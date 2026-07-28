import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { AccessScopeService } from "../src/auth/access-scope.service";
import { DatabaseService } from "../src/database/database.service";

describe("AccessScopeService + DualAuth", () => {
    let app: INestApplication;
    let jwtService: JwtService;
    let accessScope: AccessScopeService;

    const databaseMock = {
        user: {
            findUnique: jest.fn().mockResolvedValue({
                business_unit_id: 7,
                role: "Collection_Agent",
                account_id: 42,
            }),
            count: jest.fn().mockResolvedValue(0),
            findFirst: jest.fn().mockResolvedValue({
                id: "user-1",
                username: "agent.user",
                email: "agent@archaser.test",
                name: "Agent",
                account_id: 42,
                role: "Collection_Agent",
                language: "English",
                time_zone: null,
                locale: null,
                sidebar_collapsed: null,
            }),
            update: jest.fn(),
        },
        account: {
            findFirst: jest.fn(),
            findUnique: jest.fn().mockResolvedValue({
                name: "Test Account",
                primary_color: null,
                secondary_color: null,
            }),
        },
        rolePermission: {
            findUnique: jest.fn().mockResolvedValue(null),
        },
        businessUnit: {
            findMany: jest.fn().mockResolvedValue([]),
            findUnique: jest.fn().mockResolvedValue({
                is_primary: false,
                account_id: 42,
            }),
        },
        $disconnect: jest.fn().mockResolvedValue(undefined),
    };

    beforeAll(async () => {
        process.env.JWT_SECRET = "access-scope-test-secret";
        process.env.NEXTAUTH_SECRET = "access-scope-test-secret";

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
        accessScope = app.get(AccessScopeService);
    });

    afterAll(async () => {
        if (app) {
            await app.close();
        }
    });

    it("GET /auth/me rejects unauthenticated with 401", async () => {
        await request(app.getHttpServer()).get("/auth/me").expect(401);
    });

    it("resolves account_id from DualAuth JWT via AccessScopeService", async () => {
        const token = await jwtService.signAsync({
            sub: "user-1",
            username: "agent.user",
            email: "agent@archaser.test",
            account_id: 42,
            role: "Collection_Agent",
            name: "Agent",
        });

        await request(app.getHttpServer())
            .get("/auth/me")
            .set("Authorization", `Bearer ${token}`)
            .expect(200)
            .expect((res) => {
                expect(res.body.account_id).toBe(42);
            });

        const info = await accessScope.resolveUserInfo({
            sub: "user-1",
            username: "agent.user",
            account_id: 42,
            role: "Collection_Agent",
        });
        expect(info.accountId).toBe(42);
        expect(info.userId).toBe("user-1");
        expect(info.businessUnitId).toBe(7);
    });

    it("buildCustomerAccessWhere always includes account_id", async () => {
        const parts = await accessScope.buildCustomerAccessWhere({
            userId: "user-1",
            accountId: 42,
            role: "Collection_Agent",
            businessUnitId: 7,
        });
        expect(parts.some((p) => p.account_id === 42)).toBe(true);
    });
});
