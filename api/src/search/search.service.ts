import { Injectable } from "@nestjs/common";
import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { serializeBigInt } from "../common/serialize-bigint";
import { DatabaseService } from "../database/database.service";

function formatAmountWithoutSymbol(
    amount: number,
    locale: string = "en-US"
): string {
    const hasDecimalPlaces = Math.abs(amount % 1) > 0.0001;
    return new Intl.NumberFormat(locale, {
        minimumFractionDigits: hasDecimalPlaces ? 2 : 0,
        maximumFractionDigits: hasDecimalPlaces ? 2 : 0,
    }).format(amount);
}

function calculateRelevanceScore(
    primaryText: string,
    searchTerm: string,
    secondaryText?: string | null
): number {
    if (!primaryText) return 0;
    const searchLower = searchTerm.toLowerCase();
    const primaryLower = primaryText.toLowerCase();
    const secondaryLower = secondaryText?.toLowerCase() || "";
    let score = 0;

    if (primaryLower === searchLower) score += 100;
    else if (primaryLower.startsWith(searchLower)) score += 80;
    else if (primaryLower.includes(searchLower)) score += 50;

    if (secondaryText) {
        if (secondaryLower === searchLower) score += 30;
        else if (secondaryLower.includes(searchLower)) score += 15;
    }

    const matchLength = primaryLower.indexOf(searchLower);
    if (matchLength >= 0) {
        score += Math.max(0, 20 - matchLength);
    }
    return score;
}

@Injectable()
export class SearchService {
    constructor(
        private readonly db: DatabaseService,
        private readonly accessScope: AccessScopeService
    ) {}

