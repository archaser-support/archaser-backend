import { OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@archaser/database";
export declare class DatabaseService extends PrismaClient implements OnModuleDestroy {
    constructor();
    onModuleDestroy(): Promise<void>;
}
