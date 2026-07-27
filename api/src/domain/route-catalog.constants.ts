/**
 * Small catalog constants used for OpenAPI enum/documentation purposes only.
 * Real routing/authorization lives in each domain's own Nest controller —
 * these lists do not gate request handling.
 */

/** Entity types served by Nest-native domain modules under /api/entities/:entityType. */
export const NEST_DOMAIN_ENTITY_TYPES = [
    "customers",
    "invoices",
    "contacts",
    "customer-collection-period",
    "accounts",
    "users",
    "business-units",
    "bank-accounts",
    "customer-banks",
    "business-unit-banks",
    "insurance-policies",
    "insurance-policy-countries",
    "insurance-policy-named-policies",
] as const;

/** Operation types served by OperationsDomainController under /api/operations/:operationType. */
export const OPERATION_TYPES = [
    "disputes",
    "dispute-reasons",
    "promise-to-pay",
    "legal-cases",
    "notifications",
    "sms",
    "email",
] as const;
