"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const core_1 = require("@nestjs/core");
const swagger_1 = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const app_module_1 = require("./app.module");
const enrich_strangler_openapi_1 = require("./openapi/enrich-strangler-openapi");
if (process.env.npm_lifecycle_event === "start:dev" ||
    process.env.FORCE_NEST_DEV === "1") {
    process.env.NODE_ENV = "development";
}
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    app.use((0, cookie_parser_1.default)());
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
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
    }));
    const swaggerConfig = new swagger_1.DocumentBuilder()
        .setTitle("Archaser API")
        .setDescription(enrich_strangler_openapi_1.SWAGGER_DESCRIPTION)
        .setVersion("0.4.0")
        .addBearerAuth()
        .build();
    const document = (0, enrich_strangler_openapi_1.enrichStranglerOpenApi)(swagger_1.SwaggerModule.createDocument(app, swaggerConfig));
    swagger_1.SwaggerModule.setup("docs", app, document);
    const port = Number(process.env.NEST_PORT || process.env.PORT || 3002);
    await app.listen(port);
    if (typeof process.send === "function") {
        process.send("ready");
    }
}
bootstrap();
//# sourceMappingURL=main.js.map