import { ArchaserAuthModule } from "@archaser/auth";
import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { DatabaseService } from "../database/database.service";

@Module({
    imports: [
        ArchaserAuthModule.forRoot({
            imports: [DatabaseModule],
            useExisting: DatabaseService,
        }),
    ],
    exports: [ArchaserAuthModule],
})
export class AuthModule {}
