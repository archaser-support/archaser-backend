import {
    ForbiddenException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
    AccessScopeService,
    AccessUserInfo,
} from "../auth/access-scope.service";
import { JwtPayload } from "../auth/jwt-payload";
import { serializeBigInt } from "../common/serialize-bigint";
import { DatabaseService } from "../database/database.service";
import { ExecuteReportDto, ReportFilterDto } from "./dto/execute-report.dto";
import {
    CONTEXT_PRIMARY_TABLE,
    CREDIT_DASHBOARD_CONTEXTS,
    DASHBOARD_REPORT_CONTEXTS,
    ENTITY_LIST_REPORT_CONTEXTS,
    FINANCIAL_DASHBOARD_CONTEXTS,
    getFieldOutputKey,
    MODEL_NAME_MAP,
    OPERATION_DASHBOARD_CONTEXTS,
    RELATION_FROM_PRIMARY,
} from "./report.constants";
import {
    bindCreditInsurancePrisma,
    enrichCreditDashboardCustomerRows,
    fetchTopUpExpiringReportAsCustomerRows,
    getLimitWarningReport,
    isCreditDashboardEnrichedSortField,
    reportConfigNeedsCreditDashboardEnrichment,
    sortCreditDashboardEnrichedRows,
} from "@archaser/credit-insurance-domain";
import { prepareDashboardActivityMarkers } from "./dashboard-activity-markers.util";
import { prepareDashboardCreditCustomerMarkers } from "./dashboard-credit-customer-markers.util";
import { prepareDashboardCreditInvoiceMarkers } from "./dashboard-credit-invoice-markers.util";
import {
    extractTrendCostReportField,
    isTrendCostBackedReportField,
    mergeLatestCustomerPolicyTrendSelect,
} from "./report-customer-trend-fields.util";
import {
    extractCustomerPolicyReportField,
    isCustomerPolicyBackedReportField,
    mergeActiveCustomerPolicySelect,
} from "@archaser/credit-insurance-domain";
import {
    attachLinkingIds,
    getFieldLinkMetadata,
} from "./report-link.util";
import {
    mergeAndWhere,
    splitFiltersByTable,
} from "./report-filter.util";
import {
    buildAccountScopeWhere,
    nestBusinessUnitScopeWhere,
    nestOwnerScopeWhere,
    reportVisibilityWhere,
} from "./report-scope.util";
import {
    applyComputedFieldSelect,
    extractComputedFieldValue,
    formatTermsBreachReasonForDisplay,
    isComputedReportField,
    isPrismaListRelation,
    isPrismaScalarField,
    resolveComputedSortTarget,
    sortFormattedReportRows,
} from "./report-virtual-fields.util";
import {
    REPORT_METADATA,
    resolveReportFieldType,
} from "./report-metadata";
import {
    applyFormulasToRows,
    mergeFormulaOperandFieldsIntoConfig,
} from "./report-formula/formula-execution";
import {
    FormulaWarningSummary,
    ReportFormula,
    FORMULA_OUTPUT_KEY_PREFIX,
} from "./report-formula/types";
import {
    formatReportDate,
    formatReportDateTime,
} from "./report-datetime.util";

type ReportConfig = {
    tables?: string[];
    fields?: Array<{
        table: string;
        field: string;
        alias?: string;
        aggregation?: string;
    }>;
    filters?: ReportFilterDto[];
    sorting?: Array<{ field: string; direction?: string }>;
    grouping?: string[];
    formulas?: ReportFormula[];
};

type PrismaWhere = Record<string, unknown>;
type ExecuteReportResult = {
    data: Record<string, unknown>[];
    totalRecords: number;
    formulaWarnings?: FormulaWarningSummary[];
};

@Injectable()
export class ReportExecutionService {
    constructor(
        private readonly db: DatabaseService,
        private readonly access: AccessScopeService
    ) {
        bindCreditInsurancePrisma(this.db);
    }

