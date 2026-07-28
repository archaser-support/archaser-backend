import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";

describe("SystemModule — Nest-native HTTP contract", () => {
    let app: INestApplication;
    let jwtService: JwtService;

    const databaseMock = {
        user: {
            findUnique: jest.fn().mockResolvedValue({
                business_unit_id: null,
                role: "Collection_Agent",
                account_id: 42,
            }),
            findMany: jest.fn().mockResolvedValue([
                {
                    id: "user-1",
                    name: "Agent User",
                    email: "agent@archaser.test",
                    first_name: "Agent",
                    last_name: "User",
                    role: "Collection_Agent",
                    image: null,
                    business_unit_id: null,
                },
            ]),
        },
        account: {
            findUnique: jest.fn().mockResolvedValue({ currency: "USD" }),
        },
        rolePermission: {
            findUnique: jest.fn().mockResolvedValue(null),
        },
        businessUnit: {
            findMany: jest.fn().mockResolvedValue([]),
            findUnique: jest.fn().mockResolvedValue(null),
            count: jest.fn().mockResolvedValue(0),
        },
        customer: {
            count: jest.fn().mockResolvedValue(5),
            findMany: jest.fn().mockResolvedValue([]),
        },
        invoice: {
            aggregate: jest.fn().mockResolvedValue({
                _sum: { outstanding_debt: 1200, amount: 0 },
            }),
            count: jest.fn().mockResolvedValue(3),
            groupBy: jest
                .fn()
                .mockResolvedValue([{ customer_id: 1 }, { customer_id: 2 }]),
            findMany: jest.fn().mockResolvedValue([]),
        },
        invoicePayment: {
            aggregate: jest.fn().mockResolvedValue({
                _sum: { amount: 500 },
            }),
        },
        customerDispute: {
            count: jest.fn().mockResolvedValue(2),
            groupBy: jest.fn().mockResolvedValue([{ customer_id: 1 }]),
            findMany: jest.fn().mockResolvedValue([]),
        },
        disputeInvoice: {
            count: jest.fn().mockResolvedValue(4),
        },
        activity: {
            count: jest.fn().mockResolvedValue(10),
            findMany: jest.fn().mockResolvedValue([]),
        },
        customerCollectionPeriod: {
            findMany: jest.fn().mockResolvedValue([
                {
                    id: 99,
                    current_category: "Agent",
                    total_outstanding_amount: 100,
                    Customer: {
                        id: 1,
                        customer_number: "C-1",
                        Company: { name: "Acme" },
                    },
                },
            ]),
            count: jest.fn().mockResolvedValue(1),
            groupBy: jest.fn().mockResolvedValue([
                {
                    current_category: "Agent",
                    _count: { _all: 2 },
                    _sum: {
                        total_outstanding_amount: 100,
                        no_of_overdue_invoices: 1,
                        promise_to_pay_amount: 50,
                    },
                },
            ]),
            aggregate: jest.fn().mockResolvedValue({
                _sum: {
                    total_outstanding_amount: 100,
                    promise_to_pay_amount: 50,
                },
            }),
        },
        cronJob: {
            findMany: jest.fn().mockResolvedValue([
                {
                    id: 1,
                    name: "Daily Sync",
                    active: true,
                    cron_expression: "0 0 * * *",
                    last_run_at: null,
                    next_run_at: null,
                    timeout_period_seconds: 1800,
                    modified_at: new Date(),
                    created_at: new Date(),
                    sort_order: 1,
                },
            ]),
        },
        $disconnect: jest.fn().mockResolvedValue(undefined),
    };

    async function bearerToken(): Promise<string> {
        return jwtService.signAsync({
            sub: "user-1",
            username: "agent.user",
            email: "agent@archaser.test",
            account_id: 42,
            role: "Collection_Agent",
            name: "Agent User",
        });
    }

    beforeAll(async () => {
        process.env.JWT_SECRET = "system-module-test-secret";
        process.env.NEXTAUTH_SECRET = "system-module-test-secret";
        process.env.JWT_EXPIRES_IN = "8h";

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
                forbidNonWhitelisted: true,
                transform: true,
            })
        );
        await app.init();
        jwtService = app.get(JwtService);
    });

    afterAll(async () => {
        if (app) {
            await app.close();
        }
    });

    it("GET /api/system/dashboard rejects unauthenticated requests with 401", async () => {
        await request(app.getHttpServer())
            .get("/api/system/dashboard")
            .expect(401);
    });

    it("GET /api/system/dashboard returns KPI shape via Nest SystemModule", async () => {
        const token = await bearerToken();
        const response = await request(app.getHttpServer())
            .get("/api/system/dashboard")
            .set("Authorization", `Bearer ${token}`)
            .expect(200);

        expect(response.body).toMatchObject({
            activeCustomers: 2,
            overdueAmount: 1200,
            overdueInvoices: 3,
            totalCollected: 500,
            currency: "USD",
            fromCache: false,
            disputeStats: expect.objectContaining({
                uniqueCustomerCount: 1,
                disputeInvoiceCount: 4,
            }),
        });
        expect(Array.isArray(response.body.collectionStats)).toBe(true);
        expect(databaseMock.invoice.aggregate).toHaveBeenCalled();
    });

    it("GET /api/system/chart-details and control-center/agents work", async () => {
        const token = await bearerToken();

        const chart = await request(app.getHttpServer())
            .get("/api/system/dashboard/chart-details")
            .set("Authorization", `Bearer ${token}`)
            .expect(200);
        expect(chart.body).toMatchObject({ details: [] });

        const cc = await request(app.getHttpServer())
            .get("/api/system/control-center/stats")
            .set("Authorization", `Bearer ${token}`)
            .expect(200);
        expect(cc.body.agents).toHaveLength(1);
        expect(cc.body.stats).toBeDefined();
    });

    it("GET /api/system/operation-dashboard and agents return Nest shapes", async () => {
        const token = await bearerToken();

        const ops = await request(app.getHttpServer())
            .get("/api/system/operation-dashboard")
            .set("Authorization", `Bearer ${token}`)
            .expect(200);
        expect(ops.body.aggregate.disputes).toBeDefined();
        expect(ops.body.aggregate.promises).toBeDefined();
        expect(ops.body.fromCache).toBe(false);

        const agents = await request(app.getHttpServer())
            .get("/api/system/agents")
            .set("Authorization", `Bearer ${token}`)
            .expect(200);
        expect(agents.body.agents).toHaveLength(1);
        expect(agents.body.totalRecords).toBe(1);
    });

    it("GET /api/system/admin/cron-jobs and POST cache-invalidation", async () => {
        const token = await bearerToken();

        const cron = await request(app.getHttpServer())
            .get("/api/system/admin/cron-jobs")
            .set("Authorization", `Bearer ${token}`)
            .expect(200);
        expect(cron.body.cronJobs).toHaveLength(1);

        const cache = await request(app.getHttpServer())
            .post("/api/system/cache-invalidation")
            .send({
                source: "cron-job",
                reason: "test",
                affectedCustomerIds: [1],
            })
            .expect(201);
        expect(cache.body).toMatchObject({
            success: true,
            source: "cron-job",
            reason: "test",
        });
    });

    it("GET /api/system/shared-stats/customers returns total_accounts", async () => {
        const token = await bearerToken();
        const response = await request(app.getHttpServer())
            .get("/api/system/shared-stats/customers")
            .set("Authorization", `Bearer ${token}`)
            .expect(200);
        expect(response.body).toMatchObject({
            total_accounts: 5,
            currency: "USD",
        });
    });
});
