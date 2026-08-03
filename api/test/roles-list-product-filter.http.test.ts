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

    beforeEach(() => {
        jest.clearAllMocks();
        databaseMock.user.findUnique.mockResolvedValue({
            business_unit_id: null,
            role: "archaser_admin",
            account_id: 10013,
        });
        databaseMock.user.findFirst.mockResolvedValue({
            id: "admin-1",
            account_id: 10013,
            role: "archaser_admin",
            business_unit_id: null,
        });
        databaseMock.rolePermission.findUnique.mockResolvedValue(null);
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

    it("returns master roles for credit-only accounts even when master rows are collection-tagged", async () => {
        databaseMock.account.findUnique.mockResolvedValue({
            id: 10149,
            has_collection: false,
            has_credit_insurance: true,
        });
        // Master templates: collection-only flags (matches production data).
        // Credit-only list must include these — no empty-set fallback to ALL_ROLES.
        databaseMock.rolePermission.findMany.mockImplementation(
            async (args: {
                where?: { account_id?: number; role?: unknown };
                distinct?: string[];
            }) => {
                expect(args?.distinct).toBeUndefined();
                // Master template query uses role: { not: "archaser_admin" }
                if (
                    args?.where?.account_id === 10013 &&
                    typeof args?.where?.role === "object" &&
                    args.where.role !== null
                ) {
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
                // getRolePermissions lookups (role is a string)
                return [{ permission_key: "manage_users" }];
            }
        );

        const token = await adminToken();
        const res = await request(app.getHttpServer())
            .get("/api/roles?accountId=10149")
            .set("Authorization", `Bearer ${token}`)
            .expect(200);

        const roleNames = res.body.roles.map((r: { role: string }) => r.role);
        expect(roleNames).toEqual(
            expect.arrayContaining([
                "Collection_Agent",
                "System_Administrator",
            ])
        );
        expect(roleNames).not.toContain("Account_Manager");
        expect(roleNames).not.toContain("archaser_admin");
        expect(roleNames.length).toBe(2);
    });

    it("includes a role when any master permission row is credit-tagged (not only the first)", async () => {
        databaseMock.account.findUnique.mockResolvedValue({
            id: 10149,
            has_collection: false,
            has_credit_insurance: true,
        });
        // Same role: collection-tagged row first, credit-tagged later — distinct:["role"]
        // would keep only the first and hide the role on non-credit-only paths;
        // credit-only includes all rows regardless.
        databaseMock.rolePermission.findMany.mockImplementation(
            async (args: {
                where?: { account_id?: number; role?: unknown };
                distinct?: string[];
            }) => {
                expect(args?.distinct).toBeUndefined();
                if (
                    args?.where?.account_id === 10013 &&
                    typeof args?.where?.role === "object" &&
                    args.where.role !== null
                ) {
                    return [
                        {
                            role: "Account_Manager",
                            is_collection: true,
                            is_credit_insurance: false,
                        },
                        {
                            role: "Account_Manager",
                            is_collection: false,
                            is_credit_insurance: true,
                        },
                    ];
                }
                return [{ permission_key: "view_customers" }];
            }
        );

        const token = await adminToken();
        const res = await request(app.getHttpServer())
            .get("/api/roles?accountId=10149")
            .set("Authorization", `Bearer ${token}`)
            .expect(200);

        const roleNames = res.body.roles.map((r: { role: string }) => r.role);
        expect(roleNames).toContain("Account_Manager");
        expect(roleNames).not.toContain("archaser_admin");
    });
});
