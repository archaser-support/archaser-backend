import { DynamicModule, Type } from "@nestjs/common";
export type ArchaserAuthModuleOptions = {
    /** App DatabaseModule (must export DatabaseService). */
    imports: Array<Type<unknown> | DynamicModule>;
    /** Existing DatabaseService class (extends PrismaClient). */
    useExisting: Type<unknown>;
};
/**
 * Shared auth for Nest peels (sms, connectors, reports) and main api.
 * Caller must provide AUTH_DATABASE via useExisting DatabaseService.
 */
export declare class ArchaserAuthModule {
    static forRoot(options: ArchaserAuthModuleOptions): DynamicModule;
}
