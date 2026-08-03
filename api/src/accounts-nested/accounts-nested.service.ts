import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import {
    decryptCredentials,
    runInProcessSync,
    testBillingConnectorConnection,
} from "@archaser/billing-connector";
import { serializeBigInt } from "../common/serialize-bigint";
import { DatabaseService } from "../database/database.service";
import {
    areBackfillOptionsLocked,
    formatBackfillStartDateForApi,
    resolveBackfillStartDateChange,
    resolveIncludeOlderOpenInvoicesChange,
    resolveSkipReportingBreachOnBackfillChange,
} from "./billing-connector-backfill-options";

const ADMIN_ACCOUNT_ID = 10013;
const CREDIT_PRODUCT = "credit_insurance" as const;

const GENERIC_ENTITIES = ["customer", "contact", "invoice", "payment"] as const;
const GENERIC_FIELDS = [
    "text1",
    "text2",
    "number1",
    "number2",
    "date1",
    "date2",
] as const;

type GenericEntity = (typeof GENERIC_ENTITIES)[number];
type GenericField = (typeof GENERIC_FIELDS)[number];

const DEFAULT_LABELS: Record<GenericField, string> = {
    text1: "Custom Text 1",
    text2: "Custom Text 2",
    number1: "Custom Number 1",
    number2: "Custom Number 2",
    date1: "Custom Date 1",
    date2: "Custom Date 2",
};

function defaultField(field: GenericField) {
    return { enabled: false, label: DEFAULT_LABELS[field], read_only: false };
}

function defaultEntityConfig() {
    return {
        text1: defaultField("text1"),
        text2: defaultField("text2"),
        number1: defaultField("number1"),
        number2: defaultField("number2"),
        date1: defaultField("date1"),
        date2: defaultField("date2"),
    };
}

function mergeWithDefaults(
    raw: Record<string, unknown> | null | undefined
): Record<GenericEntity, ReturnType<typeof defaultEntityConfig>> {
    const base = {
        customer: defaultEntityConfig(),
        contact: defaultEntityConfig(),
        invoice: defaultEntityConfig(),
        payment: defaultEntityConfig(),
    };
    if (!raw || typeof raw !== "object") return base;
    for (const entity of GENERIC_ENTITIES) {
        const entityRaw = raw[entity] as Record<string, unknown> | undefined;
        if (!entityRaw) continue;
        for (const field of GENERIC_FIELDS) {
            const f = entityRaw[field] as Record<string, unknown> | undefined;
            if (!f) continue;
            base[entity][field] = {
                enabled:
                    typeof f.enabled === "boolean"
                        ? f.enabled
                        : base[entity][field].enabled,
                label:
                    typeof f.label === "string" && f.label.trim()
                        ? f.label.trim().slice(0, 100)
                        : base[entity][field].label,
                read_only:
                    typeof f.read_only === "boolean"
                        ? f.read_only
                        : base[entity][field].read_only,
            };
        }
    }
    return base;
}

const SMS_PREF_INCLUDE = {
    Country: {
        select: {
            id: true,
            name: true,
            iso2: true,
            iso3: true,
            phonecode: true,
            emoji: true,
        },
    },
    SMSVendor: {
        select: {
            id: true,
            name: true,
            provider: true,
            is_active: true,
            priority: true,
            cost_per_sms: true,
            currency: true,
        },
    },
} as const;

@Injectable()
export class AccountsNestedService {
    constructor(
        private readonly db: DatabaseService,
        private readonly accessScope: AccessScopeService
    ) {}

