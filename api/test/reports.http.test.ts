import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";

describe("Reports Nest-native HTTP", () => {
    let app: INestApplication;
    let jwtService: JwtService;

    const reportRow = {
        id: 7,
        account_id: 42,
        name: "Customers default",
        unique_name: "customers_default",
        description: null,
        report_config: {
            tables: ["Customer"],
            fields: [
                { table: "Customer", field: "name" },
                { table: "Customer", field: "customer_number" },
                { table: "Customer", field: "Country.name" },
            ],
            filters: [],
            sorting: [{ field: "name", direction: "asc" }],
        },
        is_public: false,
        is_system: true,
        is_default: true,
        context: "customers",
        created_at: new Date("2024-01-01"),
        modified_at: new Date("2024-01-02"),
        created_by: "creator-id",
        modified_by: "modifier-id",
        User_Report_created_byToUser: {
            id: "creator-id",
            name: "Creator Name",
            username: "creator",
            first_name: "Creator",
            last_name: "Name",
            email: "creator@example.com",
        },
        User_Report_modified_byToUser: {
            id: "modifier-id",
            name: "Modifier Name",
            username: "modifier",
            first_name: "Modifier",
            last_name: "Name",
            email: "modifier@example.com",
        },
    };

    const databaseMock = {
        user: {
            findUnique: jest.fn().mockResolvedValue({
                business_unit_id: null,
                role: "Collection_Agent",
                account_id: 42,
            }),
        },
        account: {
            findUnique: jest.fn().mockResolvedValue({
                has_credit_insurance: false,
            }),
        },
        rolePermission: {
            findUnique: jest.fn().mockResolvedValue({ id: 1 }),
        },
        businessUnit: {
            findMany: jest.fn().mockResolvedValue([]),
            findUnique: jest.fn().mockResolvedValue(null),
        },
        report: {
            findMany: jest.fn().mockResolvedValue([reportRow]),
            count: jest.fn().mockResolvedValue(1),
            findFirst: jest.fn().mockImplementation(({ where }) => {
                if (where?.id === 8) {
                    return Promise.resolve(disputeReportRow);
                }
                return Promise.resolve(reportRow);
            }),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
        },
        userDefaultReport: {
            findFirst: jest.fn().mockResolvedValue(null),
            upsert: jest.fn(),
            deleteMany: jest.fn(),
        },
        reportShare: {
            findMany: jest.fn().mockResolvedValue([]),
            create: jest.fn(),
        },
        reportSchedule: {
            findMany: jest.fn().mockResolvedValue([]),
            create: jest.fn(),
            update: jest.fn(),
        },
        customer: {
            findMany: jest.fn().mockResolvedValue([
                {
                    id: 1,
                    customer_number: "C-1",
                    collection_status: "Active",
                    total_invoices_overdue: 0,
                    total_due_amount: 0,
                    modified_at: new Date("2024-01-02"),
                    Company: { id: 10, name: "Acme" },
                    Person: null,
                    Country: { id: 1, name: "Israel" },
                    State: null,
                    ParentCustomer: null,
                    CustomerCollectionPeriod: [],
                },
            ]),
            count: jest.fn().mockResolvedValue(1),
        },
        customerDispute: {
            findMany: jest.fn().mockResolvedValue([
                {
                    id: 55,
                    dispute_status: "Open",
                    created_at: new Date("2024-02-01"),
                    owner_id: "user-1",
                    Customer: {
                        id: 1,
                        customer_number: "C-1",
                        Company: { id: 10, name: "Acme" },
                        Person: null,
                    },
                    DisputeReason: { id: 3, name: "Pricing" },
                    User_CustomerDispute_owner_idToUser: {
                        id: "user-1",
                        name: "Agent One",
                    },
                    DisputeInvoice: [
                        {
                            Invoice: {
                                outstanding_debt: 150,
                                due_date: new Date("2024-01-15"),
                            },
                        },
                    ],
                },
            ]),
            count: jest.fn().mockResolvedValue(1),
        },
    };

    const disputeReportRow = {
        ...reportRow,
        id: 8,
        name: "Open Disputes",
        unique_name: "open_disputes",
        context: "disputes",
        report_config: {
            tables: ["Dispute", "Customer"],
            fields: [
                { table: "Dispute", field: "dispute_number" },
                { table: "Customer", field: "name" },
                { table: "Customer", field: "customer_number" },
                { table: "Dispute", field: "amount_in_dispute" },
                { table: "Dispute", field: "days_past_due" },
                { table: "Dispute", field: "created_at" },
                { table: "Dispute", field: "dispute_reason" },
                { table: "Dispute", field: "dispute_status" },
                { table: "Dispute", field: "assigned_to" },
            ],
            filters: [
                {
                    table: "Dispute",
                    field: "dispute_status",
                    value: "Resolved",
                    operator: "not_equals",
                },
            ],
            sorting: [{ field: "Customer.name", direction: "ASC" }],
        },
    };

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        })
            .overrideProvider(DatabaseService)
            .useValue(databaseMock)
            .compile();

        app = moduleFixture.createNestApplication();
        app.use(cookieParser());
        app.useGlobalPipes(
            new ValidationPipe({
                whitelist: true,
                transform: true,
                // Match backend/api/src/main.ts — UI fields like timezone must be allowlisted.
                forbidNonWhitelisted: true,
            })
        );
        await app.init();
        jwtService = app.get(JwtService);
    });

    afterAll(async () => {
        await app.close();
    });

    function authHeader() {
        const token = jwtService.sign({
            sub: "user-1",
            account_id: 42,
            role: "Collection_Agent",
            email: "a@b.com",
        });
        return { Authorization: `Bearer ${token}` };
    }

    it("GET /api/reports returns list shape", async () => {
        const res = await request(app.getHttpServer())
            .get("/api/reports?context=customers")
            .set(authHeader())
            .expect(200);
        expect(res.body.reports).toHaveLength(1);
        expect(res.body.totalRecords).toBe(1);
        expect(res.body.reports[0].User_Report_created_byToUser.name).toBe(
            "Creator Name"
        );
        expect(res.body.reports[0].User_Report_modified_byToUser.name).toBe(
            "Modifier Name"
        );
        expect(databaseMock.report.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                include: {
                    User_Report_created_byToUser: {
                        select: expect.objectContaining({
                            name: true,
                            username: true,
                            email: true,
                        }),
                    },
                    User_Report_modified_byToUser: {
                        select: expect.objectContaining({
                            name: true,
                            username: true,
                            email: true,
                        }),
                    },
                },
            })
        );
    });

    it("GET /api/reports/:id wraps payload as { report }", async () => {
        const res = await request(app.getHttpServer())
            .get("/api/reports/7")
            .set(authHeader())
            .expect(200);
        expect(res.body.report).toBeDefined();
        expect(res.body.report.id).toBe(7);
        expect(res.body.report.name).toBe("Customers default");
        expect(res.body.report.User_Report_created_byToUser.name).toBe(
            "Creator Name"
        );
        expect(res.body.id).toBeUndefined();
    });

    it("POST /api/reports/:id/execute returns data + totalRecords", async () => {
        const res = await request(app.getHttpServer())
            .post("/api/reports/7/execute")
            .set(authHeader())
            .send({
                page: 1,
                limit: 20,
                search: "",
                sortField: "",
                sortDirection: "asc",
                locale: "en-US",
                language: "English",
                timezone: "Asia/Kolkata",
            })
            .expect(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.totalRecords).toBe(1);
        expect(res.body.data[0]["Customer.name"]).toBe("Acme");
    });

    it("POST /api/reports/:id/execute applies chained formulas and warning summaries", async () => {
        databaseMock.report.findFirst.mockResolvedValueOnce({
            ...reportRow,
            id: 9,
            report_config: {
                tables: ["Customer"],
                fields: [{ table: "Customer", field: "name" }],
                formulas: [
                    {
                        id: "doubled",
                        label: "Doubled ratio",
                        expression: "[formula:ratio]*2",
                        format: "number",
                    },
                    {
                        id: "ratio",
                        label: "Ratio",
                        expression:
                            "[Customer.total_due_amount]/[Customer.total_invoices_overdue]",
                        format: "number",
                    },
                ],
            },
        });
        databaseMock.customer.findMany.mockResolvedValueOnce([
            {
                id: 1,
                total_due_amount: 100,
                total_invoices_overdue: 4,
                Company: { id: 10, name: "Acme" },
                Person: null,
            },
            {
                id: 2,
                total_due_amount: 100,
                total_invoices_overdue: 0,
                Company: { id: 11, name: "Globex" },
                Person: null,
            },
        ]);
        databaseMock.customer.count.mockResolvedValueOnce(2);

        const res = await request(app.getHttpServer())
            .post("/api/reports/9/execute")
            .set(authHeader())
            .send({ page: 1, limit: 20, locale: "en-US" })
            .expect(200);

        expect(res.body.data[0]["formula:ratio"]).toBe(25);
        expect(res.body.data[0]["formula:doubled"]).toBe(50);
        expect(res.body.data[1]["formula:ratio"]).toBeNull();
        expect(res.body.data[1]["formula:doubled"]).toBeNull();
        expect(res.body.formulaWarnings).toEqual([
            { formulaId: "ratio", label: "Ratio", invalidCount: 1 },
        ]);
    });

    it("POST /api/reports/:id/execute maps Dispute Customer.name sort/select for Prisma", async () => {
        databaseMock.customerDispute.findMany.mockClear();
        databaseMock.report.findFirst.mockResolvedValueOnce(disputeReportRow);

        const res = await request(app.getHttpServer())
            .post("/api/reports/8/execute")
            .set(authHeader())
            .send({
                page: 1,
                limit: 20,
                search: "",
                sortField: "",
                sortDirection: "asc",
                locale: "en-US",
                language: "English",
                timezone: "Asia/Kolkata",
            })
            .expect(200);

        expect(databaseMock.customerDispute.findMany).toHaveBeenCalled();
        const args = databaseMock.customerDispute.findMany.mock.calls[0][0];
        expect(args.orderBy).toEqual([
            { Customer: { Company: { name: "asc" } } },
        ]);
        expect(args.select.Customer.select.name).toBeUndefined();
        expect(args.select.Customer.select.Company).toEqual({
            select: { id: true, name: true },
        });
        expect(args.select.dispute_number).toBeUndefined();
        expect(args.select.amount_in_dispute).toBeUndefined();
        expect(args.select.days_past_due).toBeUndefined();
        expect(args.select.assigned_to).toBeUndefined();
        expect(args.select.dispute_reason).toBeUndefined();
        expect(args.select.id).toBe(true);
        expect(args.select.DisputeReason).toBeDefined();
        expect(args.select.DisputeInvoice).toBeDefined();
        expect(args.select.User_CustomerDispute_owner_idToUser).toBeDefined();

        expect(res.body.data[0]["Customer.name"]).toBe("Acme");
        expect(res.body.data[0]["Dispute.dispute_number"]).toBe(55);
        expect(res.body.data[0]["___formatted_Dispute.dispute_number"]).toBe(
            "DIS-000055"
        );
        expect(res.body.data[0]["Dispute.amount_in_dispute"]).toBe(150);
        expect(res.body.data[0]["Dispute.dispute_reason"]).toBe("Pricing");
        expect(res.body.data[0]["Dispute.assigned_to"]).toBe("Agent One");
    });

    it("POST /api/reports/:id/execute rejects unknown body properties", async () => {
        await request(app.getHttpServer())
            .post("/api/reports/7/execute")
            .set(authHeader())
            .send({ page: 1, limit: 20, includeTotals: true })
            .expect(400);
    });

    it("GET /api/reports without auth is 401", async () => {
        await request(app.getHttpServer()).get("/api/reports").expect(401);
    });
});
