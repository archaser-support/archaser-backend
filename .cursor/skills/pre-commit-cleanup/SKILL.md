---
name: pre-commit-cleanup
description: Clean and optimize changed files before commit by running focused checks only on git-modified paths, including clear dead leftovers. Use when the user is preparing a commit, asks to clean staged/changed files, or wants a pre-commit pass.
---

# Pre-Commit Cleanup

Run a fast, low-risk cleanup only on changed files. Do not format or lint the entire repository unless the user asks.

## Scope

- Include paths from both:
  - `git diff --name-only`
  - `git diff --cached --name-only`
- De-duplicate paths.
- Ignore generated/build outputs (`dist/`, `portal/out/`, `node_modules/`, `.next/`) and binary assets unless explicitly requested.

## Workflow

1. Collect changed paths and group by file type.
2. Run only relevant checks per type, including a **dead leftovers** pass on changed source files.
3. Re-check git status/diff.
4. Report exactly what was changed and what still needs manual review.

## Dead leftovers (redundant code)

Scan **the whole contents** of each changed source file (not only the diff hunks). Auto-remove only **clear** dead leftovers. Do **not** refactor duplicated or overlapping logic.

### Auto-remove when clearly unused / obsolete

- Unused imports
- Unused **non-exported** variables, helpers, and functions
- Unreachable live code
- Clear leftover commented-out functions/blocks (keep short explanatory comments)

### Never auto-remove

- **Exports** and export-like public surfaces (named/default exports; Apex `global`/`public`/`@AuraEnabled`; LWC `@api` properties) — even if unused inside the file
- Diagnostic / `console.log` instrumentation (unless the user explicitly asks to remove it)
- Anything that is **not clearly** dead — leave it and list under manual review

### CSS

- Do **not** delete CSS selectors automatically.
- If a changed CSS file likely has unused selectors, **report** them under manual review only.

## File-type checks for this repo

- TypeScript / JavaScript (`*.ts`, `*.tsx`, `*.js`, `*.mjs`, `*.cjs`)
  - Prefer lightweight static checks: dead leftovers (above), broken syntax, inconsistent naming with nearby files.
  - Use `ReadLints` on changed portal/gateway paths when available; fix only clear issues in the changed files.
  - Follow `.cursor/skills/review-ui/theme-authority.md` for portal UI (Title Case, button pills, tabs, Salesforce modal/form patterns).
  - Do not run full `npm run build` / `npm run verify` unless the user explicitly requests it.

- CSS (`*.css`, `*.module.css`)
  - Prefer shared tokens/primitives under `portal/styles/` over one-off inline styles.
  - Do not override button `border-radius`; keep pill buttons on shared `.btn` classes.
  - Component-specific styles stay in co-located `*.module.css`; do not dump one-offs into `globals.css`.
  - Likely-unused selectors: report only (see Dead leftovers).

- Apex / LWC / Salesforce metadata (`force-app/**`, `*.cls`, `*.trigger`, `*.js` under LWC)
  - Keep edits minimal; do not reformat whole metadata files.
  - Apply the same dead-leftovers rules; treat public/`@AuraEnabled`/`@api` as exports (never remove).
  - Do not point local sandbox wiring at Render (see `.cursor/rules/local-vs-render-salesforce.mdc`).

- JSON (`*.json`)
  - Validate JSON syntax.
  - Preserve structure and key ordering unless a reformat is explicitly requested.

- Markdown plans / issues (`.cursor/plans/**`, `.scratch/**/issues/**`)
  - Fix broken links and obvious typos only; do not rewrite content.

## Safety rules

- Never touch files outside the git changed set unless asked.
- Never modify secrets/credentials files (`.env`, credential JSON, tokens).
- Keep edits minimal and mechanical during cleanup passes.
- Preserve diagnostic/`console.log` instrumentation unless the user explicitly asks to remove it.
- If a command/tool is unavailable, report it and continue with available checks.

## Output format

When done, provide:

1. Changed files inspected.
2. Checks run.
3. Files modified by cleanup (include what dead leftovers were removed).
4. Remaining risks or suggested manual checks (include uncertain “maybe dead” items and likely-unused CSS selectors).
