import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { CollectionPeriodController } from "./collection-period.controller";
import { CollectionPeriodService } from "./collection-period.service";
import { ContactsController } from "./contacts.controller";
import { ContactsService } from "./contacts.service";

@Module({
    imports: [AuthModule, DatabaseModule],
    controllers: [ContactsController, CollectionPeriodController],
    providers: [ContactsService, CollectionPeriodService],
    exports: [ContactsService, CollectionPeriodService],
})
export class ContactsCollectionPeriodModule {}
