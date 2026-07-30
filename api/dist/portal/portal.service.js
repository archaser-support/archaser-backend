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
var PortalService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PortalService = void 0;
const common_1 = require("@nestjs/common");
const language_util_1 = require("../common/language.util");
const s3_presign_1 = require("../common/s3-presign");
const serialize_bigint_1 = require("../common/serialize-bigint");
const database_service_1 = require("../database/database.service");
const PORTAL_DISPUTABLE_INVOICE_STATUSES = ["Due", "Overdue"];
const PORTAL_LOGO_URL_TTL_SECONDS = 6 * 60 * 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let PortalService = PortalService_1 = class PortalService {
    constructor(db) {
        this.db = db;
    }
    async findCustomerByUuid(customerUUID) {
        if (!UUID_PATTERN.test(customerUUID)) {
            throw new common_1.NotFoundException({ error: "Customer not found" });
        }
        const customer = await this.db.customer.findFirst({
            where: { customer_uuid: customerUUID },
            select: {
                id: true,
                account_id: true,
                customer_uuid: true,
                customer_number: true,
                type: true,
                language: true,
                total_due_amount: true,
                customer_due_amount1: true,
                customer_due_currency1: true,
                customer_due_amount2: true,
                customer_due_currency2: true,
                total_invoices_overdue: true,
                number_of_overdue_invoices: true,
                Person: {
                    select: { first_name: true, last_name: true },
                },
                Company: {
                    select: { name: true },
                },
                Account: {
                    select: {
                        id: true,
                        name: true,
                        logo: true,
                        currency: true,
                        promise_to_pay: true,
                        max_promise_to_pay_allowed_per_cycle: true,
                        sub_domain: true,
                        portal_verification_enabled: true,
                        primary_color: true,
                        secondary_color: true,
                        chart_palette_color: true,
                    },
                },
            },
        });
        if (!customer) {
            throw new common_1.NotFoundException({ error: "Customer not found" });
        }
        return customer;
    }
    async handleSuffix(customerUUID, suffix, language) {
        const customer = await this.findCustomerByUuid(customerUUID);
        switch (suffix) {
            case "portal-data":
                return this.portalData(customer);
            case "agent-portal":
                return (0, serialize_bigint_1.serializeBigInt)({
                    customer_uuid: customer.customer_uuid,
                    customer_number: customer.customer_number,
                });
            case "invoices":
                return this.invoicesFor(customer);
            case "disputes":
            case "view-disputes":
                return this.disputesFor(customer.id);
            case "create-dispute":
                return this.createDisputeBootstrap(customer, language);
            case "bank-details":
                return { bank_details: null };
            case "banks":
                return { banks: [] };
            case "wrong-contact":
                return { ok: true };
            default:
                throw new common_1.NotFoundException({
                    error: "Portal customer path not served by Nest domain",
                });
        }
    }
    resolveCustomerDisplayName(customer) {
        if (customer.Company?.name) {
            return customer.Company.name;
        }
        const firstName = customer.Person?.first_name ?? "";
        const lastName = customer.Person?.last_name ?? "";
        const personName = `${firstName} ${lastName}`.trim();
        if (personName) {
            return personName;
        }
        return customer.Account?.name ?? "N/A";
    }
    async resolvePortalLogo(logo) {
        if (!logo) {
            return null;
        }
        if (/^(https?:|data:)/i.test(logo)) {
            return logo;
        }
        return ((await (0, s3_presign_1.presignS3Object)(logo, PORTAL_LOGO_URL_TTL_SECONDS)) ?? logo);
    }
    resolveCustomerFirstCurrency(input) {
        return (input.customerCurrencyPrimary ||
            input.customerCurrencySecondary ||
            input.collectionCurrencyPrimary ||
            input.collectionCurrencySecondary ||
            input.accountCurrency ||
            input.fallbackCurrency ||
            "USD");
    }
    buildMinimalCollectionPeriod(customer) {
        const defaultCurrency = customer.customer_due_currency1 ||
            customer.Account?.currency ||
            "USD";
        return {
            id: 0,
            total_outstanding_amount: 0,
            currency: defaultCurrency,
            customer_outstanding_amount1: 0,
            customer_currency1: defaultCurrency,
            customer_outstanding_amount2: 0,
            customer_currency2: customer.customer_due_currency2,
            promise_to_pay_count: 0,
            promise_to_pay_date: null,
            period_start_date: new Date(),
            period_end_date: null,
        };
    }
    async resolveOpenCollectionPeriod(customerId, customer) {
        const collection = await this.db.customerCollectionPeriod.findFirst({
            where: {
                customer_id: customerId,
                period_end_date: null,
            },
            orderBy: { period_start_date: "desc" },
            select: {
                id: true,
                total_outstanding_amount: true,
                currency: true,
                customer_outstanding_amount1: true,
                customer_currency1: true,
                customer_outstanding_amount2: true,
                customer_currency2: true,
                promise_to_pay_count: true,
                promise_to_pay_date: true,
                period_start_date: true,
                period_end_date: true,
            },
        });
        if (collection) {
            return collection;
        }
        return this.buildMinimalCollectionPeriod(customer);
    }
    async portalData(customer) {
        const account = customer.Account;
        const collection = await this.resolveOpenCollectionPeriod(customer.id, customer);
        const disputeCount = await this.db.customerDispute.count({
            where: {
                customer_id: customer.id,
                NOT: { dispute_status: "Resolved" },
            },
        });
        const accountName = account?.name ?? "N/A";
        const customerName = this.resolveCustomerDisplayName(customer);
        const logo = await this.resolvePortalLogo(account?.logo);
        const currency = this.resolveCustomerFirstCurrency({
            customerCurrencyPrimary: customer.customer_due_currency1,
            customerCurrencySecondary: customer.customer_due_currency2,
            collectionCurrencyPrimary: collection.customer_currency1,
            collectionCurrencySecondary: collection.customer_currency2,
            accountCurrency: account?.currency,
            fallbackCurrency: collection.currency ?? undefined,
        });
        const dueAmount1 = customer.customer_due_amount1 ?? 0;
        const overdueAmount1 = collection.customer_outstanding_amount1 ?? 0;
        const totalCombinedAmount = dueAmount1 + overdueAmount1;
        const rawCap = account?.max_promise_to_pay_allowed_per_cycle;
        const maxPromisePerCycle = rawCap != null && rawCap > 0 ? rawCap : null;
        const promiseCount = collection.promise_to_pay_count ?? 0;
        const promiseDate = collection.promise_to_pay_date;
        const isPromiseToPayMaxedOut = maxPromisePerCycle != null && promiseCount >= maxPromisePerCycle;
        const hasOpenPromise = promiseDate != null && new Date(promiseDate) >= new Date();
        const isPromiseToPayAllowed = !isPromiseToPayMaxedOut && !hasOpenPromise;
        const nextPaymentDate = promiseDate && new Date(promiseDate) > new Date()
            ? new Date(promiseDate).toISOString()
            : undefined;
        const portalVerificationEnabled = account?.portal_verification_enabled ?? true;
        return (0, serialize_bigint_1.serializeBigInt)({
            customerId: customer.id,
            customerUUID: customer.customer_uuid,
            customerName,
            accountName,
            totalOverdue: totalCombinedAmount,
            logo,
            customerType: customer.type,
            currency,
            dispute: null,
            promise_to_pay: account?.promise_to_pay ?? 0,
            CustomerCollectionPeriod: collection,
            total_due_amount: customer.total_due_amount,
            customer_due_amount1: customer.customer_due_amount1,
            customer_due_currency1: customer.customer_due_currency1,
            customer_due_amount2: customer.customer_due_amount2,
            customer_due_currency2: customer.customer_due_currency2,
            total_invoices_overdue: customer.total_invoices_overdue,
            number_of_overdue_invoices: customer.number_of_overdue_invoices,
            isPromiseToPayAllowed,
            nextPaymentDate,
            isPromiseToPayMaxedOut,
            disputeCount,
            sub_domain: account?.sub_domain ?? null,
            language: customer.language ?? "English",
            portal_verification_enabled: portalVerificationEnabled,
            Person: customer.Person,
            Company: customer.Company,
            Account: account
                ? {
                    id: account.id,
                    name: account.name,
                    logo,
                    currency: account.currency,
                    promise_to_pay: account.promise_to_pay,
                    max_promise_to_pay_allowed_per_cycle: account.max_promise_to_pay_allowed_per_cycle,
                    sub_domain: account.sub_domain,
                    portal_verification_enabled: account.portal_verification_enabled,
                    primary_color: account.primary_color,
                    secondary_color: account.secondary_color,
                    chart_palette_color: account.chart_palette_color,
                }
                : null,
            id: customer.id,
            customer_uuid: customer.customer_uuid,
            customer_number: customer.customer_number,
        });
    }
    toPortalInvoice(invoice) {
        const currency = invoice.customer_currency ?? "";
        return {
            id: invoice.id,
            invoiceNumber: invoice.invoice_number ?? "",
            amount: invoice.amount ?? 0,
            customerAmount: invoice.customer_amount ?? invoice.amount ?? 0,
            dueDate: invoice.due_date ? invoice.due_date.toISOString() : "",
            totalPaid: invoice.total_paid ?? 0,
            customerTotalPaid: invoice.customer_total_paid ?? invoice.total_paid ?? 0,
            outstandingDebt: invoice.outstanding_debt ?? 0,
            customerOutstandingDebt: invoice.customer_outstanding_debt ??
                invoice.outstanding_debt ??
                0,
            status: invoice.status ?? "",
            currency,
            customerCurrency: currency,
        };
    }
    async invoicesFor(customer) {
        const invoices = await this.db.invoice.findMany({
            where: { customer_id: customer.id },
            select: PortalService_1.PORTAL_INVOICE_SELECT,
            orderBy: { invoice_date: "desc" },
            take: 200,
        });
        return (0, serialize_bigint_1.serializeBigInt)({
            invoices: invoices.map((invoice) => this.toPortalInvoice(invoice)),
            totalRecords: invoices.length,
            logo: await this.resolvePortalLogo(customer.Account?.logo),
            customerName: this.resolveCustomerDisplayName(customer),
            accountName: customer.Account?.name ?? null,
            sub_domain: customer.Account?.sub_domain ?? null,
        });
    }
    async disputesFor(customerId) {
        const disputes = await this.db.customerDispute.findMany({
            where: { customer_id: customerId },
            orderBy: { created_at: "desc" },
        });
        return (0, serialize_bigint_1.serializeBigInt)({ disputes, totalRecords: disputes.length });
    }
    async disputeReasonsFor(accountId) {
        const select = {
            id: true,
            name: true,
            editable: true,
            DisputeReasonLanguage: {
                select: { language: true, name: true },
            },
        };
        if (accountId != null) {
            const owned = await this.db.disputeReason.findMany({
                where: { status: "Active", account_id: accountId },
                select,
                orderBy: { id: "asc" },
            });
            if (owned.length) {
                return owned;
            }
        }
        return this.db.disputeReason.findMany({
            where: { status: "Active", master_template: true },
            select,
            orderBy: { id: "asc" },
        });
    }
    async createDisputeBootstrap(customer, language) {
        const [invoices, reasons, disputeCount] = await Promise.all([
            this.db.invoice.findMany({
                where: {
                    customer_id: customer.id,
                    status: { in: [...PORTAL_DISPUTABLE_INVOICE_STATUSES] },
                    outstanding_debt: { gt: 0 },
                },
                select: PortalService_1.PORTAL_INVOICE_SELECT,
                orderBy: [{ due_date: "asc" }, { id: "asc" }],
            }),
            this.disputeReasonsFor(customer.account_id),
            this.db.customerDispute.count({
                where: {
                    customer_id: customer.id,
                    NOT: { dispute_status: "Resolved" },
                },
            }),
        ]);
        const requested = (0, language_util_1.resolveDbLanguage)(language, (0, language_util_1.resolveDbLanguage)(customer.language));
        const localizedReasons = reasons.map((reason) => {
            const translated = reason.DisputeReasonLanguage.find((entry) => (0, language_util_1.resolveDbLanguage)(entry.language) === requested);
            return {
                id: reason.id,
                name: translated?.name || reason.name,
                editable: reason.editable,
            };
        });
        return (0, serialize_bigint_1.serializeBigInt)({
            customer_id: customer.id,
            invoices: invoices.map((invoice) => this.toPortalInvoice(invoice)),
            reasons: localizedReasons,
            customerName: this.resolveCustomerDisplayName(customer),
            logo: await this.resolvePortalLogo(customer.Account?.logo),
            sub_domain: customer.Account?.sub_domain ?? null,
            hasDisputedInvoices: disputeCount > 0,
            language: (0, language_util_1.dbLanguageToLocale)(requested),
        });
    }
    async createPublicDispute(body) {
        const customerId = parseInt(String(body.customer_id ?? ""), 10);
        const reasonId = parseInt(String(body.dispute_reason_id ?? ""), 10);
        if (!Number.isFinite(customerId) || !Number.isFinite(reasonId)) {
            throw new common_1.BadRequestException({
                error: "customer_id and dispute_reason_id are required",
            });
        }
        const customer = await this.db.customer.findFirst({
            where: { id: customerId },
            select: { id: true, account_id: true },
        });
        if (!customer) {
            throw new common_1.NotFoundException({ error: "Customer not found" });
        }
        const reason = await this.db.disputeReason.findFirst({
            where: {
                id: reasonId,
                status: "Active",
                OR: [
                    { account_id: customer.account_id },
                    { master_template: true },
                ],
            },
            select: { id: true, name: true },
        });
        if (!reason) {
            throw new common_1.BadRequestException({ error: "Unknown dispute reason" });
        }
        const invoiceNumbers = String(body.invoices_in_dispute ?? "")
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean);
        if (invoiceNumbers.length === 0) {
            throw new common_1.BadRequestException({
                error: "At least one invoice is required",
            });
        }
        const invoices = await this.db.invoice.findMany({
            where: {
                customer_id: customer.id,
                invoice_number: { in: invoiceNumbers },
            },
            select: { id: true, invoice_number: true },
        });
        if (invoices.length === 0) {
            throw new common_1.BadRequestException({
                error: "No matching invoices for this customer",
            });
        }
        const collection = await this.db.customerCollectionPeriod.findFirst({
            where: { customer_id: customer.id, period_end_date: null },
            select: { id: true },
            orderBy: { id: "desc" },
        });
        const comment = String(body.dispute_comment ?? "");
        const now = new Date();
        const dispute = await this.db.$transaction(async (tx) => {
            const created = await tx.customerDispute.create({
                data: {
                    customer_id: customer.id,
                    dispute_reason_id: reason.id,
                    dispute_status: "Under_Review",
                    customer_comment: comment,
                    customer_collection_period_id: collection?.id ?? null,
                    invoices_in_dispute: invoices
                        .map((invoice) => invoice.invoice_number)
                        .filter(Boolean)
                        .join(","),
                },
                select: { id: true },
            });
            await tx.disputeInvoice.createMany({
                data: invoices.map((invoice) => ({
                    dispute_id: created.id,
                    invoice_id: invoice.id,
                })),
            });
            await tx.activity.create({
                data: {
                    customer_id: customer.id,
                    account_id: customer.account_id,
                    type: "Dispute",
                    status: "COMPLETED",
                    title: "{{disputes.fields.filed_portal_title}}",
                    title_params: {
                        userId: "portal_user",
                        disputeId: String(created.id),
                        disputeReason: reason.name,
                    },
                    content: comment,
                    collection_period_id: collection?.id ?? null,
                    schedule_time: now,
                    actual_delivery_time: now,
                    system_generated: true,
                },
            });
            if (collection) {
                await tx.customerCollectionPeriod.update({
                    where: { id: collection.id },
                    data: { last_dispute_date: now },
                });
            }
            return created;
        });
        return (0, serialize_bigint_1.serializeBigInt)({
            ok: true,
            disputeId: dispute.id,
            invoicesLinked: invoices.length,
        });
    }
    async updatePromiseToPay(body) {
        const customerId = parseInt(String(body.customer_id ?? ""), 10);
        if (!Number.isFinite(customerId)) {
            throw new common_1.BadRequestException({ error: "customer_id is required" });
        }
        const raw = String(body.promise_to_pay_date ?? "").slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
            throw new common_1.BadRequestException({
                error: "promise_to_pay_date must be YYYY-MM-DD",
            });
        }
        const promiseDate = new Date(`${raw}T00:00:00.000Z`);
        if (Number.isNaN(promiseDate.getTime())) {
            throw new common_1.BadRequestException({
                error: "promise_to_pay_date is not a valid date",
            });
        }
        const customer = await this.db.customer.findFirst({
            where: { id: customerId },
            select: {
                id: true,
                account_id: true,
                Account: {
                    select: { max_promise_to_pay_allowed_per_cycle: true },
                },
            },
        });
        if (!customer) {
            throw new common_1.NotFoundException({ error: "Customer not found" });
        }
        const collection = await this.db.customerCollectionPeriod.findFirst({
            where: { customer_id: customer.id, period_end_date: null },
            select: { id: true, promise_to_pay_count: true },
            orderBy: { id: "desc" },
        });
        if (!collection) {
            throw new common_1.BadRequestException({
                error: "Customer has no open collection period",
            });
        }
        const cap = customer.Account?.max_promise_to_pay_allowed_per_cycle ?? 0;
        if (cap > 0 && (collection.promise_to_pay_count ?? 0) >= cap) {
            throw new common_1.BadRequestException({
                error: "Promise to pay limit reached for this collection period",
            });
        }
        const now = new Date();
        const comment = String(body.comment ?? "");
        await this.db.$transaction(async (tx) => {
            await tx.customerCollectionPeriod.update({
                where: { id: collection.id },
                data: {
                    promise_to_pay_date: promiseDate,
                    promise_to_pay_count: { increment: 1 },
                },
            });
            await tx.activity.create({
                data: {
                    customer_id: customer.id,
                    account_id: customer.account_id,
                    type: "Promise_to_pay",
                    status: "COMPLETED",
                    title: "{{activities.fields.activity_promise_to_pay_from_portal}}",
                    title_params: { userId: "portal_user", date: raw },
                    content: comment,
                    collection_period_id: collection.id,
                    schedule_time: now,
                    actual_delivery_time: now,
                    system_generated: true,
                },
            });
        });
        return (0, serialize_bigint_1.serializeBigInt)({
            ok: true,
            promise_to_pay_date: promiseDate,
            promise_to_pay_count: (collection.promise_to_pay_count ?? 0) + 1,
        });
    }
};
exports.PortalService = PortalService;
PortalService.PORTAL_INVOICE_SELECT = {
    id: true,
    invoice_number: true,
    amount: true,
    customer_amount: true,
    due_date: true,
    total_paid: true,
    customer_total_paid: true,
    outstanding_debt: true,
    customer_outstanding_debt: true,
    status: true,
    customer_currency: true,
};
exports.PortalService = PortalService = PortalService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService])
], PortalService);
//# sourceMappingURL=portal.service.js.map