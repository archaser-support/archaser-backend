# Account 10149 — Helam offset pair stamp-close

## Goal

When Priority Helam cancel recon has two invoices (`IVNUM` cancel stamp ≠
`FNCIREF1` original), stamp **both** Paid with no cancel payment import and no
virtual fill — they close each other.

## Decisions

| # | Decision |
|---|----------|
| D1 | Gate: reconciled + cancel debit + `IVNUM ≠ FNCIREF1` |
| D2 | Drop cancel row (do not import as payment on original) |
| D3 | Drop original positive debit in same batch (no virtual queue) |
| D4 | Stamp both Paid from net; delete leftover `virtual` / `חלמ` payments |
| D5 | Single-invoice Helam (`IVNUM === FNCIREF1`) unchanged (import payment) |
| D6 | Receipt / CR* / debit-only virtual paths unchanged |

## Implementation

1. `helamOffsetClose.ts` — stamp-close by invoice numbers
2. `transformAccount10149Batch` — detect offset pairs; queue stamp targets
3. `pendingHelamOffsetCloses` + staged sync flush
4. Admin panel copy

## Codebase scan

**Required:** `helamOffsetClose.ts`, `account_10149/index.ts`, `extensions/types.ts`, `stagedExtensionSync.ts`, `Account10149Panel.tsx`, this plan.

**No change:** schema, receipt virtual fill, credit abs payments.
