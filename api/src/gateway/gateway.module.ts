import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { InternalServiceClient } from "../auth/internal-service.client";

/**
 * Internal S2S client only — browser peel proxies removed (D50).
 * Client implementation lives in @archaser/auth.
 */
@Module({
    imports: [AuthModule],
    providers: [InternalServiceClient],
    exports: [InternalServiceClient],
})
export class GatewayModule {}
