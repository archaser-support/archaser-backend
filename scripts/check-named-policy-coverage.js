require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const ACCOUNT_ID = Number(process.argv[2] || 10149);

async function main() {
  const byLimitType = await prisma.$queryRaw`
    SELECT ip.id AS policy_id, ip.policy_number, cp.limit_type::text AS limit_type, COUNT(*)::int AS customers
    FROM "CustomerPolicy" cp
    JOIN "Customer" c ON c.id = cp.customer_id
    JOIN "InsurancePolicy" ip ON ip.id = cp.insurance_policy_id
    WHERE c.account_id = ${ACCOUNT_ID} AND cp.is_active = true
    GROUP BY 1, 2, 3 ORDER BY 1, 3
  `;

  const namedRows = await prisma.$queryRaw`
    SELECT np.insurance_policy_id AS policy_id, COUNT(*)::int AS named_rows
    FROM "NamedPolicy" np
    JOIN "InsurancePolicy" ip ON ip.id = np.insurance_policy_id
    WHERE ip.account_id = ${ACCOUNT_ID}
    GROUP BY 1 ORDER BY 1
  `;

  const [match] = await prisma.$queryRaw`
    SELECT
      COUNT(*)::int AS named_assignments,
      COUNT(*) FILTER (WHERE np.id IS NOT NULL)::int AS has_matching_named_row,
      COUNT(*) FILTER (WHERE np.id IS NULL)::int AS missing_named_row
    FROM "CustomerPolicy" cp
    JOIN "Customer" c ON c.id = cp.customer_id
    LEFT JOIN "NamedPolicy" np
      ON np.insurance_policy_id = cp.insurance_policy_id
     AND lower(trim(np.customer_number)) = lower(trim(COALESCE(NULLIF(cp.customer_number_policy, ''), c.customer_number)))
    WHERE c.account_id = ${ACCOUNT_ID} AND cp.is_active = true AND cp.limit_type::text = 'Named'
  `;

  console.log('[named-policy-coverage] by limit type:', byLimitType);
  console.log('[named-policy-coverage] named master rows per policy:', namedRows);
  console.log('[named-policy-coverage] named assignments vs master:', { accountId: ACCOUNT_ID, ...match });
}

main()
  .catch((e) => {
    console.error('[named-policy-coverage] failed:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
