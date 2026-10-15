---
name: portfolio-summary-poc
overview: POC — Claude-generated, concise Hebrew PDF summarizing the Portfolio Health dashboard. The report range is the last 180 days ending on the generation date. The rules were set on account 10149. The same chapters and scenario rules apply to any account. Manager overview of policy status — global issues and example customers, not worklists. The plan is the instructions for the review loop; no separate skill file.
source: start-work grill session (2026-10-08); revision grill session (2026-10-11); act-now/breach-types grill (2026-10-12); review-loop grill (2026-10-12)
clickup_task_url: https://app.clickup.com/t/869fe115x
isProject: false
---

# Portfolio summary POC — account 10149

## Problem Statement

The Portfolio Health dashboard shows a lot of credit-insurance data across five tabs (Policy summary, Health, No coverage, Utilization, Costs), but a customer has to click through every KPI and chart to understand what it means for them. There is no written view that turns the numbers into conclusions.

The first PDF draft (7 pages) proved the idea but was too long: about half of it repeated dashboard tables. It also stayed at portfolio level. It did not say which customers keep breaching policy terms and why, which customers pay cash and should not cost premium, or which cash customers pay late and break MEP (Maximum Extension Period).

## Solution

Produce a Hebrew, right-to-left PDF using the dashboard default scope (all policies, all business units, with excluded customers / no-policy exposure included). The range is the last 180 days ending today, not a fixed end date. Hero KPIs must match the Portfolio Health tab for that same range and scope. The same chapters appear on every account. Recommendations follow that account's data.

**Audience / purpose:** a manager overview of the current credit-insurance policy status. Raise **global** issues and pinpoints problematic behaviour or reporting. Do **not** turn the PDF into a per-invoice or full-customer worklist — for each issue show portfolio totals and **one example customer** (largest money impact).

- A backend script pulls the dashboard data for that range and scope **plus per-customer invoice facts** (terms, due/paid dates, MEP and reporting flags, disputes) and saves them as a local data bundle.
- You start a chat pointed at this plan. The agent analyzes the bundle, checks each scenario against the rules below, and writes a **concise** Hebrew markdown draft: one short block per dashboard area, and customer-level insights with causes and recommendations. The first chapter is תקציר מנהלים. There is no actions chapter.
- The PDF is rendered once, when no topic is still open. It is about 3 pages and at most 5, with no raw data tables.

Real customer names and amounts are used. No product UI changes are made in this task.

## Report layout

| Order | Chapter |
|------|---------|
| Header | Account name, kicker **סיכום תיק ביטוח אשראי**, and the date range (plus days with data). Do not write **דוח חצי שנתי**. Opening disclaimer in the header: recommendations are automatic analysis of activity data and policy terms as entered, support decisions only, are not insurance advice, and the user owns the decision and its execution. |
| 1 | **תקציר מנהלים.** KPI row: רמת הגנת אשראי (latest, with period average and peak), חוב בסיכון (share of open balance), **חשיפה בסיכון** (the at-risk amount — this replaces כבר אחרי מועדי כיסוי), עלות פוליסה. Insight strips under the KPIs may restate at-risk exposure, period cost, and utilization. Do **not** include עלות מכירות מזומן, הכיסוי קטן ביחס לחוב, חיסכון אפשרי, or הפרות תנאי פוליסה. Cash-sales cost stays in the cash-customers chapter. |
| 2–4 | One short block each: policy terms (one sentence, not a table), health, costs. At most one chart each. Empty policies are omitted. |
| 5 | **ניצול ומסגרות.** Three bullets. The daily-utilization chart sits with the first bullet. |
| 6 | Cash-terms customers. Compact list, at most 5. The figure is the premium those sales cost, not a saving. |
| 7 | **לקוחות מזומן שמשלמים באיחור.** Not מזומן שמשלם באיחור. |
| Last | **הפרות תנאים — הארכת ימי אשראי.** Payment terms, created-at-MEP, and reporting. This chapter is part of the template on every account and every range. It is not tied to one generation date. Numbers and the example customer come from that run. It replaces the הפרות תנאי פוליסה card. |

Omitted on every account: **הפרות חוזרות**, **פעולות לפי סדר עדיפות**, **תובנות נוספות** (act-now, payer trend, late reporting, concentration), and **הכנה לחידוש הפוליסה**.

**ניצול ומסגרות** is three bullets. The daily-utilization chart stays with the first.

- **ניצול התיק.** Average, peak, and that no day passed 100%.
- **כיסוי עילי.** How many customers and covers, and the average use. One example who went over it (largest peak). One example with the larger cover and little use: state the cover and the days of use, then "כדאי לשקול אי חידוש הכיסוי העילי", and say one more customer is in the same situation. Do not name the second customer.
- **לקוחות נקובים בלי ניצול.** The count and the assessment fee on them.

Rules: no KPI tables, no month-by-month cost tables, no per-policy-year claims tables (claims and excess become one sentence, or are dropped when there are none). Numbers are stated once. Charts are kept only where they show a trend that words cannot (monthly cost, daily health, monthly compliant vs at-risk AR, daily utilization).

## Visual style

