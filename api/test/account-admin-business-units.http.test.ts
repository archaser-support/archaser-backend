import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";

describe("AccountAdmin — business units nested HTTP", () => {
    let app: INestApplication;
    let jwtService: JwtService;

    const databaseMock = {
        user: {
            findUnique: jest.fn().mockResolvedValue({
                business_unit_id: null,
                role: "Collection_Agent",
                account_id: 42,
            }),
            findFirst: jest.fn().mockResolvedValue({
                id: "user-1",
                account_id: 42,
                role: "Collection_Agent",
                business_unit_id: null,
            }),
            count: jest.fn().mockResolvedValue(0),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        account: {
            findUnique: jest.fn().mockResolvedValue({ id: 42, currency: "USD" }),
        },
        rolePermission: {
            findUnique: jest.fn().mockResolvedValue(null),
        },
        businessUnit: {
            findMany: jest.fn().mockResolvedValue([
                {
                    id: 1,
                    name: "Primary",
                    parent_id: null,
                    account_id: 42,
                    status: "Active",
                    is_primary: true,
                    Parent: null,
                },
                {
                    id: 2,
                    name: "Sales",
                    parent_id: 1,
                    account_id: 42,
                    status: "Active",
                    is_primary: false,
                    Parent: { id: 1, name: "Primary" },
                },
            ]),
            count: jest.fn().mockResolvedValue(2),
            findUnique: jest.fn().mockResolvedValue({
                id: 2,
                name: "Sales",
                account_id: 42,
                is_primary: false,
                status: "Active",
            }),
            findFirst: jest.fn().mockResolvedValue({ id: 1 }),
            create: jest.fn().mockResolvedValue({
                id: 3,
                name: "Ops",
                account_id: 42,
                parent_id: 1,
            }),
            update: jest.fn().mockResolvedValue({
                id: 2,
                status: "Inactive",
                account_id: 42,
            }),
            delete: jest.fn().mockResolvedValue({ id: 2 }),
        },
        customer: {
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
    };

    beforeAll(async () => {
        process.env.JWT_SECRET = "account-admin-bu-test-secret";
        process.env.NEXTAUTH_SECRET = "account-admin-bu-test-secret";
        process.env.JWT_EXPIRES_IN = "8h";

        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        })
            .overrideProvider(DatabaseService)
            .useValue(databaseMock)
            .compile();

        app = moduleFixture.createNestApplication();
        app.use(cookieParser());
        app.useGlobalPipes(new ValidationPipe({ transform: true }));
        await app.init();
        jwtService = moduleFixture.get(JwtService);
    });

    afterAll(async () => {
        await app.close();
    });

    async function bearerToken() {
        return jwtService.signAsync({
            sub: "user-1",
            username: "agent.user",
            email: "agent@archaser.test",
            account_id: 42,
            role: "Collection_Agent",
            name: "Agent User",
        });
    }

    it("GET /api/entities/accounts/:accountId/business-units returns paginated data", async () => {
        const token = await bearerToken();
        const res = await request(app.getHttpServer())
            .get("/api/entities/accounts/42/business-units?page=1&limit=10")
            .set("Authorization", `Bearer ${token}`)
            .expect(200);
        expect(res.body.data).toHaveLength(2);
        expect(res.body.total).toBe(2);
        expect(res.body.data[0].name).toBe("Primary");
    });

    it("GET /api/entities/accounts/:accountId/business-units without page returns array", async () => {
        const token = await bearerToken();
        const res = await request(app.getHttpServer())
            .get("/api/entities/accounts/42/business-units")
            .set("Authorization", `Bearer ${token}`)
            .expect(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body).toHaveLength(2);
    });

    it("PUT /api/entities/business-units/:id/status updates status", async () => {
        const token = await bearerToken();
        await request(app.getHttpServer())
            .put("/api/entities/business-units/2/status")
            .set("Authorization", `Bearer ${token}`)
            .send({ status: "Inactive" })
            .expect(200);
        expect(databaseMock.businessUnit.update).toHaveBeenCalled();
    });
});
