import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";

describe("AccountAdmin — accounts/users list query", () => {
    let app: INestApplication;
    let jwtService: JwtService;

    const accountFindMany = jest.fn();
    const accountCount = jest.fn();
    const userFindMany = jest.fn();
    const userCount = jest.fn();

    const databaseMock = {
        user: {
            findUnique: jest.fn().mockResolvedValue({
                business_unit_id: null,
                role: "archaser_admin",
                account_id: 10013,
            }),
            findFirst: jest.fn().mockResolvedValue({
                id: "admin-1",
                account_id: 10013,
                role: "archaser_admin",
                business_unit_id: null,
            }),
            findMany: userFindMany,
            count: userCount,
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        account: {
            findUnique: jest
                .fn()
                .mockResolvedValue({ id: 10013, currency: "ILS" }),
            findMany: accountFindMany,
            count: accountCount,
        },
        rolePermission: {
            findUnique: jest.fn().mockResolvedValue(null),
        },
    };

    beforeAll(async () => {
        process.env.JWT_SECRET = "account-admin-list-test-secret";
        process.env.NEXTAUTH_SECRET = "account-admin-list-test-secret";
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

    beforeEach(() => {
        accountFindMany.mockReset();
        accountCount.mockReset();
        userFindMany.mockReset();
        userCount.mockReset();
        accountFindMany.mockResolvedValue([
            {
                id: 55,
                name: "Acme",
                status: "Active",
                deleted_at: null,
                Country: { id: 1, name: "Israel" },
                State: null,
            },
        ]);
        accountCount.mockResolvedValue(1);
        userFindMany.mockResolvedValue([
            {
                id: "u-1",
                name: "Agent",
                email: "a@test.com",
                account_id: 42,
                status: "Active",
            },
        ]);
        userCount.mockResolvedValue(1);
    });

    async function adminToken() {
        return jwtService.signAsync({
            sub: "admin-1",
            username: "archaser.admin",
            email: "admin@archaser.test",
            account_id: 10013,
            role: "archaser_admin",
            name: "Archaser Admin",
        });
    }

    it("GET /api/entities/accounts applies search, status, deletionFilter, sort, and Country include", async () => {
        const token = await adminToken();
        const res = await request(app.getHttpServer())
            .get(
                "/api/entities/accounts?page=1&limit=25&search=55&status=Active&deletionFilter=active&sortField=country&sortDirection=asc"
            )
            .set("Authorization", `Bearer ${token}`)
            .expect(200);

        expect(res.body.accounts).toHaveLength(1);
        expect(accountFindMany).toHaveBeenCalled();
        const args = accountFindMany.mock.calls[0][0];
        expect(args.where.status).toBe("Active");
        expect(args.where.deleted_at).toBeNull();
        expect(args.where.OR).toEqual(
            expect.arrayContaining([
                { name: { contains: "55", mode: "insensitive" } },
                {
                    company_number: {
                        contains: "55",
                        mode: "insensitive",
                    },
                },
                { id: 55 },
                {
                    Country: {
                        name: { contains: "55", mode: "insensitive" },
                    },
                },
                {
                    State: {
                        name: { contains: "55", mode: "insensitive" },
                    },
                },
            ])
        );
        expect(args.orderBy).toEqual({ Country: { name: "asc" } });
        expect(args.include).toEqual({
            Country: { select: { id: true, name: true } },
            State: { select: { id: true, name: true } },
        });
    });

    it("GET /api/entities/accounts defaults deletionFilter to active (deleted_at null)", async () => {
        const token = await adminToken();
        await request(app.getHttpServer())
            .get("/api/entities/accounts?page=1&limit=10")
            .set("Authorization", `Bearer ${token}`)
            .expect(200);

        const args = accountFindMany.mock.calls[0][0];
        expect(args.where.deleted_at).toBeNull();
    });

    it("GET /api/entities/users always scopes to account_id when provided", async () => {
        const token = await adminToken();
        const res = await request(app.getHttpServer())
            .get(
                "/api/entities/users?page=1&limit=25&account_id=42&status=Active&sortField=email&sortDirection=desc&search=Agent"
            )
            .set("Authorization", `Bearer ${token}`)
            .expect(200);

        expect(res.body.users).toHaveLength(1);
        const args = userFindMany.mock.calls[0][0];
        expect(args.where.account_id).toBe(42);
        expect(args.where.status).toBe("Active");
        expect(args.where.OR).toEqual(
            expect.arrayContaining([
                { name: { contains: "Agent", mode: "insensitive" } },
                { email: { contains: "Agent", mode: "insensitive" } },
                { username: { contains: "Agent", mode: "insensitive" } },
            ])
        );
        expect(args.orderBy).toEqual({ email: "desc" });
    });
});
