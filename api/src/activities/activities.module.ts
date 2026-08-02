import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { EmailModule } from "../email/email.module";
import { ActivitiesController } from "./activities.controller";
import { ActivitiesService } from "./activities.service";
import { ActivityAttachmentsController } from "./activity-attachments.controller";
import { ActivitySequencesController } from "./activity-sequences.controller";
import { InternalEmailTemplatesController } from "./internal-email-templates.controller";
import { InternalEmailTemplatesService } from "./internal-email-templates.service";
import { SequenceContainersController } from "./sequence-containers.controller";
import { SequenceContainersService } from "./sequence-containers.service";

@Module({
    imports: [AuthModule, DatabaseModule, EmailModule],
    controllers: [
        ActivitiesController,
        ActivitySequencesController,
        SequenceContainersController,
        InternalEmailTemplatesController,
        ActivityAttachmentsController,
    ],
    providers: [
        ActivitiesService,
        SequenceContainersService,
        InternalEmailTemplatesService,
    ],
    exports: [ActivitiesService, SequenceContainersService],
})
export class ActivitiesModule {}
