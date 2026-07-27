import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { serializeBigInt } from "../common/serialize-bigint";
import { DatabaseService } from "../database/database.service";

const SEQUENCE_INCLUDE = {
    ActivitiesTemplate: {
        select: {
            id: true,
            name: true,
            category: true,
            language: true,
        },
    },
    SequenceContainer: {
        select: {
            id: true,
            account_id: true,
            category: true,
            active: true,
            is_deleted: true,
        },
    },
} as const;

const TEMPLATE_INCLUDE = {
    ActivityTemplateLanguage: true,
    User_ActivitiesTemplate_created_byToUser: true,
    User_ActivitiesTemplate_modified_byToUser: true,
} as const;

@Injectable()
export class ActivitiesService {
    constructor(
        private readonly db: DatabaseService,
        private readonly accessScope: AccessScopeService
    ) {}

    private async accountId(user: JwtPayload): Promise<{
        accountId: number;
        userId: string;
        effectiveUserId: string;
    }> {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        return {
            accountId: this.accessScope.getEffectiveAccountId(userInfo),
            userId: userInfo.userId,
            effectiveUserId: this.accessScope.getEffectiveUserId(userInfo),
        };
    }

    // ── Sequences ──────────────────────────────────────────────

    async listSequences(
        user: JwtPayload,
        query: { account_id?: string; sequence_container_id?: string }
    ) {
        const { accountId } = await this.accountId(user);
        const finalAccountId = query.account_id
            ? parseInt(query.account_id, 10)
            : accountId;
        if (!finalAccountId) {
            throw new BadRequestException({ error: "Customer ID is required" });
        }

        const where: Record<string, unknown> = { account_id: finalAccountId };
        if (query.sequence_container_id) {
            where.sequence_container_id = parseInt(
                query.sequence_container_id,
                10
            );
        }

        const activitiesSequences = await this.db.activitiesSequence.findMany({
            where,
            include: SEQUENCE_INCLUDE,
            orderBy: { step: "asc" },
        });
        return serializeBigInt({ activitiesSequences });
    }

    async getSequence(user: JwtPayload, id: number) {
        await this.accountId(user);
        const sequence = await this.db.activitiesSequence.findUnique({
            where: { id },
            include: SEQUENCE_INCLUDE,
        });
        if (!sequence) {
            throw new NotFoundException({
                error: "Activity sequence not found",
            });
        }
        return serializeBigInt(sequence);
    }

    async createSequence(user: JwtPayload, body: Record<string, unknown>) {
        const { accountId, effectiveUserId } = await this.accountId(user);
        const { id: _id, ...sequenceFields } = body;
        const shouldBeMasterTemplate =
            accountId === 10013 || !!sequenceFields.master_template;

        let step = sequenceFields.step as number | null | undefined;
        if (
            sequenceFields.category === "Automated" &&
            sequenceFields.step_type === "due"
        ) {
            step = null;
        }

        const dataWithDefaults = {
            ...sequenceFields,
            time_of_day: sequenceFields.time_of_day || "09:00",
            account_id: accountId,
            master_template: shouldBeMasterTemplate,
            step: step !== undefined ? step : sequenceFields.step,
            created_by: effectiveUserId,
            modified_by: effectiveUserId,
        };

        const sequence = await this.db.activitiesSequence.create({
            data: dataWithDefaults as never,
        });

        await this.updateLastStepFlag(
            accountId,
            String(sequenceFields.category || ""),
            sequenceFields.sequence_container_id != null
                ? Number(sequenceFields.sequence_container_id)
                : undefined
        );

        return serializeBigInt(sequence);
    }

