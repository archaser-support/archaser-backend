import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";

describe("AccountAdmin — bank accounts nested HTTP", () => {
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
        },
        account: {
            findUnique: jest.fn().mockResolvedValue({ id: 42, currency: "USD" }),
        },
        rolePermission: {
            findUnique: jest.fn().mockResolvedValue(null),
        },
        accountBankAccounts: {
            findMany: jest.fn().mockResolvedValue([
                {
                    id: 1,
                    account_id: 42,
                    bank_name: "First National",
                    account_number: "123456",
                    beneficiary_name: "Acme Corp",
                    status: true,
                    primary: true,
                    Country: { id: 1, name: "United States" },
                },
                {
                    id: 2,
                    account_id: 42,
                    bank_name: "Second Bank",
                    account_number: "789012",
                    beneficiary_name: "Acme Corp",
                    status: true,
                    primary: false,
                    Country: null,
                },
            ]),
            count: jest.fn().mockResolvedValue(2),
            findFirst: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
            delete: jest.fn(),
        },
        customerBanks: {
            count: jest.fn().mockResolvedValue(0),
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
            new ValidationPipe({
                whitelist: true,
                transform: true,
            })
        );
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

    it("GET /api/entities/accounts/:accountId/bank-accounts returns paginated data", async () => {
        const token = await bearerToken();
        const res = await request(app.getHttpServer())
            .get(
                "/api/entities/accounts/42/bank-accounts?page=1&limit=10&include=Country"
            )
            .set("Authorization", `Bearer ${token}`)
            .expect(200);
        expect(res.body.data).toHaveLength(2);
        expect(res.body.total).toBe(2);
        expect(res.body.data[0].bank_name).toBe("First National");
        expect(res.body.data[0].Country.name).toBe("United States");
        expect(databaseMock.accountBankAccounts.findMany).toHaveBeenCalled();
    });

    it("GET /api/entities/bank-accounts returns paginated data with Country", async () => {
        const token = await bearerToken();
        const res = await request(app.getHttpServer())
            .get("/api/entities/bank-accounts?page=1&limit=10")
            .set("Authorization", `Bearer ${token}`)
            .expect(200);
        expect(res.body.data).toHaveLength(2);
        expect(res.body.total).toBe(2);
    });
});
