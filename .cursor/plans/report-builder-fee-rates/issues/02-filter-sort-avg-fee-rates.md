# 02 — Filter, sort & AVG-only on fee rate fields

**Status:** done
**Priority:** normal
**Blocked by:** [01-wire-customer-fee-rates](01-wire-customer-fee-rates.md)
**User stories:** 5, 6
**PRD:** `.cursor/plans/report-builder-fee-rates.prd.md`

## What to build

Enable **filter and sort** on Insurance Fee Rate (%) and Registration Fee (%) for both **Customer** and **Customer Policies** reports, using the same live active customer–policy (+ policy fallback) semantics as slice 01 for Customer columns.

For **grouped** reports, allow **AVG** on these two percent fields and do **not** offer **SUM** (or block SUM if aggregates are chosen from a shared list). If the report engine cannot restrict SUM without a large change, ship filter/sort fully and note the SUM gap in the PRD Further Notes — do not invent a one-off UI hack.

## Acceptance criteria

- [ ] Customer report can filter on either rate (e.g. Insurance Fee Rate greater than a number) and returns matching customers
- [ ] Customer report can sort ascending/descending on either rate
- [ ] Customer Policies report can filter and sort on both rate columns
- [ ] Grouped report offers AVG for these rate fields; SUM is not available (or documented follow-up if engine-blocked)
- [ ] Filter/sort on Customer uses the same live active customer–policy (+ fallback) values as display

## How to test

1. After slice 01 works, open a Customer report with both rate columns for several customers that have different Insurance Fee Rates.
2. Filter Insurance Fee Rate (%) greater than a midpoint value; expect only higher-rate customers.
3. Sort by Registration Fee (%) descending; expect order matches the live rates.
4. Repeat filter/sort on a Customer Policies report.
5. Group a Customer report (e.g. by owner) and check aggregates on Insurance Fee Rate (%): AVG is available; SUM is not (unless a documented engine gap).
