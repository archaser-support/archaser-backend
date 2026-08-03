import { ArchaserAuthModule } from "@archaser/auth";
import { Module } from "@nestjs/common";
import { PassportModule } from "@nestjs/passport";
import { DatabaseModule } from "../database/database.module";
import { DatabaseService } from "../database/database.service";
import { EmailModule } from "../email/email.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AzureAdStrategy } from "./azure-ad.strategy";
import { GoogleStrategy } from "./google.strategy";
import { JwtStrategy } from "./jwt.strategy";

@Module({
    imports: [
        DatabaseModule,
        EmailModule,
        PassportModule.register({ defaultStrategy: "jwt" }),
        ArchaserAuthModule.forRoot({
            imports: [DatabaseModule],
            useExisting: DatabaseService,
        }),
    ],
    controllers: [AuthController],
    providers: [
        AuthService,
        JwtStrategy,
        GoogleStrategy,
        AzureAdStrategy,
    ],
    exports: [AuthService, ArchaserAuthModule, EmailModule],
})
export class AuthModule {}