    async updateSequence(
        user: JwtPayload,
        id: number,
        body: Record<string, unknown>,
        operation?: string
    ) {
        const { effectiveUserId } = await this.accountId(user);

        if (operation === "step") {
            const sequence = await this.db.activitiesSequence.update({
                where: { id },
                data: {
                    step: body.step as number,
                    modified_at: new Date(),
                    modified_by: effectiveUserId,
                } as never,
            });
            return serializeBigInt(sequence);
        }

        if (operation === "updateLastStepFlag") {
            await this.updateLastStepFlag(
                Number(body.account_id),
                String(body.category || ""),
                body.sequence_container_id != null
                    ? Number(body.sequence_container_id)
                    : undefined
            );
            return { success: true };
        }

        // fields / default update
        const {
            active,
            activity_type,
            category,
            days_from_prev_step,
            step_type,
            days_before_due,
            activity_template_id,
            master_template,
            last_category_step,
            time_of_day,
            days_after_start,
            send_to_escalated_contacts,
            send_to_standard_contacts,
            step,
            ...otherFields
        } = body;

        const current = await this.db.activitiesSequence.findUnique({
            where: { id },
            select: {
                id: true,
                category: true,
                account_id: true,
                sequence_container_id: true,
            },
        });
        if (!current) {
            throw new NotFoundException({
                error: "Activity sequence not found",
            });
        }

        const isActive = active === true || active === "true";
        const finalStep = active !== undefined ? (isActive ? step : null) : step;

        const sequence = await this.db.activitiesSequence.update({
            where: { id },
            data: {
                ...(active !== undefined && { active }),
                ...(activity_type !== undefined && { activity_type }),
                ...(category !== undefined && { category }),
                ...(days_from_prev_step !== undefined && {
                    days_from_prev_step,
                }),
                ...(step_type !== undefined && { step_type }),
                ...(days_before_due !== undefined && { days_before_due }),
                ...(activity_template_id !== undefined && {
                    activity_template_id,
                }),
                ...(master_template !== undefined && { master_template }),
                ...(last_category_step !== undefined && {
                    last_category_step,
                }),
                ...(time_of_day !== undefined && { time_of_day }),
                ...(days_after_start !== undefined && { days_after_start }),
                ...(send_to_escalated_contacts !== undefined && {
                    send_to_escalated_contacts,
                }),
                ...(send_to_standard_contacts !== undefined && {
                    send_to_standard_contacts,
                }),
                ...(finalStep !== undefined && { step: finalStep }),
                ...otherFields,
                modified_at: new Date(),
                modified_by: effectiveUserId,
            } as never,
        });

        if (current.category && current.sequence_container_id) {
            await this.updateLastStepFlag(
                current.account_id,
                current.category,
                current.sequence_container_id
            );
        }

        return serializeBigInt(sequence);
    }

    async deleteSequence(_user: JwtPayload, id: number) {
        await this.db.activitiesSequence.delete({ where: { id } });
        return null;
    }

    async updateLastStepFlag(
        accountId: number,
        category: string,
        sequenceContainerId?: number
    ): Promise<void> {
        if (!category) return;

        const resetWhere: Record<string, unknown> = {
            account_id: accountId,
            category,
            last_category_step: true,
        };
        const where: Record<string, unknown> = {
            account_id: accountId,
            category,
            active: true,
        };
        if (sequenceContainerId != null) {
            resetWhere.sequence_container_id = sequenceContainerId;
            where.sequence_container_id = sequenceContainerId;
        }

        await this.db.activitiesSequence.updateMany({
            where: resetWhere,
            data: { last_category_step: false, modified_at: new Date() },
        });

        const activeSequencesRaw =
            await this.db.activitiesSequence.findMany({
                where,
                select: {
                    id: true,
                    step: true,
                    step_type: true,
                    days_before_due: true,
                },
            });

        const activeSequences =
            category === "Automated"
                ? [...activeSequencesRaw].sort((a, b) => {
                      const aIsDue = a.step_type === "due";
                      const bIsDue = b.step_type === "due";
                      if (aIsDue !== bIsDue) return aIsDue ? -1 : 1;
                      if (aIsDue && bIsDue) {
                          return (
                              (b.days_before_due ?? -1) -
                              (a.days_before_due ?? -1)
                          );
                      }
                      return (a.step ?? Infinity) - (b.step ?? Infinity);
                  })
                : [...activeSequencesRaw].sort(
                      (a, b) => (a.step ?? Infinity) - (b.step ?? Infinity)
                  );

        if (category === "Automated") {
            let overdueIndex = 0;
            for (const seq of activeSequences) {
                const isDue = seq.step_type === "due";
                const newStep = isDue ? null : ++overdueIndex;
                if (seq.step !== newStep) {
                    await this.db.activitiesSequence.update({
                        where: { id: seq.id },
                        data: { step: newStep, modified_at: new Date() },
                    });
                }
            }
        } else {
            for (let i = 0; i < activeSequences.length; i++) {
                const newStep = i + 1;
                if (activeSequences[i].step !== newStep) {
                    await this.db.activitiesSequence.update({
                        where: { id: activeSequences[i].id },
                        data: { step: newStep, modified_at: new Date() },
                    });
                }
            }
        }

        if (activeSequences.length > 0) {
            const last = activeSequences[activeSequences.length - 1];
            await this.db.activitiesSequence.update({
                where: { id: last.id },
                data: {
                    last_category_step: true,
                    modified_at: new Date(),
                },
            });
        }
    }

