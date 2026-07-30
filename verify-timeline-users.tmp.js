/**
 * Throwaway read-only check: GET the activity timeline for the customer from the
 * reported screenshot and assert no raw user ids or unresolved {{user:}} tokens
 * survive into the response.
 */
require("dotenv").config();
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");

const API = "http://localhost:3002";
const SECRET = process.env.NEXTAUTH_SECRET || process.env.JWT_SECRET;
const CUSTOMER_ID = 1579;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const db = new PrismaClient();

async function main() {
    const customer = await db.customer.findUnique({
        where: { id: CUSTOMER_ID },
        select: { id: true, account_id: true },
    });
    const user = await db.user.findFirst({
        where: { account_id: customer.account_id },
        select: { id: true, email: true, role: true, account_id: true },
    });
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

    const res = await fetch(
        `${API}/api/entities/customers/${CUSTOMER_ID}/activity?limit=25`,
        { headers: { Authorization: `Bearer ${token}` } }
    );
    const body = await res.json();
    console.log("GET activity ->", res.status, `${body.activities?.length} rows\n`);

    let failures = 0;
    for (const a of body.activities || []) {
        const params = a.title_params || {};
        const agent = /\{\{user:[^}]*\}\}/.exec(a.content || "");
        const line = [
            `#${a.id} ${a.type}`,
            `title=${a.title}`,
            `userId=${JSON.stringify(params.userId)}`,
            `assigneeId=${JSON.stringify(params.assigneeId)}`,
        ].join(" | ");
        console.log(line);

        if (agent) {
            console.log(`   FAIL unresolved token: ${agent[0]}`);
            failures++;
        }
        for (const field of ["userId", "assigneeId", "userName", "assigneeName"]) {
            if (params[field] && UUID_RE.test(String(params[field]))) {
                console.log(`   FAIL raw uuid in ${field}: ${params[field]}`);
                failures++;
            }
        }
        // Only the rendered label/value spans matter; email + SMS bodies legitimately
        // carry uuids in portal magic links.
        for (const [, value] of (a.content || "").matchAll(
            /activity-value">([^<]*)<\/span>/g
        )) {
            if (UUID_RE.test(value)) {
                console.log(`   FAIL raw uuid in rendered value: ${value.trim()}`);
                failures++;
            }
        }
        const agentValue = /activity-value">([^<]*)<\/span>\s*$/.exec(
            (a.content || "").trimEnd()
        );
        if (agentValue) console.log(`   last value: ${agentValue[1].trim()}`);
    }

    require("fs").writeFileSync(
        "/tmp/timeline-response.json",
        JSON.stringify(body, null, 2)
    );
    console.log("\nwrote /tmp/timeline-response.json");

    console.log(failures === 0 ? "PASS: no raw ids or tokens" : `${failures} FAILURES`);
    process.exitCode = failures === 0 ? 0 : 1;
}

main()
    .catch((e) => {
        console.error("FAILED:", e.message);
        process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
