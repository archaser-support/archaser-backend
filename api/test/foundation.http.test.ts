import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";

const TEST_PASSWORD_HASH =
    "$2b$10$syJ12AL3DN30DhoujSqZyOiR8o1HG4xMA/PTTumOI5L7KDY.joxwi"; // "password"

describe("Stage 0 Nest foundation HTTP contract", () => {
    let app: INestApplication;

    const databaseMock = {
        user: {
            count: jest.fn().mockResolvedValue(3),
            findFirst: jest.fn(),
        },
        $disconnect: jest.fn().mockResolvedValue(undefined),
    };

    beforeAll(async () => {
        process.env.JWT_SECRET = "stage0-test-secret";

        databaseMock.user.findFirst.mockImplementation(
            async ({ where }: { where: { username: string } }) => {
                if (where.username !== "spike.user") {
                    return null;
                }
                return {
                    id: "user-1",
                    username: "spike.user",
                    email: "spike@archaser.test",
                    password: TEST_PASSWORD_HASH,
                    account_id: 42,
                    freeze: false,
                };
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
    });

    afterAll(async () => {
        if (app) {
            await app.close();
        }
    });

    it("GET /health succeeds without a token and reports database probe shape", async () => {
        const response = await request(app.getHttpServer())
            .get("/health")
            .expect(200);

        expect(response.body).toMatchObject({
            status: "ok",
            service: "archaser-api",
            database: {
                ok: true,
                userCount: 3,
            },
        });
        expect(databaseMock.user.count).toHaveBeenCalled();
    });

    it("POST /auth/login returns a Bearer access token for valid credentials", async () => {
        const response = await request(app.getHttpServer())
            .post("/auth/login")
            .send({ username: "spike.user", password: "password" })
            .expect(201);

        expect(response.body.token_type).toBe("Bearer");
        expect(typeof response.body.access_token).toBe("string");
        expect(response.body.access_token.length).toBeGreaterThan(20);
    });

    it("GET /auth/me rejects missing Authorization with 401", async () => {
        await request(app.getHttpServer()).get("/auth/me").expect(401);
    });

    it("GET /auth/me rejects invalid Bearer token with 401", async () => {
        await request(app.getHttpServer())
            .get("/auth/me")
            .set("Authorization", "Bearer not-a-real-token")
            .expect(401);
    });

    it("GET /auth/me accepts a valid Bearer token", async () => {
        const login = await request(app.getHttpServer())
            .post("/auth/login")
            .send({ username: "spike.user", password: "password" })
            .expect(201);

        const response = await request(app.getHttpServer())
            .get("/auth/me")
            .set("Authorization", `Bearer ${login.body.access_token}`)
            .expect(200);

        expect(response.body).toMatchObject({
            sub: "user-1",
            username: "spike.user",
            email: "spike@archaser.test",
            account_id: 42,
        });
    });

    it("OpenAPI document includes health and auth spike paths", async () => {
        const swaggerConfig = new DocumentBuilder()
            .setTitle("Archaser API")
            .setVersion("0.0.1")
            .addBearerAuth()
            .build();
        const document = SwaggerModule.createDocument(app, swaggerConfig);

        expect(document.paths["/health"]).toBeDefined();
        expect(document.paths["/auth/login"]).toBeDefined();
        expect(document.paths["/auth/me"]).toBeDefined();
    });
});
