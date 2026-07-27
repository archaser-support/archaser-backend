-- ============================================================================
-- Report Builder Migration Verification Script
-- ============================================================================
-- Run this script after deploying deploy-report-builder-to-staging.sql
-- to verify that all tables, constraints, and indexes were created correctly.
-- ============================================================================

-- Check that all tables exist
SELECT 
    'Tables Check' as check_type,
    table_name,
    CASE 
        WHEN table_name IN ('Report', 'ReportShare', 'ReportSchedule', 'ReportExecution', 'UserDefaultReport')
        THEN '✓ EXISTS'
        ELSE '✗ MISSING'
    END as status
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('Report', 'ReportShare', 'ReportSchedule', 'ReportExecution', 'UserDefaultReport')
ORDER BY table_name;

-- Check Report table columns
SELECT 
    'Report Columns' as check_type,
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
AND table_name = 'Report'
ORDER BY ordinal_position;

-- Check foreign key constraints
SELECT 
    'Foreign Keys' as check_type,
    tc.constraint_name,
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'public'
    AND tc.table_name IN ('Report', 'ReportShare', 'ReportSchedule', 'ReportExecution', 'UserDefaultReport')
ORDER BY tc.table_name, tc.constraint_name;

-- Check unique constraints
SELECT 
    'Unique Constraints' as check_type,
    tc.constraint_name,
    tc.table_name,
    string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) as columns
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
WHERE tc.constraint_type = 'UNIQUE'
    AND tc.table_schema = 'public'
    AND tc.table_name IN ('Report', 'ReportShare', 'ReportSchedule', 'ReportExecution', 'UserDefaultReport')
GROUP BY tc.constraint_name, tc.table_name
ORDER BY tc.table_name, tc.constraint_name;

-- Check indexes
SELECT 
    'Indexes' as check_type,
    indexname,
    tablename,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
AND (
    indexname LIKE 'idx_report%' 
    OR indexname LIKE 'idx_user_default_report%'
    OR tablename IN ('Report', 'ReportShare', 'ReportSchedule', 'ReportExecution', 'UserDefaultReport')
)
ORDER BY tablename, indexname;

-- Summary count
SELECT 
    'Summary' as check_type,
    'Tables' as item,
    COUNT(*)::text as count
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('Report', 'ReportShare', 'ReportSchedule', 'ReportExecution', 'UserDefaultReport')
UNION ALL
SELECT 
    'Summary',
    'Foreign Keys',
    COUNT(*)::text
FROM information_schema.table_constraints
WHERE constraint_type = 'FOREIGN KEY'
    AND table_schema = 'public'
    AND table_name IN ('Report', 'ReportShare', 'ReportSchedule', 'ReportExecution', 'UserDefaultReport')
UNION ALL
SELECT 
    'Summary',
    'Unique Constraints',
    COUNT(*)::text
FROM information_schema.table_constraints
WHERE constraint_type = 'UNIQUE'
    AND table_schema = 'public'
    AND table_name IN ('Report', 'ReportShare', 'ReportSchedule', 'ReportExecution', 'UserDefaultReport')
UNION ALL
SELECT 
    'Summary',
    'Indexes',
    COUNT(*)::text
FROM pg_indexes
WHERE schemaname = 'public'
AND (
    indexname LIKE 'idx_report%' 
    OR indexname LIKE 'idx_user_default_report%'
    OR tablename IN ('Report', 'ReportShare', 'ReportSchedule', 'ReportExecution', 'UserDefaultReport')
);










