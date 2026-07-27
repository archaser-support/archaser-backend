/**
 * Reconcile legacy customer_policy exclusion state.
 * Reason is source of truth; excluded_from_policy is derived.
 *
 * Usage:
 *   npx tsx scripts/datafixes/sync-customer-policy-exclusion-derived.ts --dry-run
 *   npx tsx scripts/datafixes/sync-customer-policy-exclusion-derived.ts --fix
 */
import { prisma } from "../../frontend/lib/prisma";
import { deriveExcludedFromPolicy } from "../../frontend/shared/creditInsurance/policyExclusion";

const dryRun = process.argv.includes("--dry-run");
const doFix = process.argv.includes("--fix");

if (!dryRun && !doFix) {
    console.error(
        "Usage: npx tsx scripts/datafixes/sync-customer-policy-exclusion-derived.ts --dry-run|--fix"
    );
    process.exit(1);
}

type OrphanKind =
    | "excluded_true_empty_reason"
    | "excluded_false_nonempty_reason"
    | "whitespace_reason";

function classifyOrphan(row: {
    excluded_from_policy: boolean;
    policy_exclusion_reason: string | null;
}): OrphanKind | null {
    const reason = row.policy_exclusion_reason;
    const trimmed = reason?.trim() ?? "";
    const derived = deriveExcludedFromPolicy(reason);

    if (trimmed === "" && reason != null && reason !== "") {
        return "whitespace_reason";
    }
    if (row.excluded_from_policy === true && trimmed === "") {
        return "excluded_true_empty_reason";
    }
    if (row.excluded_from_policy === false && trimmed !== "") {
        return "excluded_false_nonempty_reason";
    }
    if (row.excluded_from_policy !== derived) {
        return row.excluded_from_policy
            ? "excluded_true_empty_reason"
            : "excluded_false_nonempty_reason";
    }
    return null;
}

async function main() {
    const rows = await prisma.customerPolicy.findMany({
        select: {
            id: true,
            customer_id: true,
            excluded_from_policy: true,
            policy_exclusion_reason: true,
        },
    });

    const orphans = rows
        .map((row) => ({ row, kind: classifyOrphan(row) }))
        .filter((entry): entry is { row: (typeof rows)[number]; kind: OrphanKind } =>
            entry.kind != null
        );

    const counts = orphans.reduce<Record<OrphanKind, number>>(
        (acc, { kind }) => {
            acc[kind] = (acc[kind] ?? 0) + 1;
            return acc;
        },
        {
            excluded_true_empty_reason: 0,
            excluded_false_nonempty_reason: 0,
            whitespace_reason: 0,
        }
    );

    console.log("Orphan counts:", counts);
    console.log("Total rows needing reconciliation:", orphans.length);

    if (orphans.length > 0 && orphans.length <= 20) {
        console.log("Sample rows:", orphans.slice(0, 20));
    }

    if (dryRun) {
        console.log("Dry run — no changes applied.");
        return;
    }

    let updated = 0;
    for (const { row } of orphans) {
        const normalizedReason =
            row.policy_exclusion_reason != null &&
            row.policy_exclusion_reason.trim() === ""
                ? null
                : row.policy_exclusion_reason;
        const derivedExcluded = deriveExcludedFromPolicy(normalizedReason);

        await prisma.customerPolicy.update({
            where: { id: row.id },
            data: {
                policy_exclusion_reason: normalizedReason,
                excluded_from_policy: derivedExcluded,
            },
        });
        updated += 1;
    }

    console.log(`Updated ${updated} customer_policy row(s).`);
}

main()
    .catch((error) => {
        console.error(error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
