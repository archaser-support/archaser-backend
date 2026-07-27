import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { JwtService } from "@nestjs/jwt";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";
import { bindCreditInsurancePrisma } from "../src/credit-insurance/domain-db";

describe("Credit insurance leaf HTTP contracts", () => {
    let app: INestApplication;
    let jwtService: JwtService;

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
                currency: "USD",
                reporting_date_warning_days: 14,
                has_credit_insurance: true,
            }),
        },
        rolePermission: {
            findUnique: jest.fn().mockResolvedValue({ id: 1 }),
        },
        businessUnit: {
            findMany: jest.fn().mockResolvedValue([]),
            findUnique: jest.fn().mockResolvedValue(null),
            findFirst: jest.fn().mockResolvedValue(null),
            count: jest.fn().mockResolvedValue(0),
        },
        insurancePolicy: {
            count: jest.fn().mockResolvedValue(1),
            findFirst: jest.fn(),
            findMany: jest.fn().mockResolvedValue([]),
        },
        customer: {
            findMany: jest.fn().mockResolvedValue([]),
            count: jest.fn().mockResolvedValue(1),
        },
        customerPolicy: {
            findMany: jest.fn().mockResolvedValue([]),
            count: jest.fn().mockResolvedValue(0),
        },
        customerTopUp: {
            findMany: jest.fn().mockResolvedValue([]),
            count: jest.fn().mockResolvedValue(0),
        },
        customerPolicyTrend: {
            findMany: jest.fn().mockResolvedValue([]),
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
            createMany: jest.fn().mockResolvedValue({ count: 0 }),
            upsert: jest.fn(),
        },
        exchangeRate: {
            findMany: jest.fn().mockResolvedValue([]),
            findFirst: jest.fn().mockResolvedValue(null),
        },
        invoice: {
            count: jest.fn().mockResolvedValue(0),
            findMany: jest.fn().mockResolvedValue([]),
            groupBy: jest.fn().mockResolvedValue([]),
        },
        $queryRaw: jest.fn().mockResolvedValue([]),
        $executeRaw: jest.fn().mockResolvedValue(0),
        $transaction: jest.fn(),
        $disconnect: jest.fn().mockResolvedValue(undefined),
    };

    databaseMock.$transaction.mockImplementation(async (arg: unknown) => {
        if (typeof arg === "function") {
            return (arg as (tx: typeof databaseMock) => unknown)(databaseMock);
        }
        return arg;
    });

    async function token(role = "Collection_Agent"): Promise<string> {
        return jwtService.signAsync({
            sub: "user-1",
            username: "agent",
            account_id: 42,
            role,
        });
    }

    beforeAll(async () => {
        process.env.JWT_SECRET = "ci-leaf-test-secret";
        process.env.NEXTAUTH_SECRET = "ci-leaf-test-secret";

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
        SwaggerModule.createDocument(
            app,
            new DocumentBuilder()
                .setTitle("Archaser API")
                .setVersion("0.4.0")
                .addBearerAuth()
                .build()
        );
        await app.init();
        jwtService = app.get(JwtService);
        bindCreditInsurancePrisma(databaseMock as unknown as DatabaseService);
    });

    afterAll(async () => {
        if (app) await app.close();
    });

    beforeEach(() => {
        databaseMock.account.findUnique.mockResolvedValue({
            currency: "USD",
            reporting_date_warning_days: 14,
            has_credit_insurance: true,
        });
        databaseMock.rolePermission.findUnique.mockResolvedValue({ id: 1 });
        databaseMock.$queryRaw.mockResolvedValue([]);
        databaseMock.insurancePolicy.count.mockResolvedValue(1);
        databaseMock.customer.findMany.mockResolvedValue([]);
    });

    it("requires auth on stubbed leaves", async () => {
        for (const leaf of [
            "summary-history",
            "portfolio-health",
            "customer-policy-trend",
            "insurance-policy-trend",
            "report",
        ]) {
            await request(app.getHttpServer())
                .get(`/api/credit-insurance/${leaf}`)
                .expect(401);
        }
    });

    it("returns 403 when credit insurance is disabled", async () => {
        databaseMock.account.findUnique.mockResolvedValue({
            currency: "USD",
            has_credit_insurance: false,
        });
        const t = await token();
        await request(app.getHttpServer())
            .get("/api/credit-insurance/summary-history")
            .set("Authorization", `Bearer ${t}`)
            .expect(403);
    });

    it("returns 403 without view_credit_dashboard permission", async () => {
        databaseMock.rolePermission.findUnique.mockResolvedValue(null);
        const t = await token();
        await request(app.getHttpServer())
            .get("/api/credit-insurance/summary")
            .set("Authorization", `Bearer ${t}`)
            .expect(403);
    });

    it("GET summary-history returns history contract keys", async () => {
        const t = await token();
        const res = await request(app.getHttpServer())
            .get("/api/credit-insurance/summary-history?days=30")
            .set("Authorization", `Bearer ${t}`)
            .expect(200);
        expect(res.body).toEqual(
            expect.objectContaining({
                series: expect.any(Array),
                delta: expect.any(Object),
                monthPct: expect.any(Object),
                interval: "daily",
            })
        );
    });

    it("GET portfolio-health returns portfolio contract keys", async () => {
        const t = await token();
        const res = await request(app.getHttpServer())
            .get("/api/credit-insurance/portfolio-health")
            .set("Authorization", `Bearer ${t}`)
            .expect(200);
        expect(res.body).toEqual(
            expect.objectContaining({
                from: expect.any(String),
                to: expect.any(String),
                daysAvailable: expect.any(Number),
                daysInRange: expect.any(Number),
                portfolioHealth: expect.anything(),
                noCoverage: expect.anything(),
                utilization: expect.anything(),
                costs: expect.anything(),
            })
        );
    });

    it("GET customer-policy-trend returns usage trend contract", async () => {
        const t = await token();
        const res = await request(app.getHttpServer())
            .get("/api/credit-insurance/customer-policy-trend?limit=5")
            .set("Authorization", `Bearer ${t}`)
            .expect(200);
        expect(res.body).toEqual(
            expect.objectContaining({
                snapshotDate: expect.any(String),
                hasTopUpPolicies: expect.any(Boolean),
                topCustomers: expect.any(Array),
            })
        );
    });

    it("GET insurance-policy-trend requires policyId", async () => {
        const t = await token();
        await request(app.getHttpServer())
            .get("/api/credit-insurance/insurance-policy-trend")
            .set("Authorization", `Bearer ${t}`)
            .expect(400);
    });

    it("GET insurance-policy-trend returns header series contract", async () => {
        const t = await token();
        const res = await request(app.getHttpServer())
            .get("/api/credit-insurance/insurance-policy-trend?policyId=1")
            .set("Authorization", `Bearer ${t}`)
            .expect(200);
        expect(res.body).toEqual(
            expect.objectContaining({
                policyId: 1,
                series: expect.any(Array),
                latest: null,
                fromDate: null,
                toDate: null,
            })
        );
    });

    it("GET report requires type and returns data/totalRecords", async () => {
        const t = await token();
        await request(app.getHttpServer())
            .get("/api/credit-insurance/report")
            .set("Authorization", `Bearer ${t}`)
            .expect(400);

        databaseMock.customer.count.mockResolvedValue(0);
        const res = await request(app.getHttpServer())
            .get("/api/credit-insurance/report?type=overdue&limit=10")
            .set("Authorization", `Bearer ${t}`)
            .expect(200);
        expect(res.body).toEqual(
            expect.objectContaining({
                data: expect.any(Array),
                totalRecords: expect.any(Number),
            })
        );
    });
});