    async execute(
        user: JwtPayload,
        reportId: number,
        body: ExecuteReportDto
    ): Promise<ExecuteReportResult> {
        const userInfo = await this.access.resolveUserInfo(user);
        const accountId = this.access.getEffectiveAccountId(userInfo);
        const role = userInfo.viewAsUserRole || userInfo.role;

        const report = await this.db.report.findFirst({
            where: { id: reportId, ...reportVisibilityWhere(accountId) },
        });
        if (!report) {
            throw new NotFoundException("Report not found");
        }

        await this.assertExecutePermission(accountId, role, report.context);

        const config = mergeFormulaOperandFieldsIntoConfig(
            (report.report_config || {}) as ReportConfig,
            REPORT_METADATA.tables
        );
        const primaryTable =
            CONTEXT_PRIMARY_TABLE[report.context || ""] ||
            config.tables?.[0] ||
            "Customer";
        const modelKey = MODEL_NAME_MAP[primaryTable];
        if (!modelKey) {
            throw new ForbiddenException(
                `Unsupported report primary table: ${primaryTable}`
            );
        }

        const delegate = (this.db as unknown as Record<string, unknown>)[
            modelKey
        ] as {
            findMany: (args: unknown) => Promise<Record<string, unknown>[]>;
            count: (args: unknown) => Promise<number>;
        };
        if (!delegate?.findMany || !delegate?.count) {
            throw new ForbiddenException(
                `No Prisma delegate for ${primaryTable}`
            );
        }

        const page = body.page && body.page > 0 ? body.page : 1;
        // Grids use ~50–100; ViewBasedDataGrid export posts up to 10000.
        const limit =
            body.limit && body.limit > 0 ? Math.min(body.limit, 10000) : 20;
        const skip = (page - 1) * limit;

        const configFilters = Array.isArray(config.filters)
            ? config.filters
            : [];
        const bodyFilters = Array.isArray(body.filters) ? body.filters : [];
        let filters = body.replaceConfigFilters
            ? bodyFilters
            : [...configFilters, ...bodyFilters];

        let activityExtras: PrismaWhere | undefined;
        let skipSelectedUserOnActivity = false;
        if (primaryTable === "Activity") {
            const prepared = await prepareDashboardActivityMarkers(filters, {
                db: this.db,
                accountId,
                selectedUserId: body.selectedUserId,
                isAdmin:
                    this.access.isAdminAccount(accountId) ||
                    (userInfo.viewAsUserRole || userInfo.role) ===
                        "System_Administrator",
            });
            filters = prepared.filters;
            activityExtras = prepared.primaryWhereExtras;
            skipSelectedUserOnActivity = prepared.skipsSelectedUserScope;
        }

        let creditCustomerExtras: PrismaWhere | undefined;
        let creditInvoiceExtras: PrismaWhere | undefined;
        let creditDashboardPolicyId: number | undefined;
        let creditDashboardWithinDays: number | undefined;
        let creditDashboardAsOfDate: string | undefined;
        let creditCustomerMembershipType:
            | "capacity"
            | "policy_risk"
            | "limit_warning"
            | "zero_limit_warning"
            | "no_policy_exposure"
            | "top_up"
            | "top_up_expiring"
            | "utilization_bin"
            | null
            | undefined;
        if (report.context === "dashboard_credit_customers") {
            const prepared = await prepareDashboardCreditCustomerMarkers(
                filters,
                { accountId }
            );
            filters = prepared.filters;
            creditCustomerExtras = prepared.primaryWhereExtras;
            creditDashboardPolicyId = prepared.policyId;
            creditDashboardWithinDays = prepared.withinDays;
            creditDashboardAsOfDate = prepared.asOfDate;
            creditCustomerMembershipType = prepared.membershipType;
        } else if (report.context === "dashboard_credit_invoices") {
            const prepared = await prepareDashboardCreditInvoiceMarkers(
                filters,
                { accountId }
            );
            filters = prepared.filters;
            creditInvoiceExtras = prepared.primaryWhereExtras;
        }

        const scopeWhere = await this.buildScopeWhere(
            userInfo,
            accountId,
            primaryTable,
            body,
            { skipSelectedUserId: skipSelectedUserOnActivity }
        );
        const { primary: filterPrimary, nested } = splitFiltersByTable(
            this.normalizeFilters(filters, primaryTable),
            primaryTable
        );

        const nestedWhere: PrismaWhere = {};
        const relationMap = RELATION_FROM_PRIMARY[primaryTable] || {};
        for (const [table, where] of Object.entries(nested)) {
            const rel = relationMap[table];
            if (rel) {
                // Filters on a to-many relation belong inside `some` so they
                // must all be satisfied by the same related row.
                nestedWhere[rel] = isPrismaListRelation(primaryTable, rel)
                    ? { some: where }
                    : where;
            }
        }

        const searchWhere = this.buildSearchWhere(
            primaryTable,
            body.search,
            config.fields || []
        );

        const where = mergeAndWhere(
            scopeWhere,
            filterPrimary,
            nestedWhere,
            searchWhere,
            activityExtras,
            creditCustomerExtras,
            creditInvoiceExtras
        );

        const fields = (config.fields || []).filter((f) => !f.aggregation);
        const select = this.buildSelect(primaryTable, fields);

        const reportUniqueName = (report as { unique_name?: string | null })
            .unique_name;
        const isTopUpExpiringReport =
            reportUniqueName ===
                "dashboard_credit_customers_top_up_expiring" ||
            creditCustomerMembershipType === "top_up_expiring";

        if (isTopUpExpiringReport && primaryTable === "Customer") {
            const rawSortDir = (
                body.sortDirection ||
                config.sorting?.[0]?.direction ||
                "asc"
            ).toString();
            const topUpResult = await fetchTopUpExpiringReportAsCustomerRows({
                accountId,
                page,
                limit,
                search: body.search,
                sortField: body.sortField || config.sorting?.[0]?.field,
                sortDirection:
                    rawSortDir.toLowerCase() === "desc" ? "DESC" : "ASC",
                policyId: creditDashboardPolicyId,
                withinDays: creditDashboardWithinDays ?? 30,
            });
            const locale = body.locale || "en-US";
            const timezone = body.timezone;
            const data = topUpResult.rows.map((row) =>
                this.formatRow(
                    row,
                    primaryTable,
                    fields,
                    locale,
                    creditDashboardPolicyId,
                    timezone
                )
            );
            const formulaResult = applyFormulasToRows(data, config, {
                locale,
                metadataTables: REPORT_METADATA.tables,
            });
            return serializeBigInt({
                data: formulaResult.rows,
                totalRecords: topUpResult.total,
                ...(formulaResult.warnings.length
                    ? { formulaWarnings: formulaResult.warnings }
                    : {}),
            });
        }

        const effectiveSortField =
            body.sortField || config.sorting?.[0]?.field;
        const effectiveSortDirection =
            body.sortDirection ||
            (config.sorting?.[0]?.direction?.toLowerCase() === "asc"
                ? "asc"
                : "desc");
        const computedSortTarget = resolveComputedSortTarget(
            effectiveSortField,
            primaryTable,
            fields
        );
        const needsComputedFormattedSort = computedSortTarget != null;
        // Enriched metrics (Open AR, policy risk, …) must sort in memory after
        // enrichment — independent of report.context so builder/copied reports work.
        const needsCreditDashboardInMemorySort =
            primaryTable === "Customer" &&
            !!effectiveSortField &&
            (isCreditDashboardEnrichedSortField(effectiveSortField) ||
                (report.context === "dashboard_credit_customers" &&
                    isCustomerPolicyBackedReportField(effectiveSortField)));
        const needsInMemorySort =
            needsCreditDashboardInMemorySort || needsComputedFormattedSort;

        const orderBy = needsInMemorySort
            ? []
            : this.buildOrderBy(
                  primaryTable,
                  body.sortField,
                  body.sortDirection,
                  config.sorting
              );

        const findArgs: Record<string, unknown> = {
            where,
            skip: needsInMemorySort ? undefined : skip,
            take: needsInMemorySort ? undefined : limit,
            orderBy: orderBy.length ? orderBy : undefined,
            select,
        };

        let [rows, totalRecords] = await Promise.all([
            delegate.findMany(findArgs),
            delegate.count({ where }),
        ]);

        // Open AR / related metrics are not Prisma columns — always enrich when
        // requested, even if context is wrong/null (staging copied reports, builder).
        if (
            primaryTable === "Customer" &&
            reportConfigNeedsCreditDashboardEnrichment(fields)
        ) {
            const requestedCustomerFields = fields
                .filter((f) => f.table === "Customer" && f.field)
                .map((f) => f.field as string);
            // Sorting by an enriched field must still compute it even if hidden.
            if (
                effectiveSortField &&
                isCreditDashboardEnrichedSortField(effectiveSortField)
            ) {
                const sortLeaf = effectiveSortField.startsWith("Customer.")
                    ? effectiveSortField.slice("Customer.".length)
                    : effectiveSortField;
                if (!requestedCustomerFields.includes(sortLeaf)) {
                    requestedCustomerFields.push(sortLeaf);
                }
            }
            let limitWarningByCustomerId:
                | Map<
                      number,
                      Awaited<
                          ReturnType<typeof getLimitWarningReport>
                      >["rows"][number]
                  >
                | undefined;
            if (requestedCustomerFields.includes("limit_warning_summary")) {
                const { rows: warningRows } = await getLimitWarningReport(
                    accountId,
                    100_000,
                    0,
                    { policyId: creditDashboardPolicyId }
                );
                limitWarningByCustomerId = new Map(
                    warningRows.map((r) => [r.customerId, r])
                );
            }
            rows = await enrichCreditDashboardCustomerRows(rows, {
                accountId,
                policyId: creditDashboardPolicyId,
                requestedFields: requestedCustomerFields,
                limitWarningByCustomerId,
                asOfDate: creditDashboardAsOfDate,
            });
        }

        if (needsCreditDashboardInMemorySort && effectiveSortField) {
            rows = sortCreditDashboardEnrichedRows(
                rows,
                effectiveSortField,
                effectiveSortDirection
            );
            totalRecords = rows.length;
            rows = rows.slice(skip, skip + limit);
        }

        const locale = body.locale || "en-US";
        const timezone = body.timezone;
        const data = rows.map((row) =>
            this.formatRow(
                row,
                primaryTable,
                fields,
                locale,
                creditDashboardPolicyId,
                timezone
            )
        );
        const formulaResult = applyFormulasToRows(data, config, {
            locale,
            metadataTables: REPORT_METADATA.tables,
        });

        let resultRows = formulaResult.rows;
        if (needsComputedFormattedSort && computedSortTarget) {
            resultRows = sortFormattedReportRows(
                resultRows,
                computedSortTarget.outputKey,
                effectiveSortDirection === "desc" ? "desc" : "asc"
            );
            totalRecords = resultRows.length;
            resultRows = resultRows.slice(skip, skip + limit);
        }

        return serializeBigInt({
            data: resultRows,
            totalRecords,
            ...(formulaResult.warnings.length
                ? { formulaWarnings: formulaResult.warnings }
                : {}),
        });
    }

