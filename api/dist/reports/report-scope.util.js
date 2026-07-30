"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportVisibilityWhere = reportVisibilityWhere;
exports.buildAccountScopeWhere = buildAccountScopeWhere;
exports.nestOwnerScopeWhere = nestOwnerScopeWhere;
exports.nestBusinessUnitScopeWhere = nestBusinessUnitScopeWhere;
function reportVisibilityWhere(accountId) {
    return { account_id: accountId };
}
function buildAccountScopeWhere(primaryTable, accountId) {
    if (primaryTable === "Contact") {
        return {
            Company: {
                Customer: {
                    some: { account_id: accountId },
                },
            },
        };
    }
    if (primaryTable === "Dispute" ||
        primaryTable === "CustomerCollectionPeriod") {
        return { Customer: { account_id: accountId } };
    }
    if (primaryTable === "InvoicePayment") {
        return { Invoice: { account_id: accountId } };
    }
    return { account_id: accountId };
}
function nestOwnerScopeWhere(primaryTable, ownerFilter) {
    if (!ownerFilter || Object.keys(ownerFilter).length === 0) {
        return null;
    }
    if (primaryTable === "Customer" ||
        primaryTable === "Invoice") {
        return ownerFilter;
    }
    if (primaryTable === "Contact") {
        return {
            Company: {
                Customer: {
                    some: ownerFilter,
                },
            },
        };
    }
    if (primaryTable === "Dispute" ||
        primaryTable === "CustomerCollectionPeriod") {
        return { Customer: ownerFilter };
    }
    if (primaryTable === "Activity" || primaryTable === "Payment") {
        return { Customer: ownerFilter };
    }
    if (primaryTable === "CustomerBanks") {
        return { Customer: ownerFilter };
    }
    return null;
}
function nestBusinessUnitScopeWhere(primaryTable, buFilter) {
    if (!buFilter || Object.keys(buFilter).length === 0) {
        return null;
    }
    if (primaryTable === "Customer" || primaryTable === "Invoice") {
        return buFilter;
    }
    if (primaryTable === "Contact") {
        return {
            Company: {
                Customer: {
                    some: buFilter,
                },
            },
        };
    }
    if (primaryTable === "Dispute" ||
        primaryTable === "CustomerCollectionPeriod" ||
        primaryTable === "Activity" ||
        primaryTable === "Payment" ||
        primaryTable === "CustomerBanks") {
        return { Customer: buFilter };
    }
    if (primaryTable === "InvoicePayment") {
        return { Invoice: { Customer: buFilter } };
    }
    return null;
}
//# sourceMappingURL=report-scope.util.js.map