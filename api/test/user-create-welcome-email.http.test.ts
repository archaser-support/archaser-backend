import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";
import { SystemEmailService } from "../src/email/system-email.service";
import { MongoLogService } from "../src/logging/mongo-log.service";

/**
 * Asserts user create uses branded welcome email (not plain inline HTML).
 */
describe("User create — branded welcome email", () => {
    let app: INestApplication;
    let jwtService: JwtService;
    let systemEmail: SystemEmailService;
    const userCreate = jest.fn();
    const userFindFirst = jest.fn();
    const accountFindUnique = jest.fn();
    const sendWelcomeUserEmail = jest.fn().mockResolvedValue({
        messageId: "test-msg",
    });

    const databaseMock = {
        user: {
            findUnique: jest.fn().mockResolvedValue({
                business_unit_id: null,
                role: "archaser_admin",
                account_id: 10013,
            }),
            findFirst: userFindFirst,
            create: userCreate,
        },
        account: {
            findUnique: accountFindUnique,
        },
        businessUnit: {
            findFirst: jest.fn().mockResolvedValue({ id: 111 }),
        },
        rolePermission: {
            findUnique: jest.fn().mockResolvedValue({
                permission_key: "manage_users",
            }),
            findMany: jest.fn().mockResolvedValue([]),
        },
    };

    beforeAll(async () => {
        process.env.JWT_SECRET = "user-create-test-secret";
        process.env.NEXTAUTH_SECRET = "user-create-test-secret";
        process.env.JWT_EXPIRES_IN = "8h";
        process.env.NEST_AUTH_SUCCESS_REDIRECT = "http://localhost:3000";

        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        })
            .overrideProvider(DatabaseService)
            .useValue(databaseMock)
            .overrideProvider(MongoLogService)
            .useValue({ logMessage: jest.fn().mockResolvedValue(null) })
            .compile();

        app = moduleFixture.createNestApplication();
        app.use(cookieParser());
        app.useGlobalPipes(new ValidationPipe({ transform: true }));
        await app.init();
        jwtService = moduleFixture.get(JwtService);
        systemEmail = moduleFixture.get(SystemEmailService);
        jest.spyOn(systemEmail, "sendWelcomeUserEmail").mockImplementation(
            sendWelcomeUserEmail
        );
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
        userFindFirst.mockResolvedValue(null);
        accountFindUnique.mockResolvedValue({
            id: 10149,
            has_collection: false,
            has_credit_insurance: true,
        });
        userCreate.mockImplementation(
            async ({ data }: { data: Record<string, unknown> }) => ({
                ...data,
                id: data.id || "new-user-1",
            })
        );
        sendWelcomeUserEmail.mockResolvedValue({ messageId: "test-msg" });
    });

    it("POST /api/entities/users creates user and sends branded welcome email", async () => {
        const token = await jwtService.signAsync({
            sub: "admin-1",
            username: "archaser.admin",
            email: "admin@archaser.test",
            account_id: 10013,
            role: "archaser_admin",
            name: "Archaser Admin",
        });

        const res = await request(app.getHttpServer())
            .post("/api/entities/users")
            .set("Authorization", `Bearer ${token}`)
            .send({
                email: "new.user@example.com",
                username: "new.user",
                first_name: "New",
                last_name: "User",
                role: "Collection_Agent",
                language: "English",
                status: "Active",
                account_id: 10149,
                time_zone: "Asia/Jerusalem",
                locale: "he-IL",
                business_unit_id: 111,
            });

        expect(res.body?.error).toBeUndefined();
        expect(res.status).toBeGreaterThanOrEqual(200);
        expect(res.status).toBeLessThan(300);
        expect(userCreate).toHaveBeenCalled();
        const created = userCreate.mock.calls[0][0].data;
        expect(created.resetToken).toEqual(expect.any(String));
        expect(sendWelcomeUserEmail).toHaveBeenCalledWith(
            "new.user@example.com",
            "New User",
            expect.stringContaining("/reset-password/"),
            "en",
            false,
            true,
            expect.objectContaining({ accountId: 10149 })
        );
    });

    it("SystemEmailService composes branded welcome HTML", async () => {
        (systemEmail.sendWelcomeUserEmail as jest.Mock).mockRestore?.();
        jest.spyOn(systemEmail, "sendHtmlEmail").mockResolvedValue({
            messageId: "compose-test",
        });

        await systemEmail.sendWelcomeUserEmail(
            "compose@example.com",
            "Compose User",
            "https://localhost:3000/reset-password/tok123",
            "en",
            false,
            true
        );

        expect(systemEmail.sendHtmlEmail).toHaveBeenCalledWith(
            expect.objectContaining({
                toEmail: "compose@example.com",
                html: expect.stringContaining("email-container"),
                subject: expect.stringMatching(/Welcome to ARchaser/i),
            })
        );
        const html = (systemEmail.sendHtmlEmail as jest.Mock).mock
            .calls[0][0].html as string;
        expect(html).not.toMatch(
            /^<p>Welcome to ARchaser\.<\/p><p>Set your password/
        );
        expect(html).toContain("Compose User");
    });
});
