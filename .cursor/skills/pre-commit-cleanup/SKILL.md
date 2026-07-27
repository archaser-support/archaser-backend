---
name: pre-commit-cleanup
description: Clean and optimize changed files before commit by running focused checks only on git-modified paths. Use when the user is preparing a commit, asks to clean staged/changed files, or wants a pre-commit pass.
---

# Pre-Commit Cleanup

Run a fast, low-risk cleanup only on changed files. Do not format or lint the entire repository unless the user asks.

## Scope

- Include paths from both:
  - `git diff --name-only`
  - `git diff --cached --name-only`
- De-duplicate paths.
- Ignore generated/build outputs (`DerivedData`, `.derivedData`) and binary assets unless explicitly requested.

## Workflow

1. Collect changed paths and group by file type.
2. Run only relevant checks per type.
3. Re-check git status/diff.
4. Report exactly what was changed and what still needs manual review.

## File-type checks for this repo

- Swift (`*.swift`)
  - Prefer lightweight static checks and style consistency.
  - Follow project rules in `.cursorrules`, `.cursor/rules/apple-swiftui-ux.mdc`, `.cursor/rules/rtl-hebrew-ui.mdc`, and `Zman App/.cursor/rules/ui-theme-usage.mdc`.
  - Do not run `xcodebuild` unless the user explicitly requests it.

- JSON (`*.json`)
  - Validate JSON syntax.
  - Preserve structure and key ordering unless a reformat is explicitly requested.
  - Be careful with large prayer files in `Zman App/PrayerContent/`.

- Python (`*.py`)
  - Keep stdlib-only constraints for Sefaria scripts where applicable.
  - Preserve CLI behavior and documented flags.

## Safety rules

- Never touch files outside the git changed set unless asked.
- Never modify secrets/credentials files.
- Keep edits minimal and mechanical during cleanup passes.
- If a command/tool is unavailable, report it and continue with available checks.

## Output format

When done, provide:

1. Changed files inspected.
2. Checks run.
3. Files modified by cleanup.
4. Remaining risks or suggested manual checks.
