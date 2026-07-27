import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { AccountService } from "@/server/services/AccountService";
import { BusinessUnitService } from "@/server/services/BusinessUnitService";
import { InsurancePolicyService } from "@/server/services/InsurancePolicyService";
import { PermissionService } from "@/server/services/PermissionService";
import { createUser, getSystemUserId } from "@/server/services/UserService";

import {
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    PRIMARY_BUSINESS_UNIT_NAME,
    PRIMARY_DCL_CUSTOMER_SINCE_MONTHS,
    PRIMARY_MAX_DCL_ILS,
    PRIMARY_MAX_TOTAL_COVER_ILS,
    PRIMARY_MAX_TOTAL_DCL_SDL_COVER_ILS,
    PRIMARY_MIN_CREDIT_SCORE,
    PRIMARY_POLICY_NUMBER,
    PRIMARY_SCORE_VALIDITY_MONTHS,
    SAMPLE_ACCOUNT_COMPANY_NUMBER,
    SAMPLE_ACCOUNT_NAME,
    SAMPLE_ACCOUNT_SUBDOMAIN,
    SECONDARY_BUSINESS_UNIT_NAME,
    TOPUP_MAX_TOTAL_COVER_ILS,
    TOPUP_POLICY_NUMBER,
} from "./constants";
import type { AccountBootstrapResult, HistoryWindow } from "./types";

function primaryPolicyBootstrapFields(window: HistoryWindow) {
    return {
        start_date: window.policyStart,
        end_date: window.policyEnd,
        currency: "ILS",
        policy_kind: "Primary" as const,
        status: "Active" as const,
        insurer_name: "Credit Reporting Dev Insurer",
        max_total_cover: PRIMARY_MAX_TOTAL_COVER_ILS,
        max_total_dcl_sdl_cover: PRIMARY_MAX_TOTAL_DCL_SDL_COVER_ILS,
        min_credit_score: PRIMARY_MIN_CREDIT_SCORE,
        score_validity_period_months: PRIMARY_SCORE_VALIDITY_MONTHS,
        max_dcl: PRIMARY_MAX_DCL_ILS,
        dcl_customer_since_months: PRIMARY_DCL_CUSTOMER_SINCE_MONTHS,
    };
}

export async function applyPrimaryPolicyBootstrapFields(
    primaryPolicyId: number,
    window: HistoryWindow,
    accountId: number
): Promise<void> {
    const actorUserId = getSystemUserId(accountId);
    await prisma.insurancePolicy.update({
        where: { id: primaryPolicyId },
        data: {
            ...primaryPolicyBootstrapFields(window),
            modified_by: actorUserId,
        },
    });
}

async function getMasterAdminUserId(): Promise<string | undefined> {
    const adminUser = await prisma.user.findFirst({
        where: {
            account_id: 10013,
            role: "archaser_admin",
            status: "Active",
        },
        select: { id: true },
    });
    return adminUser?.id;
}

async function ensureAccountShell(
    window: HistoryWindow,
    actorUserId: string
): Promise<{ accountId: number; createdAccount: boolean }> {
    const existing = await prisma.account.findFirst({
        where: {
            sub_domain: SAMPLE_ACCOUNT_SUBDOMAIN,
            deleted_at: null,
        },
        select: { id: true },
    });

    if (existing) {
        await prisma.account.update({
            where: { id: existing.id },
            data: {
                name: SAMPLE_ACCOUNT_NAME,
                currency: "ILS",
                has_credit_insurance: true,
                has_collection: false,
                balance_evaluation_method: "Payment-Based",
                modified_by: actorUserId,
            },
        });
        return { accountId: existing.id, createdAccount: false };
    }

    const masterAdminUserId = await getMasterAdminUserId();
    const account = await AccountService.createCustomer(
        {
            name: SAMPLE_ACCOUNT_NAME,
            company_number: SAMPLE_ACCOUNT_COMPANY_NUMBER,
            status: "Active",
            promise_to_pay: 14,
            sub_domain: SAMPLE_ACCOUNT_SUBDOMAIN,
            client_type: "All",
            default_language: "English",
            locale: "en-US",
            currency: "ILS",
            has_credit_insurance: true,
            has_collection: false,
            balance_evaluation_method: "Payment-Based",
        } as Prisma.AccountCreateInput,
        masterAdminUserId
    );

    return { accountId: account.id, createdAccount: true };
}

async function ensureRolePermissions(
    accountId: number,
    actorUserId: string
): Promise<void> {
    const permissionService = PermissionService.getInstance();
    await permissionService.cloneRolePermissions(10013, accountId, actorUserId, {
        hasCollection: false,
        hasCreditInsurance: true,
    });
    await permissionService.ensureCreditInsuranceDashboardPermissions(
        accountId,
        actorUserId
    );
}

async function ensureBusinessUnits(
    accountId: number,
    actorUserId: string
): Promise<number[]> {
    const businessUnits = await BusinessUnitService.getBusinessUnitsByAccount(
        accountId
    );

    let primaryBu = businessUnits.find((bu) => bu.is_primary);
    if (!primaryBu) {
        primaryBu = await BusinessUnitService.createPrimaryBusinessUnit(
            accountId,
            actorUserId,
            PRIMARY_BUSINESS_UNIT_NAME
        );
    } else if (primaryBu.name !== PRIMARY_BUSINESS_UNIT_NAME) {
        await prisma.businessUnit.update({
            where: { id: primaryBu.id },
            data: {
                name: PRIMARY_BUSINESS_UNIT_NAME,
                modified_by: actorUserId,
            },
        });
    }

    let secondaryBu = businessUnits.find(
        (bu) => !bu.is_primary && bu.name === SECONDARY_BUSINESS_UNIT_NAME
    );
    if (!secondaryBu) {
        secondaryBu = await BusinessUnitService.createBusinessUnit(
            {
                name: SECONDARY_BUSINESS_UNIT_NAME,
                account_id: accountId,
                parent_id: primaryBu.id,
                status: "Active",
            },
            actorUserId
        );
    }

    return [primaryBu.id, secondaryBu.id];
}

