# 02 — Costs UI tooltip + help copy

**Status:** done  
**Priority:** normal  
**Blocked by:** [01-range-cost-registration-components](01-range-cost-registration-components.md)  
**User stories:** 7, 8  
**PRD:** `.cursor/plans/portfolio-health-registration-fee-cost.prd.md`

## What to build

On Credit Portfolio Health → Costs & Effectiveness, keep a **single** monthly policy-cost bar, but make the bar **tooltip** show:

- Insurance fee  
- Registration fee  
- Top-ups  
- Total  

Wire the tooltip from the monthly component fields delivered by slice 01. Update Policy cost and monthly chart **help** copy so they describe registration as a percent of the insurance premium (and still mention issued sales / annualized limit / top-ups).

Zeros may appear as $0 lines. Do not introduce stacked bars or new theme styles without approval — reuse the existing chart tooltip pattern.

**Note:** Translation file edits need explicit permission at implement time (EN/HE dashboard keys).

## Acceptance criteria

- [x] Monthly bar height still reflects total monthly Policy cost (including registration).
- [x] Hovering a month shows Insurance fee, Registration fee, Top-ups, and Total with correct amounts/currency formatting.
- [x] Policy cost KPI still shows the folded period total (no separate registration card required).
- [x] Policy cost / monthly chart help text mentions registration markup on the insurance premium.
- [x] EN and HE dashboard strings updated together when translation permission is granted.

## How to test

1. Open `/credit-portfolio-health`, select Costs & Effectiveness, choose a range with mixed insurance and (if available) top-up cost.
2. Confirm Policy cost number includes registration (matches slice 01 expectations).
3. Hover each monthly bar — tooltip lists four lines and the total matches the bar.
4. Open the help tooltips on Policy cost and Monthly policy cost — copy mentions registration as % of insurance premium.
5. Switch locale to Hebrew and spot-check the same help/tooltip labels.
