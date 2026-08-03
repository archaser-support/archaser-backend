import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient, resolveDatabaseUrl } from "@archaser/database";

@Injectable()
export class DatabaseService extends PrismaClient implements OnModuleDestroy {
    constructor() {
        super({
            log: ["error"],
            errorFormat: "pretty",
            datasources: {
                db: {
                    url: resolveDatabaseUrl({
                        module: "connectors",
                        applicationName: "archaser-connectors",
                        connectionLimit: Number(
                            process.env.CONNECTION_LIMIT_CONNECTORS || 5
                        ),
                    }),
                },
            },
        });
    }

    async onModuleDestroy() {
        await this.$disconnect();
    }
}
