import request from "supertest";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import cookieParser from "cookie-parser";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";

describe("FE↔BE reconnect — missing route ports", () => {
    let app: INestApplication;
    let jwtService: JwtService;
    let token: string;

    const databaseMock = {
        user: {
            findUnique: jest.fn().mockResolvedValue({
                business_unit_id: 1,
                role: "archaser_admin",
                account_id: 10013,
            }),
        },
        rolePermission: {
            findUnique: jest.fn().mockResolvedValue({ id: 1 }),
        },
        businessUnit: {
            findFirst: jest.fn().mockResolvedValue({ id: 10 }),
            findUnique: jest.fn().mockResolvedValue({ external_id: "BU-1" }),
            findMany: jest.fn().mockResolvedValue([]),
        },
        company: {
            findMany: jest.fn().mockResolvedValue([{ id: 1, name: "Acme" }]),
            create: jest.fn().mockResolvedValue({
                id: 2,
                name: "New Co",
                company_number: null,
            }),
            update: jest.fn().mockResolvedValue({ id: 1, name: "Renamed" }),
        },
        customerCollectionPeriod: {
            findFirst: jest.fn().mockResolvedValue({ id: 99 }),
            count: jest.fn().mockResolvedValue(3),
            aggregate: jest.fn().mockResolvedValue({
                _sum: { total_outstanding_amount: 12000 },
            }),
        },
        customer: {
            findMany: jest.fn().mockResolvedValue([
                {
                    id: 1,
                    customer_number: "C-1",
                    type: "Company",
                    business_unit_id: 10,
                    Person: null,
                    Company: { name: "Acme" },
                },
            ]),
            findFirst: jest.fn().mockResolvedValue({ id: 1, account_id: 10013 }),
            count: jest.fn().mockResolvedValue(2),
        },
        businessUnitBankAccounts: {
            findMany: jest.fn().mockResolvedValue([
                {
                    id: 50,
                    business_unit_id: 10,
                    bank_account_id: 7,
                    AccountBankAccounts: { id: 7, bank_name: "Bank A" },
                },
            ]),
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({
                id: 51,
                business_unit_id: 10,
                bank_account_id: 7,
                AccountBankAccounts: { id: 7, bank_name: "Bank A" },
            }),
            delete: jest.fn().mockResolvedValue({ id: 50 }),
        },
        accountBankAccounts: {
            findFirst: jest.fn().mockResolvedValue({
                id: 7,
                account_id: 10013,
                bank_name: "Bank A",
            }),
        },
        activity: {
            create: jest.fn().mockResolvedValue({
                id: BigInt(1),
                content: "hello",
                type: "Internal",
            }),
            count: jest.fn().mockResolvedValue(0),
            groupBy: jest.fn().mockResolvedValue([]),
        },
        activityContact: {
            findMany: jest.fn().mockResolvedValue([
                {
                    communication_channel: "Email",
                    status: "Delivered",
                    delivered_at: new Date(),
                    failed_at: null,
                    created_at: new Date(),
                },
            ]),
        },
        cronJob: {
            findMany: jest.fn().mockResolvedValue([
                {
                    id: 1,
                    name: "job-a",
                    active: true,
                    cron_expression: "* * * * *",
                    last_run_at: null,
                    next_run_at: null,
                    created_at: new Date(),
                    modified_at: new Date(),
                    sort_order: 1,
                    timeout_period_seconds: 1800,
                    last_execution_duration_seconds: null,
                    average_execution_duration_seconds: null,
                    min_execution_duration_seconds: null,
                    max_execution_duration_seconds: null,
                    success_count_30d: 1,
                    failure_count_30d: 0,
                    timeout_count_30d: 0,
                    last_success_at: null,
                    last_failure_at: null,
                    last_timeout_at: null,
                    performance_baseline_seconds: null,
                    performance_degradation_alert_sent_at: null,
                },
            ]),
            findUnique: jest.fn().mockResolvedValue({
                id: 1,
                name: "job-a",
                active: true,
            }),
        },
        importJob: {
            findMany: jest.fn().mockResolvedValue([]),
        },
        log: {
            findMany: jest.fn().mockResolvedValue([]),
        },
        account: {
            findUnique: jest.fn().mockResolvedValue({ currency: "ILS" }),
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
            new ValidationPipe({ whitelist: true, transform: true })
        );
        await app.init();
        jwtService = moduleFixture.get(JwtService);
        token = jwtService.sign({
            sub: "user-1",
            account_id: 10013,
            role: "archaser_admin",
            email: "admin@example.com",
        });
    });

    afterAll(async () => {
        await app.close();
    });

    it("GET /api/system/company returns items", async () => {
        const res = await request(app.getHttpServer())
            .get("/api/system/company")
            .set("Authorization", `Bearer ${token}`)
            .expect(200);
        expect(res.body.items).toEqual([{ id: 1, name: "Acme" }]);
    });

    it("POST /api/business-units/validate-access returns items", async () => {
        const res = await request(app.getHttpServer())
            .post("/api/business-units/validate-access")
            .set("Authorization", `Bearer ${token}`)
            .send({ externalIds: ["BU-1"] })
            .expect(200);
        expect(res.body.items[0]).toMatchObject({
            externalId: "BU-1",
            exists: true,
            hasAccess: true,
        });
    });

    it("GET /api/customers/search returns items", async () => {
        const res = await request(app.getHttpServer())
            .get("/api/customers/search?q=C")
            .set("Authorization", `Bearer ${token}`)
            .expect(200);
        expect(res.body.items[0].customer_number).toBe("C-1");
    });

    it("POST /api/entities/customers/:id/comments creates activity", async () => {
        const res = await request(app.getHttpServer())
            .post("/api/entities/customers/1/comments")
            .set("Authorization", `Bearer ${token}`)
            .send({ comment: "hello" })
            .expect(200);
        expect(res.body.content || res.body.type).toBeTruthy();
    });

    it("GET /api/system/admin/system-health returns cronJobs", async () => {
        const res = await request(app.getHttpServer())
            .get("/api/system/admin/system-health")
            .set("Authorization", `Bearer ${token}`)
            .expect(200);
        expect(res.body.cronJobs.overview.totalJobs).toBe(1);
    });

    it("GET /api/system/admin/dashboard returns jobs", async () => {
        const res = await request(app.getHttpServer())
            .get("/api/system/admin/dashboard")
            .set("Authorization", `Bearer ${token}`)
            .expect(200);
        expect(res.body.jobs).toHaveLength(1);
        expect(res.body.runningJobs).toBeDefined();
    });

    it("GET /api/communication-intelligence/analytics returns channelMetrics", async () => {
        const res = await request(app.getHttpServer())
            .get("/api/communication-intelligence/analytics")
            .set("Authorization", `Bearer ${token}`)
            .expect(200);
        expect(res.body.channelMetrics[0].channel).toBe("Email");
    });

    it("GET /api/entities/business-unit-banks/:buId lists assignments", async () => {
        const res = await request(app.getHttpServer())
            .get("/api/entities/business-unit-banks/10")
            .set("Authorization", `Bearer ${token}`)
            .expect(200);
        expect(res.body[0]).toMatchObject({
            id: 50,
            bank_account_id: 7,
        });
        expect(res.body[0].CustomerBankAccount).toBeDefined();
    });

    it("GET /api/operations/legal-cases/stats returns LegalCasesResponse shape", async () => {
        const res = await request(app.getHttpServer())
            .get("/api/operations/legal-cases/stats")
            .set("Authorization", `Bearer ${token}`)
            .expect(200);
        expect(res.body).toMatchObject({
            totalRecords: 3,
            totalCustomers: 2,
            totalAmount: 12000,
            currency: "ILS",
        });
    });
});
