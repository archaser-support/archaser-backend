import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { JwtService } from "@nestjs/jwt";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";

describe("Stage 1A core AR — Nest-native HTTP contract", () => {
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
            findUnique: jest.fn(),
        },
        rolePermission: {
            findUnique: jest.fn().mockResolvedValue(null),
        },
        businessUnit: {
            findMany: jest.fn().mockResolvedValue([]),
            findUnique: jest.fn().mockResolvedValue(null),
        },
        customer: {
            findMany: jest
                .fn()
                .mockResolvedValue([{ id: 1, customer_number: "C-1" }]),
            count: jest.fn().mockResolvedValue(1),
            findFirst: jest.fn().mockResolvedValue({ id: 1, account_id: 42 }),
            findUnique: jest.fn(),
            update: jest.fn(),
        },
        invoice: {
            findMany: jest
                .fn()
                .mockResolvedValue([{ id: 10, invoice_number: "INV-1" }]),
            count: jest.fn().mockResolvedValue(1),
            findFirst: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
            aggregate: jest.fn(),
        },
        contact: {
            findMany: jest
                .fn()
                .mockResolvedValue([{ id: 5, email: "a@b.com" }]),
            count: jest.fn().mockResolvedValue(1),
            findFirst: jest.fn(),
            update: jest.fn(),
        },
        customerCollectionPeriod: {
            findUnique: jest.fn().mockResolvedValue({
                id: 99,
                current_category: "Automated",
                customer_id: 1,
                Customer: { account_id: 42 },
            }),
            update: jest.fn().mockImplementation(
                async ({ data }: { data: Record<string, unknown> }) => ({
                    id: 99,
                    current_category: data.current_category,
                })
            ),
        },
        customerDispute: {
            findMany: jest
                .fn()
                .mockResolvedValue([{ id: 1, dispute_status: "New" }]),
            count: jest.fn().mockResolvedValue(1),
            findFirst: jest.fn(),
            update: jest.fn(),
        },
        disputeReason: {
            findMany: jest.fn().mockResolvedValue([]),
            count: jest.fn().mockResolvedValue(0),
            findFirst: jest.fn(),
            update: jest.fn(),
        },
        importJob: {
            create: jest.fn().mockResolvedValue({
                id: "job-1",
                status: "Pending",
                import_type: "Payment",
            }),
            update: jest.fn(),
            findFirst: jest.fn(),
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
        process.env.JWT_SECRET = "stage1a-strangler-test-secret";
        process.env.NEXTAUTH_SECRET = "stage1a-strangler-test-secret";
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

        const swaggerConfig = new DocumentBuilder()
            .setTitle("Archaser API")
            .setVersion("0.2.0")
            .addBearerAuth()
            .build();
        SwaggerModule.createDocument(app, swaggerConfig);

        await app.init();
        jwtService = app.get(JwtService);
    });

    afterAll(async () => {
        if (app) {
            await app.close();
        }
    });

    it("GET /api/entities/customers rejects unauthenticated requests with 401", async () => {
        await request(app.getHttpServer())
            .get("/api/entities/customers")
            .expect(401);
    });

    it("GET /api/entities/customers returns list shape via Nest CustomersModule (not bundled)", async () => {
        const token = await bearerToken();
        const response = await request(app.getHttpServer())
            .get("/api/entities/customers")
            .set("Authorization", `Bearer ${token}`)
            .expect(200);

        expect(response.body).toMatchObject({
            customers: [{ id: 1, customer_number: "C-1" }],
            totalRecords: 1,
        });
        expect(databaseMock.customer.findMany).toHaveBeenCalled();
    });

    it("GET /api/entities/invoices and contacts return list shapes via Nest modules", async () => {
        const token = await bearerToken();

        const invoices = await request(app.getHttpServer())
            .get("/api/entities/invoices")
            .set("Authorization", `Bearer ${token}`)
            .expect(200);
        expect(invoices.body.invoices).toHaveLength(1);
        expect(invoices.body.totalRecords).toBe(1);

        const contacts = await request(app.getHttpServer())
            .get("/api/entities/contacts")
            .set("Authorization", `Bearer ${token}`)
            .expect(200);
        expect(contacts.body.contacts).toHaveLength(1);
        expect(contacts.body.totalPages).toBe(1);
    });

    it("PUT /api/entities/customer-collection-period/:id updates the category via Nest-native service", async () => {
        const token = await bearerToken();
        const response = await request(app.getHttpServer())
            .put("/api/entities/customer-collection-period/99")
            .set("Authorization", `Bearer ${token}`)
            .send({ current_category: "Agent" })
            .expect(200);

        expect(response.body).toMatchObject({ id: 99, current_category: "Agent" });
        expect(databaseMock.customerCollectionPeriod.update).toHaveBeenCalled();
    });

    it("GET /api/operations/disputes rejects without auth and succeeds with Bearer (Nest-native)", async () => {
        await request(app.getHttpServer())
            .get("/api/operations/disputes")
            .expect(401);

        const token = await bearerToken();
        const response = await request(app.getHttpServer())
            .get("/api/operations/disputes")
            .set("Authorization", `Bearer ${token}`)
            .expect(200);

        expect(response.body.disputes).toHaveLength(1);
        expect(databaseMock.customerDispute.findMany).toHaveBeenCalled();
    });

    it("POST /api/import/payment rejects without auth and accepts Bearer (Nest-native stub)", async () => {
        await request(app.getHttpServer())
            .post("/api/import/payment")
            .send({ payments: [] })
            .expect(401);

        const token = await bearerToken();
        const response = await request(app.getHttpServer())
            .post("/api/import/payment")
            .set("Authorization", `Bearer ${token}`)
            .send({ payments: [] })
            .expect(201);

        expect(response.body).toMatchObject({ results: [], message: "ok" });
    });

    it("non-allowlisted entity type returns 404", async () => {
        const token = await bearerToken();
        await request(app.getHttpServer())
            .get("/api/entities/not-a-real-entity")
            .set("Authorization", `Bearer ${token}`)
            .expect(404);
    });

    it("GET /metrics returns Prometheus exposition text", async () => {
        const response = await request(app.getHttpServer())
            .get("/metrics")
            .expect(200);

        expect(response.text).toMatch(/nest_/);
        expect(response.headers["content-type"]).toMatch(/text\/plain/);
    });

    it("OpenAPI includes core AR Nest-native paths", async () => {
        const { enrichStranglerOpenApi } = await import(
            "../src/openapi/enrich-strangler-openapi"
        );
        const swaggerConfig = new DocumentBuilder()
            .setTitle("Archaser API")
            .setVersion("0.4.0")
            .addBearerAuth()
            .build();
        const document = enrichStranglerOpenApi(
            SwaggerModule.createDocument(app, swaggerConfig)
        );

        expect(document.paths["/api/import/payment"]).toBeDefined();
        expect(document.paths["/api/import/customer"]).toBeDefined();
        expect(document.paths["/api/import/invoice"]).toBeDefined();
        expect(document.paths["/api/import/contact"]).toBeDefined();
        expect(document.paths["/api/entities/customers"]).toBeDefined();
        expect(document.paths["/api/entities/invoices"]).toBeDefined();
        expect(document.paths["/api/operations/{operationType}"]).toBeDefined();
        expect(document.paths["/metrics"]).toBeDefined();
    });
});
