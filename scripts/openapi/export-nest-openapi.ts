/**
 * Exports Nest OpenAPI JSON for web client codegen.
 * Usage: npm run openapi:export
 *
 * Requires a prior Nest build (script runs build -w @archaser/api).
 * Output: api/openapi.json
 */
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
// Use compiled Nest output so tsx does not re-transpile decorators.
import { AppModule } from "../../api/dist/app.module";
import {
    enrichStranglerOpenApi,
    SWAGGER_DESCRIPTION,
} from "../../api/dist/openapi/enrich-strangler-openapi";

async function main() {
    process.env.JWT_SECRET =
        process.env.JWT_SECRET || "openapi-export-dev-secret";
    const app = await NestFactory.create(AppModule, { logger: false });
    const config = new DocumentBuilder()
        .setTitle("Archaser API")
        .setDescription(SWAGGER_DESCRIPTION)
        .setVersion("0.4.0")
        .addBearerAuth()
        .build();
    const document = enrichStranglerOpenApi(
        SwaggerModule.createDocument(app, config)
    );
    const outDir = join(__dirname, "../../api");
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, "openapi.json");
    writeFileSync(outPath, JSON.stringify(document, null, 2));
    // eslint-disable-next-line no-console
    console.log(`Wrote ${outPath} (${Object.keys(document.paths || {}).length} paths)`);
    await app.close();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
