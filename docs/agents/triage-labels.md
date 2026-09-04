# Triage Labels

Maps canonical triage roles to the `**Status:**` strings used on local vertical-slice markdown files under `.cursor/plans/<feature-slug>/issues/`. ClickUp human tickets use the ARchaser board status ladder in `docs/agents/clickup-git-workflow.md` — do not invent board names here.

## Triage roles (slice files)

| Label in mattpocock/skills | Label in our tracker | Meaning |
| -------------------------- | -------------------- | ------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation |
| `wontfix`                  | `wontfix`            | Will not be actioned |

## Implementation lifecycle (local slices)

| Label in our tracker | Meaning |
| -------------------- | ------- |
| `in-progress`        | Claimed / implementer working or failed done gate |
| `done`               | Slice accepted; dependents may unblock |

`/to-issues` defaults new slices to `ready-for-agent`.
