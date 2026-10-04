import { sumOpenArRollupFromMembers } from "@archaser/credit-insurance-domain";

describe("credit pool open AR rollup", () => {
    it("sums descendant due/overdue and takes earliest overdue date", () => {
        const rollup = sumOpenArRollupFromMembers([
            {
                total_due_amount: 100,
                total_overdue_amount: 50,
                no_of_due_invoices: 2,
                number_of_overdue_invoices: 1,
                oldest_invoice_overdue_date: new Date("2026-01-10"),
                oldest_invoice_overdue_date_all: new Date("2026-01-05"),
            },
            {
                total_due_amount: 20,
                total_overdue_amount: 30,
                no_of_due_invoices: 1,
                number_of_overdue_invoices: 2,
                oldest_invoice_overdue_date: new Date("2026-01-01"),
                oldest_invoice_overdue_date_all: new Date("2026-01-08"),
            },
        ]);

        expect(rollup.total_due_amount).toBe(120);
        expect(rollup.total_overdue_amount).toBe(80);
        expect(rollup.no_of_due_invoices).toBe(3);
        expect(rollup.number_of_overdue_invoices).toBe(3);
        expect(rollup.oldest_invoice_overdue_date?.toISOString()).toBe(
            new Date("2026-01-01").toISOString()
        );
        expect(rollup.oldest_invoice_overdue_date_all?.toISOString()).toBe(
            new Date("2026-01-05").toISOString()
        );
    });
});