Presentation only. The renderer styles the draft. It does not change calculations, source data, filters, historical snapshots, policy rules, recommendations, or action order, and it does not hardcode an example customer or any figure into the template.

Use the chapters in Report layout. Do not add umbrella titles (for example "מגמות, ניצול ועלויות" or "תרחישים ותנאי הפוליסה"). Headings stay the ones in the draft.

White A4. Dark readable text, subtle separators, compact tables. The report chrome follows the half-year portfolio PDF: a purple banner (`#6D4AFF`), numbered chapter badges, a KPI row, and purple table headers. Compliant exposure stays Portfolio Health jade (`#0F9D74`); at-risk exposure stays copper (`#C2703A`). The daily-health line is blue. Do not recolor those series with the banner purple.

Header: purple banner. Account name and **סיכום תיק ביטוח אשראי** on the right, the date range under the name, ARchaser on the left. Keep the ARchaser mark's proportions and colors. Do not write דוח חצי שנתי. The disclaimer sits in the banner, before the KPI row.

The KPI row is the four figures in Report layout. Insight strips under תקציר מנהלים use a colored edge and the draft's sentences. Do not add עלות מכירות מזומן, הכיסוי קטן ביחס לחוב, חיסכון אפשרי, כבר אחרי מועדי כיסוי, or הפרות תנאי פוליסה. Cash-sales cost stays in the cash-customers chapter. Inside the wording, keep these apart:

- Latest protection rate and the period-average protection rate.
- Open balance (concentration, as-of receivables) and invoice amounts during the period (scenario tables).
- Period insurance cost and the annual credit-assessment fee. The fee is not part of the period cost.

There is no actions chapter.

Policy terms stay one sentence, not a table.

Charts sit with the paragraph that explains them and do not split from that paragraph across a page. Each chart has a legend, a unit, and readable labels. The value axis is on the right. **Every bar shows its value**: inside the bar when the segment is tall enough, otherwise just above it. The daily-health chart draws a labeled **85%** reference line. That 85 is `PORTFOLIO_HEALTH_BELOW_THRESHOLD_PCT`. Do not call it a policy requirement. On monthly charts, mark a month as partial when the selected range does not cover it from the first to the last day, and say so in the caption. There is still no month-by-month cost table; the cost paragraph sits beside the monthly cost chart. Each cost bar is split into premium, registration fee, and כיסוי עילי. The annual assessment fee stays out of the chart.

The payment-terms, created-at-MEP, and reporting tables keep every row and column. Highlight a day-count row only when the recommendation immediately above asks for that number (`לבקש מהמבטח N ימי אשראי`, or `לבקש … N יום`). Do not hardcode 152. When the rule says not to name a day count, highlight nothing. A highlighted row is the recommendation. The other rows are scenarios, not insurer approval.

## Language

Write the draft in professional Hebrew for a finance manager reading a credit-insurance report. Correct grammar, and vocabulary a reader can understand without the product screen in front of them.

- State the fact. Do not use a metaphor. "שעון ה־MEP" is not clear. When the due date is the invoice date, write that מניין ימי ה־MEP מתחיל ביום החשבונית.
- Name the subject in the heading. Do not use a question or a casual verb. "מה משתנה כשמעלים את הימים" is not a report heading. The day-extension chapter is **הפרות תנאים — הארכת ימי אשראי**.
- Do not use product slang: דגל, דשבורד, כרטיס, סעיף למעלה, הגדולים, מחמירים, בלי מספר ימים, טופ־אפ, תוספת (when it means a top-up). A top-up is **כיסוי עילי**. Use the report terms: יתרה פתוחה, חריגה, מועד, מסגרת, כיסוי, כיסוי עילי, פרמיה, דמי רישום, עמלת הערכת אשראי, המלצה, חלופה.
- The cash-customers-who-pay-late chapter is **לקוחות מזומן שמשלמים באיחור**. מזומן שמשלם באיחור treats the cash term as the one who pays, and in the singular.
- State a duration in days, not "כשבוע". Do not write "כמעט בלי שימוש", "באותו מצב", or a bare order such as "לא לחדש" or "ההמלצה היא שלא לחדש". Write the fact, then "כדאי לשקול אי חידוש הכיסוי העילי".
- When a customer name is part of a sentence, write **הלקוח** immediately before the name. A name that opens a list line stays without it.
- These wordings apply on every account. Fill the numbers and the name from that run. Do not copy a sentence from one account's draft into another.