    private async assertExecutePermission(
        accountId: number,
        role: string,
        context: string | null
    ): Promise<void> {
        const canViewReports = await this.access.hasPermission(
            accountId,
            role,
            "view_reports"
        );
        if (canViewReports) {
            return;
        }
        // Customer-detail embedded grids (contacts, banks, etc.)
        if (context && ENTITY_LIST_REPORT_CONTEXTS.has(context)) {
            if (
                await this.access.hasPermission(
                    accountId,
                    role,
                    "view_customers"
                )
            ) {
                return;
            }
            if (
                (context === "contacts" || context === "customer_contacts") &&
                (await this.access.hasPermission(
                    accountId,
                    role,
                    "view_contacts"
                ))
            ) {
                return;
            }
        }
        if (!context || !DASHBOARD_REPORT_CONTEXTS.has(context)) {
            throw new ForbiddenException(
                "You do not have permission to execute reports"
            );
        }
        if (FINANCIAL_DASHBOARD_CONTEXTS.has(context)) {
            if (
                await this.access.hasPermission(
                    accountId,
                    role,
                    "view_financial_dashboard"
                )
            ) {
                return;
            }
        }
        if (OPERATION_DASHBOARD_CONTEXTS.has(context)) {
            if (
                await this.access.hasPermission(
                    accountId,
                    role,
                    "view_operation_dashboard"
                )
            ) {
                return;
            }
        }
        if (CREDIT_DASHBOARD_CONTEXTS.has(context)) {
            if (
                await this.access.hasPermission(
                    accountId,
                    role,
                    "view_credit_dashboard"
                )
            ) {
                return;
            }
        }
        throw new ForbiddenException(
            "You do not have permission to execute reports"
        );
    }

    private async buildScopeWhere(
        userInfo: AccessUserInfo,
        accountId: number,
        primaryTable: string,
        body: ExecuteReportDto,
        options: { skipSelectedUserId?: boolean } = {}
    ): Promise<PrismaWhere> {
        const parts: PrismaWhere[] = [
            buildAccountScopeWhere(primaryTable, accountId),
        ];

        const hasViewAs = await this.access.hasPermission(
            accountId,
            userInfo.viewAsUserRole || userInfo.role,
            "use_view_as"
        );
        const effectiveUserId = this.access.getEffectiveUserId(userInfo);
        const ownerFilter = await this.access.getOwnerFilter(
            effectiveUserId,
            hasViewAs,
            userInfo.viewAsUserId,
            userInfo.viewAsUserRole,
            userInfo.viewAsUserAccountId
        );

        const nestedOwner = nestOwnerScopeWhere(primaryTable, ownerFilter);
        if (nestedOwner) {
            parts.push(nestedOwner);
        }

        const isAdmin =
            this.access.isAdminAccount(accountId) ||
            (userInfo.viewAsUserRole || userInfo.role) ===
                "System_Administrator";
        const buFilter = await this.access.getBusinessUnitFilter(
            userInfo.businessUnitId,
            isAdmin,
            accountId
        );
        const nestedBu = nestBusinessUnitScopeWhere(primaryTable, buFilter);
        if (nestedBu) {
            parts.push(nestedBu);
        }

        if (body.businessUnitId != null && body.businessUnitId > 0) {
            const ids = [
                body.businessUnitId,
                ...(await this.access.getBusinessUnitHierarchy(
                    body.businessUnitId
                )),
            ];
            const selectedBu = nestBusinessUnitScopeWhere(primaryTable, {
                business_unit_id: { in: ids },
            });
            if (selectedBu) {
                parts.push(selectedBu);
            }
        }

        if (body.selectedUserId && !options.skipSelectedUserId) {
            if (primaryTable === "Activity") {
                parts.push({
                    OR: [
                        { created_by: body.selectedUserId },
                        { owner_id: body.selectedUserId },
                    ],
                });
            } else if (
                primaryTable === "Customer" ||
                primaryTable === "Invoice"
            ) {
                parts.push({ owner_id: body.selectedUserId });
            }
        }

        return mergeAndWhere(...parts);
    }

    private buildSearchWhere(
        primaryTable: string,
        search: string | undefined,
        _fields: Array<{ table: string; field: string }>
    ): PrismaWhere | null {
        const q = (search || "").trim();
        if (!q) {
            return null;
        }
        if (primaryTable === "Customer") {
            return {
                OR: [
                    {
                        customer_number: {
                            contains: q,
                            mode: "insensitive",
                        },
                    },
                    {
                        Company: {
                            name: { contains: q, mode: "insensitive" },
                        },
                    },
                    {
                        Person: {
                            full_name: {
                                contains: q,
                                mode: "insensitive",
                            },
                        },
                    },
                ],
            };
        }
        if (primaryTable === "Invoice") {
            return {
                invoice_number: { contains: q, mode: "insensitive" },
            };
        }
        if (primaryTable === "Contact") {
            return { email: { contains: q, mode: "insensitive" } };
        }
        return null;
    }

