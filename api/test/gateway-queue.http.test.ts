import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { JwtService } from "@nestjs/jwt";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";
import { CronQueueService } from "../src/queue/cron-queue.service";
import { GatewayProxyService } from "../src/gateway/gateway-proxy.service";

describe("Gateway peel + cron queue HTTP contract", () => {
    let app: INestApplication;
    let jwtService: JwtService;

    const databaseMock = {
        user: { count: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
        account: { findFirst: jest.fn(), findUnique: jest.fn() },
        $disconnect: jest.fn(),
    };

    const cronQueueMock = {
        enqueueRunNow: jest.fn().mockResolvedValue({
            queued: true,
            jobId: "bull-1",
        }),
        enqueueSyncSchedules: jest.fn().mockResolvedValue({
            queued: true,
            jobId: "bull-2",
        }),
        onModuleDestroy: jest.fn(),
    };

    const proxyMock = {
        forward: jest.fn().mockResolvedValue({
            status: 200,
            body: { accepted: true },
        }),
    };

    beforeAll(async () => {
        process.env.JWT_SECRET = "gateway-test-secret";
        process.env.NEXTAUTH_SECRET = "gateway-test-secret";

        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        })
            .overrideProvider(DatabaseService)
            .useValue(databaseMock)
            .overrideProvider(CronQueueService)
            .useValue(cronQueueMock)
            .overrideProvider(GatewayProxyService)
            .useValue(proxyMock)
            .compile();

        app = moduleFixture.createNestApplication();
        app.use(cookieParser());
        app.useGlobalPipes(
            new ValidationPipe({
                whitelist: true,
                forbidNonWhitelisted: true,
                transform: true,
            })
        );
        SwaggerModule.createDocument(
            app,
            new DocumentBuilder()
                .setTitle("Archaser API")
                .addBearerAuth()
                .build()
        );
        await app.init();
        jwtService = app.get(JwtService);
    });

    afterAll(async () => {
        if (app) await app.close();
    });

    async function token() {
        return jwtService.signAsync({
            sub: "u1",
            username: "admin",
            account_id: 10013,
            role: "archaser_admin",
        });
    }

    it("POST /api/gateway/cron/:jobId/run-now enqueues BullMQ job", async () => {
        await request(app.getHttpServer())
            .post("/api/gateway/cron/42/run-now")
            .expect(401);

        const t = await token();
        const res = await request(app.getHttpServer())
            .post("/api/gateway/cron/42/run-now")
            .set("Authorization", `Bearer ${t}`)
            .expect(201);

        expect(res.body).toMatchObject({
            cronJobId: 42,
            queued: true,
            jobId: "bull-1",
        });
        expect(cronQueueMock.enqueueRunNow).toHaveBeenCalledWith(
            expect.objectContaining({ cronJobId: 42, triggeredBy: "u1" })
        );
    });

    it("POST /api/gateway/sms/send forwards to SMS service", async () => {
        const t = await token();
        const res = await request(app.getHttpServer())
            .post("/api/gateway/sms/send")
            .set("Authorization", `Bearer ${t}`)
            .send({ to: "+1000", body: "hi" })
            .expect(200);

        expect(res.body).toEqual({ accepted: true });
        expect(proxyMock.forward).toHaveBeenCalledWith(
            "sms",
            "/internal/send",
            expect.objectContaining({ method: "POST" })
        );
    });

    it("POST /api/gateway/cron/sync-schedules enqueues sync", async () => {
        const t = await token();
        const res = await request(app.getHttpServer())
            .post("/api/gateway/cron/sync-schedules")
            .set("Authorization", `Bearer ${t}`)
            .expect(201);

        expect(res.body).toMatchObject({
            triggeredBy: "u1",
            queued: true,
            jobId: "bull-2",
        });
        expect(cronQueueMock.enqueueSyncSchedules).toHaveBeenCalled();
    });

    it("POST /api/gateway/connectors/:accountId/sync forwards", async () => {
        const t = await token();
        await request(app.getHttpServer())
            .post("/api/gateway/connectors/10013/sync")
            .set("Authorization", `Bearer ${t}`)
            .send({ force: true })
            .expect(200);

        expect(proxyMock.forward).toHaveBeenCalledWith(
            "connectors",
            "/internal/accounts/10013/sync",
            expect.objectContaining({ method: "POST" })
        );
    });

    it("POST /api/gateway/reports/:id/execute forwards", async () => {
        const t = await token();
        await request(app.getHttpServer())
            .post("/api/gateway/reports/99/execute")
            .set("Authorization", `Bearer ${t}`)
            .send({})
            .expect(200);

        expect(proxyMock.forward).toHaveBeenCalledWith(
            "reports",
            "/internal/reports/99/execute",
            expect.objectContaining({ method: "POST" })
        );
    });

    it("OpenAPI includes gateway cron and peel paths", async () => {
        const document = SwaggerModule.createDocument(
            app,
            new DocumentBuilder().setTitle("Archaser API").addBearerAuth().build()
        );
        const paths = Object.keys(document.paths || {});
        expect(paths.some((p) => p.includes("/api/gateway/cron"))).toBe(true);
        expect(paths.some((p) => p.includes("/api/gateway/sms"))).toBe(true);
    });
});
