import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { JwtService } from "@nestjs/jwt";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";
import { bindCreditInsurancePrisma } from "../src/credit-insurance/domain-db";

describe("Portal + credit insurance + remainder HTTP contract", () => {
    let app: INestApplication;
    let jwtService: JwtService;

    // `customer_uuid` is a Postgres uuid column, and PortalService rejects
    // non-UUID path segments before querying, so the fixture needs a real one.
    const PORTAL_UUID = "b7c94418-6e39-48a5-8390-dab8c730f7d2";

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
            findMany: jest.fn().mockResolvedValue([
                {
                    id: 1,
                    name: "Policy A",
                    policy_number: "POL-A",
                    end_date: new Date("2099-12-31"),
                    max_total_cover: 1000,
                },
            ]),
            count: jest.fn().mockResolvedValue(1),
            findFirst: jest.fn(),
            update: jest.fn(),
        },
        customerCollectionPeriod: {
            findFirst: jest.fn().mockResolvedValue(null),
            findMany: jest.fn().mockResolvedValue([]),
            count: jest.fn().mockResolvedValue(0),
            groupBy: jest.fn().mockResolvedValue([]),
            aggregate: jest.fn().mockResolvedValue({ _sum: {} }),
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
                    if (where.customer_uuid !== PORTAL_UUID) return null;
                    return {
                        id: 1,
                        account_id: 42,
                        customer_uuid: PORTAL_UUID,
                        customer_number: "C-1",
                        type: "Person",
                        language: "en",
                        total_due_amount: 0,
                        customer_due_amount1: 0,
                        customer_due_currency1: "USD",
                        customer_due_amount2: 0,
                        customer_due_currency2: null,
                        total_invoices_overdue: 0,
                        number_of_overdue_invoices: 0,
                        Person: { first_name: "Jane", last_name: "Doe" },
                        Company: null,
                        Account: {
                            id: 42,
                            name: "Acme",
                            logo: null,
                            currency: "USD",
                            // Days ahead a payment date may be promised, not a flag.
                            promise_to_pay: 10,
                            max_promise_to_pay_allowed_per_cycle: 3,
                            sub_domain: null,
                            portal_verification_enabled: false,
                            primary_color: null,
                            secondary_color: null,
                            chart_palette_color: null,
                        },
                    };
                }
            ),
        },
        customerPolicy: {
            count: jest.fn().mockResolvedValue(0),
            findMany: jest.fn().mockResolvedValue([]),
        },
        customerTopUp: {
            count: jest.fn().mockResolvedValue(0),
            findMany: jest.fn().mockResolvedValue([]),
        },
        customerPolicyTrend: {
            findMany: jest.fn().mockResolvedValue([]),
        },
        exchangeRate: {
            findMany: jest.fn().mockResolvedValue([]),
            findFirst: jest.fn().mockResolvedValue(null),
        },
        customerDispute: {
            findMany: jest.fn().mockResolvedValue([]),
            count: jest.fn().mockResolvedValue(0),
        },
        activity: {
            count: jest.fn().mockResolvedValue(0),
            findMany: jest.fn().mockResolvedValue([]),
        },
        $queryRaw: jest.fn().mockResolvedValue([
            {
                c: 0,
                t: 0,
                cnt_reporting: 0,
                cnt_payment_term: 0,
                cnt_overdue_mep: 0,
                cnt_outdated_dcl: 0,
                cnt_after_policy_end: 0,
            },
        ]),
        $executeRaw: jest.fn().mockResolvedValue(0),
        $transaction: jest.fn(),
        cronJob: {
            findMany: jest.fn().mockResolvedValue([]),
        },
        $disconnect: jest.fn().mockResolvedValue(undefined),
    };

    databaseMock.$transaction.mockImplementation(async (arg: unknown) => {
        if (typeof arg === "function") {
            return (arg as (tx: typeof databaseMock) => unknown)(databaseMock);
        }
        return arg;
    });

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
        bindCreditInsurancePrisma(databaseMock as unknown as DatabaseService);
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
            .get(`/api/customers/${PORTAL_UUID}/portal-data`)
            .expect(200);
        expect(res.body.customer_uuid).toBe(PORTAL_UUID);
        expect(databaseMock.customerCollectionPeriod.findFirst).toHaveBeenCalled();
        expect(databaseMock.customerDispute.count).toHaveBeenCalled();
    });

    it("GET portal-data allows a promise to pay when the cycle cap is unused", () => {
        // Guards the portal's promise-to-pay page: reading an unset or unreached
        // cap as "none allowed" hid the date picker behind a maxed-out state.
        return request(app.getHttpServer())
            .get(`/api/customers/${PORTAL_UUID}/portal-data`)
            .expect(200)
            .expect((res) => {
                expect(res.body).toMatchObject({
                    promise_to_pay: 10,
                    isPromiseToPayAllowed: true,
                    isPromiseToPayMaxedOut: false,
                });
            });
    });

    it("GET portal invoices route returns branding alongside the invoices", async () => {
        const res = await request(app.getHttpServer())
            .get(`/api/customers/${PORTAL_UUID}/invoices`)
            .expect(200);
        // The portal sub-page layout reads the header logo and name from here.
        expect(res.body).toMatchObject({
            invoices: [],
            totalRecords: 0,
            logo: null,
        });
        expect(databaseMock.invoice.findMany).toHaveBeenCalled();
    });

    it("GET portal customer UUID route 404s for unknown uuid", async () => {
        await request(app.getHttpServer())
            .get("/api/customers/2f1c9d64-0000-4000-8000-000000000000/portal-data")
            .expect(404);
    });

    it("GET portal customer UUID route 404s for a malformed uuid", async () => {
        // Reaching Prisma with a non-uuid would raise P2023 and surface a 500.
        await request(app.getHttpServer())
            .get("/api/customers/does-not-exist/portal-data")
            .expect(404);
    });

    it("POST /api/portal/create-dispute is public but validates its body", async () => {
        // Public: the failure is a 400 from the handler, not a 401 from the guard.
        // An empty body used to be answered with a silent 201 and no dispute row.
        await request(app.getHttpServer())
            .post("/api/portal/create-dispute")
            .send({})
            .expect(400);
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
