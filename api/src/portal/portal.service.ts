import { Injectable, NotFoundException } from "@nestjs/common";
import { serializeBigInt } from "../common/serialize-bigint";
import { DatabaseService } from "../database/database.service";

type PortalCollectionPeriod = {
    id: number;
    total_outstanding_amount: number | null;
    currency: string | null;
    customer_outstanding_amount1: number | null;
    customer_currency1: string | null;
    customer_outstanding_amount2: number | null;
    customer_currency2: string | null;
    promise_to_pay_count: number;
    promise_to_pay_date: Date | null;
    period_start_date: Date;
    period_end_date: Date | null;
};

@Injectable()
export class PortalService {
    constructor(private readonly db: DatabaseService) {}

    private async findCustomerByUuid(customerUUID: string) {
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
            throw new NotFoundException({ error: "Customer not found" });
        }
        return customer;
    }

    async handleSuffix(
        customerUUID: string,
        suffix: string,
        body: Record<string, unknown>
    ) {
        const customer = await this.findCustomerByUuid(customerUUID);

        switch (suffix) {
            case "portal-data":
                return this.portalData(customer);
            case "agent-portal":
                return serializeBigInt({
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
                throw new NotFoundException({
                    error: "Portal customer path not served by Nest domain",
                });
        }
    }

    private resolveCustomerDisplayName(customer: {
        Company: { name: string } | null;
        Person: { first_name: string | null; last_name: string | null } | null;
        Account: { name: string | null } | null;
    }): string {
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

    private resolveCustomerFirstCurrency(input: {
        customerCurrencyPrimary?: string | null;
        customerCurrencySecondary?: string | null;
        collectionCurrencyPrimary?: string | null;
        collectionCurrencySecondary?: string | null;
        accountCurrency?: string | null;
        fallbackCurrency?: string | null;
    }): string {
        return (
            input.customerCurrencyPrimary ||
            input.customerCurrencySecondary ||
            input.collectionCurrencyPrimary ||
            input.collectionCurrencySecondary ||
            input.accountCurrency ||
            input.fallbackCurrency ||
            "USD"
        );
    }

    private buildMinimalCollectionPeriod(customer: {
        customer_due_currency1: string | null;
        customer_due_currency2: string | null;
        Account: { currency: string | null } | null;
    }): PortalCollectionPeriod {
        const defaultCurrency =
            customer.customer_due_currency1 ||
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

    private async resolveOpenCollectionPeriod(
        customerId: number,
        customer: {
            customer_due_currency1: string | null;
            customer_due_currency2: string | null;
            Account: { currency: string | null } | null;
        }
    ): Promise<PortalCollectionPeriod> {
        const collection =
            await this.db.customerCollectionPeriod.findFirst({
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

    private async portalData(
        customer: Awaited<ReturnType<PortalService["findCustomerByUuid"]>>
    ) {
        const account = customer.Account;
        const collection = await this.resolveOpenCollectionPeriod(
            customer.id,
            customer
        );

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

        const maxPromisePerCycle =
            account?.max_promise_to_pay_allowed_per_cycle ?? 0;
        const promiseCount = collection.promise_to_pay_count ?? 0;
        const promiseDate = collection.promise_to_pay_date;

        const isPromiseToPayAllowed =
            maxPromisePerCycle > promiseCount &&
            (promiseDate === null || new Date(promiseDate) < new Date());

        const nextPaymentDate =
            promiseDate && new Date(promiseDate) > new Date()
                ? new Date(promiseDate).toISOString()
                : undefined;

        const portalVerificationEnabled =
            account?.portal_verification_enabled ?? true;

        return serializeBigInt({
            // ICustomerDetails (camelCase)
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
            isPromiseToPayMaxedOut:
                maxPromisePerCycle === promiseCount,
            disputeCount,
            sub_domain: account?.sub_domain ?? null,
            language: customer.language ?? "English",
            portal_verification_enabled: portalVerificationEnabled,

            // Layout / verify / theme consumers
            Person: customer.Person,
            Company: customer.Company,
            Account: account
                ? {
                      id: account.id,
                      name: account.name,
                      logo: account.logo,
                      currency: account.currency,
                      promise_to_pay: account.promise_to_pay,
                      max_promise_to_pay_allowed_per_cycle:
                          account.max_promise_to_pay_allowed_per_cycle,
                      sub_domain: account.sub_domain,
                      portal_verification_enabled:
                          account.portal_verification_enabled,
                      primary_color: account.primary_color,
                      secondary_color: account.secondary_color,
                      chart_palette_color: account.chart_palette_color,
                  }
                : null,

            // Backward-compatible aliases for legacy portal pages
            id: customer.id,
            customer_uuid: customer.customer_uuid,
            customer_number: customer.customer_number,
        });
    }

    private async invoicesFor(customerId: number) {
        const invoices = await this.db.invoice.findMany({
            where: { customer_id: customerId },
            orderBy: { invoice_date: "desc" },
            take: 200,
        });
        return serializeBigInt({ invoices, totalRecords: invoices.length });
    }

    private async disputesFor(customerId: number) {
        const disputes = await this.db.customerDispute.findMany({
            where: { customer_id: customerId },
            orderBy: { created_at: "desc" },
        });
        return serializeBigInt({ disputes, totalRecords: disputes.length });
    }

    private async createDispute(
        customerId: number,
        body: Record<string, unknown>
    ) {
        void customerId;
        void body;
        return { ok: true };
    }

    async createPublicDispute(body: Record<string, unknown>) {
        void body;
        return { ok: true };
    }

    async updatePromiseToPay(body: Record<string, unknown>) {
        void body;
        return { ok: true };
    }
}