    /**
     * Build a Prisma `select` that supports:
     * - scalar columns on the primary table
     * - dotted relation fields stored as `Country.name` on the primary table
     * - common Customer virtual fields (name, category, parent_customer_name)
     */
    private buildSelect(
        primaryTable: string,
        fields: Array<{ table: string; field: string }>
    ): Record<string, unknown> {
        const select: Record<string, unknown> = { id: true };
        const relationMap = RELATION_FROM_PRIMARY[primaryTable] || {};

        const ensureRelSelect = (
            rel: string
        ): Record<string, unknown> => {
            const existing = select[rel];
            if (
                existing &&
                typeof existing === "object" &&
                existing !== null &&
                "select" in (existing as object)
            ) {
                return (existing as { select: Record<string, unknown> })
                    .select;
            }
            const nested: Record<string, unknown> = { id: true };
            select[rel] = { select: nested };
            return nested;
        };

        for (const f of fields) {
            if (f.table === primaryTable) {
                if (this.applyVirtualSelect(primaryTable, f.field, select)) {
                    continue;
                }
                if (this.applyAuditUserSelect(primaryTable, f.field, select)) {
                    continue;
                }
                if (
                    primaryTable === "Customer" &&
                    f.field === "InsurancePolicy.policy_number"
                ) {
                    this.applyCustomerPolicyNumberSelect(select);
                    continue;
                }
                if (
                    primaryTable === "Invoice" &&
                    f.field === "InsurancePolicy.policy_number"
                ) {
                    this.applyInvoicePolicyNumberSelect(select);
                    continue;
                }
                if (f.field.includes(".")) {
                    const [relTable, ...rest] = f.field.split(".");
                    const rel = relationMap[relTable] || relTable;
                    const leaf = rest.join(".");
                    if (leaf === "name" && relTable === "Customer") {
                        this.applyCustomerNameSelect(ensureRelSelect(rel));
                        continue;
                    }
                    if (leaf === "category" && relTable === "Customer") {
                        const nested = ensureRelSelect(rel);
                        nested.CustomerCollectionPeriod = {
                            take: 1,
                            orderBy: { id: "desc" },
                            select: { id: true, current_category: true },
                        };
                        continue;
                    }
                    if (
                        leaf &&
                        applyComputedFieldSelect(
                            relTable,
                            leaf,
                            ensureRelSelect(rel)
                        )
                    ) {
                        continue;
                    }
                    if (
                        leaf &&
                        !isPrismaScalarField(relTable, leaf) &&
                        !leaf.includes(".")
                    ) {
                        continue;
                    }
                    if (leaf) {
                        ensureRelSelect(rel)[leaf] = true;
                    }
                    continue;
                }
                // Skip unknown / virtual scalars — never send them to Prisma.
                if (!isPrismaScalarField(primaryTable, f.field)) {
                    continue;
                }
                select[f.field] = true;
                continue;
            }
            const rel = relationMap[f.table];
            if (!rel) {
                // CustomerBanks → AccountBankAccounts → Country (report joins Country via bank account)
                if (
                    primaryTable === "CustomerBanks" &&
                    f.table === "Country"
                ) {
                    const aba = ensureRelSelect("AccountBankAccounts");
                    const existing = aba.Country;
                    const countrySelect =
                        existing &&
                        typeof existing === "object" &&
                        existing !== null &&
                        "select" in (existing as object)
                            ? (
                                  existing as {
                                      select: Record<string, unknown>;
                                  }
                              ).select
                            : { id: true };
                    if (isPrismaScalarField("Country", f.field)) {
                        countrySelect[f.field] = true;
                    }
                    aba.Country = { select: countrySelect };
                }
                continue;
            }
            if (f.table === "Customer" && f.field === "name") {
                this.applyCustomerNameSelect(ensureRelSelect(rel));
                continue;
            }
            if (
                f.table === "Customer" &&
                f.field === "InsurancePolicy.policy_number"
            ) {
                this.applyCustomerPolicyNumberSelect(ensureRelSelect(rel));
                continue;
            }
            if (f.table === "Customer" && f.field === "category") {
                const nested = ensureRelSelect(rel);
                nested.CustomerCollectionPeriod = {
                    take: 1,
                    orderBy: { id: "desc" },
                    select: { id: true, current_category: true },
                };
                continue;
            }
            if (
                applyComputedFieldSelect(
                    f.table,
                    f.field,
                    ensureRelSelect(rel)
                )
            ) {
                continue;
            }
            if (
                f.table === "Contact" &&
                (f.field === "first_name" || f.field === "last_name")
            ) {
                const nested = ensureRelSelect(rel);
                nested[f.field] = true;
                nested.customer_id = true;
                continue;
            }
            if (!isPrismaScalarField(f.table, f.field)) {
                continue;
            }
            ensureRelSelect(rel)[f.field] = true;
        }

        this.enrichSelectForLinks(primaryTable, fields, select);
        if (primaryTable === "Customer") {
            const customerFields = fields
                .filter((f) => f.table === "Customer")
                .map((f) => f.field);
            mergeActiveCustomerPolicySelect(select, customerFields);
            mergeLatestCustomerPolicyTrendSelect(select, customerFields);
        }
        return select;
    }

    private applyCustomerPolicyNumberSelect(
        select: Record<string, unknown>
    ): void {
        const existing = select.CustomerPolicy as
            | {
                  select?: Record<string, unknown>;
                  take?: number;
                  orderBy?: Record<string, "asc" | "desc">;
              }
            | undefined;
        const existingSelect =
            existing?.select && typeof existing.select === "object"
                ? existing.select
                : {};

        select.CustomerPolicy = {
            ...(existing || {}),
            take: 1,
            orderBy: { id: "desc" as const },
            select: {
                ...existingSelect,
                id: true,
                insurance_policy_id: true,
                InsurancePolicy: {
                    select: {
                        id: true,
                        policy_number: true,
                    },
                },
            },
        };
    }

    private applyInvoicePolicyNumberSelect(
        select: Record<string, unknown>
    ): void {
        select.policy_id = true;
        const existing = select.InsurancePolicy as
            | { select?: Record<string, unknown> }
            | undefined;
        const existingSelect =
            existing?.select && typeof existing.select === "object"
                ? existing.select
                : {};
        select.InsurancePolicy = {
            select: {
                ...existingSelect,
                id: true,
                policy_number: true,
            },
        };
    }

