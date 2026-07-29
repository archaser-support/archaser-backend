import {
    topologicalSortFormulas,
    validateFormulaDependencyGraph,
} from "../src/reports/report-formula/formula-dependencies";
import { applyFormulasToRows } from "../src/reports/report-formula/formula-execution";
import {
    normalizeFormulaExpression,
    parseFormulaExpression,
} from "../src/reports/report-formula/parser";
import { ReportFormula } from "../src/reports/report-formula/types";

const metadataTables = [
    {
        name: "Invoice",
        fields: [{ name: "amount", type: "amount" }],
    },
    {
        name: "Customer",
        fields: [{ name: "cost_percent", type: "number" }],
    },
];

describe("Nest report formula core", () => {
    it("orders dependencies before dependents while preserving stable peers", () => {
        const formulas: ReportFormula[] = [
            {
                id: "total",
                label: "Total",
                expression: "[formula:premium]+1",
                format: "number",
            },
            {
                id: "unrelated",
                label: "Unrelated",
                expression: "[Invoice.amount]",
                format: "number",
            },
            {
                id: "premium",
                label: "Premium",
                expression: "[Invoice.amount]*2",
                format: "number",
            },
        ];

        expect(topologicalSortFormulas(formulas).map((formula) => formula.id)).toEqual([
            "unrelated",
            "premium",
            "total",
        ]);
        expect(validateFormulaDependencyGraph(formulas)).toBeNull();
    });

    it("detects cycles and formula-only chains without a report field", () => {
        expect(
            validateFormulaDependencyGraph([
                {
                    id: "a",
                    label: "A",
                    expression: "[formula:b]",
                    format: "number",
                },
                {
                    id: "b",
                    label: "B",
                    expression: "[formula:a]",
                    format: "number",
                },
            ])
        ).toMatchObject({ code: "cycle" });
    });

    it("preserves parser safety and expression limits", () => {
        expect(normalizeFormulaExpression("1,5 + [Invoice.amount]", ",")).toBe(
            "1.5+[Invoice.amount]"
        );
        expect(() => parseFormulaExpression("eval(1)")).toThrow(/prohibited/i);
        expect(() => parseFormulaExpression("1+".repeat(501))).toThrow(
            /maximum length/i
        );
    });
});

describe("Nest report formula execution chaining", () => {
    it("evaluates a reverse-listed two-step chain in dependency order", () => {
        const result = applyFormulasToRows(
            [
                {
                    id: 1,
                    "Invoice.amount": 2000,
                    "Customer.cost_percent": 3,
                },
            ],
            {
                tables: ["Invoice", "Customer"],
                fields: [
                    { table: "Invoice", field: "amount" },
                    { table: "Customer", field: "cost_percent" },
                ],
                formulas: [
                    {
                        id: "total",
                        label: "Total",
                        expression: "[formula:premium]",
                        format: "number",
                    },
                    {
                        id: "premium",
                        label: "Premium",
                        expression:
                            "[Invoice.amount]*[Customer.cost_percent]",
                        format: "number",
                    },
                ],
            },
            { locale: "en-US", metadataTables }
        );

        expect(result.rows[0]["formula:premium"]).toBe(60);
        expect(result.rows[0]["formula:total"]).toBe(60);
        expect(result.warnings).toEqual([]);
    });

    it("blanks a failed chain and warns only on the upstream calculation", () => {
        const result = applyFormulasToRows(
            [{ id: 1, "Invoice.amount": 10 }],
            {
                fields: [{ table: "Invoice", field: "amount" }],
                formulas: [
                    {
                        id: "premium",
                        label: "Premium",
                        expression: "[Invoice.amount]/0",
                        format: "number",
                    },
                    {
                        id: "total",
                        label: "Total",
                        expression: "[formula:premium]+1",
                        format: "number",
                    },
                ],
            },
            { metadataTables }
        );

        expect(result.rows[0]["formula:premium"]).toBeNull();
        expect(result.rows[0]["formula:total"]).toBeNull();
        expect(result.warnings).toEqual([
            { formulaId: "premium", label: "Premium", invalidCount: 1 },
        ]);
    });

    it("inherits currency source through compose-only formulas", () => {
        const result = applyFormulasToRows(
            [
                {
                    id: 1,
                    "Invoice.amount": 1000,
                    "Customer.cost_percent": 5,
                    "__currency_Invoice.amount": "EUR",
                },
            ],
            {
                fields: [
                    { table: "Invoice", field: "amount" },
                    { table: "Customer", field: "cost_percent" },
                ],
                formulas: [
                    {
                        id: "premium",
                        label: "Premium",
                        expression:
                            "[Invoice.amount]*[Customer.cost_percent]",
                        format: "currency",
                    },
                    {
                        id: "total",
                        label: "Total",
                        expression: "[formula:premium]+1",
                        format: "currency",
                    },
                ],
            },
            { locale: "en-US", accountCurrency: "USD", metadataTables }
        );

        expect(result.rows[0]["formula:total"]).toBe(51);
        expect(String(result.rows[0]["___formatted_formula:total"])).toMatch(
            /€|EUR/
        );
    });
});
