BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_enum e
        JOIN pg_type t ON e.enumtypid = t.oid
        WHERE t.typname = 'internal_email_template_type'
          AND e.enumlabel = 'credit_insurance_alert'
    ) THEN
        ALTER TYPE internal_email_template_type ADD VALUE 'credit_insurance_alert';
    END IF;
END $$;

INSERT INTO "InternalEmailTemplate" (
    created_at,
    modified_at,
    name,
    type,
    subject,
    content,
    active,
    account_id,
    master_template
)
SELECT
    NOW(),
    NOW(),
    'Credit Insurance Alert',
    'credit_insurance_alert'::internal_email_template_type,
    '{{title}}',
    '<p>Hello {{recipient_name}},</p>
<p>{{message}}</p>
<p><strong>Customer:</strong> {{customer_name}}</p>
<p><strong>Invoice:</strong> {{invoice_number}}</p>
<p><a href="{{action_url}}">View credit report</a></p>',
    TRUE,
    10013,
    TRUE
WHERE NOT EXISTS (
    SELECT 1
    FROM "InternalEmailTemplate"
    WHERE type = 'credit_insurance_alert'::internal_email_template_type
      AND master_template = TRUE
);

COMMIT;
