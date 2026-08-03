import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";
import { CronQueueService } from "../src/queue/cron-queue.service";

describe("GET /api/system/cron — Lambda x-cron-secret", () => {
    let app: INestApplication;
    const cronSecret = "test-cron-secret-lambda";

    const databaseMock = {
        user: {
            findUnique: jest.fn(),
            findFirst: jest.fn(),
        },
        cronJob: {
            findMany: jest.fn().mockResolvedValue([]),
        },
    };

    const cronQueueMock = {
        enqueueSyncSchedules: jest.fn().mockResolvedValue({
            queued: true,
            jobId: "1",
        }),
        enqueueRunNow: jest.fn(),
        onModuleDestroy: jest.fn(),
    };

    beforeAll(async () => {
        process.env.JWT_SECRET = "cron-lambda-test-secret";
        process.env.NEXTAUTH_SECRET = "cron-lambda-test-secret";
        process.env.CRON_SECRET = cronSecret;
        process.env.ENABLE_CRON_JOBS = "true";
        process.env.BULLMQ_ENABLED = "false";

        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        })
            .overrideProvider(DatabaseService)
            .useValue(databaseMock)
            .overrideProvider(CronQueueService)
            .useValue(cronQueueMock)
            .compile();

        app = moduleFixture.createNestApplication();
        app.use(cookieParser());
        app.useGlobalPipes(new ValidationPipe({ transform: true }));
        await app.init();
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        cronQueueMock.enqueueSyncSchedules.mockResolvedValue({
            queued: true,
            jobId: "1",
        });
    });

    it("returns 401 without x-cron-secret", async () => {
        const res = await request(app.getHttpServer())
            .get("/api/system/cron")
            .expect(401);
        expect(res.body.error).toBe("Unauthorized");
        expect(String(res.body.message || "")).toMatch(/x-cron-secret/i);
    });

    it("returns 401 with wrong x-cron-secret", async () => {
        await request(app.getHttpServer())
            .get("/api/system/cron")
            .set("x-cron-secret", "wrong")
            .expect(401);
    });

    it("accepts valid x-cron-secret and runs when ENABLE_CRON_JOBS=true", async () => {
        process.env.ENABLE_CRON_JOBS = "true";
        const res = await request(app.getHttpServer())
            .get("/api/system/cron")
            .set("x-cron-secret", cronSecret)
            .expect(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toBe("Cron jobs executed successfully");
        expect(cronQueueMock.enqueueSyncSchedules).toHaveBeenCalled();
    });

    it("accepts secret query param when header is absent", async () => {
        process.env.ENABLE_CRON_JOBS = "true";
        const res = await request(app.getHttpServer())
            .get(`/api/system/cron?secret=${cronSecret}`)
            .expect(200);
        expect(res.body.success).toBe(true);
    });

    it("returns disabled message when ENABLE_CRON_JOBS is not true", async () => {
        process.env.ENABLE_CRON_JOBS = "false";
        const res = await request(app.getHttpServer())
            .get("/api/system/cron")
            .set("x-cron-secret", cronSecret)
            .expect(200);
        expect(res.body).toEqual({
            success: true,
            message: "Cron jobs are disabled",
            result: null,
        });
        expect(cronQueueMock.enqueueSyncSchedules).not.toHaveBeenCalled();
    });
});
