# 01 — Account-matched extension label

**Status:** done
**Priority:** high
**Blocked by:** —
**User stories:** 1, 2, 3, 4, 5, 6, 18
**PRD:** `.cursor/plans/billing-integration-ext-ctp.prd.md`

## What to build

On Account → Billing settings → Integration (Schedule), remove the Extension key Autocomplete. If the billing extension registry has `account_{accountId}`, show a read-only label for that extension; otherwise show a “no account extension” label. On Save of the billing connector: auto-set the matching account key when unset; clear any stored key that is not the matching account key (and clear extension config when the key clears, consistent with existing validation). Keep showing the existing extension settings panel when the matched key is attached. Ship English and Hebrew copy for any new/changed strings.

## Acceptance criteria

- [x] Extension key Autocomplete is gone from the Integration / Schedule UI
- [x] When `account_{accountId}` exists in the registry, a read-only label identifies it
- [x] When no match exists, UI shows no-account-extension copy (EN + HE)
- [x] Save attaches the matching key when previously unset
- [x] Save clears non-matching stored keys (including sample no-op)
- [x] Matched extension settings panel still renders when the key is attached
- [x] Matching English and Hebrew locale keys are added/updated together

## How to test

1. Open an account that has a registered `account_{id}` extension (e.g. 10149) → Billing settings → Integration.
2. Confirm there is no Extension key dropdown; a label shows the account extension.
3. If the connector had no key, Save and reload — key is attached and the extension panel still appears when applicable.
4. On an account without a matching registry entry, confirm the no-extension label; if a leftover non-account key was stored, Save clears it.
5. Switch locale to Hebrew and confirm new labels.