| What you mean | Write |
|---------------|--------|
| Policy credit, MEP, and reporting length | ימי אשראי מרביים N, ימי MEP N, ימי דיווח N |
| Lowest protection rate | רמת ההגנה הנמוכה ביותר היא X% |
| Named customers with no balance | N מתוך M לקוחות נקובים |
| Cash share of sales | X% מהמכירות במזומן |
| Effective cost | X% מיתרת החוב המכוסה הממוצעת בתקופה |
| Utilization never passed 100% | באף יום לא עלה ניצול התיק על 100% |
| Balance left cover because of MEP | יתרה של X יצאה מכיסוי בשל חריגת MEP, כולה אצל הלקוח [name] |
| Delay is steady or not | האיחור עקבי, or האיחור אינו עקבי |
| Largest amount in a group | הלקוח בעל הסכום הגבוה ביותר הוא הלקוח [name] |
| Cash cost is not an order to stop reporting | אין בכך הוראה להפסיק את הדיווח למבטח |
| Annual assessment fee is outside the monthly bars | דמי ההערכה השנתיים אינם כלולים בעמודות החודשיות |
| Payment-term ask | ההמלצה היא לבקש מהמבטח N ימי אשראי, המספר הנמוך ביותר שבו לא נותרת חריגה מתנאי התשלום בתקופה, ובתוך התקרה של 180 יום |
| What the שיפור column means | השיפור הוא הירידה בסכום החריגה לעומת N יום |
| Created-at-MEP table, no day to ask for | בימי MEP של N נותרו … אין המלצה למספר ימים מסוים |
| Reporting table, no day to ask for | ב־N ימי דיווח נותרו … אין המלצה למספר ימים מסוים |
| Cash customer who pays late | X% מהחשבוניות חרגו מימי ה־MEP. החציון הוא N יום ממועד החשבונית עד התשלום |
| Unused כיסוי עילי | כדאי לשקול אי חידוש הכיסוי העילי |
| Day-extension chapter title | הפרות תנאים — הארכת ימי אשראי |

- Match number and gender. A plural amount takes אינם; חוב takes אינו. After **הלקוח**, the verb is masculine.
- Keep MEP and the insurer's name as they appear on the policy. Do not translate them into a vague word.
- Language edits do not change a number, a recommendation, the action order, or the chapter. Do not add a chapter in order to sound formal. The sensitivity chapter in Report layout is required; it is not an extra chapter.

## Policy violations

There is no **הפרות תנאי פוליסה** card and no ranked share list in the PDF. The last chapter, **הפרות תנאים — הארכת ימי אשראי**, is the violations view: payment terms, created-at-MEP, and reporting, with every sensitivity row. The bundle may still carry the reason breakdown for the review loop. It is not a report chapter.

## Customer insights — definitions

### Recurring term breaches

Two breach types, analyzed and shown separately because they need different fixes:

- **Type A — terms over policy max:** invoice issued with more credit days than the customer's policy max payment term (`Invoice.ctv_payment_term`; credit days = due date − invoice date vs `CustomerPolicy.max_payment_term`).
- **Type B — paid late past MEP:** invoice paid after its MEP deadline (`close_date` > `target_mep_date`), or still open after it as of range end. Uses the stored `target_mep_date` so the month-end cutoff and extra-days rules match the product.

**Recurring rule:** a customer is a recurring breacher of a type when **at least 50% of its invoices issued in the range** breached that type, with **at least 3 invoices** in the range (so one invoice cannot score 100%).

**Cause classification** (payment patterns + disputes; activity notes are not read):

| Cause | Detected by | Recommendation |
|-------|-------------|----------------|
| Terms setup | Type A on most of the customer's invoices with the same issued terms | If the customer's assigned payment term is **below** the policy max, suggest raising it in the system up to that max. If it is already at the policy max, suggest only an insurer approval for the days actually issued |
| Steady slow payer | Type B; days late are consistent (spread between 25th and 75th percentile ≤ 15 days) | Ask for more credit days (the median actual days-to-pay rounded up to 30/45/60/90) or a longer MEP; flag when this exceeds the policy max of 120 days |
| Dispute-linked | At least half of the breached invoices have a `DisputeInvoice` | Resolve the disputes; not a credit problem |
| Worsening payer | Monthly median days late rises across the range (last 2 months above the first 2 by ≥ 15 days) **and** the last 2 months are actually late (> 0 days), so "paying less early" does not count | Reduce exposure or limit; review before the next limit renewal |
| Erratic | Type B with none of the above | Targeted collection; no terms change |

Do **not** write that breaches are unrelated to disputes. Dispute links are usually missing when the report is generated, so no `DisputeInvoice` rows is not a finding.

These definitions stay for the review loop. **הפרות חוזרות** is not a report chapter.

### Cash-terms customers

- **Cash invoice:** due date = invoice date (fallback: `payment_term = 0`).
- **Cash customer:** at least 90% of the customer's invoice amount in the range is cash. Customers with a 10–90% cash share are listed separately as **mixed**.
- **Cost:** the exact premium the cash sales generated under the policy cost rules (actual-sales premium on cash invoices × cost %, plus the registration fee on that premium), plus the annual credit assessment fee for cash customers that are named on the policy. The cost uses the same cost inputs as the Costs section, so it reconciles with the dashboard total.
- **Wording:** shown as the premium those cash sales cost in the period. Not a "possible saving," and not a firm instruction to stop reporting.

### לקוחות מזומן שמשלמים באיחור

- **Detected by:** cash customer (or mixed) with Type B breaches. Because the due date is the invoice date, the MEP clock starts on day 0.
- **Impact shown:** the share of invoices past the MEP days, the median days from the invoice date to payment, and the balance put out of cover by the customer MEP flag (`ctv_customer_overdue_mep` on its invoices). Use the Language row for a cash customer who pays late on every list line. A bare "אחרי MEP" or "חציון N יום" does not say what is counted.
- **Recommendation (data-driven):** when due date = invoice date but **actual payment date** is later, always offer **both** forks — give real credit days sized from payment behaviour, **or** enforce cash collection. Steady delay leans on a specific term bucket; erratic delay still shows a sized terms option alongside collection (cash labels in the ERP are not proof they pay on the invoice day).

