import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { JwtService } from "@nestjs/jwt";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";

describe("Portal + credit insurance + remainder HTTP contract", () => {
    let app: INestApplication;
    let jwtService: JwtService;

    const databaseMock = {
        user: {
            count: jest.fn().mockResolvedValue(0),
            findFirst: jest.fn(),
            findUnique: jest.fn().mockResolvedValue({
                business_unit_id: null,
                role: "Collection_Agent",
                account_id: 42,
            }),
            update: jest.fn(),
        },
        account: {
            findFirst: jest.fn(),
            findUnique: jest.fn().mockResolvedValue({
                currency: "USD",
                reporting_date_warning_days: 14,
                credit_limit_warning_threshold_pct: 80,
                credit_score_validity_warning_days: 30,
                has_credit_insurance: true,
            }),
        },
        rolePermission: {
            findUnique: jest.fn().mockResolvedValue({ id: 1 }),
        },
        businessUnit: {
            findMany: jest.fn().mockResolvedValue([]),
            findUnique: jest.fn().mockResolvedValue(null),
            count: jest.fn().mockResolvedValue(0),
        },
        insurancePolicy: {
            aggregate: jest
                .fn()
                .mockResolvedValue({ _sum: { max_total_cover: 1000 } }),
            findMany: jest
                .fn()
                .mockResolvedValue([{ id: 1, name: "Policy A" }]),
            count: jest.fn().mockResolvedValue(1),
            findFirst: jest.fn(),
            update: jest.fn(),
        },
        invoice: {
            aggregate: jest.fn().mockResolvedValue({
                _sum: { capacity_gap_amount: 0, outstanding_debt: 0 },
                _count: { _all: 0 },
            }),
            count: jest.fn().mockResolvedValue(0),
            findMany: jest.fn().mockResolvedValue([]),
            updateMany: jest.fn(),
        },
        customer: {
            findMany: jest.fn().mockResolvedValue([]),
            count: jest.fn().mockResolvedValue(0),
            findFirst: jest.fn().mockImplementation(
                async ({ where }: { where: { customer_uuid?: string } }) => {
                    if (where.customer_uuid !== "uuid-1") return null;
                    return {
                        id: 1,
                        customer_uuid: "uuid-1",
                        customer_number: "C-1",
                        Person: { first_name: "Jane", last_name: "Doe" },
                        Company: null,
                        Account: { id: 42, name: "Acme", currency: "USD" },
                    };
                }
            ),
        },
        customerPolicy: {
            count: jest.fn().mockResolvedValue(0),
        },
        customerTopUp: {
            count: jest.fn().mockResolvedValue(0),
        },
        customerDispute: {
            findMany: jest.fn().mockResolvedValue([]),
        },
        cronJob: {
            findMany: jest.fn().mockResolvedValue([]),
        },
        $disconnect: jest.fn().mockResolvedValue(undefined),
    };

    async function token(): Promise<string> {
        return jwtService.signAsync({
            sub: "user-1",
            username: "agent",
            account_id: 42,
            role: "Collection_Agent",
        });
    }

    beforeAll(async () => {
        process.env.JWT_SECRET = "slice04-test-secret";
        process.env.NEXTAUTH_SECRET = "slice04-test-secret";

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
                .setVersion("0.3.0")
                .addBearerAuth()
                .build()
        );
        await app.init();
        jwtService = app.get(JwtService);
    });

    afterAll(async () => {
        if (app) await app.close();
    });

    it("GET /api/credit-insurance/summary requires auth and returns KPI shape", async () => {
        await request(app.getHttpServer())
            .get("/api/credit-insurance/summary")
            .expect(401);

        const t = await token();
        const res = await request(app.getHttpServer())
            .get("/api/credit-insurance/summary")
            .set("Authorization", `Bearer ${t}`)
            .expect(200);
        expect(res.body).toMatchObject({
            healthIndex: expect.any(Number),
            totalReceivables: expect.any(Number),
            reportingCountdown: {
                invoiceCount: expect.any(Number),
                totalAmount: expect.any(Number),
                windowDays: expect.any(Number),
            },
            termsBreach: {
                invoiceCount: expect.any(Number),
                totalAmount: expect.any(Number),
            },
            capacityGap: {
                totalAmount: expect.any(Number),
                customerOverLimitCount: expect.any(Number),
            },
            withoutPolicy: {
                customerCount: expect.any(Number),
                totalAmount: expect.any(Number),
            },
        });
        expect(res.body.reportingCountdown).toBeDefined();
    });

    it("GET /api/entities/insurance-policies is allowlisted behind JWT (Nest-native)", async () => {
        const t = await token();
        const res = await request(app.getHttpServer())
            .get("/api/entities/insurance-policies")
            .set("Authorization", `Bearer ${t}`)
            .expect(200);
        expect(res.body.policies).toHaveLength(1);
        expect(databaseMock.insurancePolicy.findMany).toHaveBeenCalled();
    });

    it("GET portal customer UUID route is public (no JWT) — Nest-native PortalService", async () => {
        const res = await request(app.getHttpServer())
            .get("/api/customers/uuid-1/portal-data")
            .expect(200);
        expect(res.body.customer_uuid).toBe("uuid-1");
        expect(databaseMock.invoice.findMany).toHaveBeenCalled();
    });

    it("GET portal customer UUID route 404s for unknown uuid", async () => {
        await request(app.getHttpServer())
            .get("/api/customers/does-not-exist/portal-data")
            .expect(404);
    });

    it("POST /api/portal/create-dispute is public", async () => {
        await request(app.getHttpServer())
            .post("/api/portal/create-dispute")
            .send({})
            .expect(201);
    });

    it("GET /api/system (bare, no sub-route) is 404 — no pages-bundle fallback exists", async () => {
        // SystemModule only registers sub-routes (dashboard, control-center, …);
        // a bare /api/system no longer falls through to a legacy bundle.
        await request(app.getHttpServer()).get("/api/system").expect(404);
    });

    it("GET /api/search/global requires auth and returns Nest-native search shape", async () => {
        await request(app.getHttpServer())
            .get("/api/search/global")
            .expect(401);

        const t = await token();
        const res = await request(app.getHttpServer())
            .get("/api/search/global")
            .set("Authorization", `Bearer ${t}`)
            .expect(200);
        // No `q` query param — SearchService short-circuits to an empty result set.
        expect(res.body).toMatchObject({ results: [] });
    });

    it("GET /api/state/list (no Nest domain owns it) is a plain 404", async () => {
        const t = await token();
        await request(app.getHttpServer())
            .get("/api/state/list")
            .set("Authorization", `Bearer ${t}`)
            .expect(404);
    });

    it("OpenAPI includes portal and credit-insurance tags/paths", async () => {
        const { enrichStranglerOpenApi } = await import(
            "../src/openapi/enrich-strangler-openapi"
        );
        const document = enrichStranglerOpenApi(
            SwaggerModule.createDocument(
                app,
                new DocumentBuilder()
                    .setTitle("Archaser API")
                    .setVersion("0.4.0")
                    .addBearerAuth()
                    .build()
            )
        );
        expect(document.paths["/api/credit-insurance/summary"]).toBeDefined();
        expect(document.paths["/api/portal/create-dispute"]).toBeDefined();
        expect(
            document.paths["/api/customers/{customerUUID}/portal-data"]
        ).toBeDefined();
    });
});