async function ensureInsurancePolicies(
    accountId: number,
    window: HistoryWindow,
    actorUserId: string
): Promise<{ primaryPolicyId: number; topUpPolicyId: number }> {
    let primaryPolicy = await prisma.insurancePolicy.findFirst({
        where: {
            account_id: accountId,
            policy_number: PRIMARY_POLICY_NUMBER,
        },
        select: { id: true },
    });

    if (!primaryPolicy) {
        const created = await InsurancePolicyService.createPolicy(
            {
                policy_number: PRIMARY_POLICY_NUMBER,
                ...primaryPolicyBootstrapFields(window),
            },
            accountId,
            actorUserId
        );
        primaryPolicy = { id: created.id };
    } else {
        await applyPrimaryPolicyBootstrapFields(
            primaryPolicy.id,
            window,
            accountId
        );
    }

    let topUpPolicy = await prisma.insurancePolicy.findFirst({
        where: {
            account_id: accountId,
            policy_number: TOPUP_POLICY_NUMBER,
        },
        select: { id: true },
    });

    if (!topUpPolicy) {
        const created = await InsurancePolicyService.createPolicy(
            {
                policy_number: TOPUP_POLICY_NUMBER,
                start_date: window.policyStart,
                end_date: window.policyEnd,
                currency: "ILS",
                policy_kind: "TopUp",
                parent_insurance_policy_id: primaryPolicy.id,
                allow_concurrent_top_ups: true,
                max_total_cover: TOPUP_MAX_TOTAL_COVER_ILS,
                status: "Active",
                insurer_name: "Credit Reporting Dev TopUp",
            },
            accountId,
            actorUserId
        );
        topUpPolicy = { id: created.id };
    } else {
        await prisma.insurancePolicy.update({
            where: { id: topUpPolicy.id },
            data: {
                start_date: window.policyStart,
                end_date: window.policyEnd,
                currency: "ILS",
                policy_kind: "TopUp",
                parent_insurance_policy_id: primaryPolicy.id,
                allow_concurrent_top_ups: true,
                max_total_cover: TOPUP_MAX_TOTAL_COVER_ILS,
                status: "Active",
                modified_by: actorUserId,
            },
        });
    }

    return {
        primaryPolicyId: primaryPolicy.id,
        topUpPolicyId: topUpPolicy.id,
    };
}

async function ensureAdminUser(
    accountId: number,
    businessUnitId: number | null,
    actorUserId: string
): Promise<boolean> {
    const existing = await prisma.user.findFirst({
        where: {
            account_id: accountId,
            email: ADMIN_EMAIL,
            deactivated_at: null,
        },
        select: { id: true },
    });

    if (existing) {
        const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);
        await prisma.user.update({
            where: { id: existing.id },
            data: {
                password: hashedPassword,
                status: "Active",
                role: "Account_Manager",
                modified_by: actorUserId,
            },
        });
        return false;
    }

    const user = await createUser({
        email: ADMIN_EMAIL,
        first_name: "Credit",
        last_name: "Reporting",
        role: "Account_Manager",
        status: "Active",
        account_id: accountId,
        language: "English",
        locale: "en-US",
        time_zone: "Asia/Jerusalem",
        business_unit_id: businessUnitId,
        created_by: actorUserId,
        modified_by: actorUserId,
    });

    const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);
    await prisma.user.update({
        where: { id: user.id },
        data: { password: hashedPassword },
    });

    return true;
}

export async function bootstrapAccountShell(
    window: HistoryWindow
): Promise<AccountBootstrapResult> {
    const provisionalActor = (await getMasterAdminUserId()) || "system";
    const { accountId, createdAccount } = await ensureAccountShell(
        window,
        provisionalActor
    );
    const actorUserId = getSystemUserId(accountId);

    await ensureRolePermissions(accountId, actorUserId);

    const businessUnitIds = await ensureBusinessUnits(accountId, actorUserId);
    const { primaryPolicyId, topUpPolicyId } = await ensureInsurancePolicies(
        accountId,
        window,
        actorUserId
    );
    const createdAdminUser = await ensureAdminUser(
        accountId,
        businessUnitIds[0] ?? null,
        actorUserId
    );

    return {
        accountId,
        subdomain: SAMPLE_ACCOUNT_SUBDOMAIN,
        createdAccount,
        createdAdminUser,
        adminEmail: ADMIN_EMAIL,
        adminPassword: ADMIN_PASSWORD,
        primaryPolicyId,
        topUpPolicyId,
        businessUnitIds,
    };
}

export function printBootstrapSummary(result: AccountBootstrapResult): void {
    console.log("Account shell ready:");
    console.log(`  accountId: ${result.accountId}`);
    console.log(`  subdomain: ${result.subdomain}`);
    console.log(
        `  account: ${result.createdAccount ? "created" : "reused (updated flags)"}`
    );
    console.log(`  primary policy id: ${result.primaryPolicyId}`);
    console.log(`  top-up policy id: ${result.topUpPolicyId}`);
    console.log(`  business units: ${result.businessUnitIds.join(", ")}`);
    console.log(
        `  admin user: ${result.createdAdminUser ? "created" : "reused"} (${result.adminEmail})`
    );
    console.log(`  admin password: ${result.adminPassword}`);
}
