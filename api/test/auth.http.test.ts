import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { JwtService } from "@nestjs/jwt";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";

const TEST_PASSWORD_HASH =
    "$2b$10$syJ12AL3DN30DhoujSqZyOiR8o1HG4xMA/PTTumOI5L7KDY.joxwi"; // "password"

type UserRow = {
    id: string;
    username: string;
    email: string | null;
    name: string | null;
    password: string | null;
    account_id: number | null;
    role: string | null;
    freeze: boolean | null;
    status: string | null;
    failed_login_attempts: number | null;
    deactivated_at: Date | null;
    language?: string | null;
    time_zone?: string | null;
    locale?: string | null;
    sidebar_collapsed?: boolean | null;
    resetToken?: string | null;
    resetTokenExpiry?: Date | null;
    session_version?: number;
};

describe("Nest auth ownership HTTP contract", () => {
    let app: INestApplication;
    let jwtService: JwtService;

    const users = new Map<string, UserRow>();

    const databaseMock = {
        user: {
            count: jest.fn().mockResolvedValue(0),
            findFirst: jest.fn(),
            update: jest.fn(),
        },
        account: {
            findFirst: jest.fn(),
            findUnique: jest.fn(),
        },
        $disconnect: jest.fn().mockResolvedValue(undefined),
    };

    function seedUser(row: UserRow) {
        users.set(row.username, row);
        if (row.email) {
            users.set(`email:${row.email.toLowerCase()}`, row);
        }
        users.set(`id:${row.id}`, row);
    }

    beforeAll(async () => {
        process.env.JWT_SECRET = "stage1a-auth-test-secret";
        process.env.JWT_EXPIRES_IN = "8h";
        process.env.NEST_PUBLIC_URL = "http://localhost:3002";
        process.env.NEST_AUTH_SUCCESS_REDIRECT = "http://localhost:3000/login";
        process.env.AUTH_SSO_SIMULATE = "1";
        process.env.GOOGLE_CLIENT_ID = "google-client-id";
        process.env.GOOGLE_CLIENT_SECRET = "google-client-secret";
        process.env.MICROSOFT_CLIENT_ID = "ms-client-id";
        process.env.MICROSOFT_CLIENT_SECRET = "ms-client-secret";
        process.env.MICROSOFT_TENANT_ID = "common";

        seedUser({
            id: "user-1",
            username: "spike.user",
            email: "spike@archaser.test",
            name: "Spike User",
            password: TEST_PASSWORD_HASH,
            account_id: 42,
            role: "Collection_Agent",
            freeze: false,
            status: "Active",
            failed_login_attempts: 0,
            deactivated_at: null,
            language: "English",
            time_zone: "Asia/Jerusalem",
            locale: "en-US",
            sidebar_collapsed: false,
            resetToken: null,
            resetTokenExpiry: null,
            session_version: 0,
        });

        seedUser({
            id: "user-frozen",
            username: "frozen.user",
            email: "frozen@archaser.test",
            name: "Frozen User",
            password: TEST_PASSWORD_HASH,
            account_id: 42,
            role: "Auditor",
            freeze: true,
            status: "Active",
            failed_login_attempts: 5,
            deactivated_at: null,
        });

        seedUser({
            id: "user-inactive",
            username: "inactive.user",
            email: "inactive@archaser.test",
            name: "Inactive User",
            password: TEST_PASSWORD_HASH,
            account_id: 42,
            role: "Auditor",
            freeze: false,
            status: "Inactive",
            failed_login_attempts: 0,
            deactivated_at: null,
        });

        seedUser({
            id: "user-sso",
            username: "sso.user",
            email: "sso@archaser.test",
            name: "SSO User",
            password: null,
            account_id: 42,
            role: "Account_Manager",
            freeze: false,
            status: "Active",
            failed_login_attempts: 0,
            deactivated_at: null,
        });

        databaseMock.user.findFirst.mockImplementation(
            async ({
                where,
            }: {
                where: {
                    username?: string;
                    email?: string;
                    id?: string;
                    resetToken?: string;
                    resetTokenExpiry?: { gt: Date };
                    deactivated_at?: null;
                };
            }) => {
                let row: UserRow | undefined;
                if (where.username) {
                    row = users.get(where.username);
                } else if (where.email) {
                    row = users.get(`email:${where.email.toLowerCase()}`);
                } else if (where.id) {
                    row = users.get(`id:${where.id}`);
                } else if (where.resetToken) {
                    for (const value of users.values()) {
                        if (
                            value.resetToken === where.resetToken &&
                            value.resetTokenExpiry &&
                            value.resetTokenExpiry > new Date()
                        ) {
                            row = value;
                            break;
                        }
                    }
                }
                if (!row) {
                    return null;
                }
                if (where.deactivated_at === null && row.deactivated_at) {
                    return null;
                }
                return { ...row };
            }
        );

        databaseMock.user.update.mockImplementation(
            async ({
                where,
                data,
            }: {
                where: { id: string };
                data: Partial<UserRow>;
            }) => {
                const row = users.get(`id:${where.id}`);
                if (!row) {
                    return null;
                }
                Object.assign(row, data);
                users.set(row.username, row);
                users.set(`id:${row.id}`, row);
                if (row.email) {
                    users.set(`email:${row.email.toLowerCase()}`, row);
                }
                return row;
            }
        );

        databaseMock.account.findFirst.mockImplementation(
            async ({
                where,
            }: {
                where: {
                    sub_domain?: { equals: string; mode?: string };
                    deleted_at?: null;
                };
            }) => {
                const subdomain = where.sub_domain?.equals?.toLowerCase();
                if (subdomain === "acme") {
                    return {
                        id: 42,
                        name: "Acme Corp",
                        sso_enabled: true,
                        sso_providers: "google,microsoft",
                    };
                }
                if (subdomain === "nosso") {
                    return {
                        id: 99,
                        name: "No SSO Corp",
                        sso_enabled: false,
                        sso_providers: null,
                    };
                }
                return null;
            }
        );

        databaseMock.account.findUnique.mockImplementation(
            async ({
                where,
                select,
            }: {
                where: { id: number };
                select?: Record<string, boolean>;
            }) => {
                if (where.id === 42) {
                    const account = {
                        id: 42,
                        name: "Acme Corp",
                        sso_enabled: true,
                        sso_providers: "google,microsoft",
                        currency: "USD",
                        primary_color: "#112233",
                        secondary_color: "#445566",
                    };
                    if (!select) {
                        return account;
                    }
                    const picked: Record<string, unknown> = {};
                    for (const key of Object.keys(select)) {
                        if (select[key]) {
                            picked[key] = (account as Record<string, unknown>)[
                                key
                            ];
                        }
                    }
                    return picked;
                }
                if (where.id === 99) {
                    return {
                        id: 99,
                        name: "No SSO Corp",
                        sso_enabled: false,
                        sso_providers: null,
                    };
                }
                return null;
            }
        );

        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        })
            .overrideProvider(DatabaseService)
            .useValue(databaseMock)
            .compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(
            new ValidationPipe({
                whitelist: true,
                forbidNonWhitelisted: true,
                transform: true,
            })
        );

        const swaggerConfig = new DocumentBuilder()
            .setTitle("Archaser API")
            .setVersion("0.0.1")
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

    it("POST /auth/login returns Bearer token; GET /auth/me includes account_id and role", async () => {
        const login = await request(app.getHttpServer())
            .post("/auth/login")
            .send({ username: "spike.user", password: "password" })
            .expect(201);

        expect(login.body.token_type).toBe("Bearer");
        expect(typeof login.body.access_token).toBe("string");

        const me = await request(app.getHttpServer())
            .get("/auth/me")
            .set("Authorization", `Bearer ${login.body.access_token}`)
            .expect(200);

        expect(me.body).toMatchObject({
            sub: "user-1",
            username: "spike.user",
            email: "spike@archaser.test",
            account_id: 42,
            role: "Collection_Agent",
            name: "Spike User",
            language: "English",
            account_name: "Acme Corp",
            primary_color: "#112233",
            sidebar_collapsed: false,
        });
    });

    it("POST /auth/forget-password and /auth/reset-password round-trip", async () => {
        await request(app.getHttpServer())
            .post("/auth/forget-password")
            .send({ email: "spike@archaser.test" })
            .expect(201);

        const user = users.get("id:user-1");
        expect(user?.resetToken).toBeTruthy();
        expect(user?.resetTokenExpiry).toBeInstanceOf(Date);

        await request(app.getHttpServer())
            .post("/auth/reset-password")
            .send({
                token: user!.resetToken,
                password: "Password1",
            })
            .expect(201);

        expect(users.get("id:user-1")?.resetToken).toBeNull();
        // Restore known hash so later login tests keep working.
        const restored = users.get("id:user-1");
        if (restored) {
            restored.password = TEST_PASSWORD_HASH;
            restored.session_version = 0;
        }
    });

    it("POST /auth/forget-password returns 404 for unknown email", async () => {
        await request(app.getHttpServer())
            .post("/auth/forget-password")
            .send({ email: "missing@archaser.test" })
            .expect(404);
    });

    it("POST /auth/login rejects frozen users with 401", async () => {
        const response = await request(app.getHttpServer())
            .post("/auth/login")
            .send({ username: "frozen.user", password: "password" })
            .expect(401);

        expect(String(response.body.message).toLowerCase()).toMatch(/frozen/);
    });

    it("POST /auth/login rejects inactive users with 401", async () => {
        const response = await request(app.getHttpServer())
            .post("/auth/login")
            .send({ username: "inactive.user", password: "password" })
            .expect(401);

        expect(String(response.body.message).toLowerCase()).toMatch(/inactive/);
    });

    it("POST /auth/login rejects bad password and freezes after 5 failures", async () => {
        seedUser({
            id: "user-fail",
            username: "fail.user",
            email: "fail@archaser.test",
            name: "Fail User",
            password: TEST_PASSWORD_HASH,
            account_id: 42,
            role: "Auditor",
            freeze: false,
            status: "Active",
            failed_login_attempts: 4,
            deactivated_at: null,
        });

        const response = await request(app.getHttpServer())
            .post("/auth/login")
            .send({ username: "fail.user", password: "wrong-password" })
            .expect(401);

        expect(response.body.message).toBeDefined();
        const updated = users.get("fail.user");
        expect(updated?.failed_login_attempts).toBe(5);
        expect(updated?.freeze).toBe(true);
    });

    it("GET /auth/me rejects missing Authorization with 401", async () => {
        await request(app.getHttpServer()).get("/auth/me").expect(401);
    });

    it("GET /auth/me rejects forged Bearer token with 401", async () => {
        await request(app.getHttpServer())
            .get("/auth/me")
            .set("Authorization", "Bearer not-a-real-token")
            .expect(401);
    });

    it("GET /auth/me rejects expired Bearer token with 401", async () => {
        const expired = await jwtService.signAsync(
            {
                sub: "user-1",
                username: "spike.user",
                email: "spike@archaser.test",
                account_id: 42,
                role: "Collection_Agent",
                name: "Spike User",
            },
            { expiresIn: -10 }
        );

        await request(app.getHttpServer())
            .get("/auth/me")
            .set("Authorization", `Bearer ${expired}`)
            .expect(401);
    });

    it("GET /auth/scope-probe allows matching account_id and forbids others", async () => {
        const login = await request(app.getHttpServer())
            .post("/auth/login")
            .send({ username: "spike.user", password: "password" })
            .expect(201);

        await request(app.getHttpServer())
            .get("/auth/scope-probe")
            .query({ account_id: 42 })
            .set("Authorization", `Bearer ${login.body.access_token}`)
            .expect(200);

        await request(app.getHttpServer())
            .get("/auth/scope-probe")
            .query({ account_id: 99 })
            .set("Authorization", `Bearer ${login.body.access_token}`)
            .expect(403);
    });

    it("GET /auth/account-by-subdomain returns SSO discovery shape", async () => {
        const found = await request(app.getHttpServer())
            .get("/auth/account-by-subdomain")
            .query({ subdomain: "acme" })
            .expect(200);

        expect(found.body).toEqual({
            accountId: 42,
            name: "Acme Corp",
            ssoEnabled: true,
            ssoProviders: ["google", "microsoft"],
        });

        await request(app.getHttpServer())
            .get("/auth/account-by-subdomain")
            .query({ subdomain: "missing" })
            .expect(404);
    });

    it("SSO simulate success redirects with nest_token for enabled Google", async () => {
        const response = await request(app.getHttpServer())
            .get("/auth/sso/simulate")
            .query({ email: "sso@archaser.test", provider: "google" })
            .expect(302);

        const location = String(response.headers.location);
        expect(location).toContain("nest_token=");
        expect(location).not.toContain("error=");

        const token = new URL(location).searchParams.get("nest_token");
        expect(token).toBeTruthy();

        const me = await request(app.getHttpServer())
            .get("/auth/me")
            .set("Authorization", `Bearer ${token}`)
            .expect(200);

        expect(me.body).toMatchObject({
            sub: "user-sso",
            email: "sso@archaser.test",
            account_id: 42,
            role: "Account_Manager",
        });
    });

    it("SSO simulate redirects SSONotEnabled when account SSO is off", async () => {
        seedUser({
            id: "user-nosso",
            username: "nosso.user",
            email: "nosso@archaser.test",
            name: "No SSO User",
            password: null,
            account_id: 99,
            role: "Auditor",
            freeze: false,
            status: "Active",
            failed_login_attempts: 0,
            deactivated_at: null,
        });

        const response = await request(app.getHttpServer())
            .get("/auth/sso/simulate")
            .query({ email: "nosso@archaser.test", provider: "google" })
            .expect(302);

        const location = String(response.headers.location);
        expect(location).toContain("error=SSONotEnabled");
    });

    it("SSO simulate redirects AccessDenied when provider not allowed", async () => {
        databaseMock.account.findUnique.mockImplementationOnce(
            async () => ({
                id: 42,
                sso_enabled: true,
                sso_providers: "microsoft",
            })
        );

        const response = await request(app.getHttpServer())
            .get("/auth/sso/simulate")
            .query({ email: "sso@archaser.test", provider: "google" })
            .expect(302);

        expect(String(response.headers.location)).toContain(
            "error=AccessDenied"
        );
    });

    it("OpenAPI document includes auth ownership paths", async () => {
        const swaggerConfig = new DocumentBuilder()
            .setTitle("Archaser API")
            .setVersion("0.0.1")
            .addBearerAuth()
            .build();
        const document = SwaggerModule.createDocument(app, swaggerConfig);

        expect(document.paths["/auth/login"]).toBeDefined();
        expect(document.paths["/auth/me"]).toBeDefined();
        expect(document.paths["/auth/forget-password"]).toBeDefined();
        expect(document.paths["/auth/reset-password"]).toBeDefined();
        expect(document.paths["/auth/account-by-subdomain"]).toBeDefined();
        expect(document.paths["/auth/scope-probe"]).toBeDefined();
        expect(document.paths["/auth/google"]).toBeDefined();
        expect(document.paths["/auth/azure-ad"]).toBeDefined();
    });
});