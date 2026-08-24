import { randomInt } from "crypto";
import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import {
    dbLanguageToLocale,
    resolveDbLanguage,
} from "../common/language.util";
import { presignS3Object } from "../common/s3-presign";
import { serializeBigInt } from "../common/serialize-bigint";
import { DatabaseService } from "../database/database.service";

/** Invoice statuses a portal visitor may raise a dispute against. */
const PORTAL_DISPUTABLE_INVOICE_STATUSES = ["Due", "Overdue"] as const;

/** Logo links outlive a page view but should not be indefinitely valid. */
const PORTAL_LOGO_URL_TTL_SECONDS = 6 * 60 * 60;

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

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class PortalService {
    constructor(private readonly db: DatabaseService) {}

    private async findCustomerByUuid(customerUUID: string) {
        // `customer_uuid` is a Postgres uuid column, so a non-UUID segment makes
        // Prisma fail the query itself (P2023) and surface a 500. The portal
        // route matches any first segment, so reject the value here instead.
        if (!UUID_PATTERN.test(customerUUID)) {
            throw new NotFoundException({ error: "Customer not found" });
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
                Country: { select: { name: true } },
                State: { select: { name: true } },
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
        language?: string
    ) {
        const customer = await this.findCustomerByUuid(customerUUID);

        switch (suffix) {
            case "portal-data":
                return this.portalData(customer);
            case "agent-portal": {
                const bootstrap = await this.createDisputeBootstrap(
                    customer,
                    language
                );
                return {
                    ...bootstrap,
                    isOpenDispute: Boolean(bootstrap.hasDisputedInvoices),
                };
            }
            case "invoices":
                return this.invoicesFor(customer);
            case "disputes":
            case "view-disputes":
                return this.disputesFor(customer, language);
            case "create-dispute":
                return this.createDisputeBootstrap(customer, language);
            case "bank-details":
                return this.bankDetailsFor(customer);
            case "banks":
                return { banks: [] };
            case "wrong-contact":
                return this.wrongContactFor(customer);
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

    /**
     * Account.logo holds an S3 object key. A portal visitor has no session, so
     * it must be signed here — otherwise the browser gets a bare key, renders it
     * as a relative <img src>, 404s, and falls back to a placeholder icon.
     */
    private async resolvePortalLogo(
        logo: string | null | undefined
    ): Promise<string | null> {
        if (!logo) {
            return null;
        }
        if (/^(https?:|data:)/i.test(logo)) {
            return logo;
        }
        return (
            (await presignS3Object(logo, PORTAL_LOGO_URL_TTL_SECONDS)) ?? logo
        );
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

        // An unset cap means "not configured", not "zero promises allowed" —
        // reading it as zero blocked the portal's promise-to-pay page outright
        // for every account that never set a limit.
        const rawCap = account?.max_promise_to_pay_allowed_per_cycle;
        const maxPromisePerCycle = rawCap != null && rawCap > 0 ? rawCap : null;
        const promiseCount = collection.promise_to_pay_count ?? 0;
        const promiseDate = collection.promise_to_pay_date;

        const isPromiseToPayMaxedOut =
            maxPromisePerCycle != null && promiseCount >= maxPromisePerCycle;
        // A promise still in the future is the one already in play; the customer
        // may make another only once that date has passed.
        const hasOpenPromise =
            promiseDate != null && new Date(promiseDate) >= new Date();
        const isPromiseToPayAllowed = !isPromiseToPayMaxedOut && !hasOpenPromise;

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
            isPromiseToPayMaxedOut,
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
                      logo,
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

    /** Portal grids read camelCase keys, not raw Prisma columns. */
    private toPortalInvoice(invoice: {
        id: number;
        invoice_number: string | null;
        amount: number | null;
        customer_amount: number | null;
        due_date: Date | null;
        total_paid: number | null;
        customer_total_paid: number | null;
        outstanding_debt: number | null;
        customer_outstanding_debt: number | null;
        status: string | null;
        customer_currency: string | null;
    }) {
        // Invoice has no account-level currency column; customer_currency is the
        // only one stored, so both fields the portal reads resolve to it.
        const currency = invoice.customer_currency ?? "";
        return {
            id: invoice.id,
            invoiceNumber: invoice.invoice_number ?? "",
            amount: invoice.amount ?? 0,
            customerAmount: invoice.customer_amount ?? invoice.amount ?? 0,
            dueDate: invoice.due_date ? invoice.due_date.toISOString() : "",
            totalPaid: invoice.total_paid ?? 0,
            customerTotalPaid:
                invoice.customer_total_paid ?? invoice.total_paid ?? 0,
            outstandingDebt: invoice.outstanding_debt ?? 0,
            customerOutstandingDebt:
                invoice.customer_outstanding_debt ??
                invoice.outstanding_debt ??
                0,
            status: invoice.status ?? "",
            currency,
            customerCurrency: currency,
        };
    }

    private static readonly PORTAL_INVOICE_SELECT = {
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
    } as const;

    private async invoicesFor(
        customer: Awaited<ReturnType<PortalService["findCustomerByUuid"]>>
    ) {
        const invoices = await this.db.invoice.findMany({
            where: { customer_id: customer.id },
            select: PortalService.PORTAL_INVOICE_SELECT,
            orderBy: { invoice_date: "desc" },
            take: 200,
        });
        // The sub-pages layout sources the header logo and name from here, so
        // branding has to travel with this response too.
        return serializeBigInt({
            invoices: invoices.map((invoice) => this.toPortalInvoice(invoice)),
            totalRecords: invoices.length,
            logo: await this.resolvePortalLogo(customer.Account?.logo),
            customerName: this.resolveCustomerDisplayName(customer),
            accountName: customer.Account?.name ?? null,
            sub_domain: customer.Account?.sub_domain ?? null,
        });
    }

    private async disputesFor(
        customer: Awaited<ReturnType<PortalService["findCustomerByUuid"]>>,
        language?: string
    ) {
        const requested = resolveDbLanguage(
            language,
            resolveDbLanguage(customer.language)
        );
        const disputes = await this.db.customerDispute.findMany({
            where: { customer_id: customer.id },
            orderBy: { created_at: "desc" },
            include: {
                DisputeReason: {
                    select: {
                        name: true,
                        DisputeReasonLanguage: {
                            select: { language: true, name: true },
                        },
                    },
                },
                User_CustomerDispute_owner_idToUser: {
                    select: {
                        name: true,
                        first_name: true,
                        last_name: true,
                    },
                },
                DisputeInvoice: {
                    include: {
                        Invoice: {
                            select: PortalService.PORTAL_INVOICE_SELECT,
                        },
                    },
                },
            },
        });

        const mapped = disputes.map((dispute) => {
            const translated = dispute.DisputeReason?.DisputeReasonLanguage.find(
                (entry) => resolveDbLanguage(entry.language) === requested
            );
            const owner = dispute.User_CustomerDispute_owner_idToUser;
            const ownerName =
                owner?.name ||
                `${owner?.first_name || ""} ${owner?.last_name || ""}`.trim();
            const initials = ownerName
                ? ownerName
                      .split(/\s+/)
                      .filter(Boolean)
                      .map((part) => part[0])
                      .join("")
                      .slice(0, 2)
                      .toUpperCase()
                : "";
            const hasContact =
                dispute.contact_first_name ||
                dispute.contact_email ||
                dispute.contact_mobile;
            return {
                id: dispute.id,
                status: dispute.dispute_status,
                reason: translated?.name || dispute.DisputeReason?.name || null,
                comment: dispute.customer_comment,
                created_at: dispute.created_at,
                modified_at: dispute.modified_at,
                assignedUser: owner
                    ? { initials: initials || "?", name: ownerName }
                    : null,
                contact: hasContact
                    ? {
                          name: `${dispute.contact_first_name || ""} ${dispute.contact_last_name || ""}`.trim(),
                          email: dispute.contact_email || "",
                          mobile: dispute.contact_mobile || "",
                      }
                    : null,
                resolutionComment: dispute.resolution_comment,
                invoices: dispute.DisputeInvoice.map((row) =>
                    this.toPortalInvoice(row.Invoice)
                ),
            };
        });

        return serializeBigInt({
            disputes: mapped,
            totalRecords: mapped.length,
            customerName: this.resolveCustomerDisplayName(customer),
            logo: await this.resolvePortalLogo(customer.Account?.logo),
            customerCurrency:
                customer.customer_due_currency1 ||
                customer.Account?.currency ||
                "USD",
            country: customer.Country?.name || null,
            state: customer.State?.name || null,
        });
    }

    private async bankDetailsFor(
        customer: Awaited<ReturnType<PortalService["findCustomerByUuid"]>>
    ) {
        const banks = await this.db.customerBanks.findMany({
            where: { customer_id: customer.id },
            include: {
                AccountBankAccounts: {
                    include: {
                        Country: { select: { iso2: true, name: true } },
                    },
                },
            },
            orderBy: { id: "asc" },
        });
        return serializeBigInt({
            Account: {
                name: customer.Account?.name || null,
                logo: await this.resolvePortalLogo(customer.Account?.logo),
            },
            CustomerBanks: banks.map((bank) => ({
                id: bank.id,
                customer_bank_account_id: bank.customer_bank_account_id,
                CustomerBankAccount: bank.AccountBankAccounts,
            })),
        });
    }

    private async wrongContactFor(
        customer: Awaited<ReturnType<PortalService["findCustomerByUuid"]>>
    ) {
        return serializeBigInt({
            id: customer.id,
            Account: {
                name: customer.Account?.name || null,
                logo: await this.resolvePortalLogo(customer.Account?.logo),
            },
        });
    }

    /**
     * Accounts are provisioned with their own copies of the ten master-template
     * reasons, and only those copies carry `DisputeReasonLanguage` translations.
     * Selecting `account_id OR master_template` therefore returns every reason
     * twice and mixes in untranslated originals, so the templates are used only
     * as a fallback for an account that has no reasons of its own yet.
     */
    private async disputeReasonsFor(accountId: number | null) {
        const select = {
            id: true,
            name: true,
            editable: true,
            DisputeReasonLanguage: {
                select: { language: true, name: true },
            },
        } as const;

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

    /**
     * Bootstrap for the portal's create-dispute page. Returning anything without
     * an `invoices` array makes that page throw during render and trip the
     * portal error boundary, so the shape here is load-bearing.
     */
    private async createDisputeBootstrap(
        customer: Awaited<ReturnType<PortalService["findCustomerByUuid"]>>,
        language?: string
    ) {
        const [invoices, reasons, disputeCount] = await Promise.all([
            this.db.invoice.findMany({
                where: {
                    customer_id: customer.id,
                    status: { in: [...PORTAL_DISPUTABLE_INVOICE_STATUSES] },
                    outstanding_debt: { gt: 0 },
                },
                select: PortalService.PORTAL_INVOICE_SELECT,
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

        // `DisputeReasonLanguage.language` holds enum names ("Hebrew"), but the
        // page sends a locale code ("he"), so both sides go through the resolver.
        const requested = resolveDbLanguage(
            language,
            resolveDbLanguage(customer.language)
        );
        const localizedReasons = reasons.map((reason) => {
            const translated = reason.DisputeReasonLanguage.find(
                (entry) => resolveDbLanguage(entry.language) === requested
            );
            return {
                id: reason.id,
                name: translated?.name || reason.name,
                editable: reason.editable,
            };
        });

        return serializeBigInt({
            customer_id: customer.id,
            invoices: invoices.map((invoice) => this.toPortalInvoice(invoice)),
            reasons: localizedReasons,
            customerName: this.resolveCustomerDisplayName(customer),
            logo: await this.resolvePortalLogo(customer.Account?.logo),
            sub_domain: customer.Account?.sub_domain ?? null,
            hasDisputedInvoices: disputeCount > 0,
            // Echoed as a locale code, matching the `?language=` the page sent.
            language: dbLanguageToLocale(requested),
        });
    }

    async createPublicDispute(body: Record<string, unknown>) {
        if (String(body.dispute_type || "") === "contact") {
            return this.createContactDispute(body);
        }

        const customerId = parseInt(String(body.customer_id ?? ""), 10);
        const reasonId = parseInt(String(body.dispute_reason_id ?? ""), 10);
        if (!Number.isFinite(customerId) || !Number.isFinite(reasonId)) {
            throw new BadRequestException({
                error: "customer_id and dispute_reason_id are required",
            });
        }

        const customer = await this.db.customer.findFirst({
            where: { id: customerId },
            select: { id: true, account_id: true },
        });
        if (!customer) {
            throw new NotFoundException({ error: "Customer not found" });
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
            throw new BadRequestException({ error: "Unknown dispute reason" });
        }

        // The portal submits invoice numbers (space/comma separated), not ids.
        const invoiceNumbers = String(body.invoices_in_dispute ?? "")
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean);
        if (invoiceNumbers.length === 0) {
            throw new BadRequestException({
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
            throw new BadRequestException({
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
                } as never,
                select: { id: true },
            });

            await tx.disputeInvoice.createMany({
                data: invoices.map((invoice) => ({
                    dispute_id: created.id,
                    invoice_id: invoice.id,
                })) as never,
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
                } as never,
            });

            if (collection) {
                await tx.customerCollectionPeriod.update({
                    where: { id: collection.id },
                    data: { last_dispute_date: now } as never,
                });
            }

            return created;
        });

        return serializeBigInt({
            ok: true,
            disputeId: dispute.id,
            invoicesLinked: invoices.length,
        });
    }

    private async createContactDispute(body: Record<string, unknown>) {
        const customerId = parseInt(String(body.customer_id ?? ""), 10);
        if (!Number.isFinite(customerId)) {
            throw new BadRequestException({ error: "customer_id is required" });
        }

        const customer = await this.db.customer.findFirst({
            where: { id: customerId },
            select: { id: true, account_id: true },
        });
        if (!customer) {
            throw new NotFoundException({ error: "Customer not found" });
        }

        const collection = await this.db.customerCollectionPeriod.findFirst({
            where: { customer_id: customer.id, period_end_date: null },
            select: { id: true },
            orderBy: { id: "desc" },
        });
        if (!collection) {
            throw new BadRequestException({
                error: "No active collection period",
            });
        }

        const comment = String(body.contact_comment ?? "");
        const now = new Date();
        const created = await this.db.$transaction(async (tx) => {
            const dispute = await tx.customerDispute.create({
                data: {
                    customer_id: customer.id,
                    dispute_status: "Under_Review",
                    customer_comment: comment,
                    customer_collection_period_id: collection.id,
                    contact_first_name:
                        String(body.contact_first_name ?? "") || null,
                    contact_last_name:
                        String(body.contact_last_name ?? "") || null,
                    contact_email: String(body.contact_email ?? "") || null,
                    contact_mobile: String(body.contact_mobile ?? "") || null,
                } as never,
                select: { id: true },
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
                        disputeId: String(dispute.id),
                        disputeReason: "contact",
                    },
                    content: comment,
                    collection_period_id: collection.id,
                    schedule_time: now,
                    actual_delivery_time: now,
                    system_generated: true,
                } as never,
            });

            await tx.customerCollectionPeriod.update({
                where: { id: collection.id },
                data: { last_dispute_date: now } as never,
            });

            return dispute;
        });

        return serializeBigInt({ ok: true, disputeId: created.id });
    }

    private obfuscateEmail(email: string): string {
        const [local, domain] = email.split("@");
        if (!domain) {
            return email;
        }
        return `${local.slice(0, 2)}***@${domain}`;
    }

    private async portalContactEmail(
        customerUUID: string,
        contactId?: number
    ) {
        const customer = await this.findCustomerByUuid(customerUUID);
        const contact = await this.db.contact.findFirst({
            where: {
                customer_id: customer.id,
                email: { not: null },
                ...(Number.isFinite(contactId) ? { id: contactId } : {}),
            },
            select: { id: true, email: true },
            orderBy: { id: "asc" },
        });
        if (!contact?.email) {
            throw new NotFoundException({ error: "No contact email" });
        }
        return { customer, email: contact.email };
    }

    async sendVerificationCode(body: Record<string, unknown>) {
        const customerUUID = String(body.customerUUID || "");
        const contactId = body.contactId != null ? Number(body.contactId) : NaN;
        const { email } = await this.portalContactEmail(
            customerUUID,
            Number.isFinite(contactId) ? contactId : undefined
        );
        const code = String(randomInt(100000, 1000000));
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
        await this.db.verificationCode.deleteMany({
            where: { customer_uuid: customerUUID },
        });
        await this.db.verificationCode.create({
            data: {
                customer_uuid: customerUUID,
                code,
                expires_at: expiresAt,
            },
        });
        return {
            success: true,
            emailObfuscated: this.obfuscateEmail(email),
        };
    }

    async verifyCode(body: Record<string, unknown>) {
        const customerUUID = String(body.customerUUID || "");
        const code = String(body.code || "").trim();
        if (!UUID_PATTERN.test(customerUUID) || !code) {
            return { valid: false };
        }
        const row = await this.db.verificationCode.findFirst({
            where: {
                customer_uuid: customerUUID,
                code,
                expires_at: { gt: new Date() },
            },
            orderBy: { created_at: "desc" },
        });
        return { valid: Boolean(row) };
    }

    async verificationEmail(body: Record<string, unknown>) {
        const customerUUID = String(body.customerUUID || "");
        const contactId = body.contactId != null ? Number(body.contactId) : NaN;
        const { email } = await this.portalContactEmail(
            customerUUID,
            Number.isFinite(contactId) ? contactId : undefined
        );
        return { email };
    }

    async updatePromiseToPay(body: Record<string, unknown>) {
        const customerId = parseInt(String(body.customer_id ?? ""), 10);
        if (!Number.isFinite(customerId)) {
            throw new BadRequestException({ error: "customer_id is required" });
        }

        const raw = String(body.promise_to_pay_date ?? "").slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
            throw new BadRequestException({
                error: "promise_to_pay_date must be YYYY-MM-DD",
            });
        }
        const promiseDate = new Date(`${raw}T00:00:00.000Z`);
        if (Number.isNaN(promiseDate.getTime())) {
            throw new BadRequestException({
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
            throw new NotFoundException({ error: "Customer not found" });
        }

        const collection = await this.db.customerCollectionPeriod.findFirst({
            where: { customer_id: customer.id, period_end_date: null },
            select: { id: true, promise_to_pay_count: true },
            orderBy: { id: "desc" },
        });
        if (!collection) {
            throw new BadRequestException({
                error: "Customer has no open collection period",
            });
        }

        // An unset cap means "not configured", not "zero promises allowed".
        const cap = customer.Account?.max_promise_to_pay_allowed_per_cycle ?? 0;
        if (cap > 0 && (collection.promise_to_pay_count ?? 0) >= cap) {
            throw new BadRequestException({
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
                } as never,
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
                } as never,
            });
        });

        return serializeBigInt({
            ok: true,
            promise_to_pay_date: promiseDate,
            promise_to_pay_count: (collection.promise_to_pay_count ?? 0) + 1,
        });
    }
}
