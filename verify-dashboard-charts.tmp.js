/**
 * Throwaway read-only check: GET the financial dashboard for an account and
 * report which chart payloads are populated vs empty.
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");

const API = "http://localhost:3002";
const SECRET = process.env.NEXTAUTH_SECRET || process.env.JWT_SECRET;
const ACCOUNT_ID = Number(process.env.ACCOUNT_ID || 10117);
const db = new PrismaClient();

const ENTITY_KEYS = [
    "overdueInvoicesByCustomer",
    "overdueInvoicesByBusinessUnit",
    "invoicesByCustomer",
    "invoicesByBusinessUnit",
];
const CHART_KEYS = [
    "audienceReport",
    "activeCustomersChart",
    "automatedPhaseSplit",
    "collectionEffortsPhase",
];

async function main() {
    const user = await db.user.findFirst({
        where: { account_id: ACCOUNT_ID },
        select: { id: true, email: true, role: true, account_id: true },
    });
    if (!user) throw new Error(`no user for account ${ACCOUNT_ID}`);
    const token = jwt.sign(
        {
            sub: user.id,
            username: user.email,
            account_id: user.account_id,
            role: user.role,
        },
        SECRET,
        { expiresIn: "1h" }
    );

    const res = await fetch(`${API}/api/system/dashboard?viewMode=child`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    console.log(
        `GET /api/system/dashboard -> ${res.status} (account ${ACCOUNT_ID}, fromCache=${body.fromCache}, currency=${body.currency})\n`
    );

    for (const key of ENTITY_KEYS) {
        const rows = body[key];
        const n = Array.isArray(rows) ? rows.length : "not-an-array";
        console.log(`${key}: ${n} slices`);
        for (const row of (rows || []).slice(0, 3)) {
            console.log(
                `    ${row.customer} | ${row.amount} | ${row.percentage}%`
            );
        }
        const pctSum = (rows || []).reduce((s, r) => s + r.percentage, 0);
        if (rows?.length) console.log(`    percentage total: ${pctSum.toFixed(2)}`);
    }

    console.log("\nreceivablesMaturitySchedule:");
    for (const row of body.receivablesMaturitySchedule || []) {
        console.log(
            `    ${row.daysRange}: ${row.invoices} inv | ${row.accounts} cust | ${row.amount} | ${row.amountPercentage}`
        );
    }

    console.log("");
    for (const key of CHART_KEYS) {
        const chart = body[key] || {};
        const cats = chart.options?.xaxis?.categories || chart.options?.labels;
        const series = chart.series || [];
        const names = series
            .map((s) => (typeof s === "object" ? `${s.name}=[${s.data}]` : s))
            .join("  ");
        console.log(`${key}: categories=${JSON.stringify(cats)}`);
        console.log(`    ${names}`);
    }

    console.log("\nKPIs:", {
        overdueAmount: body.overdueAmount,
        overdueInvoices: body.overdueInvoices,
        activeCustomers: body.activeCustomers,
        hasChildBusinessUnits: body.hasChildBusinessUnits,
    });
}

main()
    .catch((e) => {
        console.error("FAILED:", e.message);
        process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
