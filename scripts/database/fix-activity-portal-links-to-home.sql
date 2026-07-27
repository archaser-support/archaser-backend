-- Datafix: Update Activity.content so portal links point to portal home (no nested paths).
-- Strips trailing path and query from portal URLs (e.g. /view-invoices, ?status=due).
--
-- Optional: preview rows that would change (run first)
-- SELECT id, content
-- FROM "Activity"
-- WHERE content LIKE '%/portal/%'
--   AND content ~ '(https?:\/\/[^\/]+)?(\/[a-z]{2}\/portal\/[a-f0-9-]+)(\/[^"''<>\s?]*)?(\?[^"''<>\s]*)?'
--   AND content != REGEXP_REPLACE(
--         content,
--         '(https?:\/\/[^\/]+)?(\/[a-z]{2}\/portal\/[a-f0-9-]+)(\/[^"''<>\s?]*)?(\?[^"''<>\s]*)?',
--         '\1\2',
--         'g'
--   );

UPDATE "Activity"
SET content = REGEXP_REPLACE(
    content,
    '(https?:\/\/[^\/]+)?(\/[a-z]{2}\/portal\/[a-f0-9-]+)(\/[^"''<>\s?]*)?(\?[^"''<>\s]*)?',
    '\1\2',
    'g'
)
WHERE content LIKE '%/portal/%';
