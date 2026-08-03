"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeInvoiceCapacityGapFlagsFromStored = computeInvoiceCapacityGapFlagsFromStored;
exports.syncInvoiceCapacityGapFlagsForCustomer = syncInvoiceCapacityGapFlagsForCustomer;
exports.syncInvoiceCapacityGapFlagsForAccount = syncInvoiceCapacityGapFlagsForAccount;
const client_1 = require("@prisma/client");
const domain_db_1 = require("../domain-db");
/**
 * Sticky {@link Invoice.in_capacity_gap} from stored per-invoice gap limit amount.
 */
function computeInvoiceCapacityGapFlagsFromStored(invoices) {
    const flags = new Map();
    for (const inv of invoices) {
        const limitGap = inv.capacity_gap_amount_limit == null
            ? 0
            : typeof inv.capacity_gap_amount_limit === "number"
                ? inv.capacity_gap_amount_limit
                : inv.capacity_gap_amount_limit.toNumber();
        flags.set(inv.id, limitGap > 0);
    }
    return flags;
}
/**
 * Recompute {@link Invoice.in_capacity_gap} from stored invoice gap fields.
 * Does not invoke policy gap writer — use {@link syncCreditInsuranceGapPipelineForCustomer}.
 */
async function syncInvoiceCapacityGapFlagsForCustomer(customerId, options) {
    const dbClient = options?.dbClient ?? domain_db_1.prisma;
    const customer = await dbClient.customer.findUnique({
        where: { id: customerId },
        select: {
            id: true,
            account_id: true,
            Account: { select: { has_credit_insurance: true } },
        },
    });
    if (!customer?.Account?.has_credit_insurance) {
        return;
    }
    const openInvoices = (await dbClient.invoice.findMany({
        where: {
            customer_id: customerId,
            account_id: customer.account_id,
            status: { in: ["Due", "Overdue"] },
        },
        select: {
            id: true,
            in_capacity_gap: true,
            capacity_gap_amount_limit: true,
        },
    }));
    const flags = computeInvoiceCapacityGapFlagsFromStored(openInvoices.map((inv) => ({
        id: inv.id,
        in_capacity_gap: inv.in_capacity_gap,
        capacity_gap_amount_limit: inv.capacity_gap_amount_limit == null
            ? null
            : inv.capacity_gap_amount_limit instanceof client_1.Prisma.Decimal
                ? inv.capacity_gap_amount_limit.toNumber()
                : Number(inv.capacity_gap_amount_limit),
    })));
    const updates = [];
    for (const inv of openInvoices) {
        const next = flags.get(inv.id) ?? false;
        if (inv.in_capacity_gap !== next) {
            updates.push({ id: inv.id, in_capacity_gap: next });
        }
    }
    if (updates.length === 0) {
        return;
    }
    await Promise.all(updates.map((u) => dbClient.invoice.update({
        where: { id: u.id },
        data: { in_capacity_gap: u.in_capacity_gap },
    })));
}
/**
 * Batch sync for all customers on an account with credit insurance enabled.
 */
async function syncInvoiceCapacityGapFlagsForAccount(accountId) {
    const customers = await domain_db_1.prisma.customer.findMany({
        where: {
            account_id: accountId,
            collection_status: { in: ["Active", "Inactive"] },
            Account: { has_credit_insurance: true },
        },
        select: { id: true },
    });
    for (const c of customers) {
        const { syncCreditInsuranceGapPipelineForCustomer } = await Promise.resolve().then(() => __importStar(require("./syncCreditInsuranceGapPipeline")));
        await syncCreditInsuranceGapPipelineForCustomer(c.id);
    }
    return { customersProcessed: customers.length };
}
