BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_rule_product') THEN
        CREATE TYPE notification_rule_product AS ENUM ('credit_insurance', 'collection');
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_rule_trigger_type') THEN
        CREATE TYPE notification_rule_trigger_type AS ENUM (
            'overdue_block',
            'capacity_gap',
            'entry_terms_breach',
            'action_window',
            'limit_warnings'
        );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_delivery_channel') THEN
        CREATE TYPE notification_delivery_channel AS ENUM ('in_app', 'email');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "NotificationRuleSet" (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES "Account"(id) ON DELETE CASCADE,
    product notification_rule_product NOT NULL,
    trigger_type notification_rule_trigger_type NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    modified_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    created_by VARCHAR(255),
    modified_by VARCHAR(255),
    CONSTRAINT ux_notification_rule_set_account_product_trigger
        UNIQUE (account_id, product, trigger_type)
);

CREATE INDEX IF NOT EXISTS idx_notification_rule_set_account_product
ON "NotificationRuleSet" (account_id, product);

CREATE TABLE IF NOT EXISTS "NotificationRule" (
    id SERIAL PRIMARY KEY,
    rule_set_id INTEGER NOT NULL REFERENCES "NotificationRuleSet"(id) ON DELETE CASCADE,
    advance_day_offsets INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
    metadata JSONB,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    modified_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    created_by VARCHAR(255),
    modified_by VARCHAR(255),
    CONSTRAINT ux_notification_rule_rule_set UNIQUE (rule_set_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_rule_rule_set
ON "NotificationRule" (rule_set_id);

CREATE TABLE IF NOT EXISTS "NotificationRuleRoleDefault" (
    id SERIAL PRIMARY KEY,
    rule_id INTEGER NOT NULL REFERENCES "NotificationRule"(id) ON DELETE CASCADE,
    role user_role NOT NULL,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    modified_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    created_by VARCHAR(255),
    modified_by VARCHAR(255),
    CONSTRAINT ux_notification_rule_role_default_rule_role UNIQUE (rule_id, role)
);

CREATE INDEX IF NOT EXISTS idx_notification_rule_role_default_rule
ON "NotificationRuleRoleDefault" (rule_id);

CREATE TABLE IF NOT EXISTS "NotificationRuleUserOverride" (
    id SERIAL PRIMARY KEY,
    rule_id INTEGER NOT NULL REFERENCES "NotificationRule"(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    modified_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    created_by VARCHAR(255),
    modified_by VARCHAR(255),
    CONSTRAINT ux_notification_rule_user_override_rule_user UNIQUE (rule_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_rule_user_override_rule_active
ON "NotificationRuleUserOverride" (rule_id, active);

CREATE TABLE IF NOT EXISTS "NotificationDeliveryLog" (
    id BIGSERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES "Account"(id) ON DELETE CASCADE,
    rule_id INTEGER NOT NULL REFERENCES "NotificationRule"(id) ON DELETE CASCADE,
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(128) NOT NULL,
    offset_days INTEGER,
    channel notification_delivery_channel NOT NULL,
    delivered_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    cleared_at TIMESTAMPTZ(6),
    metadata JSONB,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    modified_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_delivery_log_account_delivered_desc
ON "NotificationDeliveryLog" (account_id, delivered_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_delivery_log_rule_entity
ON "NotificationDeliveryLog" (rule_id, entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_notification_delivery_log_rule_channel_offset
ON "NotificationDeliveryLog" (rule_id, channel, offset_days);

WITH seeded_sets AS (
    INSERT INTO "NotificationRuleSet" (
        account_id,
        product,
        trigger_type,
        enabled,
        created_at,
        modified_at,
        created_by,
        modified_by
    )
    SELECT
        a.id,
        'credit_insurance'::notification_rule_product,
        trigger.trigger_type::notification_rule_trigger_type,
        TRUE,
        NOW(),
        NOW(),
        'system',
        'system'
    FROM "Account" a
    CROSS JOIN (
        VALUES
            ('overdue_block'),
            ('capacity_gap'),
            ('entry_terms_breach'),
            ('action_window'),
            ('limit_warnings')
    ) AS trigger(trigger_type)
    WHERE a.has_credit_insurance = TRUE
    ON CONFLICT (account_id, product, trigger_type) DO UPDATE
    SET modified_at = NOW(),
        modified_by = 'system'
    RETURNING id, trigger_type
),
all_sets AS (
    SELECT id, trigger_type
    FROM seeded_sets
    UNION
    SELECT id, trigger_type::TEXT
    FROM "NotificationRuleSet"
    WHERE product = 'credit_insurance'::notification_rule_product
),
seeded_rules AS (
    INSERT INTO "NotificationRule" (
        rule_set_id,
        advance_day_offsets,
        metadata,
        created_at,
        modified_at,
        created_by,
        modified_by
    )
    SELECT
        s.id,
        CASE
            WHEN s.trigger_type = 'action_window' THEN ARRAY[14, 7, 3]
            ELSE ARRAY[]::INTEGER[]
        END,
        NULL,
        NOW(),
        NOW(),
        'system',
        'system'
    FROM all_sets s
    ON CONFLICT (rule_set_id) DO UPDATE
    SET modified_at = NOW(),
        modified_by = 'system'
    RETURNING id
)
INSERT INTO "NotificationRuleRoleDefault" (
    rule_id,
    role,
    created_at,
    modified_at,
    created_by,
    modified_by
)
SELECT
    r.id,
    roles.role::user_role,
    NOW(),
    NOW(),
    'system',
    'system'
FROM seeded_rules r
CROSS JOIN (
    VALUES
        ('CFO'),
        ('Data_Analyst'),
        ('System_Administrator')
) AS roles(role)
ON CONFLICT (rule_id, role) DO NOTHING;

COMMIT;