    // ── Templates ──────────────────────────────────────────────

    async listTemplates(
        user: JwtPayload,
        query: Record<string, string | undefined>
    ) {
        const { accountId } = await this.accountId(user);
        const {
            query: search = "",
            page = "1",
            rowsPerPage = "10",
            category: categoryParam = "",
            active = "",
            sortField = "name",
            sortDirection = "asc",
        } = query;

        const where: Record<string, unknown> = { account_id: accountId };
        if (search) {
            where.OR = [
                { name: { contains: search, mode: "insensitive" } },
            ];
        }
        if (categoryParam) {
            const categoryMap: Record<string, string> = {
                Automated: "Automated",
                PromiseToPay: "Promise_to_pay",
                Promise_to_pay: "Promise_to_pay",
                Dispute: "Dispute",
                Agent: "Agent",
                Legal: "Legal",
            };
            const enumValue = categoryMap[categoryParam];
            if (enumValue) {
                where.category = { equals: enumValue };
            }
        }
        if (active !== "") {
            where.active = active === "true";
        }

        const take =
            Number(rowsPerPage) >= 1000 ? undefined : Number(rowsPerPage);
        const skip = take ? (Number(page) - 1) * Number(rowsPerPage) : 0;
        const allowed = [
            "name",
            "modified_at",
            "created_at",
            "modified_by",
            "created_by",
        ] as const;
        const sortFieldSafe = allowed.includes(
            sortField as (typeof allowed)[number]
        )
            ? sortField
            : "name";
        const sortDir =
            String(sortDirection).toLowerCase() === "desc" ? "desc" : "asc";
        let orderBy: Record<string, unknown> = { [sortFieldSafe]: sortDir };
        if (sortFieldSafe === "modified_by") {
            orderBy = {
                User_ActivitiesTemplate_modified_byToUser: { name: sortDir },
            };
        } else if (sortFieldSafe === "created_by") {
            orderBy = {
                User_ActivitiesTemplate_created_byToUser: { name: sortDir },
            };
        }

        const [templates, totalRecords] = await Promise.all([
            this.db.activitiesTemplate.findMany({
                where,
                skip,
                take,
                orderBy: orderBy as never,
                include: TEMPLATE_INCLUDE,
            }),
            this.db.activitiesTemplate.count({ where }),
        ]);

        return serializeBigInt({ templates, totalRecords });
    }

    async getTemplate(user: JwtPayload, id: number, operation?: string) {
        const { accountId } = await this.accountId(user);

        if (operation === "check-usage") {
            const usageCount = await this.db.activitiesSequence.count({
                where: {
                    activity_template_id: id,
                    account_id: accountId,
                },
            });
            return {
                isInUse: usageCount > 0,
                activeSequencesCount: usageCount,
            };
        }

        const template = await this.db.activitiesTemplate.findUnique({
            where: { id },
            include: TEMPLATE_INCLUDE,
        });
        if (!template) {
            throw new NotFoundException({ error: "Template not found" });
        }
        return serializeBigInt(template);
    }

    async createTemplate(user: JwtPayload, body: Record<string, unknown>) {
        const { accountId, effectiveUserId } = await this.accountId(user);
        const {
            languageTemplates,
            id: _id,
            sms_content: _sms,
            email_content: _email,
            whatsapp_content: _wa,
            email_subject: _subj,
            ...templateFields
        } = body;

        const shouldBeMasterTemplate =
            accountId === 10013 || !!templateFields.master_template;
        const auditUserId = effectiveUserId
            ? String(effectiveUserId)
            : undefined;

        const template = await this.db.$transaction(async (tx) => {
            const created = await tx.activitiesTemplate.create({
                data: {
                    ...templateFields,
                    account_id: accountId,
                    master_template: shouldBeMasterTemplate,
                    created_by: auditUserId,
                    modified_by: auditUserId,
                } as never,
            });

            if (Array.isArray(languageTemplates) && languageTemplates.length) {
                await tx.activityTemplateLanguage.createMany({
                    data: (
                        languageTemplates as Record<string, unknown>[]
                    ).map((lt) => ({
                        template_id: created.id,
                        language: lt.language as never,
                        sms_content: lt.sms_content as string | null,
                        whatsapp_content: lt.whatsapp_content as string | null,
                        email_subject: lt.email_subject as string | null,
                        email_content: lt.email_content as string | null,
                        created_by: auditUserId,
                        modified_by: auditUserId,
                    })),
                });
            }
            return created;
        });

        const createdTemplate = await this.db.activitiesTemplate.findUnique({
            where: { id: template.id },
            include: TEMPLATE_INCLUDE,
        });
        return serializeBigInt(createdTemplate);
    }

