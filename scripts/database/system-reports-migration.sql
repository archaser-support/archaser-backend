-- ============================================================================
-- System Reports Migration Script
-- Generated: 2025-12-23T15:19:38.032Z
-- Total Reports: 5
-- ============================================================================

BEGIN;

-- Delete existing system reports (optional - uncomment if needed)
-- DELETE FROM "Report" WHERE is_system = true;

-- Insert system reports

-- Report ID: 1145, Name: All Customers
-- Context: customers
INSERT INTO "Report" (
    account_id,
    name,
    description,
    report_config,
    is_public,
    is_system,
    is_default,
    context,
    created_at,
    modified_at,
    created_by,
    modified_by
) VALUES (
    10013,
    'All Customers',
    'All customers',
    '{"joins":[],"fields":[{"field":"name","table":"Customer"},{"field":"collection_status","table":"Customer"},{"field":"customer_number","table":"Customer"},{"field":"parent_customer_name","table":"Customer"},{"field":"category","table":"Customer"},{"field":"total_invoices_overdue","table":"Customer"},{"field":"total_due_amount","table":"Customer"},{"field":"modified_at","table":"Customer"},{"field":"Country.name","table":"Customer"},{"field":"State.name","table":"Customer"}],"tables":["Customer"],"filters":[],"sorting":[{"field":"name","direction":"ASC"}],"grouping":[]}'::jsonb,
    true,
    true,
    true,
    'customers',
    '2025-12-14T09:20:25.203Z'::timestamptz,
    '2025-12-22T15:25:57.047Z'::timestamptz,
    'cm4jv3d130002w6tkphqo0f3l',
    'cm4jv3d130002w6tkphqo0f3l'
);

-- Report ID: 1146, Name: Active Customers
-- Context: customers
INSERT INTO "Report" (
    account_id,
    name,
    description,
    report_config,
    is_public,
    is_system,
    is_default,
    context,
    created_at,
    modified_at,
    created_by,
    modified_by
) VALUES (
    10013,
    'Active Customers',
    'All customers',
    '{"joins":[],"fields":[{"field":"name","table":"Customer"},{"field":"customer_number","table":"Customer"},{"field":"parent_customer_name","table":"Customer"},{"field":"category","table":"Customer"},{"field":"total_invoices_overdue","table":"Customer"},{"field":"total_due_amount","table":"Customer"}],"tables":["Customer"],"filters":[{"field":"collection_status","table":"Customer","value":"Active","operator":"equals"}],"sorting":[{"field":"name","direction":"ASC"}],"grouping":[]}'::jsonb,
    true,
    true,
    false,
    'customers',
    '2025-12-14T09:20:25.918Z'::timestamptz,
    '2025-12-22T14:37:04.517Z'::timestamptz,
    'cm4jv3d130002w6tkphqo0f3l',
    'cm4jv3d130002w6tkphqo0f3l'
);

-- Report ID: 1147, Name: Inactive Customers
-- Context: customers
INSERT INTO "Report" (
    account_id,
    name,
    description,
    report_config,
    is_public,
    is_system,
    is_default,
    context,
    created_at,
    modified_at,
    created_by,
    modified_by
) VALUES (
    10013,
    'Inactive Customers',
    'All customers',
    '{"joins":[],"fields":[{"field":"name","table":"Customer"},{"field":"customer_number","table":"Customer"},{"field":"parent_customer_name","table":"Customer"},{"field":"modified_at","table":"Customer"},{"field":"modified_by","table":"Customer"}],"tables":["Customer"],"filters":[{"field":"collection_status","table":"Customer","value":"Inactive","operator":"equals"}],"sorting":[{"field":"name","direction":"ASC"}],"grouping":[]}'::jsonb,
    true,
    true,
    false,
    'customers',
    '2025-12-14T09:20:25.922Z'::timestamptz,
    '2025-12-22T14:36:20.344Z'::timestamptz,
    'cm4jv3d130002w6tkphqo0f3l',
    'cm4jv3d130002w6tkphqo0f3l'
);

-- Report ID: 1153, Name: All open disputes
-- Context: disputes
INSERT INTO "Report" (
    account_id,
    name,
    description,
    report_config,
    is_public,
    is_system,
    is_default,
    context,
    created_at,
    modified_at,
    created_by,
    modified_by
) VALUES (
    10013,
    'All open disputes',
    'All customer disputes',
    '{"joins":[{"on":"customer_id","to":"Customer","from":"Dispute","type":"LEFT"}],"fields":[{"field":"dispute_number","table":"Dispute"},{"field":"name","table":"Customer"},{"field":"customer_number","table":"Customer"},{"field":"amount_in_dispute","table":"Dispute"},{"field":"days_past_due","table":"Dispute"},{"field":"created_at","table":"Dispute"},{"field":"dispute_reason","table":"Dispute"},{"field":"dispute_status","table":"Dispute"},{"field":"assigned_to","table":"Dispute"}],"tables":["Dispute","Customer"],"filters":[{"field":"dispute_status","table":"Dispute","value":"Resolved","operator":"not_equals"}],"grouping":[]}'::jsonb,
    false,
    true,
    true,
    'disputes',
    '2025-12-21T12:47:55.446Z'::timestamptz,
    '2025-12-21T15:27:56.898Z'::timestamptz,
    'cm4jv3d130002w6tkphqo0f3l',
    'cm4jv3d130002w6tkphqo0f3l'
);

-- Report ID: 1154, Name: My open disputes
-- Context: disputes
INSERT INTO "Report" (
    account_id,
    name,
    description,
    report_config,
    is_public,
    is_system,
    is_default,
    context,
    created_at,
    modified_at,
    created_by,
    modified_by
) VALUES (
    10013,
    'My open disputes',
    'My disputes',
    '{"joins":[{"on":"customer_id","to":"Customer","from":"Dispute","type":"LEFT"}],"fields":[{"field":"dispute_number","table":"Dispute"},{"field":"name","table":"Customer"},{"field":"customer_number","table":"Customer"},{"field":"amount_in_dispute","table":"Dispute"},{"field":"days_past_due","table":"Dispute"},{"field":"created_at","table":"Dispute"},{"field":"dispute_reason","table":"Dispute"},{"field":"dispute_status","table":"Dispute"},{"field":"assigned_to","table":"Dispute"}],"tables":["Dispute","Customer"],"filters":[{"field":"assigned_to","table":"Dispute","value":"__CURRENT_USER__","operator":"equals"},{"field":"dispute_status","table":"Dispute","value":"Resolved","operator":"not_equals"}],"grouping":[]}'::jsonb,
    false,
    true,
    false,
    'disputes',
    '2025-12-21T13:46:49.555Z'::timestamptz,
    '2025-12-21T15:28:14.544Z'::timestamptz,
    'cm4jv3d130002w6tkphqo0f3l',
    'cm4jv3d130002w6tkphqo0f3l'
);

COMMIT;

-- ============================================================================
-- End of System Reports Migration Script
-- ============================================================================