## Additional insights

These are not report chapters. Do not add **תובנות נוספות**, **פעולות לפי סדר עדיפות**, or **הכנה לחידוש פוליסה**.

- **Act-now, payer trend, late reporting, and concentration** stay defined here so a later account can be checked, and they stay out of the PDF. Act-now means open invoices already past a deadline as of the generation date (MEP: `target_mep_date` before today and not `mep_ignored`; reporting: `target_reporting_date` before today and `actual_reporting_date` null). The page-1 figure for cover already at risk is **חשיפה בסיכון**, not a past-deadline amount.
- **Renewal:** omitted. For account 10149 the main policy ends Mar 31, 2027; that date is not a report chapter.
- **Top-up wording:** write **כיסוי עילי**, not תוספת and not טופ־אפ.

## User Stories

1. As the account finance owner, I want a short written summary of the policy period (about 3 pages, at most 5), so that I understand the position in minutes without opening every dashboard tab.
2. As the account owner, I want תקציר מנהלים with at-risk exposure in the KPI row, and the day-extension chapter at the end, so that I see cover and how breaches change as days increase.
3. As the account owner, I want the total policy cost, its monthly trend and effective cost explained in a few sentences, so that I know what insurance cost me and why.
4. As the account owner, I want utilization, over-coverage, idle named customers and כיסוי עילי summarized with a base-limit vs כיסוי עילי recommendation, so that my cover is right-sized at the lowest cost.
5. As the account owner, I want my Credit Protection Level trend, days below threshold and longest over-limit streak summarized, so that I know how well my receivables were protected.
6. As the account owner, I want at-risk exposure in the KPI row, and the payment-term, created-at-MEP, and reporting sensitivity tables at the end, so that I see how the breach amount changes as the days increase.
7. As the account owner, I want my key policy terms restated in one sentence, so that the insights have context.
8. As the account owner, I want customers who keep breaching policy terms classified by breach type, with one example customer, so that the review can see the repeat problem rather than a worklist. This stays in the review loop. It is not a PDF chapter.
9. As the account owner, I want the likely cause of each recurring breach (terms setup, steady slow payer, disputes, worsening payer), so that the review can name the root cause. This stays in the review loop. It is not a PDF chapter.
10. As the account owner, I want a recommendation per recurring breacher (e.g. ask for more credit days for a steady slow payer), so that the review can say how the breaches stop. This stays in the review loop. It is not a PDF chapter.
11. As the account owner, I want my cash-terms customers identified with the premium and fees they cost, so that I can stop paying insurance for sales that carry no credit risk.
12. As the account owner, I want cash customers who pay late identified with the cover they cost me through MEP breaches, so that I either give them real terms or enforce cash collection.
13. As the account owner, I want חשיפה בסיכון as the cover figure, so that past-deadline invoices are not a separate KPI or chapter.
14. As the account owner, I want payer trend, late reporting, and concentration left out of the PDF, so that those checks stay available for the review and do not add chapters.
15. As the account owner, I want the reporting sensitivity table at the end of the report, so that I see unreported invoices without a separate late-reporting chapter.
16. As the account owner, I want concentration left out of the PDF, so that the pages stay on the chapters in Report layout.
17. As the account owner, I want the renewal chapter left out of the report, so that the pages stay on the current period's policy status.
18. As the account owner, I want each insight backed by a number I can find on the dashboard or in my invoice data, so that I trust the analysis.
19. As the account owner, I want the report in Hebrew with correct right-to-left layout, so that it reads naturally.
20. As an ARchaser product owner, I want this POC to show what AI analysis of portfolio and invoice data can produce, so that I can decide whether to build it into the Policy summary tab.
21. As an ARchaser developer, I want the data pull to be a repeatable script with account and date-range inputs, so that the POC can be re-run for another range or account.
22. As an ARchaser developer, I want the dashboard parts of the bundle to come from the same service the dashboard uses, so that the PDF and the dashboard never disagree.

## Implementation Decisions

