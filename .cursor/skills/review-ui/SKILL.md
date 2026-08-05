---
name: review-ui
description: Review and patch a product UI page for theme/UX and user-facing copy consistency using screenshots in a capped loop. Ends with optional industry UX recommendations (approval required to apply). Requires a per-project overlay (theme authority, route map, capture scripts).
disable-model-invocation: true
---

# Review UI

Improve a product UI page so it matches that project's theme, UX patterns, and user-facing copy. Capture → review → patch → re-capture, up to **3** rounds. Then recommend optional industry UX improvements (never auto-applied).

**Input required:** a URL path for the page under review. Optional: greenfield mode when the user says there is no theme.

## Project overlay (required)

This shared skill is process-only. Before doing anything else, load the **project overlay** next to this file:

| File | Role |
|------|------|
| `theme-authority.md` | **Single source of truth** for this product’s UI (tokens, copy, buttons, tabs, forms, modals, checklist, rejected critiques) |
| `industry-ux.md` | **Optional** industry heuristics checklist for Step 3 recommendations only (not auto-applied) |
| `route-map.md` | Path → source files for this product |
| `scripts/` | Capture / auth helpers (wired via product `package.json`) |

Paths are relative to this skill directory (typically `.cursor/skills/review-ui/` in the product repo).

**If `theme-authority.md` is missing:** stop and tell the user this product has no review-ui overlay yet. Do not invent theme rules. Point them at adding overlay files beside this `SKILL.md` (and optional `npm` scripts such as `ui-review:capture` / `ui-review:save-auth`).

**If `industry-ux.md` is missing:** continue the theme review normally. Skip Optional UX in Step 3 and note: `No industry-ux.md; skipped Optional UX.` Do not invent a heuristics list.

Do **not** treat `.cursorrules` as the portal UI source when an overlay `theme-authority.md` exists — load the overlay only.

## Severity (stop when only Low remains)

| Severity | Meaning | Clear before stop? |
|----------|---------|--------------------|
| **High** | Token/primitive bypass, a11y/contrast break, broken layout | Yes |
| **Medium** | Hierarchy, density, control placement, footer/button pattern drift; copy **rule breaks** and **unclear/redundant** text (see overlay Copy checklist) | Yes |
| **Low** | Subjective 2px polish; subjective copy brevity when meaning is already clear | No — leave or note |
| **Optional UX** | Industry-heuristic suggestions from `industry-ux.md` (Step 3 only) | No — never blocks stop; never auto-applied |

Theme High/Medium still auto-patch per Step 2c. Optional UX is recommend-only until the user approves specific items.

## Steps

### 0 — Preconditions

1. Path given (or ask once). Skip surfaces the project overlay marks out of scope (e.g. Salesforce LWC).
2. Overlay loaded: `theme-authority.md` in full (product UI + **Review checklist**). That file is the only product UI authority for **patches**. If present, also load `industry-ux.md` for the optional pass (do not invent checks if missing).
3. App under review is reachable as documented in the overlay / product README (often a local dev server). Proceed to capture. **Never** install Playwright browsers (`playwright install`, `npx playwright install`, `npm exec … playwright install`, etc.) — not prophylactically and not after a missing-browser failure. If capture fails because Chromium/browser is missing or the launch path is wrong, **stop** and tell the user to fix Playwright on their machine (check `PLAYWRIGHT_BROWSERS_PATH` — Cursor agent shells may redirect it to an empty `cursor-sandbox-cache`; capture/save-auth clear that override). Wait for confirmation before retrying capture. Do not reinstall when browsers already exist under the default cache (e.g. `~/Library/Caches/ms-playwright`).
4. Auth / storage state exists if the overlay's capture flow needs it. If missing: tell the user to run the product's save-auth command (e.g. `npm run ui-review:save-auth`) and **stop** until they confirm.
5. **i18n (internationalization) detect:** If the overlay documents locale paths, or the repo has locale catalogs (e.g. `**/i18n/locales/*` with parallel language files), treat the project as i18n-enabled for this run. Note supported locales. If none, skip multi-language sync.

**Done when:** path known, theme-authority loaded, industry-ux presence known, app reachable, auth ready (if required), i18n presence known.

### 1 — Resolve code

Map path → files using `route-map.md`. Read the page + primary components + related CSS.

Also note any i18n keys the page clearly uses (e.g. `portalErrorMessage`, `t("…")`, `resolveApiError`) and which locale files own those keys (overlay paths when listed).

**Done when:** you can name the source files under review (and locale files if keys are in play).

### 2 — Round loop (max 3)

For `round` = 1..3:

#### 2a — Capture (required every round)

Run the product's capture command (e.g. `npm run ui-review:capture -- --path '<path>' --round <n>`). Follow overlay docs for artifact paths and exit codes (e.g. auth expired → user re-runs save-auth). If capture fails with a missing Playwright browser / launch error: **stop**, tell the user (do **not** install browsers), and wait for confirmation before retrying.

**Done when:** you have viewed the new screenshot for this round (Read the image file).

#### 2b — Review

Compare screenshot + code to `theme-authority.md` (including its **Review checklist**). Produce ranked findings (High / Medium / Low) with file hints.

**Do not** list `industry-ux.md` items as High/Medium/Low in the round loop. Industry suggestions wait for Step 3.

**Copy inventory (every round):** From the page’s source files **and** what is visible in the capture, inventory user-facing strings: page/modal titles and subtitles, buttons (including loading labels), tabs, nav labels, field labels, placeholders, helpers, alerts, badges/status text, empty states, `title` tooltips, `aria-label`s, and other visible chrome. Do **not** require forced hover/tooltip screenshot captures — read `title` / `aria-label` from code.

