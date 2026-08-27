/**
 * Non-production customer checkpoint: snapshot a customer's AR/collection subtree
 * into a single JSON payload and restore it verbatim later.
 *
 * This module owns the canonical table list, capture scope, delete order and insert
 * order, so ordering bugs have exactly one place to be fixed.
 */
import {
    ForbiddenException,
    Injectable,
    NotFoundException,
    OnModuleInit,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { bindCreditInsurancePrisma } from "../credit-insurance/domain-db";
import { syncCustomerInsuranceFields } from "../credit-insurance/domain/syncCustomerInsuranceFields";
import { DatabaseService } from "../database/database.service";
import { recalculateCustomerAmounts } from "./domain/recalculateCustomerAmounts";

const CHECKPOINT_SCHEMA_VERSION = 1;

/** Large test customers can hold thousands of rows; the default 5s is not enough. */
const RESTORE_TRANSACTION_TIMEOUT_MS = 120_000;
const RESTORE_TRANSACTION_MAX_WAIT_MS = 15_000;

export type CustomerCheckpointRowCounts = {
    invoices: number;
    invoicePayments: number;
    collectionPeriods: number;
    activities: number;
    activityContacts: number;
    disputes: number;
    disputeInvoices: number;
    customerPolicies: number;
    customerTopUps: number;
    contacts: number;
    customerBanks: number;
    hasAggregatedData: boolean;
};

export type CustomerCheckpointStatus = {
    exists: boolean;
    savedAt: string | null;
    savedBy: string | null;
    rowCounts?: CustomerCheckpointRowCounts;
};

export type CustomerCheckpointRestoreSummary = {
    restoredAt: string;
    rowCounts: CustomerCheckpointRowCounts;
};

type JsonRow = Record<string, unknown>;

type CheckpointPayload = {
    schemaVersion: number;
    capturedAt: string;
    tables: {
        customer: JsonRow;
    } & Record<string, JsonRow | JsonRow[]>;
};

/** Ids needed to scope child tables that have no direct `customer_id`. */
type ScopeContext = {
    customerId: number;
    activityIds: bigint[];
    disputeIds: number[];
};

type SnapshotTable = {
    /** Key in the payload and in the row-count summary. */
    key: string;
    /** Prisma model name, used for DMMF-driven value coercion. */
    model: Prisma.ModelName;
    /** Prisma client property for the model's delegate. */
    client: string;
    where: (scope: ScopeContext) => Record<string, unknown>;
};

/**
 * Insert order — parents first. Restore deletes in the exact reverse.
 *
 * Ordering constraints that must hold (all FKs are `NoAction` unless noted):
 * `Activity.invoice_id`, `Activity.collection_period_id` and `Activity.contact_id`
 * mean activities are deleted before invoices, periods and contacts;
 * `Invoice.collection_period_id` means invoices are deleted before periods.
 */
const SNAPSHOT_TABLES: SnapshotTable[] = [
    {
        key: "contacts",
        model: Prisma.ModelName.Contact,
        client: "contact",
        where: (s) => ({ customer_id: s.customerId }),
    },
    {
        key: "customerBanks",
        model: Prisma.ModelName.CustomerBanks,
        client: "customerBanks",
        where: (s) => ({ customer_id: s.customerId }),
    },
    {
        key: "collectionPeriods",
        model: Prisma.ModelName.CustomerCollectionPeriod,
        client: "customerCollectionPeriod",
        where: (s) => ({ customer_id: s.customerId }),
    },
    {
        key: "invoices",
        model: Prisma.ModelName.Invoice,
        client: "invoice",
        where: (s) => ({ customer_id: s.customerId }),
    },
    {
        key: "invoicePayments",
        model: Prisma.ModelName.InvoicePayment,
        client: "invoicePayment",
        where: (s) => ({ customer_id: s.customerId }),
    },
    {
        key: "activities",
        model: Prisma.ModelName.Activity,
        client: "activity",
        where: (s) => ({ customer_id: s.customerId }),
    },
    {
        key: "activityContacts",
        model: Prisma.ModelName.ActivityContact,
        client: "activityContact",
        where: (s) => ({ activity_id: { in: s.activityIds } }),
    },
    {
        key: "disputes",
        model: Prisma.ModelName.CustomerDispute,
        client: "customerDispute",
        where: (s) => ({ customer_id: s.customerId }),
    },
    {
        key: "disputeInvoices",
        model: Prisma.ModelName.DisputeInvoice,
        client: "disputeInvoice",
        where: (s) => ({ dispute_id: { in: s.disputeIds } }),
    },
    {
        key: "aggregatedData",
        model: Prisma.ModelName.CustomerAggregatedData,
        client: "customerAggregatedData",
        where: (s) => ({ customer_id: s.customerId }),
    },
    {
        key: "customerPolicies",
        model: Prisma.ModelName.CustomerPolicy,
        client: "customerPolicy",
        where: (s) => ({ customer_id: s.customerId }),
    },
    {
        key: "customerTopUps",
        model: Prisma.ModelName.CustomerTopUp,
        client: "customerTopUp",
        where: (s) => ({ customer_id: s.customerId }),
    },
];

type CheckpointDbClient = DatabaseService | Prisma.TransactionClient;

type Delegate = {
    findMany(args: { where: unknown }): Promise<JsonRow[]>;
    deleteMany(args: { where: unknown }): Promise<{ count: number }>;
    createMany(args: { data: JsonRow[] }): Promise<{ count: number }>;
};

function delegateFor(db: CheckpointDbClient, client: string): Delegate {
    return (db as unknown as Record<string, Delegate>)[client];
}

/** Scalar/enum field types per model, read once from the generated DMMF. */
const fieldTypeCache = new Map<string, Map<string, string>>();

function fieldTypes(model: string): Map<string, string> {
    const cached = fieldTypeCache.get(model);
    if (cached) {
        return cached;
    }
    const definition = Prisma.dmmf.datamodel.models.find(
        (m) => m.name === model
    );
    const types = new Map<string, string>();
    for (const field of definition?.fields ?? []) {
        if (field.kind === "scalar" || field.kind === "enum") {
            types.set(field.name, field.type);
        }
    }
    fieldTypeCache.set(model, types);
    return types;
}

/** Prisma runtime values -> JSON-safe primitives. */
function toJsonValue(value: unknown): unknown {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === "bigint") {
        return value.toString();
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (Prisma.Decimal.isDecimal(value)) {
        return value.toString();
    }
    if (Buffer.isBuffer(value)) {
        return value.toString("base64");
    }
    return value;
}

function toJsonRow(row: JsonRow): JsonRow {
    const out: JsonRow = {};
    for (const [key, value] of Object.entries(row)) {
        out[key] = toJsonValue(value);
    }
    return out;
}

/**
 * JSON primitives -> Prisma input values, driven by the live schema so a payload
 * captured before a column was added or dropped still restores cleanly.
 */
function fromJsonRow(model: string, row: JsonRow): JsonRow {
    const types = fieldTypes(model);
    const out: JsonRow = {};

    for (const [key, value] of Object.entries(row)) {
        const type = types.get(key);
        if (!type) {
            continue;
        }
        if (value === null || value === undefined) {
            out[key] = null;
            continue;
        }
        switch (type) {
            case "DateTime":
                out[key] = new Date(value as string);
                break;
            case "BigInt":
                out[key] = BigInt(value as string | number);
                break;
            case "Decimal":
                out[key] = new Prisma.Decimal(value as string | number);
                break;
            case "Bytes":
                out[key] = Buffer.from(value as string, "base64");
                break;
            default:
                out[key] = value;
        }
    }

    return out;
}

function rowsFor(payload: CheckpointPayload, key: string): JsonRow[] {
    const rows = payload.tables[key];
    return Array.isArray(rows) ? rows : [];
}

function countsFor(payload: CheckpointPayload): CustomerCheckpointRowCounts {
    return {
        invoices: rowsFor(payload, "invoices").length,
        invoicePayments: rowsFor(payload, "invoicePayments").length,
        collectionPeriods: rowsFor(payload, "collectionPeriods").length,
        activities: rowsFor(payload, "activities").length,
        activityContacts: rowsFor(payload, "activityContacts").length,
        disputes: rowsFor(payload, "disputes").length,
        disputeInvoices: rowsFor(payload, "disputeInvoices").length,
        customerPolicies: rowsFor(payload, "customerPolicies").length,
        customerTopUps: rowsFor(payload, "customerTopUps").length,
        contacts: rowsFor(payload, "contacts").length,
        customerBanks: rowsFor(payload, "customerBanks").length,
        hasAggregatedData: rowsFor(payload, "aggregatedData").length > 0,
    };
}

@Injectable()
export class CustomerCheckpointService implements OnModuleInit {
    constructor(
        private readonly db: DatabaseService,
        private readonly accessScope: AccessScopeService
    ) {}

    onModuleInit() {
        bindCreditInsurancePrisma(this.db);
    }

    /**
     * Enforces the PRD gates in order: non-production, customer visible to the
     * caller's account, and the account's checkpoint flag.
     */
    private async assertCheckpointAccess(
        user: JwtPayload,
        customerId: number
    ): Promise<{ accountId: number; effectiveUserId: string }> {
        if (process.env.NODE_ENV === "production") {
            throw new ForbiddenException({
                error: "Customer checkpoints are disabled in production",
                code: "CHECKPOINT_PRODUCTION_DISABLED",
            });
        }

        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const customer = await this.db.customer.findFirst({
            where: { id: customerId, account_id: accountId },
            select: {
                account_id: true,
                Account: { select: { enable_customer_checkpoints: true } },
            },
        });

        if (!customer) {
            throw new NotFoundException({
                error: "Customer not found",
                code: "CUSTOMER_NOT_FOUND",
            });
        }

        if (customer.Account?.enable_customer_checkpoints !== true) {
            throw new ForbiddenException({
                error: "Customer checkpoints are not enabled for this account",
                code: "CHECKPOINT_NOT_ENABLED",
            });
        }

        return {
            accountId: customer.account_id,
            effectiveUserId: this.accessScope.getEffectiveUserId(userInfo),
        };
    }

    private async resolveScope(
        db: CheckpointDbClient,
        customerId: number
    ): Promise<ScopeContext> {
        const [activities, disputes] = await Promise.all([
            db.activity.findMany({
                where: { customer_id: customerId },
                select: { id: true },
            }),
            db.customerDispute.findMany({
                where: { customer_id: customerId },
                select: { id: true },
            }),
        ]);

        return {
            customerId,
            activityIds: activities.map((a) => a.id),
            disputeIds: disputes.map((d) => d.id),
        };
    }

    private async capture(customerId: number): Promise<CheckpointPayload> {
        const customer = await this.db.customer.findUnique({
            where: { id: customerId },
        });
        if (!customer) {
            throw new NotFoundException({
                error: "Customer not found",
                code: "CUSTOMER_NOT_FOUND",
            });
        }

        const scope = await this.resolveScope(this.db, customerId);
        const tables: Record<string, JsonRow | JsonRow[]> = {
            customer: toJsonRow(customer as JsonRow),
        };

        for (const table of SNAPSHOT_TABLES) {
            const rows = await delegateFor(this.db, table.client).findMany({
                where: table.where(scope),
            });
            tables[table.key] = rows.map(toJsonRow);
        }

        return {
            schemaVersion: CHECKPOINT_SCHEMA_VERSION,
            capturedAt: new Date().toISOString(),
            tables: tables as CheckpointPayload["tables"],
        };
    }

    async getStatus(
        user: JwtPayload,
        customerId: number
    ): Promise<CustomerCheckpointStatus> {
        await this.assertCheckpointAccess(user, customerId);

        const checkpoint = await this.db.customerCheckpoint.findUnique({
            where: { customer_id: customerId },
        });

        if (!checkpoint) {
            return { exists: false, savedAt: null, savedBy: null };
        }

        return {
            exists: true,
            savedAt: checkpoint.saved_at.toISOString(),
            savedBy: checkpoint.saved_by,
            rowCounts: countsFor(
                checkpoint.payload as unknown as CheckpointPayload
            ),
        };
    }

    async save(
        user: JwtPayload,
        customerId: number
    ): Promise<CustomerCheckpointStatus> {
        const { accountId, effectiveUserId } = await this.assertCheckpointAccess(
            user,
            customerId
        );

        const payload = await this.capture(customerId);
        const savedAt = new Date();

        const checkpoint = await this.db.customerCheckpoint.upsert({
            where: { customer_id: customerId },
            create: {
                customer_id: customerId,
                account_id: accountId,
                payload: payload as unknown as Prisma.InputJsonValue,
                saved_at: savedAt,
                saved_by: effectiveUserId,
            },
            update: {
                account_id: accountId,
                payload: payload as unknown as Prisma.InputJsonValue,
                saved_at: savedAt,
                saved_by: effectiveUserId,
            },
        });

        return {
            exists: true,
            savedAt: checkpoint.saved_at.toISOString(),
            savedBy: checkpoint.saved_by,
            rowCounts: countsFor(payload),
        };
    }

    async restore(
        user: JwtPayload,
        customerId: number
    ): Promise<CustomerCheckpointRestoreSummary> {
        await this.assertCheckpointAccess(user, customerId);

        const checkpoint = await this.db.customerCheckpoint.findUnique({
            where: { customer_id: customerId },
        });
        if (!checkpoint) {
            throw new NotFoundException({
                error: "No checkpoint saved for this customer",
                code: "CHECKPOINT_NOT_FOUND",
            });
        }

        const payload = checkpoint.payload as unknown as CheckpointPayload;

        const legacyPaymentsSkipped = rowsFor(payload, "payments").length;
        if (legacyPaymentsSkipped > 0) {
            // Legacy Payment-table bucket — table removed; InvoicePayment is restored separately.
            console.warn(
                `[CustomerCheckpoint] skipping ${legacyPaymentsSkipped} legacy payments row(s) for customer ${customerId}`
            );
        }

        await this.db.$transaction(
            async (tx) => {
                const scope = await this.resolveScope(tx, customerId);

                for (const table of [...SNAPSHOT_TABLES].reverse()) {
                    await delegateFor(tx, table.client).deleteMany({
                        where: table.where(scope),
                    });
                }

                const customerRow = fromJsonRow(
                    Prisma.ModelName.Customer,
                    payload.tables.customer
                );
                delete customerRow.id;
                await tx.customer.update({
                    where: { id: customerId },
                    data: customerRow as Prisma.CustomerUncheckedUpdateInput,
                });

                for (const table of SNAPSHOT_TABLES) {
                    const rows = rowsFor(payload, table.key);
                    if (!rows.length) {
                        continue;
                    }
                    await delegateFor(tx, table.client).createMany({
                        data: rows.map((row) => fromJsonRow(table.model, row)),
                    });
                }
            },
            {
                timeout: RESTORE_TRANSACTION_TIMEOUT_MS,
                maxWait: RESTORE_TRANSACTION_MAX_WAIT_MS,
            }
        );

        // Post-commit re-derivation (PRD D11). Restore is verbatim, so these should
        // be no-ops unless the business rules changed since the checkpoint was saved.
        await recalculateCustomerAmounts([customerId], this.db);
        await syncCustomerInsuranceFields(customerId);

        return {
            restoredAt: new Date().toISOString(),
            rowCounts: countsFor(payload),
        };
    }
}
