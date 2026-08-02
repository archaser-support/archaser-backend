import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";

describe("Logs + SMS list query", () => {
    let app: INestApplication;
    let jwtService: JwtService;

    const logFindMany = jest.fn();
    const logCount = jest.fn();
    const vendorFindMany = jest.fn();
    const countryVendorFindMany = jest.fn();
    const countryVendorCount = jest.fn();

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
        },
        account: {
            findUnique: jest
                .fn()
                .mockResolvedValue({ id: 10013, currency: "ILS" }),
        },
        rolePermission: {
            findUnique: jest.fn().mockResolvedValue({
                role: "archaser_admin",
                permission: "view_system_logs",
                allowed: true,
            }),
        },
        log: {
            findMany: logFindMany,
            count: logCount,
            groupBy: jest.fn().mockResolvedValue([]),
        },
        sMSVendor: {
            findMany: vendorFindMany,
        },
        countrySMSVendor: {
            findMany: countryVendorFindMany,
            count: countryVendorCount,
        },
    };

    beforeAll(async () => {
        process.env.JWT_SECRET = "logs-sms-list-test-secret";
        process.env.NEXTAUTH_SECRET = "logs-sms-list-test-secret";
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
        logFindMany.mockReset();
        logCount.mockReset();
        vendorFindMany.mockReset();
        countryVendorFindMany.mockReset();
        countryVendorCount.mockReset();
        logFindMany.mockResolvedValue([]);
        logCount.mockResolvedValue(0);
        vendorFindMany.mockResolvedValue([
            { id: 1, provider: "Twilio", priority: 1, currency: "USD" },
        ]);
        countryVendorFindMany.mockResolvedValue([]);
        countryVendorCount.mockResolvedValue(0);
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

    it("GET /api/logs honors sortField/sortDirection", async () => {
        const token = await adminToken();
        await request(app.getHttpServer())
            .get(
                "/api/logs?page=1&limit=20&sortField=level&sortDirection=asc&search=fail"
            )
            .set("Authorization", `Bearer ${token}`)
            .expect(200);

        const args = logFindMany.mock.calls[0][0];
        expect(args.orderBy).toEqual({ level: "asc" });
        expect(args.where.message).toEqual({
            contains: "fail",
            mode: "insensitive",
        });
    });

    it("GET /api/sms/vendors applies search and sort", async () => {
        const token = await adminToken();
        await request(app.getHttpServer())
            .get(
                "/api/sms/vendors?search=Twilio&sortField=priority&sortDirection=desc"
            )
            .set("Authorization", `Bearer ${token}`)
            .expect(200);

        const args = vendorFindMany.mock.calls[0][0];
        expect(args.where.OR).toEqual(
            expect.arrayContaining([
                {
                    provider: {
                        contains: "Twilio",
                        mode: "insensitive",
                    },
                },
            ])
        );
        expect(args.orderBy).toEqual({ priority: "desc" });
    });

    it("GET /api/sms/country-vendors applies sort allowlist", async () => {
        const token = await adminToken();
        await request(app.getHttpServer())
            .get(
                "/api/sms/country-vendors?page=1&limit=20&sortField=country&sortDirection=desc"
            )
            .set("Authorization", `Bearer ${token}`)
            .expect(200);

        const args = countryVendorFindMany.mock.calls[0][0];
        expect(args.orderBy).toEqual({ Country: { name: "desc" } });
    });
});
