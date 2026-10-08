---
name: portfolio-summary-poc
overview: POC — Claude-generated Hebrew PDF summarizing the Portfolio Health dashboard for account 10149 (Apr 1 – Sep 30, 2026), to show the visibility the system gives on a credit insurance policy and the potential of AI analysis.
source: start-work grill session (2026-10-08)
clickup_task_url: https://app.clickup.com/t/869fe115x
isProject: false
---

# Portfolio summary POC — account 10149

## Problem Statement

The Portfolio Health dashboard shows a lot of credit-insurance data across five tabs (Policy summary, Health, No coverage, Utilization, Costs), but a customer has to click through every KPI and chart to understand what it means for them. There is no written, narrative view that turns the numbers into conclusions about cost, usage, top-ups and risk. Sales and account management also have nothing concrete to show what the system's visibility, combined with AI analysis, can deliver.

## Solution

Produce a one-off, Hebrew, right-to-left PDF for account 10149 covering Apr 1 – Sep 30, 2026, using the dashboard default scope (all policies, all business units, no-policy exposure excluded).

- A small backend script pulls exactly the data the dashboard shows for that range and scope, and saves it as a local data bundle.
- Claude (the agent) analyzes the bundle and writes everything in Hebrew: an executive summary, a section per dashboard area, insights and recommendations on cost, usage, top-ups, at-risk exposure and idle named customers.
- A render step turns the narrative and charts into a branded PDF.

The PDF goes to account 10149 only, so real customer names and amounts are used. No product UI changes are made in this task.

## User Stories

1. As the account 10149 finance owner, I want a single written summary of my policy's last six months, so that I understand my credit insurance position without opening every dashboard tab.
2. As the account owner, I want the total policy cost for the period, including top-ups, so that I know what insurance actually cost me.
3. As the account owner, I want the monthly policy cost trend explained, so that I can see which months were expensive and why.
4. As the account owner, I want effective cost per compliant unit explained in plain language, so that I can judge value for money.
5. As the account owner, I want registration fees and the annual credit assessment fee called out, so that I see fixed versus variable cost.
6. As the account owner, I want average and top-10 utilization of my limits, so that I know whether my cover is right-sized.
7. As the account owner, I want over-coverage and coverage peak highlighted, so that I can spot limits I pay for but don't use, and moments I nearly ran out.
8. As the account owner, I want idle named customers listed, so that I can consider reducing or cancelling unused named limits.
9. As the account owner, I want top-up count, affected customers and top-up draw explained, so that I understand how often my base cover was not enough.
10. As the account owner, I want a recommendation on whether to raise base limits instead of buying top-ups, so that I can reduce cost.
11. As the account owner, I want my Credit Protection Level and lowest health day explained, so that I know how well my receivables were protected.
12. As the account owner, I want the share of days below the health threshold and the longest over-limit streak, so that I understand how persistent my exposure gaps were.
13. As the account owner, I want monthly compliant versus at-risk AR summarized, so that I see whether risk is growing or shrinking.
14. As the account owner, I want at-risk exposure (customer share, count, amount) and the leading reasons for lack of coverage, so that I know what to fix first.
15. As the account owner, I want policy violations and their leading cause summarized, so that I avoid losing cover on claims.
16. As the account owner, I want my key policy terms (max cover, DCL/SDL cover, fee rate, payment term, MEP, reporting days) restated briefly, so that the insights have context.
17. As the account owner, I want claims and remaining excess per policy year mentioned when relevant, so that I see my claim headroom.
18. As the account owner, I want each insight backed by a number I can find on the dashboard, so that I trust the analysis.
19. As the account owner, I want a short prioritized action list at the end, so that I know what to do next.
20. As the account owner, I want the report in Hebrew with correct right-to-left layout, so that it reads naturally.
21. As an ARchaser product owner, I want this POC to show what AI analysis of dashboard data can produce, so that I can decide whether to build it into the Policy summary tab.
22. As an ARchaser developer, I want the data pull to be a repeatable script with account and date-range inputs, so that the POC can be re-run for another range or account.
23. As an ARchaser developer, I want the data bundle to come from the same service the dashboard uses, so that the PDF and the dashboard never disagree.

## Implementation Decisions

- **Deliverable:** one Hebrew PDF for account 10149. English is out of scope.
- **Range and scope:** Apr 1 – Sep 30, 2026 (six full calendar months). The script takes account, from and to as inputs, like the dashboard's date range field. Scope follows the dashboard default: no policy filter, all business units, no-policy exposure excluded.
- **Data source:** the script calls the same portfolio-health domain service the dashboard endpoint uses (health, no-coverage, utilization and costs sections), with account-wide access (no business-unit restriction). Policy terms and claims/remaining excess come from the same data the Policy summary tab reads. No new API endpoint.
- **Data bundle:** the script writes one JSON bundle (range, days available versus days in range, all four sections, policy terms, claims/excess) to the gitignored local workspace. Real customer data is never committed.
- **Data coverage check:** the bundle records days with snapshot data versus days in range. If coverage is incomplete, the report must say so rather than present partial data as complete.
- **Analysis and narrative:** Claude writes all text from the bundle: executive summary, one section per area (policy terms, health, no coverage, utilization and top-ups, costs), insights and a prioritized recommendation list. No AI/LLM SDK is added to the product. Every quoted number must map to a bundle field.
- **Number formatting:** money and percentages follow the dashboard's existing Hebrew formatting conventions (currency from the policy, he-IL locale).
- **Charts:** rendered as static images from bundle data: monthly policy cost, daily health, monthly compliant/at-risk AR, daily utilization and top-up draw. No new chart dependency. Use what is already available in the repos, or plain SVG.
- **PDF rendering:** an RTL HTML document (narrative and charts) printed to PDF with headless Chromium through the Playwright already in the frontend repo. If a browser download is needed, ask the user first. Fallback: open the HTML and print to PDF manually.
- **Branding:** reuse the existing Portfolio Health design tokens (colors, fonts) and ARchaser logo. No new product styles.
- **Committed artifacts:** the data-pull and render scripts, plus planning files. The generated bundle, narrative and PDF stay local and are shared manually.
- **i18n:** no product UI copy changes, so no locale file updates. The PDF text is Hebrew content, not locale keys.
- **Schema:** none.

## Testing Decisions

- Per project rules, no automated tests are added unless requested.
- **Seam:** the JSON data bundle. It is checked manually against the live dashboard for the same account, range and default filters.
- **Verification:** every KPI quoted in the PDF is checked against the matching dashboard tab. Every insight must trace to a bundle field. Hebrew RTL rendering is checked visually (numbers, currency symbols and mixed-direction text).
- **Prior art:** existing one-off scripts under the backend scripts folder (tsx-run, dotenv, argument parsing).

## Out of Scope

- In-app summary on the Policy summary tab (follow-up ClickUp task after POC approval).
- Any in-product AI/LLM integration or SDK.
- English version, other accounts, per-policy breakdowns, including no-policy exposure.
- Anonymization or scaling of amounts.
- Download-PDF or export features in the dashboard.

## Further Notes

- The task is a POC for judging what AI analysis can do. Insight quality and how clearly each insight traces to a number matter more than visual polish.
- If the POC is approved, the follow-up can reuse the bundle shape as the input contract for an in-app summary.
