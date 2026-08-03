import * as path from "path";
import type { PrismaClient } from "@prisma/client";

type BindFn = (client: PrismaClient) => void;

function resolveCreditDomainRoot(): string {
    if (process.env.CREDIT_INSURANCE_DOMAIN_ROOT?.trim()) {
        return path.resolve(process.env.CREDIT_INSURANCE_DOMAIN_ROOT.trim());
    }
    // packages/cron-jobs/dist → ../../../api/dist/credit-insurance
    return path.resolve(__dirname, "../../../api/dist/credit-insurance");
}

function loadCreditDomain<T>(relativeJsPath: string): T {
    const full = path.join(resolveCreditDomainRoot(), relativeJsPath);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(full) as T;
}

export function bindCreditDomain(prisma: PrismaClient): void {
    const mod = loadCreditDomain<{ bindCreditInsurancePrisma: BindFn }>(
        "domain-db.js"
    );
    mod.bindCreditInsurancePrisma(prisma);
}

export function requireCreditDomainModule<T>(relativeJsPath: string): T {
    return loadCreditDomain<T>(relativeJsPath);
}
