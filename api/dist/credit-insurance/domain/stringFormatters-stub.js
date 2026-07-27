"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveCustomerFirstCurrency = resolveCustomerFirstCurrency;
function resolveCustomerFirstCurrency(input) {
    return (input.customerCurrencyPrimary ||
        input.customerCurrencySecondary ||
        input.collectionCurrencyPrimary ||
        input.collectionCurrencySecondary ||
        input.accountCurrency ||
        input.fallbackCurrency ||
        input.terminalFallback ||
        "USD");
}
//# sourceMappingURL=stringFormatters-stub.js.map