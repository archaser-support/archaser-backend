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
exports.PortalService = void 0;
const common_1 = require("@nestjs/common");
const serialize_bigint_1 = require("../common/serialize-bigint");
const database_service_1 = require("../database/database.service");
let PortalService = class PortalService {
    constructor(db) {
        this.db = db;
    }
    async findCustomerByUuid(customerUUID) {
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
    async handleSuffix(customerUUID, suffix, body) {
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
                return this.invoicesFor(customer.id);
            case "disputes":
            case "view-disputes":
                return this.disputesFor(customer.id);
            case "create-dispute":
                return this.createDispute(customer.id, body);
            case "bank-details":
                return { bank_details: null };
            case "banks":
                return { banks: [] };
            case "wrong-contact":
                return { ok: true };
            case "top-ups":
                return { topUps: [] };
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
        const logo = account?.logo ?? null;
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
        const maxPromisePerCycle = account?.max_promise_to_pay_allowed_per_cycle ?? 0;
        const promiseCount = collection.promise_to_pay_count ?? 0;
        const promiseDate = collection.promise_to_pay_date;
        const isPromiseToPayAllowed = maxPromisePerCycle > promiseCount &&
            (promiseDate === null || new Date(promiseDate) < new Date());
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
            isPromiseToPayMaxedOut: maxPromisePerCycle === promiseCount,
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
                    logo: account.logo,
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
    async invoicesFor(customerId) {
        const invoices = await this.db.invoice.findMany({
            where: { customer_id: customerId },
            orderBy: { invoice_date: "desc" },
            take: 200,
        });
        return (0, serialize_bigint_1.serializeBigInt)({ invoices, totalRecords: invoices.length });
    }
    async disputesFor(customerId) {
        const disputes = await this.db.customerDispute.findMany({
            where: { customer_id: customerId },
            orderBy: { created_at: "desc" },
        });
        return (0, serialize_bigint_1.serializeBigInt)({ disputes, totalRecords: disputes.length });
    }
    async createDispute(customerId, body) {
        void customerId;
        void body;
        return { ok: true };
    }
    async createPublicDispute(body) {
        void body;
        return { ok: true };
    }
    async updatePromiseToPay(body) {
        void body;
        return { ok: true };
    }
};
exports.PortalService = PortalService;
exports.PortalService = PortalService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService])
], PortalService);
//# sourceMappingURL=portal.service.js.map