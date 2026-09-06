import { creditInsurancePrisma as prisma } from "@archaser/credit-insurance-domain";

/**
 * When policy_id is set/changed, copy InsurancePolicyCountry → CustomerPolicy fields for the customer's country.
 */
export async function getPolicyCountryDefaultsForCustomer(
    policyId: number,
    countryId: number | null
): Promise<{
    reporting_days: number | null;
    max_payment_term: number | null;
    max_allowed_mep: number | null;
} | null> {
    if (!countryId) {
        return null;
    }

    const row = await prisma.insurancePolicyCountry.findFirst({
        where: {
            insurance_policy_id: policyId,
            country_id: countryId,
        },
        select: {
            reporting_days: true,
            payment_term_cap: true,
            country_mep: true,
        },
    });

    if (!row) {
        return null;
    }

    return {
        reporting_days: row.reporting_days,
        max_payment_term: row.payment_term_cap,
        max_allowed_mep: row.country_mep,
    };
}
