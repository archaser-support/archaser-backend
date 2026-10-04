/**
 * Apply B'SSACH quota rows (Excel 230–231) onto CustomerPolicy for two groups.
 * Then run create-shell-customers-from-group-list.ts separately with --apply.
 *
 * Excel: Copy of מכסות תקפות בבססח 24.09.xlsx
 *   Row 230 — אלקטרה קמעונאות בע"מ — 25,000,000 NIS, 120 days, from 2025-06-30
 *   Row 231 — א.ל.מ. סחר (2000) בע"מ — 6,989,000 NIS, 120 days, from 2025-06-24
 *
 * Usage:
 *   npx tsx scripts/datafixes/apply-bssach-quotas-and-create-shells.ts --apply
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
    bindCreditInsurancePrisma,
    startOfTodayUtc,
} from "@archaser/credit-insurance-domain";

const LOG = "[apply-bssach-quotas]";
const ACCOUNT_ID = 10149;
const POLICY_NUMBER = "13-G-09154";

type QuotaRow = {
    shellName: string;
    mainCustomerNumber: string;
    otherCustomerNumbers: string[];
    approvedLimit: number;
    approvedLimitCurrency: string;
    maxPaymentTerm: number;
    activeCustomerSince: Date;
};

/** Mapped from Excel rows 230–231 (Sheet1). */
const QUOTAS: QuotaRow[] = [
    {
        shellName: 'אלקטרה קמעונאות בע"מ',
        mainCustomerNumber: "107789795",
        otherCustomerNumbers: ["107789755"],
        approvedLimit: 25_000_000,
        approvedLimitCurrency: "NIS",
        maxPaymentTerm: 120,
        activeCustomerSince: new Date(Date.UTC(2025, 5, 30)),
    },
    {
        shellName: 'א.ל.מ סחר 0 2 בע"מ ח.פ. 511021495',
        mainCustomerNumber: "107821693",
        otherCustomerNumbers: ["107821686"],
        approvedLimit: 6_989_000,
        approvedLimitCurrency: "NIS",
        maxPaymentTerm: 120,
        activeCustomerSince: new Date(Date.UTC(2025, 5, 24)),
    },
];

async function upsertNamedCustomerPolicy(args: {
    prisma: PrismaClient;
    customerId: number;
    customerNumber: string;
    insurancePolicyId: number;
    approvedLimit: number;
    approvedLimitCurrency: string;
    maxPaymentTerm: number;
    maxAllowedMep: number | null;
    reportingDays: number | null;
    mepCutoffDay: number | null;
    mepSubstituteExtraDays: number | null;
    reportingCutoffDay: number | null;
    reportingSubstituteExtraDays: number | null;
    paymentTermCutoffDay: number | null;
    paymentTermSubstituteDay: number | null;
    costPercent: unknown;
    registrationFeePercent: unknown;
    activeCustomerSince: Date;
}): Promise<"create" | "patch"> {
    const {
        prisma,
        customerId,
        customerNumber,
        insurancePolicyId,
        approvedLimit,
        approvedLimitCurrency,
        maxPaymentTerm,
        maxAllowedMep,
        reportingDays,
        activeCustomerSince,
    } = args;

    let named = await prisma.namedPolicy.findFirst({
        where: {
            insurance_policy_id: insurancePolicyId,
            customer_number: customerNumber,
        },
    });
    if (!named) {
        named = await prisma.namedPolicy.create({
            data: {
                insurance_policy_id: insurancePolicyId,
                customer_number: customerNumber,
                customer_max_limit: String(approvedLimit),
                limit_expiration_date: null,
                max_payment_term: maxPaymentTerm,
                customer_mep: maxAllowedMep,
                reporting_days: reportingDays,
            },
        });
    } else {
        named = await prisma.namedPolicy.update({
            where: { id: named.id },
            data: {
                customer_max_limit: String(approvedLimit),
                limit_expiration_date: null,
                max_payment_term: maxPaymentTerm,
                customer_mep: maxAllowedMep,
                reporting_days: reportingDays,
            },
        });
    }

    const patch = {
        insurance_policy_id: insurancePolicyId,
        limit_type: "Named" as const,
        customer_number_policy: customerNumber,
        approved_limit: approvedLimit,
        approved_limit_currency: approvedLimitCurrency,
        approved_limit_expiration_date: null,
        max_payment_term: maxPaymentTerm,
        max_allowed_mep: maxAllowedMep ?? named.customer_mep,
        reporting_days: reportingDays ?? named.reporting_days,
        mep_cutoff_day: args.mepCutoffDay,
        mep_substitute_extra_days: args.mepSubstituteExtraDays,
        reporting_cutoff_day: args.reportingCutoffDay,
        reporting_substitute_extra_days: args.reportingSubstituteExtraDays,
        payment_term_cutoff_day: args.paymentTermCutoffDay,
        payment_term_substitute_day: args.paymentTermSubstituteDay,
        active_customer_since: activeCustomerSince,
        cost_percent: args.costPercent as never,
        registration_fee_percent: args.registrationFeePercent as never,
        excluded_from_policy: false,
        policy_exclusion_reason: null,
    };

    const active = await prisma.customerPolicy.findFirst({
        where: { customer_id: customerId, is_active: true },
        select: { id: true, insurance_policy_id: true },
    });

    if (!active) {
        await prisma.customerPolicy.create({
            data: {
                customer_id: customerId,
                is_active: true,
                status: "active",
                policy_change_start_date: startOfTodayUtc(),
                ...patch,
            } as never,
        });
        return "create";
    }

    if (active.insurance_policy_id !== insurancePolicyId) {
        await prisma.customerPolicy.update({
            where: { id: active.id },
            data: { is_active: false, status: "inactive" },
        });
        await prisma.customerPolicy.create({
            data: {
                customer_id: customerId,
                is_active: true,
                status: "active",
                policy_change_start_date: startOfTodayUtc(),
                ...patch,
            } as never,
        });
        return "create";
    }

    await prisma.customerPolicy.update({
        where: { id: active.id },
        data: patch as never,
    });
    return "patch";
}

