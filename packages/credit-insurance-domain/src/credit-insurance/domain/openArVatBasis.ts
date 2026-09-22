/**
 * Shared open-AR contribution under the account include/exclude VAT setting.
 *
 * Payments and outstanding stay on the with-VAT ledger. When the account
 * excludes VAT and both invoice amount sides are present (with ≠ 0), the
 * contribution is outstanding × (|without| ÷ |with|) so credit notes keep the
 * same sign as include-VAT (ERP often stores without-VAT as a positive magnitude
 * while amount/outstanding are negative). Otherwise use gross outstanding
 * (include mode, or incomplete VAT fields).
 */

export type OpenArVatBasisInput = {
    /** Account setting: true = include VAT (today's gross behavior). */
    amountsIncludeVat: boolean;
    /** With-VAT open outstanding for the invoice line. */
    outstandingWithVat: number;
    /** Invoice amount without VAT (account currency), when known. */
    amountWithoutVat?: number | null;
    /** Invoice amount with VAT (account currency), when known. */
    amountWithVat?: number | null;
};

/**
 * Returns the open-AR contribution for one invoice under the account VAT basis.
 */
export function computeOpenArVatBasisContribution(
    input: OpenArVatBasisInput
): number {
    const outstanding = Number(input.outstandingWithVat);
    if (!Number.isFinite(outstanding)) {
        return 0;
    }

    if (input.amountsIncludeVat) {
        return outstanding;
    }

    const without =
        input.amountWithoutVat == null ? null : Number(input.amountWithoutVat);
    const withVat =
        input.amountWithVat == null ? null : Number(input.amountWithVat);

    if (
        without == null ||
        withVat == null ||
        !Number.isFinite(without) ||
        !Number.isFinite(withVat) ||
        withVat === 0
    ) {
        return outstanding;
    }

    // Abs ratio preserves outstanding sign (credits stay credits), matching
    // include-VAT behavior when without-VAT is stored as a positive magnitude.
    return outstanding * (Math.abs(without) / Math.abs(withVat));
}

/** Apply VAT basis to a gross outstanding given invoice VAT triad fields. */
export function applyOpenArVatBasis(
    amountsIncludeVat: boolean,
    outstandingWithVat: number,
    invoice: {
        amount_without_vat?: number | null;
        amount?: number | null;
    }
): number {
    return computeOpenArVatBasisContribution({
        amountsIncludeVat,
        outstandingWithVat,
        amountWithoutVat: invoice.amount_without_vat,
        amountWithVat: invoice.amount,
    });
}

/**
 * SQL expression: VAT-scaled line outstanding for invoice alias `i` and account
 * alias `a`. Gross prefers outstanding_debt then customer_outstanding_debt.
 */
export const OPEN_AR_VAT_BASIS_LINE_SQL = `
CASE
  WHEN COALESCE(a.amounts_include_vat, true) = false
    AND i.amount_without_vat IS NOT NULL
    AND i.amount IS NOT NULL
    AND i.amount <> 0
  THEN (
    CASE
      WHEN COALESCE(i.outstanding_debt, 0) != 0 THEN i.outstanding_debt
      ELSE COALESCE(i.customer_outstanding_debt, 0)
    END
  ) * (ABS(i.amount_without_vat) / ABS(i.amount))
  ELSE (
    CASE
      WHEN COALESCE(i.outstanding_debt, 0) != 0 THEN i.outstanding_debt
      ELSE COALESCE(i.customer_outstanding_debt, 0)
    END
  )
END
`.trim();

/**
 * Same as {@link OPEN_AR_VAT_BASIS_LINE_SQL} but scales customer-currency
 * outstanding (for dual-currency buckets).
 */
export const OPEN_AR_VAT_BASIS_CUSTOMER_LINE_SQL = `
CASE
  WHEN COALESCE(a.amounts_include_vat, true) = false
    AND COALESCE(i.customer_amount_without_vat, i.amount_without_vat) IS NOT NULL
    AND COALESCE(NULLIF(i.customer_amount, 0), NULLIF(i.amount, 0)) IS NOT NULL
  THEN (
    CASE
      WHEN COALESCE(i.customer_outstanding_debt, 0) != 0 THEN i.customer_outstanding_debt
      ELSE COALESCE(i.outstanding_debt, 0)
    END
  ) * (
    ABS(COALESCE(i.customer_amount_without_vat, i.amount_without_vat))
    / ABS(COALESCE(NULLIF(i.customer_amount, 0), i.amount))
  )
  ELSE (
    CASE
      WHEN COALESCE(i.customer_outstanding_debt, 0) != 0 THEN i.customer_outstanding_debt
      ELSE COALESCE(i.outstanding_debt, 0)
    END
  )
END
`.trim();
