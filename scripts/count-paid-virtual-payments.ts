/**
 * Count Paid invoices whose payments are virtual-only vs real ERP payments.
 *
 * Usage:
 *   npx tsx scripts/count-paid-virtual-payments.ts --account 10149
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const LOG = "[count-paid-virtual-payments]";

function parseArgs(argv: string[]): { accountId: number } {
    const index = argv.indexOf("--account");
    const accountId = Number.parseInt(argv[index + 1] ?? "", 10);
    if (!Number.isInteger(accountId) || accountId <= 0) {
        throw new Error("--account <id> is required");
    }
    return { accountId };
}

function isVirtual(pay: {
    payment_method: string;
    reference: string;
}): boolean {
    return (
        pay.payment_method === "virtual" ||
        pay.reference.startsWith("virtual|")
    );
}

async function main(): Promise<void> {
    const { accountId } = parseArgs(process.argv.slice(2));
    const prisma = new PrismaClient();
    try {
        const paidIds = (
            await prisma.invoice.findMany({
                where: { account_id: accountId, status: "Paid" },
                select: { id: true },
            })
        ).map((row) => row.id);

        let virtualOnly = 0;
        let hasReal = 0;
        let virtualAndReal = 0;
        let noPay = 0;
        const chunkSize = 2000;

        for (let i = 0; i < paidIds.length; i += chunkSize) {
            const chunk = paidIds.slice(i, i + chunkSize);
            const pays = await prisma.invoicePayment.findMany({
                where: {
                    account_id: accountId,
                    invoice_id: { in: chunk },
                },
                select: {
                    invoice_id: true,
                    payment_method: true,
                    reference: true,
                },
            });
            const byInv = new Map<number, typeof pays>();
            for (const pay of pays) {
                if (pay.invoice_id == null) {
                    continue;
                }
                const arr = byInv.get(pay.invoice_id) ?? [];
                arr.push(pay);
                byInv.set(pay.invoice_id, arr);
            }
            for (const id of chunk) {
                const arr = byInv.get(id) ?? [];
                if (arr.length === 0) {
                    noPay += 1;
                    continue;
                }
                const virt = arr.filter(isVirtual);
                const real = arr.filter((pay) => !isVirtual(pay));
                if (virt.length > 0 && real.length === 0) {
                    virtualOnly += 1;
                } else if (virt.length > 0 && real.length > 0) {
                    virtualAndReal += 1;
                } else {
                    hasReal += 1;
                }
            }
        }

        console.log(LOG, {
            accountId,
            paid: paidIds.length,
            virtualOnly,
            hasRealPayment: hasReal,
            virtualAndReal,
            noPayments: noPay,
        });
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error(LOG, "failed", error);
    process.exitCode = 1;
});
