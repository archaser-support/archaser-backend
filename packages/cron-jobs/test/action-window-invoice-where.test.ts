import { actionWindowInvoiceWhere } from "../src/notificationRules/NotificationRuleEvaluator";

describe("action-window invoice candidate where", () => {
    it("excludes invoices with amount < 0", () => {
        const where = actionWindowInvoiceWhere(99);
        expect(where).toMatchObject({
            account_id: 99,
            status: { in: ["Due", "Overdue"] },
            target_reporting_date: { not: null },
            actual_reporting_date: null,
            amount: { gte: 0 },
        });
    });
});