- **Deliverable:** one Hebrew PDF per run, about 3 pages, maximum 5. English is out of scope. The first run is account 10149. The PDF is rendered only when the review loop has no open topic.
- **Range and scope:** the last 180 days ending on the generation date (inclusive). The pull script defaults to that window; `--from` and `--to` override it. Scope follows the dashboard default: no policy filter, all business units, **with excluded customers** (`includeNoPolicyExposure: true`).
- **Dashboard data:** unchanged. `getCreditPortfolioHealth` (health, no coverage, utilization, costs) with account-wide access, plus policy terms and claims/excess from the Policy summary tab services. No new API endpoint. POC may extend the **bundle** (not the product API) with terms-breach share breakdown + example customer per reason derived from the same daily `breachAmountByReason` totals the No Coverage section already computes.
- **Customer insight data (new bundle sections, `BUNDLE_VERSION` 2+):** the script adds read-only Prisma queries for invoices issued in the range on in-scope customers (customers with an active linked policy, same scope as the dashboard): invoice and due dates, close date, amount (same VAT basis as the dashboard), payment term, `ctv_payment_term`, `ctv_customer_overdue_mep`, `target_mep_date`, `target_reporting_date`, `reporting_breach`, dispute link, and the customer's policy max payment term, MEP, cost %, registration fee % and named status. The script computes per-customer aggregates (breach shares, days-late percentiles, monthly medians, cash share, cash premium saving) so the narrative quotes computed numbers, not Claude's own arithmetic.
- **Customer identity:** invoices are attributed to their credit-pool root customer (same pool attribution as the Costs section), so customers match the grouped names on the dashboard.
- **Cash premium cost:** reuse the cost inputs and rules from the Costs section (actual-sales cost %, registration fee %, annual assessment fee) instead of a new formula, so it reconciles with the Costs total. The report states that figure as cost, not as a possible saving.
- **Act-now list:** defined in Additional insights and omitted from the PDF. The page-1 cover figure is חשיפה בסיכון.
- **Data coverage check:** the bundle records days with snapshot data vs days in range. If coverage is incomplete, the report says so.
- **Analysis and narrative:** Claude writes all text from the bundle, following this plan. No AI/LLM SDK is added to the product. No separate skill file. Every quoted number maps to a bundle field. While a topic is open, the draft is markdown in `.scratch/portfolio-summary-poc/`. See Review loop and Scenario behavior.
- **Number formatting:** money and percentages follow the dashboard's Hebrew formatting conventions (currency from the policy, he-IL locale). Amounts above 1M are rounded to one decimal (e.g. 28.9M ₪) to save space.
- **Charts:** at most four static charts (monthly policy cost, daily health, monthly compliant/at-risk AR, daily utilization). No new chart dependency; plain SVG or what the repos already have. See Visual style for the 85% reference line, legends, partial months, bar values, and keeping each chart with its explanation.
- **PDF rendering:** RTL HTML printed to PDF with headless Chromium through the Playwright already in the frontend repo. If a browser download is needed, ask the user first. Fallback: open the HTML and print to PDF manually. Hebrew is the report language. Latin names and numbers stay readable inside the RTL layout. An English narrative is out of scope.
- **Branding:** purple banner and chapter badges, jade and copper for exposure, ARchaser on the banner, as specified in Visual style. No new product styles. Top-up is written כיסוי עילי.
- **Committed artifacts:** the data-pull and render scripts, plus planning files. The bundle, narrative and PDF stay in the gitignored `.scratch/portfolio-summary-poc/` and are shared manually.
- **i18n:** no product UI copy changes, so no locale file updates.
- **Schema:** none. Cash terms are inferred from invoice dates; no cash flag is added.

## Decision log

| # | Topic | Decision | Rationale / plan impact |
|---|-------|----------|-------------------------|
| D1 | PDF length | About 3 pages: summary + actions, one short block per area, customer insights; no raw tables | The 7-page draft repeated dashboard tables; the narrative is the value. Adds the Report layout section. |
| D2 | Breach types | Both: Type A (issued terms over policy max) and Type B (paid late past MEP), shown separately | They need different fixes (terms setup vs payer behavior). |
| D3 | Recurring rule | At least 50% of the customer's invoices in the range breached (plus a minimum of 3 invoices) | The user chose the invoice-share rule; the minimum count stops single-invoice customers scoring 100%. |
| D4 | Cause sources | Payment patterns + disputes; no activity notes | Patterns and disputes are structured and traceable; free-text notes are hard to verify. |
| D5 | Cash customer rule | At least 90% of invoice amount is cash; 10–90% listed as mixed | Tolerates a few non-cash invoices without hiding mixed customers. |
| D6 | Cash saving wording | Exact saving + "confirm exemption with insurer" note | Insurer wording on cash-sale declaration varies. |
| D7 | Cash customers paying late | Steady delay → set real credit terms matching actual days-to-pay; erratic → enforce cash collection | The data tells which fix fits each customer. |
| D8 | Extra insights | All five: act-now list, payer trend, late reporting, concentration, renewal brief | Each is capped at 3–5 lines; the page cap moved from 3 to a maximum of 4. |
| D9 | Build-time adjustments | Act-now window 30 days; worsening payer requires actual lateness; pool-root customer attribution | Found while generating the PDF: deadlines cluster on month-end cutoffs; early payers drifting later were flagged as worsening; premium reconciled with Costs only after pool attribution (0.00% difference). |
| D10 | Act-now MEP list | Only invoices **already past** MEP — not upcoming deadlines | באג had 0 MEP breaches but topped the list because deadlines clustered on 7 Nov; grace-period customers must not appear as MEP problems. |
| D11 | Terms-breach types on page 1 | Every type with share > 0, ranked | Leading-cause-only hid ~45% of breach amount; managers need every behaviour that has a value. |
| D12 | Where the list appears | Replace the MEP-only executive card with one Policy violations card | One place; no duplicate ranked list on page 2. |
| D13 | Each breach line numbers | Share % only (dashboard Share of total violations basis) | Matches the KPI managers already trust. |
| D14 | “Past MEP” rule | Open invoice with `target_mep_date` before today and not `mep_ignored` | Same deadline as cover risk; does not wait on `ctv_customer_overdue_mep`. |
| D15 | Reporting on act-now | Already past only (`target_reporting_date` before today, still unreported) | Same bar as MEP. |
| D16 | Hero KPI | Combined past MEP + past reporting (“already late on cover deadlines”) | Replaces “to handle in 30 days”. |
| D17 | Report purpose + combined total | Manager overview of policy status; pinpoints behaviour/reporting — not worklists; unique invoices once in the hero total | Caps list depth; one debt counted once even if both clocks expired. |
| D18 | Breach card depth | All types with a value; **customer count** + **one example customer** per type (not full customer lists) | Overview with scale and a concrete name. |
| D18b | Payment Term when already at policy max | Example customer at policy max with longer issued terms → ask insurer to raise terms | Align-to-max alone is wrong when local max is already the ceiling. |
| D19 | Example customer pick | Largest breach amount for that type in the range | Biggest money impact per behaviour. |
| D20 | Act-now action wording | Portfolio total + one example customer | Same overview rule as D18. |
| D21 | Fix hint per breach type | Yes — short fixed phrase by type | Behaviour + managerial response on the same card. |
| D22 | Page-2 הפרות | Drop the violations paragraph | Numbers stated once on the page-1 Policy violations card. |