async function main(): Promise<void> {
    const apply = process.argv.includes("--apply");
    const prisma = new PrismaClient();
    bindCreditInsurancePrisma(prisma);

    console.log(LOG, { accountId: ACCOUNT_ID, mode: apply ? "apply" : "dry-run" });

    try {
        const today = new Date();
        const insurancePolicy = await prisma.insurancePolicy.findFirst({
            where: {
                account_id: ACCOUNT_ID,
                policy_number: POLICY_NUMBER,
                policy_kind: "Primary",
                status: "Active",
                start_date: { lte: today },
                end_date: { gte: today },
            },
        });
        if (!insurancePolicy) {
            throw new Error(`Assignable policy not found: ${POLICY_NUMBER}`);
        }

        for (const quota of QUOTAS) {
            const numbers = [
                quota.mainCustomerNumber,
                ...quota.otherCustomerNumbers,
            ];
            for (const customerNumber of numbers) {
                const customer = await prisma.customer.findFirst({
                    where: {
                        account_id: ACCOUNT_ID,
                        customer_number: customerNumber,
                    },
                    select: { id: true, customer_number: true },
                });
                if (!customer) {
                    console.log(LOG, "skip — customer missing", { customerNumber });
                    continue;
                }

                console.log(LOG, apply ? "upsert policy" : "would upsert policy", {
                    customerNumber,
                    customerId: customer.id,
                    shellName: quota.shellName,
                    approvedLimit: quota.approvedLimit,
                    maxPaymentTerm: quota.maxPaymentTerm,
                    activeCustomerSince: quota.activeCustomerSince
                        .toISOString()
                        .slice(0, 10),
                    policyNumber: POLICY_NUMBER,
                });

                if (!apply) {
                    continue;
                }

                const action = await upsertNamedCustomerPolicy({
                    prisma,
                    customerId: customer.id,
                    customerNumber,
                    insurancePolicyId: insurancePolicy.id,
                    approvedLimit: quota.approvedLimit,
                    approvedLimitCurrency: quota.approvedLimitCurrency,
                    maxPaymentTerm: quota.maxPaymentTerm,
                    maxAllowedMep: insurancePolicy.max_allowed_mep,
                    reportingDays: insurancePolicy.reporting_days,
                    mepCutoffDay: insurancePolicy.mep_cutoff_day,
                    mepSubstituteExtraDays:
                        insurancePolicy.mep_substitute_extra_days,
                    reportingCutoffDay: insurancePolicy.reporting_cutoff_day,
                    reportingSubstituteExtraDays:
                        insurancePolicy.reporting_substitute_extra_days,
                    paymentTermCutoffDay:
                        insurancePolicy.payment_term_cutoff_day,
                    paymentTermSubstituteDay:
                        insurancePolicy.payment_term_substitute_day,
                    costPercent: insurancePolicy.cost_percent,
                    registrationFeePercent:
                        insurancePolicy.registration_fee_percent,
                    activeCustomerSince: quota.activeCustomerSince,
                });
                console.log(LOG, "policy upserted", {
                    customerNumber,
                    action,
                });
            }
        }

        console.log(LOG, apply ? "done" : "dry-run done — re-run with --apply to write");
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error(LOG, "failed", {
        errorMessage: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
});
