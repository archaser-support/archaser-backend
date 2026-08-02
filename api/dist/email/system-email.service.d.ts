import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../database/database.service";
import { LogLevel } from "../logging/mongo-log.types";
import { MongoLogService } from "../logging/mongo-log.service";
export type WelcomeEmailLogContext = {
    accountId?: number;
    userId?: string;
};
type WelcomeContentVariables = {
    product_title: string;
    product_subtitle: string;
    welcome_intro: string;
    feature_1: string;
    feature_2: string;
    feature_3: string;
    feature_4: string;
    feature_5: string;
};
export declare class SystemEmailService {
    private readonly config;
    private readonly db;
    private readonly mongoLog;
    private readonly logger;
    constructor(config: ConfigService, db: DatabaseService, mongoLog: MongoLogService);
    logWelcomeEmailEvent(message: string, level: LogLevel, details: Record<string, unknown>, context?: WelcomeEmailLogContext): void;
    buildWelcomeContentVars(args: {
        hasCollection: boolean;
        hasCreditInsurance: boolean;
        language: string;
    }): WelcomeContentVariables;
    getUserLanguage(email: string): Promise<string>;
    private getWelcomeProductFlags;
    renderReportSharedEmail(args: {
        language?: string;
        userName: string;
        creatorName: string;
        reportName: string;
        reportUrl: string;
        permission: string;
    }): {
        subject: string;
        html: string;
    };
    sendReportSharedEmail(args: {
        toEmail: string;
        language?: string;
        userName: string;
        creatorName: string;
        reportName: string;
        reportUrl: string;
        permission: string;
    }): Promise<{
        messageId: string;
    }>;
    sendResetPasswordEmail(resetLink: string, receiverEmail: string, language?: string): Promise<{
        messageId: string;
    }>;
    sendWelcomeUserEmail(receiverEmail: string, userName: string, resetLink: string, language?: string, hasCollection?: boolean, hasCreditInsurance?: boolean, logContext?: WelcomeEmailLogContext): Promise<{
        messageId: string;
    }>;
    sendHtmlEmail(args: {
        toEmail: string;
        subject: string;
        html: string;
        fromName?: string;
        replyToEmail?: string;
        messageId?: string;
        logContext?: WelcomeEmailLogContext;
    }): Promise<{
        messageId: string;
    }>;
    private getWelcomeEmailDiagnostics;
    private getResetPasswordUrlDiagnostics;
}
export {};