    /** Ensure FKs / Customer.id needed for __link_* metadata are selected. */
    private enrichSelectForLinks(
        primaryTable: string,
        fields: Array<{ table: string; field: string }>,
        select: Record<string, unknown>
    ): void {
        const tables = new Set(fields.map((f) => f.table));
        const fieldNames = new Set(
            fields
                .filter((f) => f.table === primaryTable)
                .map((f) => f.field)
        );

        if (primaryTable === "Customer") {
            if (fieldNames.has("parent_customer_name")) {
                select.parent_customer_id = true;
            }
            return;
        }

        if (primaryTable === "Contact") {
            select.customer_id = true;
            return;
        }

        if (
            tables.has("Customer") ||
            tables.has("Contact") ||
            primaryTable === "Dispute" ||
            primaryTable === "Activity" ||
            primaryTable === "Invoice"
        ) {
            select.customer_id = true;
        }
    }

    /** Expand known virtual fields into includes; returns true if handled. */
    private applyVirtualSelect(
        primaryTable: string,
        field: string,
        select: Record<string, unknown>
    ): boolean {
        if (applyComputedFieldSelect(primaryTable, field, select)) {
            return true;
        }

        if (primaryTable === "Customer") {
            if (field === "name") {
                this.applyCustomerNameSelect(select);
                return true;
            }
            if (field === "parent_customer_name") {
                select.parent_customer_id = true;
                select.ParentCustomer = {
                    select: {
                        id: true,
                        type: true,
                        customer_number: true,
                        Company: { select: { name: true } },
                        Person: {
                            select: {
                                first_name: true,
                                last_name: true,
                                full_name: true,
                            },
                        },
                    },
                };
                return true;
            }
            if (field === "category") {
                select.CustomerCollectionPeriod = {
                    take: 1,
                    orderBy: { id: "desc" },
                    select: { id: true, current_category: true },
                };
                return true;
            }
            return false;
        }

        if (primaryTable === "Dispute") {
            if (field === "dispute_number") {
                select.id = true;
                select.customer_id = true;
                select.Customer = { select: { id: true } };
                return true;
            }
            if (field === "assigned_to") {
                select.owner_id = true;
                select.User_CustomerDispute_owner_idToUser = {
                    select: {
                        id: true,
                        name: true,
                        first_name: true,
                        last_name: true,
                    },
                };
                return true;
            }
            if (field === "dispute_reason") {
                select.DisputeReason = {
                    select: { id: true, name: true },
                };
                return true;
            }
            if (
                field === "amount_in_dispute" ||
                field === "days_past_due"
            ) {
                select.DisputeInvoice = {
                    select: {
                        id: true,
                        Invoice: {
                            select: {
                                id: true,
                                outstanding_debt: true,
                                due_date: true,
                            },
                        },
                    },
                };
                return true;
            }
        }

        if (primaryTable === "Activity") {
            if (field === "call_time") {
                // Virtual: actual_delivery_time || created_at
                select.actual_delivery_time = true;
                select.created_at = true;
                return true;
            }
            if (field === "call_direction") {
                // Virtual: extracted from title_params.callType
                select.title_params = true;
                return true;
            }
        }

        return false;
    }

    private applyCustomerNameSelect(
        select: Record<string, unknown>
    ): void {
        select.customer_number = true;
        select.Company = { select: { id: true, name: true } };
        select.Person = {
            select: {
                id: true,
                first_name: true,
                last_name: true,
                full_name: true,
            },
        };
    }

    /** Remap report filter aliases to real Prisma columns before query build. */
    private normalizeFilters(
        filters: ReportFilterDto[],
        primaryTable: string
    ): ReportFilterDto[] {
        return filters.map((f) => {
            if (
                primaryTable === "Dispute" &&
                f.table === "Dispute" &&
                f.field === "assigned_to"
            ) {
                return { ...f, field: "owner_id" };
            }
            return f;
        });
    }

    private buildOrderBy(
        primaryTable: string,
        sortField: string | undefined,
        sortDirection: "asc" | "desc" | undefined,
        configSorting?: Array<{ field: string; direction?: string }>
    ): PrismaWhere[] {
        const dir = (sortDirection || "desc") as "asc" | "desc";
        if (sortField) {
            const parsed = this.parseSortField(sortField, primaryTable);
            if (parsed) {
                return [parsed(dir)];
            }
        }
        if (configSorting?.length) {
            const out: PrismaWhere[] = [];
            for (const s of configSorting) {
                const parsed = this.parseSortField(s.field, primaryTable);
                if (parsed) {
                    out.push(
                        parsed(
                            (s.direction || "asc").toLowerCase() === "desc"
                                ? "desc"
                                : "asc"
                        )
                    );
                }
            }
            return out;
        }
        return [{ id: "desc" }];
    }

    private parseSortField(
        sortField: string,
        primaryTable: string
    ): ((dir: "asc" | "desc") => PrismaWhere) | null {
        const raw = (sortField || "").trim();
        if (!raw) {
            return null;
        }

        // Formula results are computed after fetch; they cannot drive SQL ORDER BY.
        if (raw.startsWith(FORMULA_OUTPUT_KEY_PREFIX)) {
            return null;
        }

        // Aggregated output keys (e.g. Invoice.amount__COUNT) must not be treated as
        // nested scalar paths — Prisma rejects `{ Invoice: { amount__COUNT: "asc" } }`.
        const aggregationOrderBy = this.parseAggregationSortField(
            raw,
            primaryTable
        );
        if (aggregationOrderBy) {
            return aggregationOrderBy;
        }

        // Normalize "Customer.name" → compare as field on primary
        const normalized =
            raw.startsWith(`${primaryTable}.`) && raw.split(".").length === 2
                ? raw.slice(primaryTable.length + 1)
                : raw;

        if (primaryTable === "Customer") {
            if (normalized === "name") {
                return (dir) => ({ Company: { name: dir } });
            }
            if (normalized === "InsurancePolicy.policy_number") {
                // Customer -> CustomerPolicy is one-to-many; Prisma cannot
                // order Customer rows by a nested list relation field directly.
                // Fall back to stable id sorting to avoid runtime query errors.
                return (dir) => ({ id: dir });
            }
            if (
                normalized === "parent_customer_name" ||
                normalized === "category"
            ) {
                return (dir) => ({ id: dir });
            }
        }

        if (primaryTable === "Invoice") {
            if (normalized === "InsurancePolicy.policy_number") {
                return (dir) => ({
                    InsurancePolicy: { policy_number: dir },
                });
            }
        }

        if (primaryTable === "Dispute") {
            if (normalized === "dispute_number") {
                return (dir) => ({ id: dir });
            }
            if (normalized === "assigned_to") {
                return (dir) => ({
                    User_CustomerDispute_owner_idToUser: { name: dir },
                });
            }
            if (normalized === "dispute_reason") {
                return (dir) => ({ DisputeReason: { name: dir } });
            }
            if (
                normalized === "amount_in_dispute" ||
                normalized === "days_past_due"
            ) {
                return (dir) => ({ id: dir });
            }
        }

        if (primaryTable === "Activity") {
            if (normalized === "call_time") {
                // Prefer delivery time; fall back sort on created_at is in-memory in leaves.
                return (dir) => ({ actual_delivery_time: dir });
            }
            if (normalized === "call_direction") {
                return (dir) => ({ id: dir });
            }
        }

        // Plain scalar on primary — skip virtual/unknown columns.
        if (!normalized.includes(".")) {
            if (
                isComputedReportField(primaryTable, normalized) ||
                !isPrismaScalarField(primaryTable, normalized)
            ) {
                return (dir) => ({ id: dir });
            }
            return (dir) => ({ [normalized]: dir });
        }

        // Relation leaf: Country.name / Customer.name
        const parts = normalized.startsWith(`${primaryTable}.`)
            ? normalized.split(".").slice(1)
            : normalized.split(".");
        if (parts.length >= 2) {
            const relTable = parts[0];
            const leaf = parts.slice(1).join(".");
            // Never treat aggregation suffixes as relation scalars.
            if (/__(SUM|AVG|COUNT|MIN|MAX)$/i.test(leaf)) {
                return (dir) => ({ id: dir });
            }
            const rel =
                (RELATION_FROM_PRIMARY[primaryTable] || {})[relTable] ||
                relTable;
            // Customer.name is virtual (Company/Person), not a Customer column
            if (relTable === "Customer" && leaf === "name") {
                return (dir) => ({ [rel]: { Company: { name: dir } } });
            }
            if (leaf.includes(".")) {
                const [nestedRel, nestedLeaf] = leaf.split(".");
                return (dir) => ({
                    [rel]: { [nestedRel]: { [nestedLeaf]: dir } },
                });
            }
            // To-many relations cannot be ordered by a nested leaf scalar.
            if (isPrismaListRelation(primaryTable, rel)) {
                return (dir) => ({ id: dir });
            }
            return (dir) => ({ [rel]: { [leaf]: dir } });
        }

        return null;
    }

