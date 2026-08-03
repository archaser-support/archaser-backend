"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveNamedPolicyCustomerNumber = resolveNamedPolicyCustomerNumber;
exports.customerPolicyToNamedMasterFields = customerPolicyToNamedMasterFields;
exports.namedPolicyCustomerNumberMatchesAssignment = namedPolicyCustomerNumberMatchesAssignment;
exports.namedMasterToCustomerPolicyPatch = namedMasterToCustomerPolicyPatch;
function toApprovedLimit(value) {
    if (value === null || value === undefined) {
        return null;
    }
    return value;
}
function resolveNamedPolicyCustomerNumber(args) {
    const policyNumber = args.customerNumberPolicy?.trim();
    if (policyNumber) {
        return policyNumber;
    }
    const mainNumber = args.customerNumber?.trim();
    return mainNumber || null;
}
/** Maps active Named CustomerPolicy fields to NamedPolicy master input. */
function customerPolicyToNamedMasterFields(assignment, customerNumber) {
    const customer_number = resolveNamedPolicyCustomerNumber({
        customerNumberPolicy: assignment.customer_number_policy,
        customerNumber,
    });
    if (!customer_number) {
        return null;
    }
    return {
        customer_number,
        customer_max_limit: assignment.approved_limit,
        limit_expiration_date: assignment.approved_limit_expiration_date ?? null,
        max_payment_term: assignment.max_payment_term,
        customer_mep: assignment.max_allowed_mep,
        reporting_days: assignment.reporting_days,
    };
}
function namedPolicyCustomerNumberMatchesAssignment(args) {
    const masterKey = args.masterCustomerNumber.trim().toLowerCase();
    if (!masterKey) {
        return false;
    }
    const policyNumber = args.customerNumberPolicy?.trim().toLowerCase();
    const mainNumber = args.customerNumber?.trim().toLowerCase();
    return masterKey === policyNumber || masterKey === mainNumber;
}
/** Maps NamedPolicy master row fields to CustomerPolicy write input. */
function namedMasterToCustomerPolicyPatch(master, options) {
    const patch = {
        customer_number_policy: master.customer_number.trim(),
        approved_limit: toApprovedLimit(master.customer_max_limit),
        approved_limit_expiration_date: master.limit_expiration_date ?? null,
        max_payment_term: master.max_payment_term,
        max_allowed_mep: master.customer_mep,
        reporting_days: master.reporting_days,
    };
    if (options?.includeLimitType !== false) {
        patch.limit_type = "Named";
    }
    return patch;
}
