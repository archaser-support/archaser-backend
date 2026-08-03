export function resolveCustomerFirstCurrency(input: {
    customerCurrencyPrimary?: string | null;
    customerCurrencySecondary?: string | null;
    collectionCurrencyPrimary?: string | null;
    collectionCurrencySecondary?: string | null;
    accountCurrency?: string | null;
    fallbackCurrency?: string | null;
    terminalFallback?: string | null;
}): string {
    return (
        input.customerCurrencyPrimary ||
        input.customerCurrencySecondary ||
        input.collectionCurrencyPrimary ||
        input.collectionCurrencySecondary ||
        input.accountCurrency ||
        input.fallbackCurrency ||
        input.terminalFallback ||
        "USD"
    );
}