The review-loop log below supersedes D1 (page cap is now 5), D6 (cash is stated as cost, not as a possible saving), D8 (renewal and the extra-insight chapters are omitted), D11–D12 and D16 (no violations card and no past-deadline KPI; the cover figure is חשיפה בסיכון), and D22 (no separate violations list). RL32–RL42 are the current report shape. Wording follows the Language table on every account.

## Review loop

You start a chat pointed at this plan. The plan is the instructions. The agent then continues in that chat until nothing is open, or you say stop. Questions are one at a time, so an earlier answer can be changed.

1. Pull the bundle for the account. The range is the last 180 days ending today, unless you pass other dates.
2. Write the Hebrew draft as markdown in `.scratch/portfolio-summary-poc/`. Do not render the PDF on each pass.
3. Fix a clear number mismatch without asking: the draft must match the bundle, and the bundle must match the dashboard service for that range. A change to a rule, a recommendation, or the action order waits for you.
4. For each scenario (one situation, with one example customer — not a question per customer): check related data already in the bundle (disputes, current terms, how they paid). Ask only when a fact the bundle does not store would change the advice. Then search online for the usual response. Offer 2–3 realistic results.
5. If this plan already has a rule for that situation, apply it to this account's numbers. If it does not, you pick the result. The agreed rule is added under Scenario behavior. The PDF shows the branch that fits the data. The other results stay in the chat. Until you pick, they may sit in an open-topics list in the draft, and that list is left out of the PDF.
6. A missing topic found online is suggested in the chat. It enters the report only after you agree. If the draft would pass 5 pages, the agent proposes what to shorten or drop and waits.
7. There is no actions chapter (RL34). Do not add one unless you ask for it.
8. When nothing is open, render the PDF once.

## Scenario behavior

Same chapters on every account (see Report layout). Recommendations follow the data. A rule is added here only after you confirm it. On a later account, apply the matching rule to the new numbers. Ask when no rule fits. Do not copy a day count or a sentence from another account.

The cause table under Recurring term breaches is the seed. These rows are the confirmed rules:

| Situation | When the data looks like this | What the report recommends |
|-----------|--------------------------------|----------------------------|
| Terms setup, below the policy max | Type A on most invoices, and the assigned term is below the policy max | Raise the term in the system up to that max |
| Terms setup, already at the policy max | Type A, and the assigned term is already the policy max | Ask the insurer for the smallest term that clears every payment-term breach in the range, and never above 180 days |
| Steady slow payer | Type B; days late are consistent (25th–75th percentile spread ≤ 15 days) | Size credit days from the median actual days-to-pay, rounded up to 30/45/60/90, and stop at the policy max. If the median exceeds the policy max (120 days on this book), ask the insurer or for a longer MEP |
| Dispute-linked | At least half of the breached invoices have a `DisputeInvoice` | Resolve the disputes |
| Worsening payer | Monthly median days late rises (last 2 months above the first 2 by ≥ 15 days) and the last 2 months are actually late | Reduce exposure or the limit |
| Erratic payer | Type B with none of the above | Targeted collection. No terms change |
| Cash sales | At least 90% of invoice amount is cash (10–90% is mixed) | State the premium those cash sales cost in the period |
| Cash customer paying late | Cash or mixed, with Type B | Offer both: credit days sized from this account's days-to-pay, or enforce cash collection |
| Over limit, no כיסוי עילי | Usage stays above the approved limit for most of the range, and that customer has no כיסוי עילי | Ask the insurer to raise the base limit to actual usage, and also turn on כיסוי עילי on the current limit. Amounts already shipped above the old limit stay uninsured |
| Invoices closed after MEP, several customers | At least two customers each closed at least half their invoices after the MEP date, with at least 3 invoices. The customer does not need a live MEP flag | Recommend increasing the MEP days, without a specific number of days. Do not recommend a payment-term change for this pattern |
| Payment term cap | Any recommendation to raise payment terms | Do not recommend a payment term above 180 days |
| Created at MEP | Invoices issued while the customer was already past MEP | Show how the breach count and amount change as MEP days change. Do not recommend a specific number of days. One example customer |
| Reporting length | Open invoices still unreported past the reporting date | Show how the breach count and amount change as reporting days change. Do not recommend a specific number of days. One example customer |

