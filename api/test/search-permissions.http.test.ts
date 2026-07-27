import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";

describe("Search + Permissions matrix HTTP (slices F/G)", () => {
    let app: INestApplication;
    let jwtService: JwtService;

    const databaseMock: Record<string, unknown> = {
        user: {
            findUnique: jest.fn().mockResolvedValue({
                business_unit_id: null,
                role: "Collection_Agent",
                account_id: 42,
            }),
            count: jest.fn().mockResolvedValue(0),
            findFirst: jest.fn(),
            update: jest.fn(),
        },
        account: {
            findFirst: jest.fn(),
            findUnique: jest.fn().mockResolvedValue({
                has_collection: true,
                has_credit_insurance: false,
            }),
        },
        rolePermission: {
            findUnique: jest.fn().mockResolvedValue(null),
            findMany: jest
                .fn()
                .mockResolvedValue([
                    { permission_key: "view_roles" },
                    { permission_key: "create_log_activity" },
                ]),
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
            upsert: jest.fn().mockResolvedValue({}),
        },
        businessUnit: {
            findMany: jest.fn().mockResolvedValue([]),
            findUnique: jest.fn().mockResolvedValue(null),
        },
        customer: {
            findMany: jest.fn().mockResolvedValue([]),
        },
        invoice: {
            findMany: jest.fn().mockResolvedValue([]),
        },
        contact: {
            findMany: jest.fn().mockResolvedValue([]),
        },
        customerDispute: {
            findMany: jest.fn().mockResolvedValue([]),
        },
        $disconnect: jest.fn().mockResolvedValue(undefined),
        $transaction: jest.fn(
            async (
                fn: (tx: Record<string, unknown>) => Promise<unknown>
            ): Promise<unknown> => fn(databaseMock)
        ),
    };

    beforeAll(async () => {
        process.env.JWT_SECRET = "slice-fg-test-secret";
        process.env.NEXTAUTH_SECRET = "slice-fg-test-secret";

        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        })
            .overrideProvider(DatabaseService)
            .useValue(databaseMock)
            .compile();

        app = moduleFixture.createNestApplication();
        app.use(cookieParser());
        await app.init();
        jwtService = app.get(JwtService);
    });

    afterAll(async () => {
        if (app) {
            await app.close();
        }
    });

    it("GET /api/search/global returns 401 without auth", async () => {
        await request(app.getHttpServer())
            .get("/api/search/global")
            .query({ q: "acme" })
            .expect(401);
    });

    it("GET /api/permissions/:role returns role permissions with auth", async () => {
        const token = await jwtService.signAsync({
            sub: "user-1",
            username: "agent.user",
            email: "agent@archaser.test",
            account_id: 42,
            role: "Collection_Agent",
            name: "Agent",
        });

        await request(app.getHttpServer())
            .get("/api/permissions/Collection_Agent")
            .set("Authorization", `Bearer ${token}`)
            .expect(200)
            .expect((res) => {
                expect(res.body.role).toBe("Collection_Agent");
                expect(Array.isArray(res.body.permissions)).toBe(true);
                expect(res.body.permissions).toEqual(
                    expect.arrayContaining([
                        "view_roles",
                        "create_log_activity",
                    ])
                );
            });
    });

    it("GET /api/permissions/me still works after matrix routes", async () => {
        const token = await jwtService.signAsync({
            sub: "user-1",
            username: "agent.user",
            account_id: 42,
            role: "Collection_Agent",
        });

        await request(app.getHttpServer())
            .get("/api/permissions/me")
            .set("Authorization", `Bearer ${token}`)
            .expect(200)
            .expect((res) => {
                expect(Array.isArray(res.body.permissions)).toBe(true);
            });
    });
});
