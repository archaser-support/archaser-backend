-- Advanced SQL Migration to update legacy numeric Contact status in Reports
-- This avoids text LIKE limitations and directly manipulates the JSONB array

UPDATE "Report" r
SET report_config = (
    SELECT jsonb_set(
        r.report_config::jsonb,
        '{filters}',
        (
            SELECT COALESCE(jsonb_agg(
                CASE 
                    WHEN f->>'table' = 'Contact' AND f->>'field' = 'status' AND (f->>'value' = '1' OR f->>'value' = '0') THEN
                        jsonb_set(f, '{value}', CASE WHEN f->>'value' = '1' THEN '"Active"'::jsonb ELSE '"Inactive"'::jsonb END)
                    ELSE f
                END
            ), '[]'::jsonb)
            FROM jsonb_array_elements(r.report_config::jsonb->'filters') AS f
        )
    )::json
)
WHERE jsonb_typeof(r.report_config::jsonb->'filters') = 'array';

SELECT 'Migration completed successfully. Affected rows: ' || count(*) FROM "Report"
WHERE report_config::text LIKE '%"Active"%';