    /**
     * Map report builder sort keys like `Invoice.amount__COUNT` to Prisma
     * relation aggregate orderBy. Falls back to stable `id` when unsupported.
     */
    private parseAggregationSortField(
        sortField: string,
        primaryTable: string
    ): ((dir: "asc" | "desc") => PrismaWhere) | null {
        const match = sortField.match(/^(.*)__(SUM|AVG|COUNT|MIN|MAX)$/i);
        if (!match) {
            return null;
        }
        const basePath = match[1];
        const aggregation = match[2].toUpperCase();

        let path = basePath;
        if (path.startsWith(`${primaryTable}.`)) {
            path = path.slice(primaryTable.length + 1);
        }

        const parts = path.split(".").filter(Boolean);
        if (parts.length === 0) {
            return (dir) => ({ id: dir });
        }

        // Primary-table aggregate (e.g. amount__COUNT) is not a Prisma orderBy.
        if (parts.length === 1 || parts[0] === primaryTable) {
            return (dir) => ({ id: dir });
        }

        const relTable = parts[0];
        const rel =
            (RELATION_FROM_PRIMARY[primaryTable] || {})[relTable] || relTable;

        if (!isPrismaListRelation(primaryTable, rel)) {
            return (dir) => ({ id: dir });
        }

        if (aggregation === "COUNT") {
            // Prisma relation orderBy supports only `_count` (not _sum/_avg/…).
            return (dir) => ({ [rel]: { _count: dir } });
        }

        // SUM / AVG / MIN / MAX cannot drive Prisma findMany orderBy on
        // to-many relations — `{ Invoice: { _sum: { amount } } }` is rejected.
        // Stable id keeps the query valid; true aggregate sort needs raw SQL
        // or post-fetch sorting.
        return (dir) => ({ id: dir });
    }

    private formatRow(
        row: Record<string, unknown>,
        primaryTable: string,
        fields: Array<{
            table: string;
            field: string;
            alias?: string;
            aggregation?: string;
        }>,
        locale: string,
        scopedPolicyId?: number,
        timezone?: string
    ): Record<string, unknown> {
        const out: Record<string, unknown> = {
            id: row.id,
        };
        const relationMap = RELATION_FROM_PRIMARY[primaryTable] || {};
        const tablesInReport = Array.from(
            new Set(fields.map((f) => f.table).concat(primaryTable))
        );

        attachLinkingIds(out, row, primaryTable, tablesInReport);

        // Prefer flat customer_id on the row used for link metadata resolution.
        const linkRow: Record<string, unknown> = {
            ...row,
            ...(out.customer_id != null
                ? { customer_id: out.customer_id }
                : {}),
            ...(out.parent_customer_id != null
                ? { parent_customer_id: out.parent_customer_id }
                : {}),
        };

        for (const f of fields) {
            const key = getFieldOutputKey(f);
            let value = this.extractFieldValue(
                row,
                primaryTable,
                f,
                relationMap,
                scopedPolicyId
            );
            if (
                f.table === "Invoice" &&
                f.field === "terms_breach_reason" &&
                value != null
            ) {
                const label = formatTermsBreachReasonForDisplay(
                    String(value),
                    locale
                );
                if (label) {
                    value = label;
                }
            }
            out[key] = value ?? null;
            out[`___formatted_${key}`] = this.formatValue(
                value,
                f.field,
                locale,
                timezone,
                resolveReportFieldType(f.table, f.field)
            );
            // dispute_number aliases the primary key. Override display to
            // "DIS-000726" so formatValue's thousands separator does not turn
            // id 1726 into "1,726". Raw value stays numeric for sort/search.
            if (
                f.table === "Dispute" &&
                f.field === "dispute_number" &&
                value != null
            ) {
                const id = typeof value === "number" ? value : Number(value);
                out[`___formatted_${key}`] = Number.isFinite(id)
                    ? `DIS-${String(id).padStart(6, "0")}`
                    : `DIS-${String(value)}`;
            }
            const linkMetadata = getFieldLinkMetadata(
                f,
                linkRow,
                primaryTable,
                key
            );
            if (linkMetadata) {
                out[`__link_${key}`] = linkMetadata;
                // Some grids / columnOrder entries use the bare field name
                // (e.g. "name") instead of "Customer.name".
                if (
                    f.field === "name" ||
                    f.field === "parent_customer_name" ||
                    f.field === "dispute_number" ||
                    f.field === "first_name" ||
                    f.field === "last_name"
                ) {
                    out[`__link_${f.field}`] = linkMetadata;
                }
            }
            // Customer grids also read a flat `name` via fieldMappings.
            if (
                primaryTable === "Customer" &&
                f.table === "Customer" &&
                f.field === "name" &&
                value != null
            ) {
                out.name = value;
            }
        }

        // Always expose primary id under Table.id for grid link columns
        out[`${primaryTable}.id`] = row.id;
        if (out.customer_id != null) {
            out["Customer.id"] = out.customer_id;
        }
        // Customer primary: also expose id as customer_id for link fallbacks
        // after view transforms overwrite/reshape rows.
        if (primaryTable === "Customer" && out.customer_id == null && row.id != null) {
            out.customer_id = row.id;
        }
        return out;
    }

