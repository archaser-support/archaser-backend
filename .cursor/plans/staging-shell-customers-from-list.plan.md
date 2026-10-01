# Staging shell customers from customer-group list

One-off datafix for **account 10149** (staging via current env). Create a shell parent per remaining screenshot row, copy the main customer’s active credit policy (force **Named**), then link every ID on that row as children through the existing parent-change path.

**Script (to add):** `scripts/datafixes/create-shell-customers-from-group-list.ts`

```bash
npx tsx scripts/datafixes/create-shell-customers-from-group-list.ts          # dry-run
npx tsx scripts/datafixes/create-shell-customers-from-group-list.ts --apply
```

Connect with existing script env cascade (`scripts/get-env-file-paths.js` / `dotenv`) and `PrismaClient` — no `.env` file edits.

## Decision log

| # | Topic | Decision | Rationale / plan impact |
|---|-------|----------|-------------------------|
| D1 | Shell `customer_number` | Start at **1002**, then 1003, … in list order. Skip first **3** screenshot rows. | First 3 shells already created by hand. |
| D2 | Account | **10149** | All lookups/creates scoped here. |
| D3 | Missing `customer_number` | Skip **that row only**; print missing numbers; continue. | One bad row must not block the rest. |
| D4 | Child already has a parent | **Overwrite** `parent_customer_id` to the new shell. | User choice; remirror will follow. |
| D5 | Shell policy | Copy **full active** `CustomerPolicy` from the main ID, then set `limit_type = Named`. | Children inherit from the shell after link. |
| D6 | Main has no active policy | Skip the row; print why. | Nothing to copy. |
| D7 | After parent set | Use existing **`onParentCustomerIdChanged`** (not FK-only). | Remirror + credit-pool side effects already in product code. |
| D8 | Shell name | New **Company** named `{name} (מאוחד)`; new Company-type Customer. | Display name is `Company.name`. |
| D9 | Dry-run | Default dry-run; write only with **`--apply`**. | Staging safety. |
| D10 | Extra shell fields | Copy **country, business unit, language, owner** from main. Leave collection status as create default (**Inactive**). | Country was requested; BU/lang/owner added. |
| D11 | Number already used | **Bump** 1002, 1003, … until free; always create a new shell (do not reuse). | Re-run can create a second shell for the same group — accept that. |
| D12 | Pending policy versions | Copy **active only**. | Pending rows stay on the leaf until remirror from shell. |

## Rows to process (skip first 3)

Main ID = 2nd column. Link **all** numbers on the row (main + extras) as children.

| Shell # (if free) | Name → `{name} (מאוחד)` | Main | Also link |
|---|---|---|---|
| 1002 | פטקום אלקטריק בע"מ | 107134486 | 10760077 |
| 1003 | אוטופון תקשורת | 107165472 | 107933273 |
| 1004 | ווידיגאיט | 10784030 | 107926601 |
| 1005 | איי.די טאצ | 107887603 | 107926119, 107932986 |
| 1006 | ת.ש פרו סלולר בע"מ | 107898084 | 107902663 |
| 1007 | א.כ אינפיניטק בעמ | 107904928 | 107902693 |
| 1008 | אוטופון תקשורת (חיפה) | 107165474 | 107936575 |
| 1009 | אלקטרה קמעונאות בע"מ | 107789795 | 107789755 |
| 1010 | אייסל ג.מ.א בע"מ | 10782790 | 107122538, 10780429 |
| 1011 | לאסט פרייס בע"מ | 107892115 | 107796878 |
| 1012 | סער טכנולוגיות (ז.ח) בע"מ | 107133527 | 107940449 |

Lookup key: `Customer.customer_number` (not `Customer.id`) + `account_id = 10149`.

**Skipped (already done):** א.ל.מ סחר…, אספיריקום מערכות בע"מ, היי ביז בע"מ.

## Per-row algorithm

1. Resolve every listed `customer_number` in account 10149. If any missing → skip row.
2. Load main customer: `country_id`, `business_unit_id`, `language`, `owner_id`, and **active** `CustomerPolicy` (`is_active = true`). If no active policy → skip row.
3. Allocate next `customer_number` as string, starting at `1002`; if taken, increment until unused (D11).
4. If `--apply`:
   - `company.create` with name `{name} (מאוחד)`.
   - `customer.create` type `Company`, that `company_id`, allocated number, copied country/BU/language/owner, `collection_status: Inactive`.
   - Clone active `CustomerPolicy` onto the new customer (same fields as product mirror keys), then set `limit_type: Named`. Keep `status`/`is_active` as on the source active row.
   - For each ID on the row: `customer.update` `parent_customer_id` = shell, then `onParentCustomerIdChanged` (previous parent → shell). Overwrite even if a parent already exists (D4).
5. Dry-run: print allocated number, company name, resolved internal ids, policy `insurance_policy_id` / `customer_number_policy`, current parents, and skip reasons. No writes.

## Codebase scan (script touchpoints)

**Required**

- `scripts/datafixes/create-shell-customers-from-group-list.ts` (new)
- `packages/credit-insurance-domain/.../parentCustomerCreditInheritance.ts` — call `onParentCustomerIdChanged`
- `packages/credit-insurance-domain/.../creditPoolShellGuards.ts` — parent must have no invoices/payments (new shells are empty)
- Prisma `Customer`, `Company`, `CustomerPolicy` (`insurance_policy_id`, `customer_number_policy`, `limit_type`)

**No change**

- API `customers.service.ts` create/update — script uses Prisma + domain helper, not HTTP
- Frontend customer form
- Tests (not requested)

## Out of scope unless requested

- ClickUp ticket / product UI
- Re-linking or deleting the 3 shells already created
- Copying pending `CustomerPolicy` rows
- Setting collection status Active

## How to test

1. Dry-run against staging env; confirm 11 rows, skips printed, numbers from 1002 (or bumped).
2. `--apply` once; in the app open a new shell — name ends with `(מאוחד)`, country/BU match main, policy Named, children listed.
3. Open a child — parent is the shell; policy matches the shell (remirror).
4. Do **not** re-run `--apply` unless you want extra shells (D11 bumps).
