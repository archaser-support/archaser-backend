import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { serializeBigInt } from "../common/serialize-bigint";
import { refreshInsuranceTargetDatesForInvoiceIds } from "../credit-insurance/domain/syncInvoiceReportingBreach";
import { DatabaseService } from "../database/database.service";

export type InvoicesListQuery = {
    page?: string;
    limit?: string;
    search?: string;
    status?: string;
    customer_id?: string;
    sortField?: string;
    sortDirection?: string;
};

@Injectable()
export class InvoicesService {
    constructor(
        private readonly db: DatabaseService,
        private readonly accessScope: AccessScopeService
    ) {}

    async list(user: JwtPayload, query: InvoicesListQuery) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);

        const page = parseInt(query.page || "1", 10);
        const limit = parseInt(query.limit || "10", 10);
        const search = query.search || "";
        const status = query.status || "";
        const customerId = query.customer_id
            ? parseInt(query.customer_id, 10)
            : null;
        const sortField = query.sortField || "";
        const sortDirection = (query.sortDirection || "desc") as
            | "asc"
            | "desc";

        const andClause: Record<string, unknown>[] = [
            { account_id: accountId },
            ...(status ? [{ status }] : []),
            ...(customerId ? [{ customer_id: customerId }] : []),
        ];

        if (search) {
            andClause.push({
                invoice_number: { contains: search, mode: "insensitive" },
            });
        }

        const where = { AND: andClause };

        const map: Record<string, string> = {
            invoice_number: "invoice_number",
            due_date: "due_date",
            invoice_date: "invoice_date",
            amount: "amount",
            status: "status",
            created_at: "created_at",
        };
        const orderBy = sortField
            ? [{ [map[sortField] || "id"]: sortDirection }, { id: "desc" }]
            : [{ invoice_date: "desc" }, { id: "desc" }];

        const [invoices, totalRecords] = await Promise.all([
            this.db.invoice.findMany({
                where: where as never,
                orderBy: orderBy as never,
                skip: (page - 1) * limit,
                take: limit,
                include: {
                    Customer: {
                        select: {
                            id: true,
                            customer_number: true,
                            Person: {
                                select: {
                                    first_name: true,
                                    last_name: true,
                                },
                            },
                            Company: { select: { name: true } },
                        },
                    },
                },
            }),
            this.db.invoice.count({ where: where as never }),
        ]);

        return serializeBigInt({ invoices, totalRecords, page, limit });
    }

    async getById(user: JwtPayload, id: number) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);

        const invoice = await this.db.invoice.findFirst({
            where: { id, account_id: accountId },
            include: {
                Customer: {
                    select: {
                        id: true,
                        customer_number: true,
                        Person: {
                            select: { first_name: true, last_name: true },
                        },
                        Company: { select: { name: true } },
                    },
                },
                InvoicePayment: true,
                DisputeInvoice: true,
            },
        });

        if (!invoice) {
            throw new NotFoundException({
                error: "Invoice not found",
                code: "INVOICE_NOT_FOUND",
            });
        }

        return serializeBigInt(invoice);
    }

    async update(
        user: JwtPayload,
        id: number,
        body: Record<string, unknown>
    ) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);

        const existing = await this.db.invoice.findFirst({
            where: { id, account_id: accountId },
            select: { id: true },
        });
        if (!existing) {
            throw new NotFoundException({
                error: "Invoice not found",
                code: "INVOICE_NOT_FOUND",
            });
        }

        const data: Record<string, unknown> = { ...body };
        delete data.id;
        delete data.account_id;
        delete data.customer_id;
        delete data.Customer;
        delete data.InvoicePayment;
        delete data.DisputeInvoice;
        delete data.created_at;
        delete data.created_by;
        data.modified_at = new Date();

        if ("account_id" in body || "customer_id" in body) {
            throw new ForbiddenException({
                error: "account_id / customer_id cannot be changed",
            });
        }

        const updated = await this.db.invoice.update({
            where: { id },
            data: data as never,
        });

        // Amount sign flips (and due/invoice date edits) must refresh MEP/reporting
        // targets via the same amount-aware path used for date-only refresh.
        if (
            Object.prototype.hasOwnProperty.call(body, "amount") ||
            Object.prototype.hasOwnProperty.call(body, "due_date") ||
            Object.prototype.hasOwnProperty.call(body, "invoice_date")
        ) {
            try {
                await refreshInsuranceTargetDatesForInvoiceIds([id], this.db);
            } catch {
                // Non-fatal: persist succeeded; targets can catch up on next stamp.
            }
        }

        return serializeBigInt(updated);
    }

    async listStatuses() {
        return [
            { id: 1, name: "Draft" },
            { id: 2, name: "Open" },
            { id: 3, name: "Overdue" },
            { id: 4, name: "Paid" },
            { id: 5, name: "Cancelled" },
            { id: 6, name: "Partially_Paid" },
            { id: 7, name: "Under_Dispute" },
            { id: 9, name: "Sent" },
            { id: 10, name: "Viewed" },
            { id: 11, name: "Void" },
            { id: 13, name: "Due" },
        ];
    }

    async availableForCredit(user: JwtPayload, customerId: number) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const invoices = await this.db.invoice.findMany({
            where: {
                account_id: accountId,
                customer_id: customerId,
                status: "Open",
                credit_for_invoice_id: null,
                outstanding_debt: { gt: 0 },
            },
            orderBy: { due_date: "asc" },
            take: 200,
            select: {
                id: true,
                invoice_number: true,
                amount: true,
                outstanding_debt: true,
                due_date: true,
                status: true,
            },
        });
        return serializeBigInt({ items: invoices });
    }

    async assignCredit(
        user: JwtPayload,
        body: {
            creditInvoiceId?: number;
            targetInvoiceId?: number;
            creditAmount?: number;
        }
    ) {
        const creditInvoiceId = Number(body.creditInvoiceId);
        const targetInvoiceId = Number(body.targetInvoiceId);
        if (
            !Number.isFinite(creditInvoiceId) ||
            !Number.isFinite(targetInvoiceId)
        ) {
            throw new BadRequestException({
                error: "creditInvoiceId and targetInvoiceId are required",
            });
        }
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const [credit, target] = await Promise.all([
            this.db.invoice.findFirst({
                where: { id: creditInvoiceId, account_id: accountId },
            }),
            this.db.invoice.findFirst({
                where: { id: targetInvoiceId, account_id: accountId },
            }),
        ]);
        if (!credit || !target) {
            throw new NotFoundException({ error: "Invoice not found" });
        }

        const creditAmount =
            body.creditAmount != null && Number.isFinite(Number(body.creditAmount))
                ? Math.abs(Number(body.creditAmount))
                : Math.abs(
                      Number(
                          credit.customer_net_amount ??
                              credit.net_amount ??
                              credit.customer_amount ??
                              credit.amount ??
                              0
                      )
                  );

        const currentCustomerNetAmount = Number(target.customer_net_amount ?? 0);
        const currentTotalPaid = Number(target.total_paid ?? 0);
        const currentCustomerTotalPaid = Number(
            target.customer_total_paid ?? 0
        );
        const newCustomerNetAmount = Math.max(
            0,
            currentCustomerNetAmount - creditAmount
        );

        const originalAmount = Number(target.amount ?? 0);
        const originalCustomerAmount = Number(target.customer_amount ?? 0);
        let newNetAmount = 0;
        if (originalCustomerAmount > 0) {
            newNetAmount = newCustomerNetAmount;
        } else if (originalAmount > 0 && currentCustomerNetAmount > 0) {
            const ratio =
                originalAmount / (Number(target.net_amount) || originalAmount);
            newNetAmount = newCustomerNetAmount * ratio;
        } else if (currentCustomerNetAmount > 0) {
            const reductionRatio =
                newCustomerNetAmount / currentCustomerNetAmount;
            newNetAmount = Number(target.net_amount ?? 0) * reductionRatio;
        } else {
            newNetAmount = Math.max(0, Number(target.net_amount ?? 0) - creditAmount);
        }

        const newOutstandingDebt = newNetAmount - currentTotalPaid;
        const newCustomerOutstandingDebt = Math.max(
            0,
            newCustomerNetAmount - currentCustomerTotalPaid
        );

        const { creditInvoice, targetInvoice } = await this.db.$transaction(
            async (tx) => {
                const creditInvoice = await tx.invoice.update({
                    where: { id: creditInvoiceId },
                    data: {
                        credit_for_invoice_id: targetInvoiceId,
                        credit_for_invoice_number: target.invoice_number || null,
                        modified_at: new Date(),
                    },
                });
                const targetInvoice = await tx.invoice.update({
                    where: { id: targetInvoiceId },
                    data: {
                        net_amount: newNetAmount,
                        customer_net_amount: newCustomerNetAmount,
                        outstanding_debt: newOutstandingDebt,
                        customer_outstanding_debt: newCustomerOutstandingDebt,
                        modified_at: new Date(),
                    },
                });
                return { creditInvoice, targetInvoice };
            }
        );

        return serializeBigInt({
            success: true,
            creditInvoice,
            targetInvoice,
            creditAmount,
            affectedCustomerIds: [credit.customer_id, target.customer_id].filter(
                (id): id is number => id != null
            ),
        });
    }
}
