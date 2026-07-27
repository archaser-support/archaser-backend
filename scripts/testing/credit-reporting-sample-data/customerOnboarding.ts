import { prisma } from "@/lib/prisma";
import { CustomerPolicyService } from "@/server/services/creditInsurance/CustomerPolicyService";
import { emptyEffectiveCustomerPolicyFields } from "@/server/services/creditInsurance/customerPolicyTypes";

import {
    COUNTRY_ID_ISRAEL,
    COUNTRY_ID_US,
    CUSTOMER_NUMBER_PREFIX,
    SAMPLE_DCL_CREDIT_SCORE,
    SAMPLE_SCENARIO_TAG_PREFIX,
} from "./constants";
import type {
    AccountBootstrapResult,
    CustomerOnboardingResult,
    ScheduledCustomer,
} from "./types";

function resolveCountryId(currencyProfile: ScheduledCustomer["currencyProfile"]): number {
    return currencyProfile === "USD-primary" ? COUNTRY_ID_US : COUNTRY_ID_ISRAEL;
}

function buildDisplayName(scheduled: ScheduledCustomer): {
    companyName?: string;
    personFirstName?: string;
    personLastName?: string;
} {
    const suffix = scheduled.customerNumber.replace(`${CUSTOMER_NUMBER_PREFIX}-`, "");

    if (scheduled.clientType === "Company") {
        return {
            companyName: `Credit Sample ${suffix}`,
        };
    }

    const personNumber = String(scheduled.index + 1).padStart(3, "0");
    return {
        personFirstName: "Credit",
        personLastName: `Sample ${personNumber}`,
    };
}

function buildPolicyPatch(scheduled: ScheduledCustomer, primaryPolicyId: number) {
    const patch: Parameters<
        typeof CustomerPolicyService.applyActivePolicyPatch
    >[0]["patch"] = {
        insurance_policy_id: primaryPolicyId,
        customer_number_policy: scheduled.customerNumber,
        approved_limit: scheduled.approvedLimit,
        approved_limit_currency: scheduled.approvedLimitCurrency,
        active_customer_since: scheduled.createDate,
        limit_type: "Named",
        max_payment_term: 60,
        max_allowed_mep: 90,
        reporting_days: 30,
    };

    switch (scheduled.scenario) {
        case "gap":
            patch.max_payment_term = 45;
            break;
        case "breach-mep":
            patch.max_allowed_mep = 15;
            break;
        case "breach-reporting":
            patch.reporting_days = 7;
            break;
        case "breach-outdated-dcl":
            patch.outdated_dcl = true;
            break;
        case "breach-post-policy-end":
            break;
        case "excluded":
            patch.policy_exclusion_reason = "Insurer declined";
            break;
        case "zero-limit":
            patch.approved_limit = 0;
            patch.zero_limit_date = scheduled.createDate;
            break;
        case "no-policy":
            patch.limit_type = "DCL";
            patch.policy_exclusion_reason = "Pending review";
            patch.credit_score = SAMPLE_DCL_CREDIT_SCORE;
            patch.credit_score_input_date = scheduled.createDate;
            patch.active_customer_since = scheduled.createDate;
            break;
        case "compliant":
        default:
            break;
    }

    return patch;
}

export async function onboardScheduledCustomer(args: {
    scheduled: ScheduledCustomer;
    bootstrap: AccountBootstrapResult;
    actorUserId: string;
}): Promise<CustomerOnboardingResult> {
    const { scheduled, bootstrap, actorUserId } = args;
    const countryId = resolveCountryId(scheduled.currencyProfile);
    const businessUnitId =
        bootstrap.businessUnitIds[scheduled.businessUnitIndex] ?? null;
    const displayName = buildDisplayName(scheduled);
    const now = scheduled.createDate;

    const companyId =
        scheduled.clientType === "Company"
            ? (
                  await prisma.company.create({
                      data: {
                          name: displayName.companyName!,
                          modified_at: now,
                      },
                      select: { id: true },
                  })
              ).id
            : undefined;

    const personId =
        scheduled.clientType === "Person"
            ? (
                  await prisma.person.create({
                      data: {
                          first_name: displayName.personFirstName!,
                          last_name: displayName.personLastName!,
                          modified_at: now,
                      },
                      select: { id: true },
                  })
              ).id
            : undefined;

    const customer = await prisma.customer.create({
        data: {
            account_id: bootstrap.accountId,
            customer_number: scheduled.customerNumber,
            type: scheduled.clientType,
            country_id: countryId,
            business_unit_id: businessUnitId,
            company_id: companyId,
            person_id: personId,
            collection_status: "Inactive",
            created_at: now,
            modified_at: now,
            created_by: actorUserId,
            modified_by: actorUserId,
            generic_text1: `${SAMPLE_SCENARIO_TAG_PREFIX}${scheduled.scenario}`,
            generic_text2: null,
        },
        select: {
            id: true,
            customer_number: true,
        },
    });

    const policyResult = await CustomerPolicyService.applyActivePolicyPatch({
        customerId: customer.id,
        accountId: bootstrap.accountId,
        countryId,
        customerNumber: customer.customer_number,
        modifiedBy: actorUserId,
        existingCountryId: countryId,
        existing: emptyEffectiveCustomerPolicyFields(),
        patch: buildPolicyPatch(scheduled, bootstrap.primaryPolicyId),
    });

    if (policyResult.error) {
        throw new Error(
            `Failed to create CustomerPolicy for ${scheduled.customerNumber}: ${policyResult.error}`
        );
    }

    return {
        customerId: customer.id,
        customerNumber: scheduled.customerNumber,
        scheduled,
    };
}

export async function onboardCustomersForDay(args: {
    scheduledCustomers: ScheduledCustomer[];
    bootstrap: AccountBootstrapResult;
    actorUserId: string;
}): Promise<CustomerOnboardingResult[]> {
    const results: CustomerOnboardingResult[] = [];

    for (const scheduled of args.scheduledCustomers) {
        results.push(
            await onboardScheduledCustomer({
                scheduled,
                bootstrap: args.bootstrap,
                actorUserId: args.actorUserId,
            })
        );
    }

    return results;
}
