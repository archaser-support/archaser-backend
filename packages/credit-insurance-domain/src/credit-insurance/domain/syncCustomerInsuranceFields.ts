/**
 * Recomputes `Customer.oldest_invoice_overdue_date` and `Customer.overdue_block`
 * from live Invoice rows; policy-derived fields (MEP, DCL, limits) are written to
 * the active CustomerPolicy.
 *
 * `oldest_invoice_overdue_date` is the ungated aging date. `overdue_block` uses the
 * MEP breach start date scope, so a pre-cutover open invoice still ages but never blocks.
 *
 * Ported from the legacy `server/services/creditInsurance/syncCustomerInsuranceFields.ts`
 * (deleted in frontend commit 2223f5e). One legacy behaviour is intentionally dropped:
 * the original wrote an "overdue block applied/cleared" timeline Activity via
 * `ActivityService`, which has no Nest equivalent. Its only caller here is checkpoint
 * restore, where manufacturing an Activity row absent from the snapshot would corrupt
 * the restored baseline.
 */
import { type DbClient, prisma } from "../domain-db";

import {
    computeCustomerOutdatedDcl,
    resolveDclApprovedLimitAfterOutdatedRecompute,
} from "./customerOutdatedDcl";
import {
    computeCustomerOverdueBlock,
    isEligibleForCustomerMepOverdue,
} from "./invoiceInsuranceFields";
import { resolveMepBreachStartDate } from "./resolveMepBreachStartDate";
import { getActiveCustomerPolicyRow } from "./resolveActiveCustomerPolicy";
import { isInvoiceInMepBreachScope } from "./shared/mepBreachScope";
import { syncCreditInsuranceGapPipelineForCustomer } from "./syncCreditInsuranceGapPipeline";
import { syncZeroLimitAlertFlagsForCustomer } from "./syncZeroLimitAlertFlags";

export type SyncCustomerInsuranceFieldsOptions = {
    dbClient?: DbClient;
    /** Follow-up effects need a committed client, so they default off inside a transaction. */
    runFollowUpEffects?: boolean;
    validateZeroLimitDate?: boolean;
    /** When set, the gap pipeline only recomputes these invoices' gaps. */
    invoiceIds?: number[];
    /** Calendar day for overdue_block / DCL evaluation (chronological replay). */
    asOfDate?: Date;
    /** Recompute open-invoice terms-breach flags after policy exclusion/limit-type changes. */
    refreshTermsBreachFlags?: boolean;
};

type SyncCoreResult = {
    accountId: number | null;
    previousBlock: boolean;
    overdueBlock: boolean;
};