    private async assertAccountAccess(
        user: JwtPayload,
        accountId: number,
        permission?: string
    ) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const effectiveAccount =
            this.accessScope.getEffectiveAccountId(userInfo);
        if (
            userInfo.accountId !== ADMIN_ACCOUNT_ID &&
            effectiveAccount !== accountId &&
            userInfo.accountId !== accountId
        ) {
            throw new ForbiddenException({ error: "Access denied" });
        }
        if (permission) {
            const role = userInfo.viewAsUserRole || userInfo.role;
            const allowed = await this.accessScope.hasPermission(
                userInfo.accountId,
                role,
                permission
            );
            if (!allowed) {
                throw new ForbiddenException({ error: "Forbidden" });
            }
        }
        return userInfo;
    }

    private assertAdmin(user: JwtPayload) {
        const isAdmin =
            user.role === "Admin" ||
            user.role === "archaser_admin" ||
            user.account_id === ADMIN_ACCOUNT_ID;
        if (!isAdmin) {
            throw new ForbiddenException({
                error: "Forbidden - Admin access required",
            });
        }
    }

    async getAccount(user: JwtPayload, accountId: number) {
        await this.assertAccountAccess(user, accountId);
        const account = await this.db.account.findUnique({
            where: { id: accountId },
        });
        if (!account) {
            throw new NotFoundException({ error: "Account not found" });
        }
        return serializeBigInt({ data: account });
    }

    async listSmsPreferences(
        user: JwtPayload,
        accountId: number,
        countryId?: string
    ) {
        this.assertAdmin(user);
        const where: Record<string, unknown> = { account_id: accountId };
        if (countryId) {
            where.country_id = parseInt(countryId, 10);
        }
        const preferences =
            await this.db.accountSMSProviderPreferences.findMany({
                where,
                include: SMS_PREF_INCLUDE,
                orderBy: [{ priority: "asc" }, { created_at: "desc" }],
            });
        return serializeBigInt(preferences);
    }

    async createSmsPreference(
        user: JwtPayload,
        accountId: number,
        body: Record<string, unknown>
    ) {
        this.assertAdmin(user);
        const countryId = Number(body.country_id);
        const vendorId = Number(body.vendor_id);
        const priority = Number(body.priority ?? 1);
        if (!Number.isFinite(countryId) || !Number.isFinite(vendorId)) {
            throw new BadRequestException({
                error: "country_id and vendor_id are required",
            });
        }
        const existing =
            await this.db.accountSMSProviderPreferences.findFirst({
                where: {
                    account_id: accountId,
                    country_id: countryId,
                    vendor_id: vendorId,
                },
            });
        if (existing) {
            throw new ConflictException({
                error: "Customer SMS provider preference already exists",
            });
        }
        const preference =
            await this.db.accountSMSProviderPreferences.create({
                data: {
                    account_id: accountId,
                    country_id: countryId,
                    vendor_id: vendorId,
                    is_enabled: body.is_enabled !== false,
                    priority: Number.isFinite(priority) ? priority : 1,
                },
                include: SMS_PREF_INCLUDE,
            });
        return serializeBigInt(preference);
    }

    async getSmsPreference(
        user: JwtPayload,
        accountId: number,
        preferenceId: number
    ) {
        this.assertAdmin(user);
        const preference =
            await this.db.accountSMSProviderPreferences.findFirst({
                where: { id: preferenceId, account_id: accountId },
                include: SMS_PREF_INCLUDE,
            });
        if (!preference) {
            throw new NotFoundException({
                error: "Customer SMS provider preference not found",
            });
        }
        const countrySMSVendor = await this.db.countrySMSVendor.findFirst({
            where: {
                country_id: preference.country_id,
                vendor_id: preference.vendor_id,
            },
            select: { phone_number: true },
        });
        return serializeBigInt({
            ...preference,
            SMSVendor: {
                ...preference.SMSVendor,
                phone_number: countrySMSVendor?.phone_number ?? null,
            },
        });
    }

    async updateSmsPreference(
        user: JwtPayload,
        accountId: number,
        preferenceId: number,
        body: Record<string, unknown>
    ) {
        this.assertAdmin(user);
        const existing =
            await this.db.accountSMSProviderPreferences.findFirst({
                where: { id: preferenceId, account_id: accountId },
            });
        if (!existing) {
            throw new NotFoundException({
                error: "Customer SMS provider preference not found",
            });
        }
        const data: Record<string, unknown> = { modified_at: new Date() };
        if (body.country_id != null) data.country_id = Number(body.country_id);
        if (body.vendor_id != null) data.vendor_id = Number(body.vendor_id);
        if (typeof body.is_enabled === "boolean")
            data.is_enabled = body.is_enabled;
        if (body.priority != null) data.priority = Number(body.priority);
        const preference =
            await this.db.accountSMSProviderPreferences.update({
                where: { id: preferenceId },
                data,
                include: SMS_PREF_INCLUDE,
            });
        return serializeBigInt(preference);
    }

    async deleteSmsPreference(
        user: JwtPayload,
        accountId: number,
        preferenceId: number
    ) {
        this.assertAdmin(user);
        const existing =
            await this.db.accountSMSProviderPreferences.findFirst({
                where: { id: preferenceId, account_id: accountId },
            });
        if (!existing) {
            throw new NotFoundException({
                error: "Customer SMS provider preference not found",
            });
        }
        await this.db.accountSMSProviderPreferences.delete({
            where: { id: preferenceId },
        });
        return { success: true };
    }

    async updateGenericFieldConfig(
        user: JwtPayload,
        accountId: number,
        body: Record<string, unknown>
    ) {
        const userInfo = await this.assertAccountAccess(
            user,
            accountId,
            "view_settings"
        );
        const entity = body.entity as GenericEntity;
        const fieldKey = body.fieldKey as GenericField;
        if (
            !GENERIC_ENTITIES.includes(entity) ||
            !GENERIC_FIELDS.includes(fieldKey)
        ) {
            throw new BadRequestException({
                error: "Invalid entity or fieldKey",
            });
        }
        const account = await this.db.account.findUnique({
            where: { id: accountId },
            select: { generic_field_config: true },
        });
        if (!account) {
            throw new NotFoundException({ error: "Account not found" });
        }
        const current = mergeWithDefaults(
            account.generic_field_config as Record<string, unknown> | null
        );
        const existing = current[entity][fieldKey];
        current[entity][fieldKey] = {
            enabled:
                typeof body.enabled === "boolean"
                    ? body.enabled
                    : existing.enabled,
            label:
                typeof body.label === "string" && body.label.trim()
                    ? body.label.trim().slice(0, 100)
                    : existing.label,
            read_only:
                typeof body.read_only === "boolean"
                    ? body.read_only
                    : existing.read_only,
        };
        await this.db.account.update({
            where: { id: accountId },
            data: {
                generic_field_config: current,
                modified_by: this.accessScope.getEffectiveUserId(userInfo),
            },
        });
        return { success: true, generic_field_config: current };
    }

    async checkUsername(username: string, excludeUserId?: string) {
        const trimmed = username.trim();
        if (!trimmed) {
            throw new BadRequestException({
                success: false,
                error: "Username cannot be empty",
            });
        }
        const existing = await this.db.user.findFirst({
            where: {
                username: { equals: trimmed, mode: "insensitive" },
                ...(excludeUserId ? { NOT: { id: excludeUserId } } : {}),
            },
            select: { id: true },
        });
        return {
            success: true,
            available: !existing,
            username: trimmed,
        };
    }

    private toPublicBillingConfig(connector: {
        id: number;
        account_id: number;
        provider: string;
        status: string;
        base_url: string | null;
        auth_type: string;
        credentials_encrypted: string | null;
        sync_enabled: boolean;
        sync_cron_expression: string;
        sync_mode: string;
        enabled_entities: unknown;
        sync_overlap_minutes: number;
        consecutive_auth_failures: number;
        backfill_started_at?: Date | null;
        backfill_start_date?: Date | null;
        include_older_open_invoices?: boolean;
        skip_reporting_breach_on_backfill?: boolean;
        last_connection_test_at: Date | null;
        last_connection_error: string | null;
        created_at: Date;
        modified_at: Date;
    }) {
        return {
            id: connector.id,
            account_id: connector.account_id,
            provider: connector.provider,
            status: connector.status,
            base_url: connector.base_url,
            auth_type: connector.auth_type,
            has_credentials: !!connector.credentials_encrypted,
            sync_enabled: connector.sync_enabled,
            sync_cron_expression: connector.sync_cron_expression,
            sync_mode: connector.sync_mode,
            enabled_entities: connector.enabled_entities,
            sync_overlap_minutes: connector.sync_overlap_minutes,
            consecutive_auth_failures: connector.consecutive_auth_failures,
            backfill_start_date: formatBackfillStartDateForApi(
                connector.backfill_start_date
            ),
            include_older_open_invoices:
                connector.include_older_open_invoices ?? true,
            skip_reporting_breach_on_backfill:
                connector.skip_reporting_breach_on_backfill ?? false,
            backfill_options_locked: areBackfillOptionsLocked(
                connector.backfill_started_at
            ),
            last_connection_test_at:
                connector.last_connection_test_at?.toISOString() ?? null,
            last_connection_error: connector.last_connection_error,
            created_at: connector.created_at.toISOString(),
            modified_at: connector.modified_at.toISOString(),
            schedule_summary: connector.sync_cron_expression,
            next_scheduled_sync_at_utc: null,
            schedule_preset: null,
            schedule_warning: null,
        };
    }

    async getBillingConnector(user: JwtPayload, accountId: number) {
        await this.assertAccountAccess(
            user,
            accountId,
            "view_billing_connector"
        );
        const connector = await this.db.billingConnector.findUnique({
            where: { account_id: accountId },
            include: { ConnectorSyncState: true },
        });
        if (!connector) {
            return { config: null };
        }
        return serializeBigInt({
            config: {
                ...this.toPublicBillingConfig(connector),
                sync_states: connector.ConnectorSyncState.map((s) => ({
                    entity_type: s.entity_type,
                    backfill_completed: s.backfill_completed,
                    backfill_completed_at:
                        s.backfill_completed_at?.toISOString() ?? null,
                    backfill_cursor_present: !!s.backfill_cursor,
                    backfill_records_pulled: s.backfill_records_pulled,
                    backfill_total_records: s.backfill_total_records,
                    last_max_updated_at:
                        s.last_max_updated_at?.toISOString() ?? null,
                    last_successful_run_at:
                        s.last_successful_run_at?.toISOString() ?? null,
                    last_attempt_at: s.last_attempt_at?.toISOString() ?? null,
                    last_error: s.last_error,
                })),
            },
        });
    }

    async upsertBillingConnector(
        user: JwtPayload,
        accountId: number,
        body: Record<string, unknown>
    ) {
        const userInfo = await this.assertAccountAccess(
            user,
            accountId,
            "manage_billing_connector"
        );
        if (body.provider === "SAP_BUSINESS_ONE") {
            throw new BadRequestException({
                error: "SAP Business One is not available yet",
                code: "PROVIDER_NOT_SUPPORTED",
            });
        }
        const actor = this.accessScope.getEffectiveUserId(userInfo);
        const data: Record<string, unknown> = {
            modified_by: actor,
            modified_at: new Date(),
        };
        if (body.provider != null) data.provider = body.provider;
        if (body.base_url !== undefined) data.base_url = body.base_url;
        if (body.auth_type != null) data.auth_type = body.auth_type;
        if (typeof body.sync_enabled === "boolean")
            data.sync_enabled = body.sync_enabled;
        if (typeof body.sync_cron_expression === "string")
            data.sync_cron_expression = body.sync_cron_expression;
        if (Array.isArray(body.enabled_entities))
            data.enabled_entities = body.enabled_entities;
        if (body.credentials && typeof body.credentials === "object") {
            data.credentials_encrypted = JSON.stringify(body.credentials);
        }

        const existing = await this.db.billingConnector.findUnique({
            where: { account_id: accountId },
        });

        let startDateChange;
        try {
            startDateChange = resolveBackfillStartDateChange({
                backfillStartedAt: existing?.backfill_started_at,
                existingStartDate: existing?.backfill_start_date,
                nextInput:
                    body.backfill_start_date === undefined
                        ? undefined
                        : (body.backfill_start_date as string | null),
            });
        } catch (error: unknown) {
            const err = error as { code?: string; message?: string };
            if (err?.code === "INVALID_BACKFILL_START_DATE") {
                throw new BadRequestException({
                    error: err.message ?? "Invalid backfill_start_date",
                    code: err.code,
                });
            }
            throw error;
        }
        if (!startDateChange.ok) {
            throw new ConflictException({
                error: startDateChange.message,
                code: startDateChange.code,
            });
        }

        const includeOlderChange = resolveIncludeOlderOpenInvoicesChange({
            backfillStartedAt: existing?.backfill_started_at,
            existingValue: existing?.include_older_open_invoices,
            nextInput:
                body.include_older_open_invoices === undefined
                    ? undefined
                    : Boolean(body.include_older_open_invoices),
        });
        if (!includeOlderChange.ok) {
            throw new ConflictException({
                error: includeOlderChange.message,
                code: includeOlderChange.code,
            });
        }

        const skipBreachChange = resolveSkipReportingBreachOnBackfillChange({
            backfillStartedAt: existing?.backfill_started_at,
            existingValue: existing?.skip_reporting_breach_on_backfill,
            nextInput:
                body.skip_reporting_breach_on_backfill === undefined
                    ? undefined
                    : Boolean(body.skip_reporting_breach_on_backfill),
        });
        if (!skipBreachChange.ok) {
            throw new ConflictException({
                error: skipBreachChange.message,
                code: skipBreachChange.code,
            });
        }

        if (startDateChange.value !== undefined) {
            data.backfill_start_date = startDateChange.value;
        }
        if (includeOlderChange.value !== undefined) {
            data.include_older_open_invoices = includeOlderChange.value;
        }
        if (skipBreachChange.value !== undefined) {
            data.skip_reporting_breach_on_backfill = skipBreachChange.value;
        }

        const connector = existing
            ? await this.db.billingConnector.update({
                  where: { account_id: accountId },
                  data,
              })
            : await this.db.billingConnector.create({
                  data: {
                      account_id: accountId,
                      created_by: actor,
                      include_older_open_invoices:
                          includeOlderChange.value !== undefined
                              ? includeOlderChange.value
                              : true,
                      skip_reporting_breach_on_backfill:
                          skipBreachChange.value !== undefined
                              ? skipBreachChange.value
                              : false,
                      ...data,
                  },
              });
        return serializeBigInt({
            config: this.toPublicBillingConfig(connector),
        });
    }

    async billingConnectorAction(
        user: JwtPayload,
        accountId: number,
        action: "test" | "sync" | "sync-runs" | "backfill-reset",
        body?: Record<string, unknown>
    ) {
        await this.assertAccountAccess(
            user,
            accountId,
            action === "sync-runs"
                ? "view_billing_connector"
                : "manage_billing_connector"
        );
        const connector = await this.db.billingConnector.findUnique({
            where: { account_id: accountId },
        });
        if (!connector && action !== "sync-runs") {
            throw new NotFoundException({
                error: "Billing connector not configured",
            });
        }
        if (action === "test") {
            if (!connector) {
                throw new NotFoundException({
                    error: "Billing connector not configured",
                });
            }
            try {
                if (!connector.credentials_encrypted || !connector.base_url) {
                    throw new Error("Missing base_url or credentials");
                }
                const credentials = decryptCredentials(
                    connector.credentials_encrypted
                );
                const result = await testBillingConnectorConnection({
                    provider: connector.provider,
                    authType: connector.auth_type as
                        | "API_KEY"
                        | "BASIC"
                        | "OAUTH2_CLIENT_CREDENTIALS",
                    baseUrl: connector.base_url,
                    credentials,
                });
                await this.db.billingConnector.update({
                    where: { account_id: accountId },
                    data: {
                        last_connection_test_at: result.testedAt,
                        last_connection_error: result.ok
                            ? null
                            : result.error || "Connection failed",
                    },
                });
                if (!result.ok) {
                    return {
                        ok: false,
                        success: false,
                        error: result.error || "Connection failed",
                    };
                }
                return { ok: true, success: true };
            } catch (err) {
                const message =
                    err instanceof Error ? err.message : String(err);
                await this.db.billingConnector.update({
                    where: { account_id: accountId },
                    data: {
                        last_connection_test_at: new Date(),
                        last_connection_error: message,
                    },
                });
                return { ok: false, success: false, error: message };
            }
        }
        if (action === "sync") {
            const result = await runInProcessSync({
                prisma: this.db,
                accountId,
                trigger:
                    typeof body?.trigger === "string"
                        ? body.trigger
                        : "manual",
            });
            return {
                queued: false,
                inProcess: true,
                ...result,
            };
        }
        if (action === "backfill-reset") {
            if (connector) {
                await this.db.connectorSyncState.updateMany({
                    where: { connector_id: connector.id },
                    data: {
                        backfill_completed: false,
                        backfill_completed_at: null,
                        backfill_cursor: null,
                        backfill_records_pulled: 0,
                        backfill_last_checkpoint_at: null,
                        backfill_total_records: null,
                        last_max_updated_at: null,
                        last_error: null,
                    },
                });
                await this.db.billingConnector.update({
                    where: { id: connector.id },
                    data: {
                        sync_mode: "BACKFILL",
                        backfill_started_at: null,
                        modified_at: new Date(),
                    },
                });
            }
            return { ok: true, reset: true };
        }
        return { runs: [] };
    }

    async getBillingMappings(
        user: JwtPayload,
        accountId: number,
        importType: string
    ) {
        await this.assertAccountAccess(
            user,
            accountId,
            "view_billing_connector"
        );
        const connector = await this.db.billingConnector.findUnique({
            where: { account_id: accountId },
        });
        if (!connector) {
            return { mapping: null };
        }
        const row = await this.db.connectorFieldMapping.findUnique({
            where: {
                connector_id_import_type: {
                    connector_id: connector.id,
                    import_type: importType as never,
                },
            },
        });
        return serializeBigInt({ mapping: row });
    }

    async putBillingMappings(
        user: JwtPayload,
        accountId: number,
        importType: string,
        body: Record<string, unknown>
    ) {
        const userInfo = await this.assertAccountAccess(
            user,
            accountId,
            "manage_billing_connector"
        );
        const connector = await this.db.billingConnector.findUnique({
            where: { account_id: accountId },
        });
        if (!connector) {
            throw new NotFoundException({
                error: "Billing connector not configured",
            });
        }
        const actor = this.accessScope.getEffectiveUserId(userInfo);
        const mapping = body.mapping ?? body;
        const row = await this.db.connectorFieldMapping.upsert({
            where: {
                connector_id_import_type: {
                    connector_id: connector.id,
                    import_type: importType as never,
                },
            },
            create: {
                connector_id: connector.id,
                import_type: importType as never,
                mapping: mapping as object,
                is_complete: body.is_complete === true,
                modified_by: actor,
            },
            update: {
                mapping: mapping as object,
                is_complete:
                    typeof body.is_complete === "boolean"
                        ? body.is_complete
                        : undefined,
                modified_by: actor,
                modified_at: new Date(),
            },
        });
        return serializeBigInt({ mapping: row });
    }

    async discoverBillingFields(
        user: JwtPayload,
        accountId: number,
        importType: string
    ) {
        await this.assertAccountAccess(
            user,
            accountId,
            "view_billing_connector"
        );
        return { importType, fields: [] };
    }

    private mapRuleSets(
        ruleSets: Array<{
            id: number;
            account_id: number;
            product: string;
            trigger_type: string;
            enabled: boolean;
            rules: Array<{
                id: number;
                advance_day_offsets: number[];
                role_defaults: Array<{ role: string }>;
                user_overrides: Array<{ id: number; user_id: string }>;
            }>;
        }>
    ) {
        return ruleSets.map((set) => ({
            id: set.id,
            account_id: set.account_id,
            product: set.product,
            trigger_type: set.trigger_type,
            enabled: set.enabled,
            rules: set.rules.map((rule) => ({
                id: rule.id,
                advance_day_offsets: rule.advance_day_offsets || [],
                role_defaults: rule.role_defaults.map((item) => item.role),
                user_overrides: rule.user_overrides.map((item) => ({
                    id: item.id,
                    user_id: item.user_id,
                })),
            })),
        }));
    }

    async listNotificationRuleSets(user: JwtPayload, accountId: number) {
        await this.assertAccountAccess(user, accountId, "view_settings");
        const account = await this.db.account.findUnique({
            where: { id: accountId },
            select: { has_credit_insurance: true },
        });
        if (!account?.has_credit_insurance) {
            throw new ForbiddenException({
                error: "Credit insurance is not enabled for this account",
            });
        }
        const ruleSets = await this.db.notificationRuleSet.findMany({
            where: { account_id: accountId, product: CREDIT_PRODUCT },
            include: {
                rules: {
                    include: {
                        role_defaults: true,
                        user_overrides: {
                            where: { active: true },
                            orderBy: { user_id: "asc" },
                        },
                    },
                },
            },
            orderBy: { trigger_type: "asc" },
        });
        return serializeBigInt({ sets: this.mapRuleSets(ruleSets) });
    }

    async updateNotificationRuleSet(
        user: JwtPayload,
        accountId: number,
        setId: number,
        body: Record<string, unknown>
    ) {
        const userInfo = await this.assertAccountAccess(
            user,
            accountId,
            "update_insurance_policy"
        );
        const account = await this.db.account.findUnique({
            where: { id: accountId },
            select: { has_credit_insurance: true },
        });
        if (!account?.has_credit_insurance) {
            throw new ForbiddenException({
                error: "Credit insurance is not enabled for this account",
            });
        }
        const actor = this.accessScope.getEffectiveUserId(userInfo);
        const existing = await this.db.notificationRuleSet.findFirst({
            where: {
                id: setId,
                account_id: accountId,
                product: CREDIT_PRODUCT,
            },
            include: { rules: true },
        });
        if (!existing) {
            throw new NotFoundException({ error: "Rule set not found" });
        }
        if (typeof body.enabled === "boolean") {
            await this.db.notificationRuleSet.update({
                where: { id: setId },
                data: {
                    enabled: body.enabled,
                    modified_by: actor,
                    modified_at: new Date(),
                },
            });
        }
        const rule = existing.rules[0];
        if (rule && Array.isArray(body.advance_day_offsets)) {
            const offsets = body.advance_day_offsets
                .map((v) => Number.parseInt(String(v), 10))
                .filter((v) => Number.isFinite(v) && v >= 0 && v <= 365);
            await this.db.notificationRule.update({
                where: { id: rule.id },
                data: {
                    advance_day_offsets: Array.from(new Set(offsets)).sort(
                        (a, b) => b - a
                    ),
                    modified_by: actor,
                    modified_at: new Date(),
                },
            });
        }
        if (rule && Array.isArray(body.user_override_user_ids)) {
            const ids = Array.from(
                new Set(
                    body.user_override_user_ids
                        .map((v) => String(v || "").trim())
                        .filter(Boolean)
                )
            );
            await this.db.notificationRuleUserOverride.updateMany({
                where: { rule_id: rule.id },
                data: { active: false, modified_by: actor },
            });
            for (const userId of ids) {
                await this.db.notificationRuleUserOverride.upsert({
                    where: {
                        rule_id_user_id: {
                            rule_id: rule.id,
                            user_id: userId,
                        },
                    },
                    create: {
                        rule_id: rule.id,
                        user_id: userId,
                        active: true,
                        created_by: actor,
                        modified_by: actor,
                    },
                    update: {
                        active: true,
                        modified_by: actor,
                        modified_at: new Date(),
                    },
                });
            }
        }
        return this.listNotificationRuleSets(user, accountId);
    }
}
