import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";

describe("Roles list — product flag filtering", () => {
    let app: INestApplication;
    let jwtService: JwtService;

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
            findUnique: jest.fn(),
        },
        rolePermission: {
            findMany: jest.fn(),
            findUnique: jest.fn().mockResolvedValue(null),
        },
    };

    beforeAll(async () => {
        process.env.JWT_SECRET = "roles-list-test-secret";
        process.env.NEXTAUTH_SECRET = "roles-list-test-secret";
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

    it("falls back to base roles for credit-only accounts when master roles are collection-only", async () => {
        databaseMock.account.findUnique.mockResolvedValue({
            id: 10149,
            has_collection: false,
            has_credit_insurance: true,
        });
        // Master templates: collection-only flags (matches production data).
        databaseMock.rolePermission.findMany.mockImplementation(
            async (args: { where?: { account_id?: number; role?: string } }) => {
                if (args?.where?.account_id === 10013 && !args?.where?.role) {
                    return [
                        {
                            role: "Collection_Agent",
                            is_collection: true,
                            is_credit_insurance: false,
                        },
                        {
                            role: "System_Administrator",
                            is_collection: true,
                            is_credit_insurance: false,
                        },
                    ];
                }
                // getRolePermissions lookups
                return [{ permission_key: "manage_users" }];
            }
        );

        const token = await adminToken();
        const res = await request(app.getHttpServer())
            .get("/api/roles?accountId=10149")
            .set("Authorization", `Bearer ${token}`)
            .expect(200);

        expect(res.body.roles.length).toBeGreaterThan(0);
        expect(res.body.roles.map((r: { role: string }) => r.role)).toEqual(
            expect.arrayContaining([
                "Collection_Agent",
                "System_Administrator",
                "Account_Manager",
            ])
        );
        expect(
            res.body.roles.map((r: { role: string }) => r.role)
        ).not.toContain("archaser_admin");
    });
});
