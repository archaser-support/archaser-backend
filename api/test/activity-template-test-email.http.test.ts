import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";
import { SystemEmailService } from "../src/email/system-email.service";
import { MongoLogService } from "../src/logging/mongo-log.service";

describe("Activity template test-email", () => {
    let app: INestApplication;
    let jwtService: JwtService;
    let systemEmail: SystemEmailService;
    const sendHtmlEmail = jest.fn().mockResolvedValue({ messageId: "test-1" });

    const databaseMock = {
        user: {
            findUnique: jest.fn().mockResolvedValue({
                business_unit_id: null,
                role: "System_Administrator",
                account_id: 10149,
                email: "tester@example.com",
            }),
            findFirst: jest.fn().mockResolvedValue({
                id: "user-1",
                account_id: 10149,
                role: "System_Administrator",
                business_unit_id: null,
            }),
        },
        account: {
            findUnique: jest.fn().mockResolvedValue({
                id: 10149,
                name: "Prime Law Partners",
                logo: null,
                sub_domain: "prime",
            }),
        },
        activitiesTemplate: {
            findUnique: jest.fn().mockResolvedValue({
                id: 42,
                account_id: 10149,
            }),
        },
        rolePermission: {
            findUnique: jest.fn().mockResolvedValue(null),
            findMany: jest.fn().mockResolvedValue([]),
        },
    };

    beforeAll(async () => {
        process.env.JWT_SECRET = "template-test-email-secret";
        process.env.NEXTAUTH_SECRET = "template-test-email-secret";
        process.env.JWT_EXPIRES_IN = "8h";

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
        jest.spyOn(systemEmail, "sendHtmlEmail").mockImplementation(
            sendHtmlEmail
        );
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        sendHtmlEmail.mockResolvedValue({ messageId: "test-1" });
        databaseMock.activitiesTemplate.findUnique.mockResolvedValue({
            id: 42,
            account_id: 10149,
        });
        databaseMock.account.findUnique.mockResolvedValue({
            id: 10149,
            name: "Prime Law Partners",
            logo: null,
            sub_domain: "prime",
        });
    });

    it("POST /api/activities/templates/:id/test-email sends processed mail", async () => {
        const token = await jwtService.signAsync({
            sub: "user-1",
            username: "tester",
            email: "tester@example.com",
            account_id: 10149,
            role: "System_Administrator",
            name: "Tester",
        });

        const res = await request(app.getHttpServer())
            .post("/api/activities/templates/42/test-email")
            .set("Authorization", `Bearer ${token}`)
            .send({
                language: "English",
                emailSubject: "Hello {first_name}",
                emailContent:
                    '<p>Please settle {customer_name} with {account_name}</p><p><a href="https://example.com/pay">Settle Balance</a></p>',
            });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(sendHtmlEmail).toHaveBeenCalled();
        const call = sendHtmlEmail.mock.calls[0][0];
        expect(call.toEmail).toBe("tester@example.com");
        expect(call.subject).toBe("Hello John");
        expect(call.html).toContain("Prime Law Partners");
        expect(call.html).toContain("John");
        expect(call.html).toContain("[Link disabled in test email]");
        expect(call.fromName).toBe("Prime Law Partners");
    });
});
