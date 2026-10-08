const { PrismaClient } = require("@prisma/client");

const MASTER_ACCOUNT_ID = 10013;
const SOURCE_ACCOUNT_ID = 10149;
const SOURCE_IDS = [5131, 5132, 5133];
const UNIQUE_NAMES = ["limits_vs_ar", "risk_exposure", "date_compare"];

const DESCRIPTIONS = {
    limits_vs_ar:
        "Customer name, number, approved limit, open receivables (AR), and limit type. No filters (all customers).",
    risk_exposure:
        "Customer name, number, open receivables, at-risk exposure, terms breach outstanding, and capacity gap. Only customers where open receivables is not zero.",
    date_compare:
        "Customer name with invoice date, due date, and amount without VAT. Filters: invoice date is last month, invoice date equals due date (The Same = Yes), and parent customer name is empty.",
};

const p = new PrismaClient();

async function upsertReport(accountId, source, description, now) {
    const shared = {
        name: source.name,
        unique_name: source.unique_name,
        description,
        report_config: source.report_config,
        is_public: source.is_public,
        is_system: true,
        is_default: false,
        context: "reports",
        created_by: source.created_by,
        modified_by: source.modified_by,
        modified_at: now,
    };

    await p.report.upsert({
        where: {
            account_id_unique_name: {
                account_id: accountId,
                unique_name: source.unique_name,
            },
        },
        create: {
            account_id: accountId,
            created_at: now,
            ...shared,
        },
        update: shared,
    });
}

(async () => {
    const sources = await p.report.findMany({
        where: {
            id: { in: SOURCE_IDS },
            account_id: SOURCE_ACCOUNT_ID,
            unique_name: { in: UNIQUE_NAMES },
        },
    });

    if (sources.length !== 3) {
        throw new Error(
            `Expected 3 source reports on account ${SOURCE_ACCOUNT_ID}, found ${sources.length}`
        );
    }

    const now = new Date();

    for (const source of sources) {
        const description = DESCRIPTIONS[source.unique_name];
        if (!description) {
            throw new Error(`Missing description for ${source.unique_name}`);
        }

        await p.report.update({
            where: { id: source.id },
            data: {
                is_system: true,
                is_default: false,
                context: "reports",
                description,
                modified_at: now,
            },
        });

        await upsertReport(MASTER_ACCOUNT_ID, source, description, now);
    }

    const masters = await p.report.findMany({
        where: {
            account_id: MASTER_ACCOUNT_ID,
            is_system: true,
            context: "reports",
            unique_name: { in: UNIQUE_NAMES },
        },
    });

    const accounts = await p.account.findMany({
        where: {
            id: { not: MASTER_ACCOUNT_ID },
            deleted_at: null,
        },
        select: { id: true },
    });

    for (const account of accounts) {
        for (const master of masters) {
            await upsertReport(
                account.id,
                master,
                master.description || DESCRIPTIONS[master.unique_name],
                now
            );
        }
    }

    const counts = await p.$queryRawUnsafe(`
    SELECT unique_name, COUNT(*)::int AS accounts,
           BOOL_AND(is_system) AS all_system,
           BOOL_AND(context = 'reports') AS all_reports_context
    FROM "Report"
    WHERE unique_name IN ('limits_vs_ar', 'risk_exposure', 'date_compare')
    GROUP BY unique_name
    ORDER BY unique_name`);

    const master = await p.report.findMany({
        where: {
            account_id: MASTER_ACCOUNT_ID,
            unique_name: { in: UNIQUE_NAMES },
        },
        select: {
            id: true,
            account_id: true,
            name: true,
            unique_name: true,
            is_system: true,
            context: true,
            description: true,
        },
        orderBy: { unique_name: "asc" },
    });

    const source = await p.report.findMany({
        where: { id: { in: SOURCE_IDS } },
        select: {
            id: true,
            account_id: true,
            name: true,
            unique_name: true,
            is_system: true,
            context: true,
            description: true,
        },
        orderBy: { id: "asc" },
    });

    console.log(JSON.stringify({ counts, master, source }, null, 2));
    await p.$disconnect();
})().catch(async (e) => {
    console.error(e);
    await p.$disconnect();
    process.exit(1);
});