async function syncCustomerInsuranceFieldsCore(
    customerId: number,
    dbClient: DbClient,
    validateZeroLimitDate: boolean,
    asOfDate?: Date
): Promise<SyncCoreResult> {
    const today = asOfDate ? new Date(asOfDate) : new Date();
    today.setHours(0, 0, 0, 0);

    const [overdueInvoices, customerRow, activePolicy] = await Promise.all([
        dbClient.invoice.findMany({
            where: {
                customer_id: customerId,
                status: "Overdue",
                OR: [{ amount: null }, { amount: { gte: 0 } }],
            },
            select: { due_date: true, amount: true, invoice_date: true },
        }),
        dbClient.customer.findUnique({
            where: { id: customerId },
            select: { overdue_block: true, account_id: true },
        }),
        getActiveCustomerPolicyRow(customerId, dbClient),
    ]);

    // Invoices issued before the account's MEP breach start date never cause a
    // block, so they are dropped from the block candidate set.
    const mepBreachStartDate = await resolveMepBreachStartDate(
        customerRow?.account_id,
        dbClient
    );

    // Two dates, deliberately: the stored column is the customer's real aging
    // (days overdue on the header, legal cases, report virtual field), while the
    // block is MEP-scoped. Gating the stored column too would zero out aging for
    // pre-cutover open invoices, which the MEP gate is not meant to touch.
    let oldestDue: Date | null = null;
    let oldestDueInMepScope: Date | null = null;
    for (const invoice of overdueInvoices) {
        if (!isEligibleForCustomerMepOverdue(invoice.amount)) {
            continue;
        }
        if (!invoice.due_date) {
            continue;
        }
        const dueDate = new Date(invoice.due_date);
        if (!oldestDue || dueDate < oldestDue) {
            oldestDue = dueDate;
        }
        if (!isInvoiceInMepBreachScope(invoice.invoice_date, mepBreachStartDate)) {
            continue;
        }
        if (!oldestDueInMepScope || dueDate < oldestDueInMepScope) {
            oldestDueInMepScope = dueDate;
        }
    }

    const policyWithInsurance = activePolicy
        ? await dbClient.customerPolicy.findFirst({
              where: { id: activePolicy.id },
              select: {
                  id: true,
                  limit_type: true,
                  credit_score: true,
                  credit_score_input_date: true,
                  active_customer_since: true,
                  approved_limit: true,
                  approved_limit_expiration_date: true,
                  zero_limit_date: true,
                  max_allowed_mep: true,
                  approved_limit_currency: true,
                  InsurancePolicy: {
                      select: {
                          min_credit_score: true,
                          score_validity_period_months: true,
                          dcl_customer_since_months: true,
                          currency: true,
                          max_dcl: true,
                      },
                  },
              },
          })
        : null;

    const overdueBlock = computeCustomerOverdueBlock({
        oldestInvoiceOverdueDate: oldestDueInMepScope,
        maxAllowedMepDays: policyWithInsurance?.max_allowed_mep ?? null,
        today,
    });

    const outdatedDcl = policyWithInsurance
        ? computeCustomerOutdatedDcl({
              limitType: policyWithInsurance.limit_type,
              creditScore: policyWithInsurance.credit_score,
              minCreditScore:
                  policyWithInsurance.InsurancePolicy?.min_credit_score ?? null,
              creditScoreInputDate: policyWithInsurance.credit_score_input_date,
              scoreValidityPeriodMonths:
                  policyWithInsurance.InsurancePolicy
                      ?.score_validity_period_months ?? null,
              activeCustomerSince: policyWithInsurance.active_customer_since,
              dclCustomerSinceMonths:
                  policyWithInsurance.InsurancePolicy
                      ?.dcl_customer_since_months ?? null,
              today,
          })
        : false;

    const approvedLimitPatch = policyWithInsurance
        ? resolveDclApprovedLimitAfterOutdatedRecompute({
              limitType: policyWithInsurance.limit_type,
              outdatedDcl,
              creditScore: policyWithInsurance.credit_score,
              minCreditScore:
                  policyWithInsurance.InsurancePolicy?.min_credit_score ?? null,
              userProvidedApprovedLimit: false,
              existingApprovedLimit: policyWithInsurance.approved_limit,
              patchedApprovedLimit: undefined,
              approvedLimitExpirationDate:
                  policyWithInsurance.approved_limit_expiration_date ?? null,
              zeroLimitDate: policyWithInsurance.zero_limit_date ?? null,
              policyMaxDcl: policyWithInsurance.InsurancePolicy?.max_dcl ?? null,
              today,
          })
        : {};

    const previousBlock = customerRow?.overdue_block === true;

    await dbClient.customer.update({
        where: { id: customerId },
        data: {
            oldest_invoice_overdue_date: oldestDue,
            overdue_block: overdueBlock,
        },
    });

    if (policyWithInsurance) {
        await dbClient.customerPolicy.update({
            where: { id: policyWithInsurance.id },
            data: {
                outdated_dcl: outdatedDcl,
                approved_limit_currency:
                    policyWithInsurance.InsurancePolicy?.currency ??
                    policyWithInsurance.approved_limit_currency ??
                    null,
                ...approvedLimitPatch,
            },
        });
    }

    await syncZeroLimitAlertFlagsForCustomer({
        customerId,
        dbClient,
        validateZeroLimitDate,
    });

    return {
        accountId: customerRow?.account_id ?? null,
        previousBlock,
        overdueBlock,
    };
}

export async function syncCustomerInsuranceFields(
    customerId: number,
    options: SyncCustomerInsuranceFieldsOptions = {}
): Promise<void> {
    const {
        dbClient,
        runFollowUpEffects = dbClient == null,
        validateZeroLimitDate = false,
        invoiceIds,
        asOfDate,
        refreshTermsBreachFlags = false,
    } = options;

    if (dbClient && runFollowUpEffects) {
        throw new Error(
            "syncCustomerInsuranceFields follow-up effects require a committed client"
        );
    }

    let coreResult: SyncCoreResult;
    if (dbClient) {
        coreResult = await syncCustomerInsuranceFieldsCore(
            customerId,
            dbClient,
            validateZeroLimitDate,
            asOfDate
        );
    } else {
        coreResult = await prisma.$transaction(async (tx) =>
            syncCustomerInsuranceFieldsCore(
                customerId,
                tx as DbClient,
                validateZeroLimitDate,
                asOfDate
            )
        );
    }

    if (!runFollowUpEffects) {
        return;
    }

    const overdueBlockChanged =
        coreResult.previousBlock !== coreResult.overdueBlock;
    if (refreshTermsBreachFlags || overdueBlockChanged) {
        const { refreshTermsBreachFlagsForCustomer } = await import(
            "./syncInvoiceReportingBreach"
        );
        await refreshTermsBreachFlagsForCustomer(customerId);
    }

    await syncCreditInsuranceGapPipelineForCustomer(customerId, { invoiceIds });
}
