export declare function resolveCustomerFirstCurrency(input: {
    customerCurrencyPrimary?: string | null;
    customerCurrencySecondary?: string | null;
    collectionCurrencyPrimary?: string | null;
    collectionCurrencySecondary?: string | null;
    accountCurrency?: string | null;
    fallbackCurrency?: string | null;
    terminalFallback?: string | null;
}): string;