A situation with no row stays open until you pick one of the 2–3 results. Only the agreed rule is added to this table.

## Review loop — decision log

| # | Topic | Decision | Rationale / plan impact |
|---|-------|----------|-------------------------|
| RL1 | When a problem is found | Fix clear number mismatches. Ask before a rule, a piece of advice, or the action order changes | Judgment calls wait for you. |
| RL2 | Web search | Judge the advice and suggest missing topics. Nothing new is agreed until you say so | Search comes after the data check. |
| RL3 | Page budget | Final PDF may grow, up to 5 pages | Supersedes the earlier maximum of 4. |
| RL4 | Past 5 pages | Propose what to shorten or drop, and wait for approval | A cut waits for you. |
| RL5 | Executive summary | Remove it. Keep policy-term violations | Violations stay on page 1. |
| RL6 | Cover card | At-risk exposure replaces "already past cover" | Already-past deadlines stay in the later act-now block. Supersedes D16 as the page-1 card. |
| RL7 | Renewal chapter | Remove it | Out of every account's report. Supersedes the renewal part of D8. |
| RL8 | Cash card | Premium those cash sales cost | Supersedes the "possible saving" wording in D6. |
| RL9 | Action order | Cover already at risk, then largest money, then cheaper or later items. You accept or move items | A reorder waits for you. |
| RL10 | When the loop stops | Stop when nothing is open. You can also stop it earlier | Then the PDF is built. |
| RL11 | How it runs | You start it once. It continues on the given range | Each pass can update this plan. |
| RL12 | Recommendation source | You, or an online source | The agent does not invent the advice. |
| RL13 | Order for a scenario | Related data, then search, then you confirm | |
| RL14 | Related information | Use stored data. Ask only when a missing fact would change the advice | |
| RL15 | Ranges | The first run is only 1 Apr–30 Sep 2026. Later runs use the account and dates you give | One range per run. Outcomes, not extra windows. |
| RL16 | Possible outcomes | 2–3 realistic results per scenario. You pick one when no rule exists | One example customer per scenario. |
| RL17 | Working file | Markdown draft while topics are open. PDF only when nothing is open | The loop judges numbers and recommendations. |
| RL18 | Purpose | Teach this plan how to review other accounts | 10149 is the first run. |
| RL19 | What is shared | Same chapters everywhere. Recommendations follow the data | |
| RL20 | Familiar situation | Apply this plan's rule to the new numbers. Ask only when no rule fits | A new agreement is written into Scenario behavior. |
| RL21 | Where scenario behavior lives | This file | The account PDF shows the branch that fits that account's data. |
| RL22 | What you start | A chat pointed at this plan. No new skill file | This plan is the instructions. |
| RL23 | Over limit, no top-up | Recommend both: raise the base limit to actual usage, and turn on a top-up on the current limit | Confirmed on account 10149. Past shipments above the old limit stay uninsured. |
| RL24 | Invoices closed after MEP across several customers | Recommend increasing the MEP days. Not a payment-term change, and not limited to customers who still show a live MEP breach | Confirmed on account 10149 after אלדין invoice SI260007164. |
| RL25 | Payment term cap | Never recommend a payment term above 180 days | On this book, 152 days already clears every payment-term breach. |
| RL26 | Payment term ask | Ask for the smallest term that clears every breach, capped at 180 | On account 10149 that is 152 days. 145 days would clear 80% of the amount. |
| RL27 | Created at MEP and reporting length | Show the sensitivity table. Do not name a day count to ask for | One example customer, the largest amount. On account 10149: אלקטרה אילת for created-at-MEP, מיקרו ג'וק for reporting. |
| RL28 | Invoices closed after MEP | Recommend increasing the MEP days, with no day count | Same as the MEP table. On account 10149 the largest customers are about 2 days past a 30-day MEP. Example: אייסל. |
| RL29 | Report range | Last 180 days ending on the generation date | Replaces a fixed end such as 30 Sep. The Apr–Sep 2026 pass remains the run that set the rules. |
| RL30 | Visual style | Style the existing chapters only. Jade accent, logo plate from the account primary, charts with their text, highlight a scenario row only when the recommendation names that day count | Presentation only. See Visual style. |
| RL31 | הפרות תנאים | The three sensitivity tables are a template chapter on every review, for every account and range. The renderer adds them from that run's data when the draft omits them | Not a one-date narrative. Do not copy a day count or a name from another range. |
| RL32 | Report chrome | Purple banner, numbered chapters, four KPIs. No דוח חצי שנתי. Date range stays in the header | Matches the half-year portfolio PDF. Supersedes the jade-only chrome in RL30. Jade and copper stay on the exposure chart. |
| RL33 | תקציר מנהלים | Keep the chapter. Drop הכיסוי קטן ביחס לחוב, חיסכון אפשרי, עלות מכירות מזומן, and הפרות תנאי פוליסה. The cover figure is חשיפה בסיכון, not כבר אחרי מועדי כיסוי. Cash-sales cost stays in the cash-customers chapter | Supersedes RL5 and the past-deadline KPI in RL6. |
| RL34 | Dropped chapters | No פעולות לפי סדר עדיפות, no תובנות נוספות, no הכנה לחידוש הפוליסה | Act-now, payer trend, late reporting, and concentration stay out of the PDF. |
| RL35 | Where הפרות תנאים sits | Last chapter | Replaces the violations card. |
| RL36 | Bar values | Every bar shows its value, inside the bar when it fits | |
| RL37 | Top-up term | כיסוי עילי | Not תוספת and not טופ־אפ. |
| RL38 | Recurring breaches | The definitions stay for the review loop. **הפרות חוזרות** is not a report chapter | Supersedes the earlier decision to print one example per breach type. |
| RL39 | Cash late heading | לקוחות מזומן שמשלמים באיחור | Not מזומן שמשלם באיחור. |
| RL40 | Unused כיסוי עילי | In ניצול ומסגרות, name one example: the larger cover that was barely used. State the duration in days. Say one more customer is in the same situation, and do not name that customer. Then "כדאי לשקול אי חידוש הכיסוי העילי" | The rule is in Report layout. On the account that set it, the named example was the larger cover and the unnamed one had zero days. |
| RL41 | Chapter 4 bullets | Three bullets: portfolio utilization (chart under it), כיסוי עילי (one customer who went over it, plus the unused-cover sentence from RL40), named customers with no balance and their assessment fee | Not one paragraph, and not two bullets. |
| RL42 | Wording is a rule | The Hebrew patterns in Language apply to every account. Numbers and names come from that run | A later review follows the table. It does not copy a sentence from one account's draft. |
| RL43 | Day-extension title | הפרות תנאים — הארכת ימי אשראי | Replaces השפעת הארכת הימים על היקף ההפרות. |

