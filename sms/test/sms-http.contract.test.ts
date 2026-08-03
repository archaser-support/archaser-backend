import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";
import { SmsService } from "../src/sms/sms.service";

describe("SMS Nest app HTTP contract", () => {
    let app: INestApplication;
    let jwtService: JwtService;
    let smsService: SmsService;

    const vendorFindMany = jest.fn();
    const vendorFindFirst = jest.fn();
    const activityContactFindFirst = jest.fn();
    const activityContactUpdate = jest.fn();

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
        sMSVendor: {
            findMany: vendorFindMany,
            findFirst: vendorFindFirst,
            findUnique: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
        },
        countrySMSVendor: {
            findMany: jest.fn().mockResolvedValue([]),
            count: jest.fn().mockResolvedValue(0),
            findFirst: jest.fn().mockResolvedValue(null),
            findUnique: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
        },
        activityContact: {
            findFirst: activityContactFindFirst,
            update: activityContactUpdate,
            count: jest.fn().mockResolvedValue(0),
        },
    };

    beforeAll(async () => {
        process.env.JWT_SECRET = "sms-nest-test-secret";
        process.env.NEXTAUTH_SECRET = "sms-nest-test-secret";
        process.env.INTERNAL_SERVICE_SECRET = "internal-test-secret";
        process.env.TWILIO_AUTH_TOKEN = "";

        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        })
            .overrideProvider(DatabaseService)
            .useValue(databaseMock)
            .compile();

        app = moduleFixture.createNestApplication();
        app.use(cookieParser());
        await app.init();
        jwtService = moduleFixture.get(JwtService);
        smsService = moduleFixture.get(SmsService);
    });

    afterAll(async () => {
        await app.close();
    });

    function adminToken() {
        return jwtService.sign({
            sub: "admin-1",
            username: "admin",
            account_id: 10013,
            role: "archaser_admin",
        });
    }

    it("GET /api/sms/vendors requires auth", async () => {
        await request(app.getHttpServer()).get("/api/sms/vendors").expect(401);
    });

    it("GET /api/sms/vendors returns list for admin", async () => {
        vendorFindMany.mockResolvedValueOnce([
            { id: 1, provider: "twilio", priority: 1 },
        ]);
        const res = await request(app.getHttpServer())
            .get("/api/sms/vendors")
            .set("Authorization", `Bearer ${adminToken()}`)
            .expect(200);
        expect(res.body).toEqual([
            { id: 1, provider: "twilio", priority: 1 },
        ]);
    });

    it("POST /api/sms/test sends via Twilio factory", async () => {
        vendorFindFirst.mockResolvedValueOnce({
            id: 3,
            provider: "twilio",
            account_sid: "ACxxx",
            auth_token: "tok",
            webhook_url: null,
            cost_per_sms: 0.01,
            is_active: true,
        });
        smsService.setTwilioClientFactory(() => ({
            messages: {
                create: async () => ({ sid: "SMabc" }),
            },
        }));

        const res = await request(app.getHttpServer())
            .post("/api/sms/test")
            .set("Authorization", `Bearer ${adminToken()}`)
            .send({
                mobileNumber: "+15551234567",
                content: "hello",
                vendorId: 3,
            })
            .expect(201);

        expect(res.body.success).toBe(true);
        expect(res.body.messageId).toBe("SMabc");
        expect(res.body.message).toMatch(/twilio/i);
    });

    it("POST /internal/sms/send requires internal secret", async () => {
        await request(app.getHttpServer())
            .post("/internal/sms/send")
            .send({ to: "+1", body: "x" })
            .expect(401);
    });

    it("POST /internal/sms/send works with secret", async () => {
        vendorFindFirst.mockResolvedValueOnce({
            id: 3,
            provider: "twilio",
            account_sid: "ACxxx",
            auth_token: "tok",
            webhook_url: null,
            cost_per_sms: null,
            is_active: true,
        });
        smsService.setTwilioClientFactory(() => ({
            messages: {
                create: async () => ({ sid: "SMint" }),
            },
        }));

        const res = await request(app.getHttpServer())
            .post("/internal/sms/send")
            .set("x-internal-service-secret", "internal-test-secret")
            .send({ to: "+15551234567", body: "hi", vendorId: 3 })
            .expect(201);

        expect(res.body.messageId).toBe("SMint");
    });

    it("GET /health", async () => {
        const res = await request(app.getHttpServer())
            .get("/health")
            .expect(200);
        expect(res.body.service).toBe("archaser-sms");
    });
});