    private extractFieldValue(
        row: Record<string, unknown>,
        primaryTable: string,
        f: { table: string; field: string },
        relationMap: Record<string, string>,
        scopedPolicyId?: number
    ): unknown {
        if (f.table === primaryTable) {
            const computed = extractComputedFieldValue(
                primaryTable,
                f.field,
                row
            );
            if (computed !== undefined) {
                return computed;
            }
            if (primaryTable === "Customer" && f.field === "name") {
                return this.extractCustomerName(row);
            }
            if (
                primaryTable === "Customer" &&
                f.field === "parent_customer_name"
            ) {
                return this.extractParentCustomerName(row);
            }
            if (
                primaryTable === "Customer" &&
                f.field === "InsurancePolicy.policy_number"
            ) {
                return this.extractCustomerPolicyNumber(row);
            }
            if (
                primaryTable === "Invoice" &&
                f.field === "InsurancePolicy.policy_number"
            ) {
                return this.extractInvoicePolicyNumber(row);
            }
            if (primaryTable === "Customer" && f.field === "category") {
                const periods = row.CustomerCollectionPeriod;
                if (Array.isArray(periods) && periods.length > 0) {
                    return (
                        (periods[0] as { current_category?: unknown })
                            .current_category ?? null
                    );
                }
                return null;
            }
            if (
                f.field === "created_by" ||
                f.field === "modified_by"
            ) {
                return this.extractAuditUserName(
                    row,
                    primaryTable,
                    f.field
                );
            }
            if (primaryTable === "Dispute") {
                const disputeValue = this.extractDisputeVirtualField(
                    row,
                    f.field
                );
                if (disputeValue !== undefined) {
                    return disputeValue;
                }
            }
            if (primaryTable === "Activity") {
                const activityValue = this.extractActivityVirtualField(
                    row,
                    f.field
                );
                if (activityValue !== undefined) {
                    return activityValue;
                }
            }
            if (
                primaryTable === "Customer" &&
                isCustomerPolicyBackedReportField(f.field)
            ) {
                const policyValue = extractCustomerPolicyReportField(
                    row,
                    f.field,
                    undefined,
                    scopedPolicyId
                );
                if (policyValue !== null && policyValue !== undefined) {
                    return policyValue;
                }
            }
            if (
                primaryTable === "Customer" &&
                isTrendCostBackedReportField(f.field)
            ) {
                return extractTrendCostReportField(row, f.field);
            }
            if (f.field.includes(".")) {
                const [relTable, ...rest] = f.field.split(".");
                const rel = relationMap[relTable] || relTable;
                const nested = row[rel] as Record<string, unknown> | null;
                if (relTable === "Customer" && rest.join(".") === "name") {
                    return nested
                        ? this.extractCustomerName(nested)
                        : null;
                }
                return this.getNestedValue(nested, rest.join(".")) ?? null;
            }
            return row[f.field];
        }
        const rel = relationMap[f.table];
        const nested = rel
            ? (row[rel] as Record<string, unknown> | null)
            : null;
        if (
            primaryTable === "CustomerBanks" &&
            f.table === "Country" &&
            !rel
        ) {
            const aba = row.AccountBankAccounts as
                | Record<string, unknown>
                | null
                | undefined;
            const country = aba?.Country as
                | Record<string, unknown>
                | null
                | undefined;
            return country?.[f.field] ?? null;
        }
        if (f.table === "Customer" && f.field === "name") {
            return nested ? this.extractCustomerName(nested) : null;
        }
        if (
            f.table === "Customer" &&
            f.field === "InsurancePolicy.policy_number"
        ) {
            return nested ? this.extractCustomerPolicyNumber(nested) : null;
        }
        if (f.field.includes(".")) {
            return this.getNestedValue(nested, f.field) ?? null;
        }
        return nested?.[f.field];
    }

    private applyAuditUserSelect(
        tableName: string,
        fieldName: string,
        select: Record<string, unknown>
    ): boolean {
        if (fieldName !== "created_by" && fieldName !== "modified_by") {
            return false;
        }
        select[fieldName] = true;
        const relationName = this.getAuditUserRelationName(tableName, fieldName);
        select[relationName] = {
            select: {
                id: true,
                name: true,
                email: true,
            },
        };
        return true;
    }

    private getAuditUserRelationName(
        tableName: string,
        fieldName: "created_by" | "modified_by"
    ): string {
        if (tableName === "Dispute") {
            const disputeRelationField =
                fieldName === "created_by"
                    ? "User_CustomerDispute_created_byToUser"
                    : "User_CustomerDispute_modified_byToUser";
            return disputeRelationField;
        }
        return `User_${tableName}_${fieldName}ToUser`;
    }

    private extractAuditUserName(
        row: Record<string, unknown>,
        tableName: string,
        fieldName: "created_by" | "modified_by"
    ): string | null {
        const relationName = this.getAuditUserRelationName(tableName, fieldName);
        const relation = row[relationName] as
            | { name?: string | null; email?: string | null }
            | null
            | undefined;
        if (relation?.name && relation.name.trim() !== "") {
            return relation.name;
        }
        if (relation?.email && relation.email.trim() !== "") {
            return relation.email;
        }
        const raw = row[fieldName];
        return raw == null ? null : String(raw);
    }

    private getNestedValue(
        value: Record<string, unknown> | null | undefined,
        path: string
    ): unknown {
        if (!value || !path) {
            return null;
        }
        return path.split(".").reduce<unknown>((acc, part) => {
            if (acc == null || typeof acc !== "object") {
                return null;
            }
            return (acc as Record<string, unknown>)[part];
        }, value);
    }

    private extractCustomerPolicyNumber(
        row: Record<string, unknown>
    ): string | null {
        const policyRows = row.CustomerPolicy as
            | Array<{ InsurancePolicy?: { policy_number?: string | null } | null }>
            | undefined;
        if (Array.isArray(policyRows)) {
            const firstPolicyNumber =
                policyRows.find((p) => p?.InsurancePolicy?.policy_number)
                    ?.InsurancePolicy?.policy_number ?? null;
            if (firstPolicyNumber) {
                return firstPolicyNumber;
            }
        }
        const direct = this.getNestedValue(
            row,
            "InsurancePolicy.policy_number"
        );
        return typeof direct === "string" && direct.trim() !== ""
            ? direct
            : null;
    }