## Testing Decisions

- Per project rules, no automated tests are added unless requested.
- **Seam:** the JSON data bundle. Dashboard sections are checked manually against the live dashboard for the same account, range and default filters.
- **Customer insights check:** for 2–3 customers per list (recurring breacher, cash, cash paying late), check the invoices in the Invoices grid: dates, terms, paid date, MEP and reporting flags.
- **Cash cost check:** the cash premium plus the non-cash premium equals the Costs section's insurance and registration totals for the range.
- **Verification:** every number quoted in the PDF traces to a bundle field. Hebrew RTL rendering is checked visually (numbers, currency symbols, mixed-direction text). Page count is at most 5. The PDF is rendered only after the review loop has no open topic.
- **Prior art:** existing one-off scripts under the backend scripts folder (tsx-run, dotenv, argument parsing); `scripts/inspect-terms-breach-invoices.ts` for terms-breach invoice queries.

## How to test

Run `scripts/portfolio-summary-poc/pull-data-bundle.ts --account 10149`. That uses the last 180 days ending today. Point a chat at this plan and let the review loop write the markdown draft. Render the PDF only when nothing is open. Expect at most 5 pages, the header without דוח חצי שנתי, תקציר מנהלים with חשיפה בסיכון in the KPI row, no actions chapter, no תובנות נוספות, no renewal chapter, no הפרות חוזרות, כיסוי עילי wherever a top-up is named, three bullets under ניצול ומסגרות, cost bars split into premium, registration, and כיסוי עילי, the chapter לקוחות מזומן שמשלמים באיחור, bar values on every bar, and **הפרות תנאים — הארכת ימי אשראי** as the last chapter. A customer name inside a sentence is preceded by הלקוח. Open the dashboard for the same range and confirm Credit Protection Level matches.

## Out of Scope

- In-app summary on the Policy summary tab (follow-up ClickUp task after POC approval).
- Any in-product AI/LLM integration or SDK.
- A cash-terms flag on Customer/Invoice, or excluding cash sales from the product's premium calculation (possible follow-up once the insurer confirms the exemption).
- Reading collection activity notes for cause analysis.
- English version and per-policy breakdowns. Other accounts use this same plan; the first PDF run is account 10149.
- Upcoming-deadline act-now windows (replaced by already-past MEP/reporting).
- Full customer lists under each terms-breach type (one example only).
- Anonymization or scaling of amounts.
- Download-PDF or export features in the dashboard.

## Further Notes

- The task is a POC for judging what AI analysis can do. Insight quality and how clearly each insight traces to a number matter more than visual polish.
- If the POC is approved, the follow-up can reuse the bundle shape (including the customer insight sections) as the input contract for an in-app summary.
- The cause thresholds (15-day spread, 15-day worsening, 90% cash share) are POC defaults. Tune them after reviewing the first output. A new scenario rule is written into Scenario behavior only after you confirm it.