    async updateTemplate(
        user: JwtPayload,
        id: number,
        body: Record<string, unknown>,
        operation?: string
    ) {
        const { accountId, effectiveUserId } = await this.accountId(user);

        if (operation === "toggle") {
            const template = await this.db.activitiesTemplate.update({
                where: { id },
                data: {
                    active: body.active as boolean,
                    modified_at: new Date(),
                    modified_by: effectiveUserId,
                },
            });
            return serializeBigInt(template);
        }

        const {
            languageTemplates,
            id: _tid,
            sms_content: _sms,
            email_content: _email,
            whatsapp_content: _wa,
            email_subject: _subj,
            ...templateFields
        } = body;

        if (templateFields.dispute_resolution === "") {
            templateFields.dispute_resolution = null;
        }
        if (templateFields.category === "") {
            templateFields.category = null;
        }
        if (templateFields.language === "") {
            templateFields.language = null;
        }

        const shouldBeMasterTemplate =
            accountId === 10013 || !!templateFields.master_template;
        const auditUserId = effectiveUserId
            ? String(effectiveUserId)
            : undefined;
        const modifiedAt = new Date();

        await this.db.$transaction(async (tx) => {
            await tx.activitiesTemplate.update({
                where: { id },
                data: {
                    ...templateFields,
                    master_template: shouldBeMasterTemplate,
                    modified_at: modifiedAt,
                    modified_by: effectiveUserId,
                } as never,
            });

            if (Array.isArray(languageTemplates) && languageTemplates.length) {
                await tx.activityTemplateLanguage.deleteMany({
                    where: { template_id: id },
                });
                await tx.activityTemplateLanguage.createMany({
                    data: (
                        languageTemplates as Record<string, unknown>[]
                    ).map((lt) => ({
                        template_id: id,
                        language: lt.language as never,
                        sms_content: lt.sms_content as string | null,
                        whatsapp_content: lt.whatsapp_content as string | null,
                        email_subject: lt.email_subject as string | null,
                        email_content: lt.email_content as string | null,
                        created_by: auditUserId,
                        modified_by: auditUserId,
                    })),
                });
            } else {
                await tx.activityTemplateLanguage.updateMany({
                    where: { template_id: id },
                    data: {
                        modified_by: auditUserId,
                        modified_at: modifiedAt,
                    },
                });
            }
        });

        const updated = await this.db.activitiesTemplate.findUnique({
            where: { id },
            include: TEMPLATE_INCLUDE,
        });
        return serializeBigInt(updated);
    }

    async deleteTemplate(_user: JwtPayload, id: number) {
        await this.db.activityTemplateLanguage.deleteMany({
            where: { template_id: id },
        });
        await this.db.activitiesTemplate.delete({ where: { id } });
        return null;
    }

    // ── Attachments ────────────────────────────────────────────

    async listAttachments(user: JwtPayload, activityId: string) {
        const { accountId } = await this.accountId(user);
        if (!activityId) {
            throw new BadRequestException({
                error: "Activity ID is required",
            });
        }
        const attachments = await this.db.activityAttachment.findMany({
            where: {
                activity_id: BigInt(activityId),
                account_id: accountId,
            },
            include: {
                Activity: { select: { account_id: true } },
            },
            orderBy: { created_at: "desc" },
        });
        return serializeBigInt(attachments);
    }

    async deleteAttachment(user: JwtPayload, id: string) {
        const { accountId } = await this.accountId(user);
        const attachment = await this.db.activityAttachment.findFirst({
            where: { id: BigInt(id), account_id: accountId },
        });
        if (!attachment) {
            throw new NotFoundException({ error: "Attachment not found" });
        }
        await this.db.activityAttachment.delete({
            where: { id: BigInt(id) },
        });
        return { success: true };
    }

    async getAttachmentDownload(user: JwtPayload, id: string) {
        const { accountId } = await this.accountId(user);
        const attachment = await this.db.activityAttachment.findFirst({
            where: { id: BigInt(id), account_id: accountId },
            include: { Activity: { select: { account_id: true } } },
        });
        if (!attachment) {
            throw new NotFoundException({ error: "Attachment not found" });
        }
        const signed = await this.getPresignedUrl({
            filePath: attachment.file_path,
            expiresIn: 3600,
        });
        return {
            attachment: serializeBigInt(attachment),
            redirectUrl: signed.url,
        };
    }

