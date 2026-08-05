# Triage Labels

The skills speak in terms of canonical triage roles plus local implementation
lifecycle statuses. This file maps those roles to the actual label strings used
in this repo's issue tracker.

## Triage roles

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

## Implementation lifecycle (local `.scratch/` slices)

| Label in our tracker | Meaning                                                                 |
| -------------------- | ----------------------------------------------------------------------- |
| `in-progress`        | Claimed by `/implement-next`; implementer working or failed done gate   |
| `done`               | Automated seam tests passed; dependents may unblock                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the
corresponding label string from this table.

Canonical docs: `docs/agents/triage-labels.md`.
