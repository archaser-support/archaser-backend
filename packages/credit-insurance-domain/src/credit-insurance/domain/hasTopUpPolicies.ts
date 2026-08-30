import { prisma } from "../domain-db";

export async function hasTopUpPolicies(accountId: number): Promise<boolean> {
    const count = await prisma.insurancePolicy.count({
        where: { account_id: accountId, policy_kind: "TopUp" },
        take: 1,
    });
    return count > 0;
}
