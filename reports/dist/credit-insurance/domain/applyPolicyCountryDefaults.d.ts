/**
 * When policy_id is set/changed, copy InsurancePolicyCountry → CustomerPolicy fields for the customer's country.
 */
export declare function getPolicyCountryDefaultsForCustomer(policyId: number, countryId: number | null): Promise<{
    reporting_days: number | null;
    max_payment_term: number | null;
    max_allowed_mep: number | null;
} | null>;