    private extractInvoicePolicyNumber(
        row: Record<string, unknown>
    ): string | null {
        const policy = row.InsurancePolicy as
            | { policy_number?: string | null }
            | null
            | undefined;
        const value = policy?.policy_number;
        return typeof value === "string" && value.trim() !== "" ? value : null;
    }

    /**
     * Activity report aliases that are not Activity columns.
     * Returns `undefined` when the field is a normal scalar.
     */
    private extractActivityVirtualField(
        row: Record<string, unknown>,
        field: string
    ): unknown {
        if (field === "call_time") {
            return row.actual_delivery_time || row.created_at || null;
        }
        if (field === "call_direction") {
            const titleParams = row.title_params;
            if (!titleParams || typeof titleParams !== "object") {
                return null;
            }
            const callType = String(
                (titleParams as { callType?: unknown }).callType ?? ""
            ).toLowerCase();
            if (callType === "incoming" || callType === "outgoing") {
                return callType;
            }
            return null;
        }
        return undefined;
    }

    /**
     * Dispute report aliases that are not CustomerDispute columns.
     * Returns `undefined` when the field is a normal scalar.
     */
    private extractDisputeVirtualField(
        row: Record<string, unknown>,
        field: string
    ): unknown {
        if (field === "dispute_number") {
            return row.id ?? null;
        }
        if (field === "assigned_to") {
            const owner = row.User_CustomerDispute_owner_idToUser as
                | {
                      name?: string | null;
                      first_name?: string | null;
                      last_name?: string | null;
                  }
                | null
                | undefined;
            if (!owner) {
                return row.owner_id ?? null;
            }
            const fromParts =
                `${owner.first_name || ""} ${owner.last_name || ""}`.trim();
            return owner.name || fromParts || row.owner_id || null;
        }
        if (field === "dispute_reason") {
            const reason = row.DisputeReason as { name?: string } | null;
            return reason?.name ?? null;
        }
        if (field === "amount_in_dispute") {
            const links = row.DisputeInvoice;
            if (!Array.isArray(links)) {
                return 0;
            }
            return links.reduce((sum: number, di) => {
                const invoice = (di as { Invoice?: { outstanding_debt?: number } })
                    .Invoice;
                const debt = invoice?.outstanding_debt || 0;
                return sum + (typeof debt === "number" ? debt : 0);
            }, 0);
        }
        if (field === "days_past_due") {
            const links = row.DisputeInvoice;
            if (!Array.isArray(links)) {
                return null;
            }
            const dueDates = links
                .map(
                    (di) =>
                        (di as { Invoice?: { due_date?: Date | string | null } })
                            .Invoice?.due_date
                )
                .filter((d): d is Date | string => d != null)
                .map((d) => new Date(d));
            if (dueDates.length === 0) {
                return null;
            }
            const oldest = new Date(
                Math.min(...dueDates.map((d) => d.getTime()))
            );
            const diffDays = Math.ceil(
                (Date.now() - oldest.getTime()) / (1000 * 60 * 60 * 24)
            );
            return diffDays > 0 ? diffDays : 0;
        }
        return undefined;
    }

    private extractCustomerName(row: Record<string, unknown>): string | null {
        const company = row.Company as { name?: string } | null;
        if (company?.name) {
            return company.name;
        }
        const person = row.Person as {
            full_name?: string | null;
            first_name?: string | null;
            last_name?: string | null;
        } | null;
        if (person) {
            const fromParts = `${person.first_name || ""} ${person.last_name || ""}`.trim();
            const name = person.full_name || fromParts;
            if (name) {
                return name;
            }
        }
        return (row.customer_number as string | null) || null;
    }

    private extractParentCustomerName(
        row: Record<string, unknown>
    ): string | null {
        const parent = row.ParentCustomer as {
            type?: string;
            Company?: { name?: string } | null;
            Person?: {
                full_name?: string | null;
                first_name?: string | null;
                last_name?: string | null;
            } | null;
        } | null;
        if (!parent) {
            return null;
        }
        if (parent.type === "Person") {
            const p = parent.Person;
            if (!p) {
                return null;
            }
            const fromParts = `${p.first_name || ""} ${p.last_name || ""}`.trim();
            return p.full_name || fromParts || null;
        }
        return parent.Company?.name || null;
    }

    private formatValue(
        value: unknown,
        field: string,
        locale: string,
        timezone?: string,
        metadataType?: string
    ): string | null {
        if (value == null) {
            return null;
        }
        if (value instanceof Date || this.looksLikeDateField(field, value)) {
            const d =
                value instanceof Date ? value : new Date(String(value));
            if (!Number.isNaN(d.getTime())) {
                try {
                    if (this.shouldFormatAsDateOnly(field, metadataType)) {
                        return formatReportDate(d, locale);
                    }
                    return formatReportDateTime(d, locale, timezone);
                } catch {
                    return d.toISOString();
                }
            }
        }
        if (typeof value === "bigint") {
            return value.toString();
        }
        if (typeof value === "number") {
            return this.formatNumber(value, locale);
        }
        if (typeof value === "boolean") {
            return value ? "Yes" : "No";
        }
        // Decimal columns (approved_limit, capacity_gap_amount, ...) are objects whose
        // toJSON() returns a string, so JSON.stringify would wrap them in literal quotes.
        if (Prisma.Decimal.isDecimal(value)) {
            return this.formatNumber(value.toNumber(), locale);
        }
        if (typeof value === "object") {
            return JSON.stringify(value);
        }
        return String(value);
    }

    private formatNumber(value: number, locale: string): string {
        if (!Number.isFinite(value)) {
            return String(value);
        }
        try {
            return new Intl.NumberFormat(locale).format(value);
        } catch {
            return String(value);
        }
    }

    private shouldFormatAsDateOnly(
        field: string,
        metadataType?: string
    ): boolean {
        const normalized = metadataType?.toLowerCase();
        if (normalized === "date") {
            return true;
        }
        if (
            normalized === "datetime" ||
            normalized === "timestamp"
        ) {
            return false;
        }
        // Fallback when metadata is missing: *_date calendar fields vs event stamps.
        if (field.includes("_at") || field === "schedule_time") {
            return false;
        }
        return (
            field.includes("_date") ||
            field === "due_date" ||
            field === "date_of_birth"
        );
    }

    private looksLikeDateField(field: string, value: unknown): boolean {
        if (
            field.includes("_at") ||
            field.includes("_date") ||
            field === "due_date" ||
            field === "schedule_time" ||
            field === "date_of_birth"
        ) {
            return true;
        }
        return (
            typeof value === "string" &&
            /^\d{4}-\d{2}-\d{2}/.test(value)
        );
    }
}