    async globalSearch(user: JwtPayload, searchTerm?: string) {
        if (
            !searchTerm ||
            typeof searchTerm !== "string" ||
            searchTerm.trim().length < 2
        ) {
            return { results: [] };
        }

        const trimmedSearch = searchTerm.trim();
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const isSystemAdmin = this.accessScope.isAdminAccount(
            userInfo.accountId
        );

        const effectiveAccountId = accountId;
        const effectiveRole = userInfo.viewAsUserRole || userInfo.role;
        const hasViewAsPermission = await this.accessScope.hasPermission(
            effectiveAccountId,
            effectiveRole,
            "use_view_as"
        );

        const ownerFilter = isSystemAdmin
            ? {}
            : await this.accessScope.getOwnerFilter(
                  userInfo.userId,
                  hasViewAsPermission,
                  userInfo.viewAsUserId,
                  userInfo.viewAsUserRole,
                  userInfo.viewAsUserAccountId
              );

        const buFilter = await this.accessScope.getBusinessUnitFilter(
            userInfo.businessUnitId,
            isSystemAdmin,
            accountId
        );

        const [customers, invoices, contacts, disputes] = await Promise.all([
            this.searchCustomers(
                trimmedSearch,
                accountId,
                ownerFilter,
                buFilter
            ),
            this.searchInvoices(
                trimmedSearch,
                accountId,
                ownerFilter,
                buFilter
            ),
            this.searchContacts(trimmedSearch, accountId),
            this.searchDisputes(
                trimmedSearch,
                accountId,
                ownerFilter,
                buFilter
            ),
        ]);

        const countsByType = {
            customer: customers.length,
            invoice: invoices.length,
            contact: contacts.length,
            dispute: disputes.length,
        };

        const allResults = [
            ...customers.map((c) => {
                const relevanceScore = calculateRelevanceScore(
                    c.name,
                    trimmedSearch,
                    c.customer_number
                );
                const formattedOverdueAmount = c.total_invoices_overdue
                    ? formatAmountWithoutSymbol(
                          Number(c.total_invoices_overdue),
                          "en-US"
                      )
                    : null;
                return {
                    id: c.id,
                    type: "customer" as const,
                    name: c.name,
                    subtitle: c.customer_number,
                    customerId: c.id,
                    relevanceScore,
                    metadata: {
                        type: c.type,
                        customer_number: c.customer_number,
                        collection_status: c.collection_status,
                        total_invoices_overdue: c.total_invoices_overdue,
                        total_invoices_overdue_formatted:
                            formattedOverdueAmount,
                        parent_customer_name: c.parent_customer_name,
                        current_category: c.current_category,
                    },
                };
            }),
            ...invoices.map((inv) => {
                const relevanceScore = calculateRelevanceScore(
                    inv.invoice_number || "",
                    trimmedSearch,
                    inv.customer_name || ""
                );
                const formattedAmount = inv.amount
                    ? formatAmountWithoutSymbol(Number(inv.amount), "en-US")
                    : null;
                const invoiceDate = inv.invoice_date
                    ? new Date(inv.invoice_date).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "2-digit",
                          day: "2-digit",
                      })
                    : null;
                return {
                    id: inv.id,
                    type: "invoice" as const,
                    name: inv.invoice_number,
                    subtitle: inv.customer_name,
                    customerId: inv.customer_id,
                    relevanceScore,
                    metadata: {
                        invoice_number: inv.invoice_number,
                        amount: inv.amount,
                        amount_formatted: formattedAmount,
                        status: inv.status_name,
                        invoice_date: invoiceDate,
                    },
                };
            }),
            ...contacts.map((cont) => {
                const relevanceScore = calculateRelevanceScore(
                    cont.name,
                    trimmedSearch,
                    cont.email || cont.phone
                );
                return {
                    id: cont.id,
                    type: "contact" as const,
                    name: cont.name,
                    subtitle: cont.company_name || cont.email || cont.phone,
                    customerId: cont.customer_id || null,
                    relevanceScore,
                    metadata: {
                        email: cont.email,
                        phone: cont.phone,
                        mobile: cont.mobile,
                        role: cont.role,
                        company_name: cont.company_name,
                    },
                };
            }),
            ...disputes.map((dis) => {
                const relevanceScore = calculateRelevanceScore(
                    dis.customer_name,
                    trimmedSearch,
                    dis.reason_name
                );
                return {
                    id: dis.id,
                    type: "dispute" as const,
                    name: dis.customer_name,
                    subtitle: dis.reason_name || `Dispute #${dis.id}`,
                    customerId: dis.customer_id,
                    relevanceScore,
                    metadata: {
                        dispute_id: dis.id,
                        reason: dis.reason_name,
                        status: dis.dispute_status,
                        created_at: dis.created_at
                            ? new Date(dis.created_at).toLocaleDateString(
                                  "en-US",
                                  {
                                      year: "numeric",
                                      month: "2-digit",
                                      day: "2-digit",
                                  }
                              )
                            : null,
                    },
                };
            }),
        ]
            .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
            .slice(0, 20);

        return serializeBigInt({
            results: allResults,
            totalCount:
                customers.length +
                invoices.length +
                contacts.length +
                disputes.length,
            countsByType,
            hasMore: allResults.length >= 20,
        });
    }

    private async searchCustomers(
        searchTerm: string,
        accountId: number,
        ownerFilter: Record<string, unknown>,
        buFilter: Record<string, unknown>
    ) {
        const where = {
            AND: [
                { account_id: accountId },
                ...(Object.keys(ownerFilter).length > 0 ? [ownerFilter] : []),
                ...(Object.keys(buFilter).length > 0 ? [buFilter] : []),
                {
                    OR: [
                        {
                            customer_number: {
                                contains: searchTerm,
                                mode: "insensitive" as const,
                            },
                        },
                        {
                            Person: {
                                first_name: {
                                    contains: searchTerm,
                                    mode: "insensitive" as const,
                                },
                            },
                        },
                        {
                            Person: {
                                last_name: {
                                    contains: searchTerm,
                                    mode: "insensitive" as const,
                                },
                            },
                        },
                        {
                            Person: {
                                full_name: {
                                    contains: searchTerm,
                                    mode: "insensitive" as const,
                                },
                            },
                        },
                        {
                            Company: {
                                name: {
                                    contains: searchTerm,
                                    mode: "insensitive" as const,
                                },
                            },
                        },
                    ],
                },
            ],
        };

        const customers = await this.db.customer.findMany({
            where,
            select: {
                id: true,
                customer_number: true,
                type: true,
                collection_status: true,
                total_invoices_overdue: true,
                parent_customer_id: true,
                Person: {
                    select: {
                        first_name: true,
                        last_name: true,
                        full_name: true,
                    },
                },
                Company: { select: { name: true } },
                ParentCustomer: {
                    select: {
                        id: true,
                        customer_number: true,
                        type: true,
                        Person: {
                            select: {
                                first_name: true,
                                last_name: true,
                                full_name: true,
                            },
                        },
                        Company: { select: { name: true } },
                    },
                },
                CustomerCollectionPeriod: {
                    select: { current_category: true },
                    take: 1,
                    orderBy: { period_end_date: "desc" },
                },
            },
            take: 8,
            orderBy: [{ customer_number: "asc" }, { id: "asc" }],
        });

        return customers.map((customer) => {
            const parentCustomerName = customer.ParentCustomer
                ? customer.ParentCustomer.type === "Person"
                    ? customer.ParentCustomer.Person?.full_name ||
                      `${customer.ParentCustomer.Person?.first_name || ""} ${customer.ParentCustomer.Person?.last_name || ""}`.trim()
                    : customer.ParentCustomer.Company?.name || ""
                : null;

            return {
                id: customer.id,
                name:
                    customer.type === "Person"
                        ? customer.Person?.full_name ||
                          `${customer.Person?.first_name || ""} ${customer.Person?.last_name || ""}`.trim()
                        : customer.Company?.name || "",
                customer_number: customer.customer_number,
                type: customer.type,
                collection_status: customer.collection_status,
                total_invoices_overdue: customer.total_invoices_overdue,
                parent_customer_id: customer.parent_customer_id,
                parent_customer_name: parentCustomerName,
                current_category:
                    customer.CustomerCollectionPeriod?.[0]?.current_category ||
                    null,
            };
        });
    }

    private async searchInvoices(
        searchTerm: string,
        accountId: number,
        ownerFilter: Record<string, unknown>,
        buFilter: Record<string, unknown>
    ) {
        const conditions: Record<string, unknown>[] = [
            { account_id: accountId },
            { status: { in: ["Overdue", "Due"] } },
        ];
        if (Object.keys(ownerFilter).length > 0) {
            conditions.push({ Customer: ownerFilter });
        }
        if (Object.keys(buFilter).length > 0) {
            conditions.push({ Customer: buFilter });
        }

        const isNumeric = !isNaN(parseInt(searchTerm, 10));
        const searchConditions: Record<string, unknown>[] = [];
        if (isNumeric) {
            searchConditions.push({ id: parseInt(searchTerm, 10) });
        }
        searchConditions.push({
            invoice_number: {
                contains: searchTerm,
                mode: "insensitive",
            },
        });
        searchConditions.push({
            Customer: {
                Person: {
                    first_name: {
                        contains: searchTerm,
                        mode: "insensitive",
                    },
                },
            },
        });
        searchConditions.push({
            Customer: {
                Person: {
                    last_name: {
                        contains: searchTerm,
                        mode: "insensitive",
                    },
                },
            },
        });
        searchConditions.push({
            Customer: {
                Company: {
                    name: { contains: searchTerm, mode: "insensitive" },
                },
            },
        });
        searchConditions.push({
            Customer: {
                customer_number: {
                    contains: searchTerm,
                    mode: "insensitive",
                },
            },
        });
        conditions.push({ OR: searchConditions });

        const invoices = await this.db.invoice.findMany({
            where: { AND: conditions },
            select: {
                id: true,
                invoice_number: true,
                customer_id: true,
                amount: true,
                invoice_date: true,
                status: true,
                Customer: {
                    select: {
                        Person: {
                            select: {
                                first_name: true,
                                last_name: true,
                                full_name: true,
                            },
                        },
                        Company: { select: { name: true } },
                        type: true,
                    },
                },
            },
            take: 8,
            orderBy: { invoice_number: "desc" },
        });

        return invoices.map((invoice) => ({
            id: invoice.id,
            invoice_number: invoice.invoice_number,
            customer_id: invoice.customer_id,
            amount: invoice.amount,
            invoice_date: invoice.invoice_date,
            status_name: invoice.status || "",
            customer_name:
                invoice.Customer?.type === "Person"
                    ? invoice.Customer.Person?.full_name ||
                      `${invoice.Customer.Person?.first_name || ""} ${invoice.Customer.Person?.last_name || ""}`.trim()
                    : invoice.Customer?.Company?.name || "",
        }));
    }

    private async searchContacts(searchTerm: string, accountId: number) {
        const contacts = await this.db.contact.findMany({
            where: {
                AND: [
                    {
                        Company: {
                            Customer: {
                                some: { account_id: accountId },
                            },
                        },
                    },
                    {
                        OR: [
                            {
                                first_name: {
                                    contains: searchTerm,
                                    mode: "insensitive",
                                },
                            },
                            {
                                last_name: {
                                    contains: searchTerm,
                                    mode: "insensitive",
                                },
                            },
                            {
                                email: {
                                    contains: searchTerm,
                                    mode: "insensitive",
                                },
                            },
                            {
                                phone: {
                                    contains: searchTerm,
                                    mode: "insensitive",
                                },
                            },
                            {
                                mobile: {
                                    contains: searchTerm,
                                    mode: "insensitive",
                                },
                            },
                        ],
                    },
                ],
            },
            select: {
                id: true,
                first_name: true,
                last_name: true,
                email: true,
                phone: true,
                mobile: true,
                role: true,
                company_id: true,
                Company: {
                    select: {
                        name: true,
                        Customer: { select: { id: true }, take: 1 },
                    },
                },
            },
            take: 6,
            orderBy: { first_name: "asc" },
        });

        return contacts.map((contact) => ({
            id: contact.id,
            name:
                `${contact.first_name || ""} ${contact.last_name || ""}`.trim() ||
                contact.email ||
                "Contact",
            email: contact.email,
            phone: contact.phone,
            mobile: contact.mobile,
            role: contact.role,
            company_id: contact.company_id,
            company_name: contact.Company?.name,
            customer_id: contact.Company?.Customer?.[0]?.id || null,
        }));
    }

    private async searchDisputes(
        searchTerm: string,
        accountId: number,
        ownerFilter: Record<string, unknown>,
        buFilter: Record<string, unknown>
    ) {
        const disputeSearchConditions: Record<string, unknown>[] = [];
        if (!isNaN(parseInt(searchTerm, 10))) {
            disputeSearchConditions.push({ id: parseInt(searchTerm, 10) });
        }
        disputeSearchConditions.push({
            Customer: {
                account_id: accountId,
                customer_number: {
                    contains: searchTerm,
                    mode: "insensitive",
                },
            },
        });
        disputeSearchConditions.push({
            Customer: {
                account_id: accountId,
                Company: {
                    name: { contains: searchTerm, mode: "insensitive" },
                },
            },
        });
        disputeSearchConditions.push({
            Customer: {
                account_id: accountId,
                Person: {
                    first_name: {
                        contains: searchTerm,
                        mode: "insensitive",
                    },
                },
            },
        });
        disputeSearchConditions.push({
            Customer: {
                account_id: accountId,
                Person: {
                    last_name: {
                        contains: searchTerm,
                        mode: "insensitive",
                    },
                },
            },
        });
        disputeSearchConditions.push({
            customer_comment: {
                contains: searchTerm,
                mode: "insensitive",
            },
        });
        disputeSearchConditions.push({
            DisputeReason: {
                name: { contains: searchTerm, mode: "insensitive" },
            },
        });

        const disputes = await this.db.customerDispute.findMany({
            where: {
                Customer: {
                    account_id: accountId,
                    ...(Object.keys(ownerFilter).length > 0
                        ? ownerFilter
                        : {}),
                    ...(Object.keys(buFilter).length > 0 ? buFilter : {}),
                },
                dispute_status: {
                    in: ["New", "Under_Review", "Awaiting_Update"],
                },
                OR: disputeSearchConditions,
            },
            select: {
                id: true,
                customer_id: true,
                dispute_status: true,
                created_at: true,
                DisputeReason: { select: { name: true } },
                Customer: {
                    select: {
                        Person: {
                            select: {
                                first_name: true,
                                last_name: true,
                                full_name: true,
                            },
                        },
                        Company: { select: { name: true } },
                        type: true,
                    },
                },
            },
            take: 6,
            orderBy: { created_at: "desc" },
        });

        return disputes.map((dispute) => ({
            id: dispute.id,
            customer_id: dispute.customer_id,
            dispute_status: dispute.dispute_status,
            reason_name: dispute.DisputeReason?.name || "",
            customer_name:
                dispute.Customer.type === "Person"
                    ? dispute.Customer.Person?.full_name ||
                      `${dispute.Customer.Person?.first_name || ""} ${dispute.Customer.Person?.last_name || ""}`.trim()
                    : dispute.Customer.Company?.name || "",
            created_at: dispute.created_at,
        }));
    }
}
