/**
 * Compare two sequence containers (e.g. 127 vs 252) to find why one
 * transitions to Agent after last step and the other does not.
 *
 * Usage: npx tsx scripts/compare-sequence-containers.ts [containerId1] [containerId2]
 * Example: npx tsx scripts/compare-sequence-containers.ts 127 252
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const CONTAINER_127 = 127;
const CONTAINER_252 = 252;

async function main() {
    const id1 = parseInt(process.argv[2] || String(CONTAINER_127), 10);
    const id2 = parseInt(process.argv[3] || String(CONTAINER_252), 10);

    console.log(`\nComparing sequence containers ${id1} (working) vs ${id2} (not transitioning)...\n`);

    const [c1, c2] = await Promise.all([
        prisma.sequenceContainer.findUnique({
            where: { id: id1 },
            include: {
                ActivitiesSequence: {
                    where: { category: "Automated" },
                    orderBy: { step: "asc" },
                },
            },
        }),
        prisma.sequenceContainer.findUnique({
            where: { id: id2 },
            include: {
                ActivitiesSequence: {
                    where: { category: "Automated" },
                    orderBy: { step: "asc" },
                },
            },
        }),
    ]);

    if (!c1) {
        console.error(`Container ${id1} not found.`);
        process.exit(1);
    }
    if (!c2) {
        console.error(`Container ${id2} not found.`);
        process.exit(1);
    }

    const seq1 = c1.ActivitiesSequence;
    const seq2 = c2.ActivitiesSequence;

    console.log("--- Container metadata ---");
    console.log(`Container ${id1}: name="${c1.name}", category=${c1.category}, account_id=${c1.account_id}`);
    console.log(`Container ${id2}: name="${c2.name}", category=${c2.category}, account_id=${c2.account_id}`);

    console.log("\n--- ActivitiesSequence (Automated) comparison ---");
    console.log(`Container ${id1}: ${seq1.length} steps. Container ${id2}: ${seq2.length} steps.`);

    const maxSteps = Math.max(seq1.length, seq2.length);
    const rows: string[] = [];
    rows.push(
        "step".padEnd(6) +
            "last_cat".padEnd(10) +
            "step_type".padEnd(12) +
            "days_before_due".padEnd(18) +
            "days_after_start".padEnd(18) +
            "  |  " +
            "last_cat".padEnd(10) +
            "step_type".padEnd(12) +
            "days_before_due".padEnd(18) +
            "days_after_start"
    );
    rows.push("-".repeat(120));

    for (let i = 0; i < maxSteps; i++) {
        const s1 = seq1[i];
        const s2 = seq2[i];
        const part1 = s1
            ? [
                  String(s1.step ?? "").padEnd(6),
                  String(s1.last_category_step).padEnd(10),
                  String(s1.step_type ?? "null").padEnd(12),
                  String(s1.days_before_due ?? "null").padEnd(18),
                  String(s1.days_after_start ?? "null").padEnd(18),
              ].join("")
            : "  (no step)  ".padEnd(66);
        const part2 = s2
            ? [
                  String(s2.last_category_step).padEnd(10),
                  String(s2.step_type ?? "null").padEnd(12),
                  String(s2.days_before_due ?? "null").padEnd(18),
                  String(s2.days_after_start ?? "null"),
              ].join("")
            : "  (no step)";
        rows.push(`      ${part1}  |      ${part2}`);
    }
    console.log(rows.join("\n"));

    const lastTrue1 = seq1.filter((s) => s.last_category_step);
    const lastTrue2 = seq2.filter((s) => s.last_category_step);

    console.log("\n--- last_category_step: true rows ---");
    console.log(`Container ${id1}: ${lastTrue1.length} row(s) with last_category_step=true: steps [${lastTrue1.map((s) => s.step).join(", ")}]`);
    console.log(`Container ${id2}: ${lastTrue2.length} row(s) with last_category_step=true: steps [${lastTrue2.map((s) => s.step).join(", ")}]`);

    if (lastTrue2.length !== 1) {
        console.log(
            `\n*** ISSUE: Container ${id2} should have exactly ONE row with last_category_step=true (the last step). Run updateLastStepFlag for this container.`
        );
    }
    if (lastTrue2.length > 1) {
        console.log(`\n*** Multiple "last" steps in ${id2} can cause Process Automated Collection Periods to consider the wrong activity.`);
    }

    const stepTypes2 = [...new Set(seq2.map((s) => s.step_type ?? "null"))];
    console.log("\n--- step_type values ---");
    console.log(`Container ${id1}: [${[...new Set(seq1.map((s) => s.step_type ?? "null"))].join(", ")}]`);
    console.log(`Container ${id2}: [${stepTypes2.join(", ")}]`);

    // Optional: check recent activities for customer 1567 to see activity_sequence_id and step
    const customerId = process.env.CUSTOMER_ID ? parseInt(process.env.CUSTOMER_ID, 10) : 1567;
    const recentActivities = await prisma.activity.findMany({
        where: { customer_id: customerId },
        orderBy: { created_at: "desc" },
        take: 10,
        select: {
            id: true,
            status: true,
            created_at: true,
            activity_sequence_id: true,
            ActivitiesSequence: {
                select: {
                    step: true,
                    sequence_container_id: true,
                    last_category_step: true,
                },
            },
        },
    });

    console.log(`--- Recent activities for customer ${customerId} (activity_sequence_id → step, container) ---`);
    for (const a of recentActivities) {
        const seq = a.ActivitiesSequence;
        const step = seq?.step;
        const containerId = seq?.sequence_container_id;
        const lastCat = seq?.last_category_step;
        console.log(
            `  Activity ${a.id} (${a.status}) seq_id=${a.activity_sequence_id} → step=${step} (type ${typeof step}) container=${containerId} last_category_step=${lastCat}`
        );
    }

    console.log("\nDone.\n");
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