Check each string against overlay **UI Copy** rules (casing, product terms, clarity). Flag unclear, redundant, wrong-case, or wrong product terms per the overlay Copy checklist severity.

**Error / toast copy:** Only review locale/error strings that appear in the capture **or** that this page’s code clearly maps to. Do **not** sweep the whole locale catalog.

**Verify before claiming:** For control shape/color or “off-system” look, read the element's classes and the shared CSS the overlay points at. Do not invent patterns listed under **Rejected critiques** (or equivalent) in the overlay.

**Branch — greenfield** (user said no theme / no tokens): propose a minimal token set; **wait for explicit OK**; write tokens; then continue patches. Do not invent brand and paint in one silent step.

**Branch — full restructure** (new IA, replace major layout/flow, not local footer/order/spacing): present the plan and **wait for OK** before editing. Style + local layout patches do **not** wait.

**Branch — meaning-changing copy** (rename established product verbs, change action meaning, rewrite marketing-style headlines): present proposed before/after strings; **wait for OK** before those edits. Safe copy fixes do **not** wait (see Patch).

**Done when:** findings listed (theme + copy); any required approval obtained or not needed; meaning-changing proposals presented if any.

#### 2c — Patch

- Auto-apply High/Medium that are style or **local layout** (same section: classes, tokens, spacing, button/footer order).
- Auto-apply **safe** High/Medium **copy**: casing per overlay, known product terms (e.g. `Preview`), obvious typos, redundant helper that duplicates an alert (trim to next-step only), missing `aria-label` / accessible name on an otherwise unlabeled control.
- Prefer existing shared primitives from the overlay; else page-local CSS.
- Honor overlay out-of-scope rules (e.g. no LWC; light theme only; one desktop viewport).
- **Do not** migrate hardcoded JSX strings into i18n catalogs during a review.
- **Do not** add decorative helpers, tooltips, or intro blurbs. Add new copy only when a control is unclear or inaccessible (overlay Copy checklist).
- **Do not** auto-apply Optional UX / `industry-ux.md` items.
- **i18n sync:** When editing a string that already lives in locale catalogs, update **every** supported locale for that key so meanings match (overlay quality bar). Keep brand/product terms as documented. If a translation is uncertain, apply the best meaning-matched attempt and note it for the summary — do not leave stale other-language strings.
- Hold meaning-changing copy until the user OKs; continue applying safe theme + safe copy in the same round.

**Done when:** High/Medium auto-safe items (style, layout, safe copy, synced locales) for this round are applied (or none left); restructure-only and meaning-copy items are either approved+applied or still pending.

#### 2d — Stop check

- Pending meaning-changing copy proposals (not yet approved or declined) still count as **uncleared Medium**.
- If no High/Medium remain → go to Step 3.
- Else if `round == 3` → go to Step 3 (note remaining High/Medium, including pending copy proposals).
- Else → next round (fresh capture required).

### 3 — Summary

Report: rounds run, files changed, leftover Low (and any uncleared High/Medium), screenshot paths, deferred meaning-changing copy proposals, and any uncertain translations.

#### Optional UX improvements

If `industry-ux.md` is present, score the **final** screenshot + page source against that checklist.

**Rules:**

1. **Recommend only** — do not edit code for these items until the user explicitly approves (e.g. “apply 1 and 3”).
2. List at most **5** items, ranked by user impact (task completion → scanability → action placement/chrome → density → help polish). If more gaps exist, note `N more omitted`.
3. Each line: **rank**, short **title**, **heuristic** name (from the checklist section), **concrete change** (one-line before→after), **primary file hint(s)**.
4. Tag overlaps with theme findings still visible in the final capture as `also industry-backed`. Do **not** re-list work already fixed this run.
5. Never suggest Rejected critiques or patterns that contradict `theme-authority.md`.
6. **Web:** may fetch only **Primary source** URLs named in `industry-ux.md` to clarify a checklist item. Do not invent new pattern families from other sites.
7. If `industry-ux.md` is missing: write `No industry-ux.md; skipped Optional UX.`

**Example line:**

`1. Group credentials fields — Heuristic: Recognition rather than recall. Put API key + secret in one card titled Credentials (now loose mid-form). Files: AskMeConfigurator.tsx. also industry-backed`

**Done when:** summary delivered (including Optional UX or skip note).

### 4 — Optional UX apply (after user approval)

When the user cherry-picks Optional UX items in this conversation:

1. Apply **only** the approved ranked items.
2. Prefer existing theme primitives (same as Step 2c).
3. **Full restructure** items still require an explicit plan OK before editing.
4. **Meaning-changing copy** still requires OK.
5. Re-capture / extra rounds only if the user asks to re-run review after the apply.

**Done when:** approved items patched (or declined); unapproved Optional UX left untouched.

## Commands

Prefer the product's documented npm scripts (names may vary). Typical:

| Command | Purpose |
|---------|---------|
| `npm run ui-review:save-auth` | Headed login → storage state |
| `npm run ui-review:capture -- --path /… --round N` | Full-page PNG |

**Do not** run any Playwright browser install command from this skill. Browser setup is a human/environment step.

Never commit auth storage files.

## Out of scope (shared V1)

Dark theme captures, multi-viewport, model-auto invoke, CI bot, inventing large new global primitives without need, forced hover/tooltip captures, migrating pages into i18n during review, whole-locale catalog sweeps, auto-applying industry UX without user approval, unbounded web research for UX trends mid-review, **installing or reinstalling Playwright browsers**. Product overlays may add further exclusions.
