import { ConsoleLogger } from "@nestjs/common";

/** Nest contexts that spam route/module maps and boot banners on every start. */
const QUIET_BOOTSTRAP_CONTEXTS = new Set([
    "InstanceLoader",
    "RoutesResolver",
    "RouterExplorer",
    "NestFactory",
    "NestApplication",
]);

/**
 * Default Nest logger minus bootstrap noise (module maps, route maps, boot banners).
 * Keeps application `Logger.log` output (sync progress, etc.).
 */
export class QuietNestLogger extends ConsoleLogger {
    override log(message: unknown, context?: string): void {
        if (
            typeof context === "string" &&
            QUIET_BOOTSTRAP_CONTEXTS.has(context)
        ) {
            return;
        }
        super.log(message, context as string);
    }
}
