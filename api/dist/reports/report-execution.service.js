"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportExecutionService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const access_scope_service_1 = require("../auth/access-scope.service");
const serialize_bigint_1 = require("../common/serialize-bigint");
const database_service_1 = require("../database/database.service");
const report_constants_1 = require("./report.constants");
const domain_db_1 = require("../credit-insurance/domain-db");
const creditDashboardReportEnrichment_1 = require("../credit-insurance/domain/creditDashboardReportEnrichment");
const creditInsuranceDashboardService_1 = require("../credit-insurance/domain/creditInsuranceDashboardService");
const dashboard_activity_markers_util_1 = require("./dashboard-activity-markers.util");
const dashboard_credit_customer_markers_util_1 = require("./dashboard-credit-customer-markers.util");
const dashboard_credit_invoice_markers_util_1 = require("./dashboard-credit-invoice-markers.util");
const report_customer_trend_fields_util_1 = require("./report-customer-trend-fields.util");
const report_customer_policy_fields_util_1 = require("./report-customer-policy-fields.util");
const report_link_util_1 = require("./report-link.util");
const report_filter_util_1 = require("./report-filter.util");
const report_scope_util_1 = require("./report-scope.util");
const report_virtual_fields_util_1 = require("./report-virtual-fields.util");
const report_metadata_1 = require("./report-metadata");
const formula_execution_1 = require("./report-formula/formula-execution");
let ReportExecutionService = class ReportExecutionService {
    constructor(db, access) {
        this.db = db;
        this.access = access;
        (0, domain_db_1.bindCreditInsurancePrisma)(this.db);
    }
    async execute(user, reportId, body) {
        const userInfo = await this.access.resolveUserInfo(user);
        const accountId = this.access.getEffectiveAccountId(userInfo);
        const role = userInfo.viewAsUserRole || userInfo.role;
        const report = await this.db.report.findFirst({
            where: {
                id: reportId,
                OR: [
                    { account_id: accountId },
                    { is_system: true },
                    { is_public: true },
                ],
            },
        });
        if (!report) {
            throw new common_1.NotFoundException("Report not found");
        }
        await this.assertExecutePermission(accountId, role, report.context);
        const config = (0, formula_execution_1.mergeFormulaOperandFieldsIntoConfig)((report.report_config || {}), report_metadata_1.REPORT_METADATA.tables);
        const primaryTable = report_constants_1.CONTEXT_PRIMARY_TABLE[report.context || ""] ||
            config.tables?.[0] ||
            "Customer";
        const modelKey = report_constants_1.MODEL_NAME_MAP[primaryTable];
        if (!modelKey) {
            throw new common_1.ForbiddenException(`Unsupported report primary table: ${primaryTable}`);
        }
        const delegate = this.db[modelKey];
        if (!delegate?.findMany || !delegate?.count) {
            throw new common_1.ForbiddenException(`No Prisma delegate for ${primaryTable}`);
        }
        const page = body.page && body.page > 0 ? body.page : 1;
        const limit = body.limit && body.limit > 0 ? Math.min(body.limit, 10000) : 20;
        const skip = (page - 1) * limit;
        const configFilters = Array.isArray(config.filters)
            ? config.filters
            : [];
        const bodyFilters = Array.isArray(body.filters) ? body.filters : [];
        let filters = body.replaceConfigFilters
            ? bodyFilters
            : [...configFilters, ...bodyFilters];
        let activityExtras;
        let skipSelectedUserOnActivity = false;
        if (primaryTable === "Activity") {
            const prepared = await (0, dashboard_activity_markers_util_1.prepareDashboardActivityMarkers)(filters, {
                db: this.db,
                accountId,
                selectedUserId: body.selectedUserId,
                isAdmin: this.access.isAdminAccount(accountId) ||
                    (userInfo.viewAsUserRole || userInfo.role) ===
                        "System_Administrator",
            });
            filters = prepared.filters;
            activityExtras = prepared.primaryWhereExtras;
            skipSelectedUserOnActivity = prepared.skipsSelectedUserScope;
        }
        let creditCustomerExtras;
        let creditInvoiceExtras;
        let creditDashboardPolicyId;
        let creditDashboardWithinDays;
        let creditCustomerMembershipType;
        if (report.context === "dashboard_credit_customers") {
            const prepared = await (0, dashboard_credit_customer_markers_util_1.prepareDashboardCreditCustomerMarkers)(filters, { accountId });
            filters = prepared.filters;
            creditCustomerExtras = prepared.primaryWhereExtras;
            creditDashboardPolicyId = prepared.policyId;
            creditDashboardWithinDays = prepared.withinDays;
            creditCustomerMembershipType = prepared.membershipType;
        }
        else if (report.context === "dashboard_credit_invoices") {
            const prepared = await (0, dashboard_credit_invoice_markers_util_1.prepareDashboardCreditInvoiceMarkers)(filters, { accountId });
            filters = prepared.filters;
            creditInvoiceExtras = prepared.primaryWhereExtras;
        }
        const scopeWhere = await this.buildScopeWhere(userInfo, accountId, primaryTable, body, { skipSelectedUserId: skipSelectedUserOnActivity });
        const { primary: filterPrimary, nested } = (0, report_filter_util_1.splitFiltersByTable)(this.normalizeFilters(filters, primaryTable), primaryTable);
        const nestedWhere = {};
        const relationMap = report_constants_1.RELATION_FROM_PRIMARY[primaryTable] || {};
        for (const [table, where] of Object.entries(nested)) {
            const rel = relationMap[table];
            if (rel) {
                nestedWhere[rel] = where;
            }
        }
        const searchWhere = this.buildSearchWhere(primaryTable, body.search, config.fields || []);
        const where = (0, report_filter_util_1.mergeAndWhere)(scopeWhere, filterPrimary, nestedWhere, searchWhere, activityExtras, creditCustomerExtras, creditInvoiceExtras);
        const fields = (config.fields || []).filter((f) => !f.aggregation);
        const select = this.buildSelect(primaryTable, fields);
        const reportUniqueName = report
            .unique_name;
        const isTopUpExpiringReport = reportUniqueName ===
            "dashboard_credit_customers_top_up_expiring" ||
            creditCustomerMembershipType === "top_up_expiring";
        if (isTopUpExpiringReport && primaryTable === "Customer") {
            const rawSortDir = (body.sortDirection ||
                config.sorting?.[0]?.direction ||
                "asc").toString();
            const topUpResult = await (0, creditDashboardReportEnrichment_1.fetchTopUpExpiringReportAsCustomerRows)({
                accountId,
                page,
                limit,
                search: body.search,
                sortField: body.sortField || config.sorting?.[0]?.field,
                sortDirection: rawSortDir.toLowerCase() === "desc" ? "DESC" : "ASC",
                policyId: creditDashboardPolicyId,
                withinDays: creditDashboardWithinDays ?? 30,
            });
            const locale = body.locale || "en-US";
            const data = topUpResult.rows.map((row) => this.formatRow(row, primaryTable, fields, locale));
            const formulaResult = (0, formula_execution_1.applyFormulasToRows)(data, config, {
                locale,
                metadataTables: report_metadata_1.REPORT_METADATA.tables,
            });
            return (0, serialize_bigint_1.serializeBigInt)({
                data: formulaResult.rows,
                totalRecords: topUpResult.total,
                ...(formulaResult.warnings.length
                    ? { formulaWarnings: formulaResult.warnings }
                    : {}),
            });
        }
        const effectiveSortField = body.sortField || config.sorting?.[0]?.field;
        const effectiveSortDirection = body.sortDirection ||
            (config.sorting?.[0]?.direction?.toLowerCase() === "asc"
                ? "asc"
                : "desc");
        const needsInMemorySort = report.context === "dashboard_credit_customers" &&
            !!effectiveSortField &&
            ((0, creditDashboardReportEnrichment_1.isCreditDashboardEnrichedSortField)(effectiveSortField) ||
                (0, report_customer_policy_fields_util_1.isCustomerPolicyBackedReportField)(effectiveSortField));
        const orderBy = needsInMemorySort
            ? []
            : this.buildOrderBy(primaryTable, body.sortField, body.sortDirection, config.sorting);
        const findArgs = {
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
        if (report.context === "dashboard_credit_customers" &&
            primaryTable === "Customer" &&
            (0, creditDashboardReportEnrichment_1.reportConfigNeedsCreditDashboardEnrichment)(fields)) {
            const requestedCustomerFields = fields
                .filter((f) => f.table === "Customer" && f.field)
                .map((f) => f.field);
            let limitWarningByCustomerId;
            if (requestedCustomerFields.includes("limit_warning_summary")) {
                const { rows: warningRows } = await (0, creditInsuranceDashboardService_1.getLimitWarningReport)(accountId, 100_000, 0, { policyId: creditDashboardPolicyId });
                limitWarningByCustomerId = new Map(warningRows.map((r) => [r.customerId, r]));
            }
            rows = await (0, creditDashboardReportEnrichment_1.enrichCreditDashboardCustomerRows)(rows, {
                accountId,
                policyId: creditDashboardPolicyId,
                requestedFields: requestedCustomerFields,
                limitWarningByCustomerId,
            });
        }
        if (needsInMemorySort && effectiveSortField) {
            rows = (0, creditDashboardReportEnrichment_1.sortCreditDashboardEnrichedRows)(rows, effectiveSortField, effectiveSortDirection);
            totalRecords = rows.length;
            rows = rows.slice(skip, skip + limit);
        }
        const locale = body.locale || "en-US";
        const data = rows.map((row) => this.formatRow(row, primaryTable, fields, locale));
        const formulaResult = (0, formula_execution_1.applyFormulasToRows)(data, config, {
            locale,
            metadataTables: report_metadata_1.REPORT_METADATA.tables,
        });
        return (0, serialize_bigint_1.serializeBigInt)({
            data: formulaResult.rows,
            totalRecords,
            ...(formulaResult.warnings.length
                ? { formulaWarnings: formulaResult.warnings }
                : {}),
        });
    }
    async assertExecutePermission(accountId, role, context) {
        const canViewReports = await this.access.hasPermission(accountId, role, "view_reports");
        if (canViewReports) {
            return;
        }
        if (context && report_constants_1.ENTITY_LIST_REPORT_CONTEXTS.has(context)) {
            if (await this.access.hasPermission(accountId, role, "view_customers")) {
                return;
            }
            if ((context === "contacts" || context === "customer_contacts") &&
                (await this.access.hasPermission(accountId, role, "view_contacts"))) {
                return;
            }
        }
        if (!context || !report_constants_1.DASHBOARD_REPORT_CONTEXTS.has(context)) {
            throw new common_1.ForbiddenException("You do not have permission to execute reports");
        }
        if (report_constants_1.FINANCIAL_DASHBOARD_CONTEXTS.has(context)) {
            if (await this.access.hasPermission(accountId, role, "view_financial_dashboard")) {
                return;
            }
        }
        if (report_constants_1.OPERATION_DASHBOARD_CONTEXTS.has(context)) {
            if (await this.access.hasPermission(accountId, role, "view_operation_dashboard")) {
                return;
            }
        }
        if (report_constants_1.CREDIT_DASHBOARD_CONTEXTS.has(context)) {
            if (await this.access.hasPermission(accountId, role, "view_credit_dashboard")) {
                return;
            }
        }
        throw new common_1.ForbiddenException("You do not have permission to execute reports");
    }
    async buildScopeWhere(userInfo, accountId, primaryTable, body, options = {}) {
        const parts = [
            (0, report_scope_util_1.buildAccountScopeWhere)(primaryTable, accountId),
        ];
        const hasViewAs = await this.access.hasPermission(accountId, userInfo.viewAsUserRole || userInfo.role, "use_view_as");
        const effectiveUserId = this.access.getEffectiveUserId(userInfo);
        const ownerFilter = await this.access.getOwnerFilter(effectiveUserId, hasViewAs, userInfo.viewAsUserId, userInfo.viewAsUserRole, userInfo.viewAsUserAccountId);
        const nestedOwner = (0, report_scope_util_1.nestOwnerScopeWhere)(primaryTable, ownerFilter);
        if (nestedOwner) {
            parts.push(nestedOwner);
        }
        const isAdmin = this.access.isAdminAccount(accountId) ||
            (userInfo.viewAsUserRole || userInfo.role) ===
                "System_Administrator";
        const buFilter = await this.access.getBusinessUnitFilter(userInfo.businessUnitId, isAdmin, accountId);
        const nestedBu = (0, report_scope_util_1.nestBusinessUnitScopeWhere)(primaryTable, buFilter);
        if (nestedBu) {
            parts.push(nestedBu);
        }
        if (body.businessUnitId != null && body.businessUnitId > 0) {
            const ids = [
                body.businessUnitId,
                ...(await this.access.getBusinessUnitHierarchy(body.businessUnitId)),
            ];
            const selectedBu = (0, report_scope_util_1.nestBusinessUnitScopeWhere)(primaryTable, {
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
            }
            else if (primaryTable === "Customer" ||
                primaryTable === "Invoice") {
                parts.push({ owner_id: body.selectedUserId });
            }
        }
        return (0, report_filter_util_1.mergeAndWhere)(...parts);
    }
    buildSearchWhere(primaryTable, search, _fields) {
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
    buildSelect(primaryTable, fields) {
        const select = { id: true };
        const relationMap = report_constants_1.RELATION_FROM_PRIMARY[primaryTable] || {};
        const ensureRelSelect = (rel) => {
            const existing = select[rel];
            if (existing &&
                typeof existing === "object" &&
                existing !== null &&
                "select" in existing) {
                return existing
                    .select;
            }
            const nested = { id: true };
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
                if (primaryTable === "Customer" &&
                    f.field === "InsurancePolicy.policy_number") {
                    this.applyCustomerPolicyNumberSelect(select);
                    continue;
                }
                if (primaryTable === "Invoice" &&
                    f.field === "InsurancePolicy.policy_number") {
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
                    if (leaf &&
                        (0, report_virtual_fields_util_1.applyComputedFieldSelect)(relTable, leaf, ensureRelSelect(rel))) {
                        continue;
                    }
                    if (leaf &&
                        !(0, report_virtual_fields_util_1.isPrismaScalarField)(relTable, leaf) &&
                        !leaf.includes(".")) {
                        continue;
                    }
                    if (leaf) {
                        ensureRelSelect(rel)[leaf] = true;
                    }
                    continue;
                }
                if (!(0, report_virtual_fields_util_1.isPrismaScalarField)(primaryTable, f.field)) {
                    continue;
                }
                select[f.field] = true;
                continue;
            }
            const rel = relationMap[f.table];
            if (!rel) {
                if (primaryTable === "CustomerBanks" &&
                    f.table === "Country") {
                    const aba = ensureRelSelect("AccountBankAccounts");
                    const existing = aba.Country;
                    const countrySelect = existing &&
                        typeof existing === "object" &&
                        existing !== null &&
                        "select" in existing
                        ? existing.select
                        : { id: true };
                    if ((0, report_virtual_fields_util_1.isPrismaScalarField)("Country", f.field)) {
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
            if (f.table === "Customer" &&
                f.field === "InsurancePolicy.policy_number") {
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
            if ((0, report_virtual_fields_util_1.applyComputedFieldSelect)(f.table, f.field, ensureRelSelect(rel))) {
                continue;
            }
            if (f.table === "Contact" &&
                (f.field === "first_name" || f.field === "last_name")) {
                const nested = ensureRelSelect(rel);
                nested[f.field] = true;
                nested.customer_id = true;
                continue;
            }
            if (!(0, report_virtual_fields_util_1.isPrismaScalarField)(f.table, f.field)) {
                continue;
            }
            ensureRelSelect(rel)[f.field] = true;
        }
        this.enrichSelectForLinks(primaryTable, fields, select);
        if (primaryTable === "Customer") {
            const customerFields = fields
                .filter((f) => f.table === "Customer")
                .map((f) => f.field);
            (0, report_customer_policy_fields_util_1.mergeActiveCustomerPolicySelect)(select, customerFields);
            (0, report_customer_trend_fields_util_1.mergeLatestCustomerPolicyTrendSelect)(select, customerFields);
        }
        return select;
    }
    applyCustomerPolicyNumberSelect(select) {
        const existing = select.CustomerPolicy;
        const existingSelect = existing?.select && typeof existing.select === "object"
            ? existing.select
            : {};
        select.CustomerPolicy = {
            ...(existing || {}),
            take: 1,
            orderBy: { id: "desc" },
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
    applyInvoicePolicyNumberSelect(select) {
        select.policy_id = true;
        const existing = select.InsurancePolicy;
        const existingSelect = existing?.select && typeof existing.select === "object"
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
    enrichSelectForLinks(primaryTable, fields, select) {
        const tables = new Set(fields.map((f) => f.table));
        const fieldNames = new Set(fields
            .filter((f) => f.table === primaryTable)
            .map((f) => f.field));
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
        if (tables.has("Customer") ||
            tables.has("Contact") ||
            primaryTable === "Dispute" ||
            primaryTable === "Activity" ||
            primaryTable === "Invoice") {
            select.customer_id = true;
        }
    }
    applyVirtualSelect(primaryTable, field, select) {
        if ((0, report_virtual_fields_util_1.applyComputedFieldSelect)(primaryTable, field, select)) {
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
            if (field === "amount_in_dispute" ||
                field === "days_past_due") {
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
                select.actual_delivery_time = true;
                select.created_at = true;
                return true;
            }
            if (field === "call_direction") {
                select.title_params = true;
                return true;
            }
        }
        return false;
    }
    applyCustomerNameSelect(select) {
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
    normalizeFilters(filters, primaryTable) {
        return filters.map((f) => {
            if (primaryTable === "Dispute" &&
                f.table === "Dispute" &&
                f.field === "assigned_to") {
                return { ...f, field: "owner_id" };
            }
            return f;
        });
    }
    buildOrderBy(primaryTable, sortField, sortDirection, configSorting) {
        const dir = (sortDirection || "desc");
        if (sortField) {
            const parsed = this.parseSortField(sortField, primaryTable);
            if (parsed) {
                return [parsed(dir)];
            }
        }
        if (configSorting?.length) {
            const out = [];
            for (const s of configSorting) {
                const parsed = this.parseSortField(s.field, primaryTable);
                if (parsed) {
                    out.push(parsed((s.direction || "asc").toLowerCase() === "desc"
                        ? "desc"
                        : "asc"));
                }
            }
            return out;
        }
        return [{ id: "desc" }];
    }
    parseSortField(sortField, primaryTable) {
        const raw = (sortField || "").trim();
        if (!raw) {
            return null;
        }
        const normalized = raw.startsWith(`${primaryTable}.`) && raw.split(".").length === 2
            ? raw.slice(primaryTable.length + 1)
            : raw;
        if (primaryTable === "Customer") {
            if (normalized === "name") {
                return (dir) => ({ Company: { name: dir } });
            }
            if (normalized === "InsurancePolicy.policy_number") {
                return (dir) => ({ id: dir });
            }
            if (normalized === "parent_customer_name" ||
                normalized === "category") {
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
            if (normalized === "amount_in_dispute" ||
                normalized === "days_past_due") {
                return (dir) => ({ id: dir });
            }
        }
        if (primaryTable === "Activity") {
            if (normalized === "call_time") {
                return (dir) => ({ actual_delivery_time: dir });
            }
            if (normalized === "call_direction") {
                return (dir) => ({ id: dir });
            }
        }
        if (!normalized.includes(".")) {
            if ((0, report_virtual_fields_util_1.isComputedReportField)(primaryTable, normalized) ||
                !(0, report_virtual_fields_util_1.isPrismaScalarField)(primaryTable, normalized)) {
                return (dir) => ({ id: dir });
            }
            return (dir) => ({ [normalized]: dir });
        }
        const parts = normalized.startsWith(`${primaryTable}.`)
            ? normalized.split(".").slice(1)
            : normalized.split(".");
        if (parts.length >= 2) {
            const relTable = parts[0];
            const leaf = parts.slice(1).join(".");
            const rel = (report_constants_1.RELATION_FROM_PRIMARY[primaryTable] || {})[relTable] ||
                relTable;
            if (relTable === "Customer" && leaf === "name") {
                return (dir) => ({ [rel]: { Company: { name: dir } } });
            }
            if (leaf.includes(".")) {
                const [nestedRel, nestedLeaf] = leaf.split(".");
                return (dir) => ({
                    [rel]: { [nestedRel]: { [nestedLeaf]: dir } },
                });
            }
            return (dir) => ({ [rel]: { [leaf]: dir } });
        }
        return null;
    }
    formatRow(row, primaryTable, fields, locale) {
        const out = {
            id: row.id,
        };
        const relationMap = report_constants_1.RELATION_FROM_PRIMARY[primaryTable] || {};
        const tablesInReport = Array.from(new Set(fields.map((f) => f.table).concat(primaryTable)));
        (0, report_link_util_1.attachLinkingIds)(out, row, primaryTable, tablesInReport);
        const linkRow = {
            ...row,
            ...(out.customer_id != null
                ? { customer_id: out.customer_id }
                : {}),
            ...(out.parent_customer_id != null
                ? { parent_customer_id: out.parent_customer_id }
                : {}),
        };
        for (const f of fields) {
            const key = (0, report_constants_1.getFieldOutputKey)(f);
            let value = this.extractFieldValue(row, primaryTable, f, relationMap);
            if (f.table === "Invoice" &&
                f.field === "terms_breach_reason" &&
                value != null) {
                const label = (0, report_virtual_fields_util_1.formatTermsBreachReasonForDisplay)(String(value), locale);
                if (label) {
                    value = label;
                }
            }
            out[key] = value ?? null;
            out[`___formatted_${key}`] = this.formatValue(value, f.field, locale);
            const linkMetadata = (0, report_link_util_1.getFieldLinkMetadata)(f, linkRow, primaryTable, key);
            if (linkMetadata) {
                out[`__link_${key}`] = linkMetadata;
                if (f.field === "name" ||
                    f.field === "parent_customer_name" ||
                    f.field === "dispute_number" ||
                    f.field === "first_name" ||
                    f.field === "last_name") {
                    out[`__link_${f.field}`] = linkMetadata;
                }
            }
            if (primaryTable === "Customer" &&
                f.table === "Customer" &&
                f.field === "name" &&
                value != null) {
                out.name = value;
            }
        }
        out[`${primaryTable}.id`] = row.id;
        if (out.customer_id != null) {
            out["Customer.id"] = out.customer_id;
        }
        if (primaryTable === "Customer" && out.customer_id == null && row.id != null) {
            out.customer_id = row.id;
        }
        return out;
    }
    extractFieldValue(row, primaryTable, f, relationMap) {
        if (f.table === primaryTable) {
            const computed = (0, report_virtual_fields_util_1.extractComputedFieldValue)(primaryTable, f.field, row);
            if (computed !== undefined) {
                return computed;
            }
            if (primaryTable === "Customer" && f.field === "name") {
                return this.extractCustomerName(row);
            }
            if (primaryTable === "Customer" &&
                f.field === "parent_customer_name") {
                return this.extractParentCustomerName(row);
            }
            if (primaryTable === "Customer" &&
                f.field === "InsurancePolicy.policy_number") {
                return this.extractCustomerPolicyNumber(row);
            }
            if (primaryTable === "Invoice" &&
                f.field === "InsurancePolicy.policy_number") {
                return this.extractInvoicePolicyNumber(row);
            }
            if (primaryTable === "Customer" && f.field === "category") {
                const periods = row.CustomerCollectionPeriod;
                if (Array.isArray(periods) && periods.length > 0) {
                    return (periods[0]
                        .current_category ?? null);
                }
                return null;
            }
            if (f.field === "created_by" ||
                f.field === "modified_by") {
                return this.extractAuditUserName(row, primaryTable, f.field);
            }
            if (primaryTable === "Dispute") {
                const disputeValue = this.extractDisputeVirtualField(row, f.field);
                if (disputeValue !== undefined) {
                    return disputeValue;
                }
            }
            if (primaryTable === "Activity") {
                const activityValue = this.extractActivityVirtualField(row, f.field);
                if (activityValue !== undefined) {
                    return activityValue;
                }
            }
            if (primaryTable === "Customer" &&
                (0, report_customer_policy_fields_util_1.isCustomerPolicyBackedReportField)(f.field)) {
                const policyValue = (0, report_customer_policy_fields_util_1.extractCustomerPolicyReportField)(row, f.field);
                if (policyValue !== null && policyValue !== undefined) {
                    return policyValue;
                }
            }
            if (primaryTable === "Customer" &&
                (0, report_customer_trend_fields_util_1.isTrendCostBackedReportField)(f.field)) {
                return (0, report_customer_trend_fields_util_1.extractTrendCostReportField)(row, f.field);
            }
            if (f.field.includes(".")) {
                const [relTable, ...rest] = f.field.split(".");
                const rel = relationMap[relTable] || relTable;
                const nested = row[rel];
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
            ? row[rel]
            : null;
        if (primaryTable === "CustomerBanks" &&
            f.table === "Country" &&
            !rel) {
            const aba = row.AccountBankAccounts;
            const country = aba?.Country;
            return country?.[f.field] ?? null;
        }
        if (f.table === "Customer" && f.field === "name") {
            return nested ? this.extractCustomerName(nested) : null;
        }
        if (f.table === "Customer" &&
            f.field === "InsurancePolicy.policy_number") {
            return nested ? this.extractCustomerPolicyNumber(nested) : null;
        }
        if (f.field.includes(".")) {
            return this.getNestedValue(nested, f.field) ?? null;
        }
        return nested?.[f.field];
    }
    applyAuditUserSelect(tableName, fieldName, select) {
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
    getAuditUserRelationName(tableName, fieldName) {
        if (tableName === "Dispute") {
            const disputeRelationField = fieldName === "created_by"
                ? "User_CustomerDispute_created_byToUser"
                : "User_CustomerDispute_modified_byToUser";
            return disputeRelationField;
        }
        return `User_${tableName}_${fieldName}ToUser`;
    }
    extractAuditUserName(row, tableName, fieldName) {
        const relationName = this.getAuditUserRelationName(tableName, fieldName);
        const relation = row[relationName];
        if (relation?.name && relation.name.trim() !== "") {
            return relation.name;
        }
        if (relation?.email && relation.email.trim() !== "") {
            return relation.email;
        }
        const raw = row[fieldName];
        return raw == null ? null : String(raw);
    }
    getNestedValue(value, path) {
        if (!value || !path) {
            return null;
        }
        return path.split(".").reduce((acc, part) => {
            if (acc == null || typeof acc !== "object") {
                return null;
            }
            return acc[part];
        }, value);
    }
    extractCustomerPolicyNumber(row) {
        const policyRows = row.CustomerPolicy;
        if (Array.isArray(policyRows)) {
            const firstPolicyNumber = policyRows.find((p) => p?.InsurancePolicy?.policy_number)
                ?.InsurancePolicy?.policy_number ?? null;
            if (firstPolicyNumber) {
                return firstPolicyNumber;
            }
        }
        const direct = this.getNestedValue(row, "InsurancePolicy.policy_number");
        return typeof direct === "string" && direct.trim() !== ""
            ? direct
            : null;
    }
    extractInvoicePolicyNumber(row) {
        const policy = row.InsurancePolicy;
        const value = policy?.policy_number;
        return typeof value === "string" && value.trim() !== "" ? value : null;
    }
    extractActivityVirtualField(row, field) {
        if (field === "call_time") {
            return row.actual_delivery_time || row.created_at || null;
        }
        if (field === "call_direction") {
            const titleParams = row.title_params;
            if (!titleParams || typeof titleParams !== "object") {
                return null;
            }
            const callType = String(titleParams.callType ?? "").toLowerCase();
            if (callType === "incoming" || callType === "outgoing") {
                return callType;
            }
            return null;
        }
        return undefined;
    }
    extractDisputeVirtualField(row, field) {
        if (field === "dispute_number") {
            return row.id ?? null;
        }
        if (field === "assigned_to") {
            const owner = row.User_CustomerDispute_owner_idToUser;
            if (!owner) {
                return row.owner_id ?? null;
            }
            const fromParts = `${owner.first_name || ""} ${owner.last_name || ""}`.trim();
            return owner.name || fromParts || row.owner_id || null;
        }
        if (field === "dispute_reason") {
            const reason = row.DisputeReason;
            return reason?.name ?? null;
        }
        if (field === "amount_in_dispute") {
            const links = row.DisputeInvoice;
            if (!Array.isArray(links)) {
                return 0;
            }
            return links.reduce((sum, di) => {
                const invoice = di
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
                .map((di) => di
                .Invoice?.due_date)
                .filter((d) => d != null)
                .map((d) => new Date(d));
            if (dueDates.length === 0) {
                return null;
            }
            const oldest = new Date(Math.min(...dueDates.map((d) => d.getTime())));
            const diffDays = Math.ceil((Date.now() - oldest.getTime()) / (1000 * 60 * 60 * 24));
            return diffDays > 0 ? diffDays : 0;
        }
        return undefined;
    }
    extractCustomerName(row) {
        const company = row.Company;
        if (company?.name) {
            return company.name;
        }
        const person = row.Person;
        if (person) {
            const fromParts = `${person.first_name || ""} ${person.last_name || ""}`.trim();
            const name = person.full_name || fromParts;
            if (name) {
                return name;
            }
        }
        return row.customer_number || null;
    }
    extractParentCustomerName(row) {
        const parent = row.ParentCustomer;
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
    formatValue(value, field, locale) {
        if (value == null) {
            return null;
        }
        if (value instanceof Date || this.looksLikeDateField(field, value)) {
            const d = value instanceof Date ? value : new Date(String(value));
            if (!Number.isNaN(d.getTime())) {
                try {
                    return new Intl.DateTimeFormat(locale, {
                        dateStyle: "short",
                        timeStyle: "short",
                    }).format(d);
                }
                catch {
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
        if (client_1.Prisma.Decimal.isDecimal(value)) {
            return this.formatNumber(value.toNumber(), locale);
        }
        if (typeof value === "object") {
            return JSON.stringify(value);
        }
        return String(value);
    }
    formatNumber(value, locale) {
        if (!Number.isFinite(value)) {
            return String(value);
        }
        try {
            return new Intl.NumberFormat(locale).format(value);
        }
        catch {
            return String(value);
        }
    }
    looksLikeDateField(field, value) {
        if (field.includes("_at") ||
            field.includes("_date") ||
            field === "due_date" ||
            field === "schedule_time") {
            return true;
        }
        return (typeof value === "string" &&
            /^\d{4}-\d{2}-\d{2}/.test(value));
    }
};
exports.ReportExecutionService = ReportExecutionService;
exports.ReportExecutionService = ReportExecutionService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        access_scope_service_1.AccessScopeService])
], ReportExecutionService);
//# sourceMappingURL=report-execution.service.js.map