/**
 * Demo-portfolio customer display names — same counter style as
 * `scripts/database/clone-demo-account.ts` (`Demo Company 0001`), but
 * new ERP creates use the `Demo Customer` prefix.
 */

export const DEMO_CUSTOMER_NAME_PREFIX = "Demo Customer ";

/** Matches clone-script `Demo Company NNNN` and sync `Demo Customer NNNN`. */
const DEMO_NAME_COUNTER_RE = /^Demo (?:Customer|Company) (\d+)$/;

export function formatDemoCustomerName(counter: number): string {
    return `${DEMO_CUSTOMER_NAME_PREFIX}${String(counter).padStart(4, "0")}`;
}

export function parseDemoNameCounter(
    name: string | null | undefined
): number | null {
    if (name == null) {
        return null;
    }
    const match = name.trim().match(DEMO_NAME_COUNTER_RE);
    if (!match) {
        return null;
    }
    const n = Number.parseInt(match[1], 10);
    return Number.isFinite(n) ? n : null;
}

/** Next counter after the highest existing Demo Company/Customer NNNN. */
export function nextDemoCustomerCounter(existingNames: string[]): number {
    let max = 0;
    for (const name of existingNames) {
        const n = parseDemoNameCounter(name);
        if (n != null && n > max) {
            max = n;
        }
    }
    return max + 1;
}

type DemoNameLookup = {
    customer: {
        findMany: (args: {
            where: {
                account_id: number;
                customer_number: { in: string[] };
            };
            select: { customer_number: true };
        }) => Promise<Array<{ customer_number: string | null }>>;
    };
    company: {
        findMany: (args: {
            where: {
                Customer: { some: { account_id: number } };
                OR: Array<{ name: { startsWith: string } }>;
            };
            select: { name: true };
        }) => Promise<Array<{ name: string }>>;
    };
};

/**
 * Rename only customers that do not yet exist on the account.
 * Existing rows keep their mapped ERP name (importer update path unchanged).
 */
export async function anonymizeNewCustomerNames(
    customers: Record<string, unknown>[],
    params: {
        accountId: number;
        prisma?: DemoNameLookup;
    }
): Promise<Record<string, unknown>[]> {
    if (customers.length === 0) {
        return customers;
    }

    const customerNumbers = [
        ...new Set(
            customers
                .map((row) => String(row.customer_number ?? "").trim())
                .filter((value) => value.length > 0)
        ),
    ];

    const existingNumbers = new Set<string>();
    let counter = 1;

    if (params.prisma && customerNumbers.length > 0) {
        const [existing, demoCompanies] = await Promise.all([
            params.prisma.customer.findMany({
                where: {
                    account_id: params.accountId,
                    customer_number: { in: customerNumbers },
                },
                select: { customer_number: true },
            }),
            params.prisma.company.findMany({
                where: {
                    Customer: { some: { account_id: params.accountId } },
                    OR: [
                        { name: { startsWith: DEMO_CUSTOMER_NAME_PREFIX } },
                        { name: { startsWith: "Demo Company " } },
                    ],
                },
                select: { name: true },
            }),
        ]);
        for (const row of existing) {
            const number = row.customer_number?.trim();
            if (number) {
                existingNumbers.add(number);
            }
        }
        counter = nextDemoCustomerCounter(demoCompanies.map((c) => c.name));
    }

    const assignedByNumber = new Map<string, string>();

    return customers.map((row) => {
        const customerNumber = String(row.customer_number ?? "").trim();
        if (!customerNumber || existingNumbers.has(customerNumber)) {
            return row;
        }
        const already = assignedByNumber.get(customerNumber);
        if (already) {
            return { ...row, name: already };
        }
        const name = formatDemoCustomerName(counter);
        counter += 1;
        assignedByNumber.set(customerNumber, name);
        return { ...row, name };
    });
}