    async uploadAttachments(
        user: JwtPayload,
        activityId: string,
        files: Array<{
            originalname: string;
            mimetype: string;
            size: number;
            buffer?: Buffer;
            path?: string;
        }>
    ) {
        const { accountId, effectiveUserId } = await this.accountId(user);
        if (!activityId) {
            throw new BadRequestException({
                error: "Activity ID is required",
            });
        }
        if (!files.length) {
            throw new BadRequestException({ error: "No files uploaded" });
        }

        const activity = await this.db.activity.findFirst({
            where: { id: BigInt(activityId), account_id: accountId },
            select: { id: true },
        });
        if (!activity) {
            throw new NotFoundException({ error: "Activity not found" });
        }

        const created = [];
        for (const file of files) {
            const safeName = file.originalname.replace(/[^\w.\-]+/g, "_");
            const filePath = `activity-attachments/${accountId}/${activityId}/${Date.now()}-${safeName}`;
            const isImage = (file.mimetype || "").startsWith("image/");
            const isAudio = (file.mimetype || "").startsWith("audio/");
            const row = await this.db.activityAttachment.create({
                data: {
                    activity_id: BigInt(activityId),
                    account_id: accountId,
                    file_name: safeName,
                    file_path: filePath,
                    file_size: file.size || 0,
                    file_type: file.mimetype || "application/octet-stream",
                    file_category: isImage
                        ? "Image"
                        : isAudio
                          ? "Audio"
                          : "Text",
                    uploaded_by: effectiveUserId,
                    created_by: effectiveUserId,
                    modified_by: effectiveUserId,
                },
            });
            created.push(row);
        }
        return serializeBigInt({
            success: true,
            attachments: created,
            count: created.length,
        });
    }

    /**
     * Presigned URL: real S3 signed URL when AWS env is present; otherwise a stub path URL.
     */
    async getPresignedUrl(body: {
        filePath?: string;
        expiresIn?: number;
    }): Promise<{ url: string }> {
        const filePath = body.filePath;
        if (!filePath || typeof filePath !== "string") {
            throw new BadRequestException({
                error: "Invalid request",
                errors: ["filePath is required"],
            });
        }
        if (!/^[a-zA-Z0-9/\-_.]+$/.test(filePath)) {
            throw new BadRequestException({
                error: "Invalid request",
                errors: ["filePath has invalid characters"],
            });
        }

        const expiresIn = Math.min(
            Math.max(Number(body.expiresIn) || 3600, 60),
            86400
        );

        const bucket =
            process.env.NEXT_APP_AWS_S3_BUCKET_NAME ||
            process.env.AWS_S3_BUCKET ||
            process.env.S3_BUCKET;
        const region =
            process.env.AWS_REGION || process.env.S3_REGION || "us-east-1";
        const accessKeyId =
            process.env.NEXT_APP_AWS_ACCESS_KEY_ID ||
            process.env.AWS_ACCESS_KEY_ID;
        const secretAccessKey =
            process.env.NEXT_APP_AWS_SECRET_ACCESS_KEY ||
            process.env.AWS_SECRET_ACCESS_KEY;

        if (bucket && accessKeyId && secretAccessKey) {
            try {
                const { S3Client, GetObjectCommand } = await import(
                    "@aws-sdk/client-s3"
                );
                const { getSignedUrl } = await import(
                    "@aws-sdk/s3-request-presigner"
                );
                const client = new S3Client({
                    region,
                    credentials: { accessKeyId, secretAccessKey },
                });
                const key = filePath
                    .replace(/^s3:\/\//, "")
                    .replace(/^\/+/, "");
                const command = new GetObjectCommand({
                    Bucket: bucket,
                    Key: key,
                });
                const url = await getSignedUrl(client, command, { expiresIn });
                return { url };
            } catch {
                // Fall through to stub when SDK unavailable or signing fails
            }
        }

        // Stub when S3 credentials are not configured (do not invent secrets)
        const base =
            process.env.NEXT_PUBLIC_BASE_URL ||
            process.env.NEXTAUTH_URL ||
            "http://localhost:3000";
        return {
            url: `${base.replace(/\/$/, "")}/api/activities/attachments/stub-download?path=${encodeURIComponent(filePath)}&expiresIn=${expiresIn}`,
        };
    }
}
