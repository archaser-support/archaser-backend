import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import {
    enrichStranglerOpenApi,
    SWAGGER_DESCRIPTION,
} from "./openapi/enrich-strangler-openapi";

// Local `npm run start:dev` / `dev:api`: force development so shared Next libs
// (e.g. MongoLogService) skip Atlas logging. Root .env may set NODE_ENV=production.
if (
    process.env.npm_lifecycle_event === "start:dev" ||
    process.env.FORCE_NEST_DEV === "1"
) {
    (process.env as { NODE_ENV?: string }).NODE_ENV = "development";
}

async function bootstrap() {
    const app = await NestFactory.create(AppModule);

    app.use(cookieParser());

    const corsOrigins = [
        process.env.NEXT_PUBLIC_BASE_URL,
        process.env.NEST_CORS_ORIGINS,
    ]
        .filter(Boolean)
        .flatMap((value) => String(value).split(","))
        .map((origin) => origin.trim())
        .filter(Boolean);

    app.enableCors({
        origin: corsOrigins.length > 0 ? corsOrigins : true,
        credentials: true,
        allowedHeaders: ["Authorization", "Content-Type", "Cookie"],
    });

    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
        })
    );

    const swaggerConfig = new DocumentBuilder()
        .setTitle("Archaser API")
        .setDescription(SWAGGER_DESCRIPTION)
        .setVersion("0.4.0")
        .addBearerAuth()
        .build();

    const document = enrichStranglerOpenApi(
        SwaggerModule.createDocument(app, swaggerConfig)
    );
    SwaggerModule.setup("docs", app, document);

    const port = Number(process.env.NEST_PORT || process.env.PORT || 3002);
    await app.listen(port);

    // PM2 wait_ready compatibility when Nest runs under ecosystem config
    if (typeof process.send === "function") {
        process.send("ready");
    }
}

bootstrap();
