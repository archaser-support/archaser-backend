"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActivitiesModule = void 0;
const common_1 = require("@nestjs/common");
const auth_module_1 = require("../auth/auth.module");
const database_module_1 = require("../database/database.module");
const activities_controller_1 = require("./activities.controller");
const activities_service_1 = require("./activities.service");
const activity_attachments_controller_1 = require("./activity-attachments.controller");
const activity_sequences_controller_1 = require("./activity-sequences.controller");
const internal_email_templates_controller_1 = require("./internal-email-templates.controller");
const internal_email_templates_service_1 = require("./internal-email-templates.service");
const sequence_containers_controller_1 = require("./sequence-containers.controller");
const sequence_containers_service_1 = require("./sequence-containers.service");
let ActivitiesModule = class ActivitiesModule {
};
exports.ActivitiesModule = ActivitiesModule;
exports.ActivitiesModule = ActivitiesModule = __decorate([
    (0, common_1.Module)({
        imports: [auth_module_1.AuthModule, database_module_1.DatabaseModule],
        controllers: [
            activities_controller_1.ActivitiesController,
            activity_sequences_controller_1.ActivitySequencesController,
            sequence_containers_controller_1.SequenceContainersController,
            internal_email_templates_controller_1.InternalEmailTemplatesController,
            activity_attachments_controller_1.ActivityAttachmentsController,
        ],
        providers: [
            activities_service_1.ActivitiesService,
            sequence_containers_service_1.SequenceContainersService,
            internal_email_templates_service_1.InternalEmailTemplatesService,
        ],
        exports: [activities_service_1.ActivitiesService, sequence_containers_service_1.SequenceContainersService],
    })
], ActivitiesModule);
//# sourceMappingURL=activities.module.js.map