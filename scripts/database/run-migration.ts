import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
    log: ['error'],
});

interface MigrationStats {
    total: number;
    executed: number;
    skipped: number;
    failed: number;
    errors: Array<{ statement: string; error: string; line?: number }>;
}

/**
 * Parse SQL file into individual statements
 * Handles comments, multi-line statements, and special PostgreSQL constructs
 */
function parseSQLFile(sqlContent: string): Array<{ statement: string; lineNumber: number }> {
    const statements: Array<{ statement: string; lineNumber: number }> = [];
    const lines = sqlContent.split('\n');
    let currentStatement = '';
    let inMultiLineComment = false;
    let statementStartLine = 1;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNumber = i + 1;
        let processedLine = line;

        // Handle multi-line comments /* ... */
        if (processedLine.includes('/*')) {
            inMultiLineComment = true;
        }

        if (inMultiLineComment) {
            if (processedLine.includes('*/')) {
                inMultiLineComment = false;
                // Remove comment part
                processedLine = processedLine.substring(processedLine.indexOf('*/') + 2);
            } else {
                // Skip this line (it's inside a comment)
                continue;
            }
        }

        // Remove single-line comments (-- ...) but preserve -- if inside quotes
        processedLine = processedLine.replace(/(?:^|[^"'])(--.*)$/gm, '');

        // Skip empty lines or lines with only whitespace
        if (processedLine.trim() === '') {
            continue;
        }

        // Track statement start
        if (currentStatement === '' && processedLine.trim()) {
            statementStartLine = lineNumber;
        }

        currentStatement += `${processedLine  }\n`;

        // Check if line ends with semicolon (statement delimiter)
        // But be careful with semicolons inside strings or JSON
        const trimmedLine = processedLine.trim();
        if (trimmedLine.endsWith(';')) {
            const statement = currentStatement.trim();

            // Skip empty statements and SELECT-only statements (these are verification queries)
            if (statement &&
                !statement.match(/^\s*SELECT\s+/i) &&  // Skip SELECT statements (verification queries)
                !statement.match(/^\s*--\s*SELECT\s+/i) &&  // Skip commented SELECT statements
                statement.length > 3) {

                statements.push({
                    statement: statement,
                    lineNumber: statementStartLine
                });
            }

            currentStatement = '';
        }
    }

    // Handle any remaining statement without semicolon
    if (currentStatement.trim() && !currentStatement.trim().match(/^\s*SELECT\s+/i)) {
        statements.push({
            statement: currentStatement.trim(),
            lineNumber: statementStartLine
        });
    }

    return statements;
}

/**
 * Ask a yes/no question
 */
function askQuestion(question: string): Promise<string> {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        rl.question(question, (answer: string) => {
            rl.close();
            resolve(answer);
        });
    });
}

/**
 * Execute migration statements one at a time
 */
async function runMigration(
    sqlFilePath: string,
    options: {
        dryRun?: boolean;
        skipVerification?: boolean;
        pauseBetweenStatements?: boolean;
        stopOnError?: boolean;
    } = {}
): Promise<MigrationStats> {
    const {
        dryRun = false,
        skipVerification = false,
        pauseBetweenStatements = false,
        stopOnError = false
    } = options;

    const stats: MigrationStats = {
        total: 0,
        executed: 0,
        skipped: 0,
        failed: 0,
        errors: []
    };

    console.log('🚀 Starting Migration Script');
    console.log('============================\n');

    // Check if file exists
    if (!fs.existsSync(sqlFilePath)) {
        throw new Error(`SQL file not found: ${sqlFilePath}`);
    }

    // Read SQL file
    console.log(`📖 Reading SQL file: ${sqlFilePath}`);
    const sqlContent = fs.readFileSync(sqlFilePath, 'utf-8');

    // Parse SQL into statements
    console.log('🔍 Parsing SQL statements...');
    let statements = parseSQLFile(sqlContent);

    // Filter out verification queries if requested
    if (skipVerification) {
        statements = statements.filter(s =>
            !s.statement.trim().match(/^\s*SELECT\s+/i) &&
            !s.statement.trim().match(/^\s*--\s*PART\s+\d+:/i)
        );
    }

    stats.total = statements.length;
    console.log(`📊 Found ${stats.total} executable statements\n`);

    // Environment check
    const environment = process.env.NODE_ENV || 'development';
    console.log(`🌍 Environment: ${environment}`);
    console.log(`🔍 Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE (will modify data)'}`);
    console.log(`⏸️  Pause between statements: ${pauseBetweenStatements ? 'YES' : 'NO'}`);
    console.log(`🛑 Stop on error: ${stopOnError ? 'YES' : 'NO'}\n`);

    if (environment === 'production' && !dryRun) {
        console.log('⚠️  PRODUCTION MODE DETECTED!');
        console.log('⚠️  This will modify live production data!\n');

        const confirm = await askQuestion('Are you absolutely sure you want to proceed with PRODUCTION data? (yes/no): ');
        if (confirm.toLowerCase() !== 'yes') {
            console.log('❌ Operation cancelled for safety.');
            process.exit(0);
        }
        console.log('');
    }

    // Confirm before starting
    if (!dryRun) {
        const confirm = await askQuestion(`Proceed with executing ${stats.total} statements? (yes/no): `);
        if (confirm.toLowerCase() !== 'yes') {
            console.log('❌ Operation cancelled.');
            process.exit(0);
        }
        console.log('');
    }

    console.log('🚀 Starting execution...\n');
    console.log('═'.repeat(80));

    // Execute statements one at a time
    for (let i = 0; i < statements.length; i++) {
        const { statement, lineNumber } = statements[i];
        const statementNumber = i + 1;

        // Extract a preview of the statement for logging
        const preview = statement.substring(0, 100).replace(/\n/g, ' ').trim();
        const truncatedPreview = preview.length > 80 ? `${preview.substring(0, 80)  }...` : preview;

        console.log(`\n[${statementNumber}/${stats.total}] Line ${lineNumber}`);
        console.log(`📝 ${truncatedPreview}`);

        // Detect query type (SELECT/WITH vs UPDATE/INSERT/DELETE/etc)
        const trimmedStatement = statement.trim();
        const isSelectQuery = /^\s*(SELECT|WITH)\s+/i.test(trimmedStatement);

        // Skip verification queries (SELECT/WITH statements) if requested
        if (skipVerification && isSelectQuery) {
            console.log('⏭️  Skipped (verification query)');
            stats.skipped++;
            continue;
        }

        try {
            if (dryRun) {
                console.log('🔍 DRY RUN - Would execute this statement');
                stats.executed++;
            } else {
                // Execute the statement
                const startTime = Date.now();

                // Use $queryRawUnsafe for SELECT/WITH queries, $executeRawUnsafe for write operations
                if (isSelectQuery) {
                    const result = await prisma.$queryRawUnsafe(statement) as any[];
                    console.log(`✅ Query executed successfully (${Date.now() - startTime}ms)`);
                    if (result && result.length > 0) {
                        console.log(`   📊 Returned ${result.length} row(s)`);
                        // Show first 3 rows if it's a diagnostic query
                        if (truncatedPreview.toLowerCase().includes('dispute') ||
                            truncatedPreview.toLowerCase().includes('check') ||
                            truncatedPreview.toLowerCase().includes('find') ||
                            truncatedPreview.toLowerCase().includes('verify')) {
                            console.log('   Sample results:');
                            result.slice(0, 3).forEach((row, idx) => {
                                console.log(`   [${idx + 1}] ${JSON.stringify(row).substring(0, 150)}...`);
                            });
                        }
                    }
                } else {
                    // Check for specific patterns before UPDATE (for debugging)
                    // Log for any UPDATE statements that might affect dispute.Denied
                    const isDisputeDeniedStatement = statement.includes('dispute.Denied') ||
                        statement.includes('dispute\.Denied') ||
                        truncatedPreview.toLowerCase().includes('dispute.denied');

                    if (isDisputeDeniedStatement) {
                        console.log('\n   ════════════════════════════════════════════════════════════════════════');
                        console.log('   🔍 DEBUG: Checking for dispute.Denied patterns BEFORE UPDATE');
                        console.log('   ════════════════════════════════════════════════════════════════════════');
                        try {
                            // Check with LIKE
                            const beforeCheckLike = await prisma.$queryRawUnsafe(`
                                SELECT COUNT(*) as count
                                FROM "Activity"
                                WHERE content IS NOT NULL
                                  AND content LIKE '%dispute.Denied%'
                            `) as any[];
                            const beforeCountLike = beforeCheckLike[0]?.count || 0;
                            console.log(`   📊 LIKE '%dispute.Denied%': ${beforeCountLike} record(s)`);

                            // Check with regex
                            const beforeCheckRegex = await prisma.$queryRawUnsafe(`
                                SELECT COUNT(*) as count
                                FROM "Activity"
                                WHERE content IS NOT NULL
                                  AND content ~* 'dispute\\.Denied'
                            `) as any[];
                            const beforeCountRegex = beforeCheckRegex[0]?.count || 0;
                            console.log(`   📊 REGEX 'dispute\\.Denied': ${beforeCountRegex} record(s)`);

                            // Check for bracketed version
                            const beforeCheckBrackets = await prisma.$queryRawUnsafe(`
                                SELECT COUNT(*) as count
                                FROM "Activity"
                                WHERE content IS NOT NULL
                                  AND content LIKE '%{{dispute.Denied}}%'
                            `) as any[];
                            const beforeCountBrackets = beforeCheckBrackets[0]?.count || 0;
                            console.log(`   📊 LIKE '%{{dispute.Denied}}%': ${beforeCountBrackets} record(s)`);

                            const totalBefore = Math.max(beforeCountLike, beforeCountRegex);
                            console.log(`   📊 TOTAL: ${totalBefore} record(s) with dispute.Denied pattern`);

                            if (totalBefore > 0) {
                                // Show sample content with more details
                                const samples = await prisma.$queryRawUnsafe(`
                                    SELECT 
                                        id,
                                        content LIKE '%{{dispute.Denied}}%' as has_brackets,
                                        content LIKE '%dispute.Denied%' AND content NOT LIKE '%{{dispute.Denied}}%' as has_unbracketed,
                                        position('dispute.Denied' in content) as position_in_content,
                                        substring(content, 
                                            GREATEST(1, position('dispute.Denied' in content) - 100), 
                                            300) as content_context
                                    FROM "Activity"
                                    WHERE content IS NOT NULL
                                      AND (content LIKE '%dispute.Denied%' OR content ~* 'dispute\\.Denied')
                                    ORDER BY id DESC
                                    LIMIT 5
                                `) as any[];

                                console.log(`   📋 Showing ${samples.length} sample record(s):`);
                                samples.forEach((sample, idx) => {
                                    console.log(`   [Sample ${idx + 1}]`);
                                    console.log(`      ID: ${sample.id}`);
                                    console.log(`      Has brackets {{...}}: ${sample.has_brackets}`);
                                    console.log(`      Has unbracketed: ${sample.has_unbracketed}`);
                                    console.log(`      Position in content: ${sample.position_in_content}`);
                                    console.log(`      Content context: ${sample.content_context}`);
                                });
                            } else {
                                console.log(`   ⚠️  WARNING: No records found with dispute.Denied pattern!`);
                                console.log(`   This might mean:`);
                                console.log(`   1. The pattern doesn't exist in the database`);
                                console.log(`   2. The pattern is in a different format`);
                                console.log(`   3. The content field is NULL`);

                                // Try to find any variation
                                console.log(`   🔍 Searching for variations...`);
                                const variations = await prisma.$queryRawUnsafe(`
                                    SELECT 
                                        COUNT(*) FILTER (WHERE content LIKE '%dispute%denied%') as case_insensitive,
                                        COUNT(*) FILTER (WHERE content LIKE '%denied%') as has_denied,
                                        COUNT(*) FILTER (WHERE content LIKE '%dispute%') as has_dispute
                                    FROM "Activity"
                                    WHERE content IS NOT NULL
                                `) as any[];
                                const variationData = variations[0];
                                console.log(`      Records with 'dispute...denied': ${variationData.case_insensitive}`);
                                console.log(`      Records with 'denied': ${variationData.has_denied}`);
                                console.log(`      Records with 'dispute': ${variationData.has_dispute}`);
                            }
                        } catch (checkError: any) {
                            console.log(`   ❌ ERROR: Could not check before state: ${checkError.message}`);
                            console.log(`   Stack: ${checkError.stack}`);
                        }
                        console.log('   ════════════════════════════════════════════════════════════════════════\n');
                    }

                    // Execute the UPDATE/DELETE/INSERT
                    const result = await prisma.$executeRawUnsafe(statement) as number;
                    console.log(`✅ Statement executed successfully (${Date.now() - startTime}ms)`);
                    console.log(`   📊 Affected ${result} row(s)`);

                    // Check after UPDATE for dispute.Denied
                    if (statement.includes('dispute.Denied') || statement.includes('dispute.Denied')) {
                        console.log('   🔍 Checking for dispute.Denied patterns after UPDATE...');
                        try {
                            const afterCheck = await prisma.$queryRawUnsafe(`
                                SELECT COUNT(*) as count
                                FROM "Activity"
                                WHERE content IS NOT NULL
                                  AND (content LIKE '%dispute.Denied%' OR content ~* 'dispute\\.Denied')
                            `) as any[];
                            const afterCount = afterCheck[0]?.count || 0;
                            console.log(`   📊 Found ${afterCount} record(s) with dispute.Denied pattern after UPDATE`);

                            if (afterCount > 0 && result === 0) {
                                console.log(`   ⚠️  WARNING: Pattern still exists but UPDATE affected 0 rows!`);
                                // Show what's actually in the content
                                const samples = await prisma.$queryRawUnsafe(`
                                    SELECT id, 
                                           content LIKE '%{{dispute.Denied}}%' as has_brackets,
                                           content LIKE '%dispute.Denied%' as has_unbracketed,
                                           substring(content, 1, 300) as content_preview
                                    FROM "Activity"
                                    WHERE content IS NOT NULL
                                      AND (content LIKE '%dispute.Denied%' OR content ~* 'dispute\\.Denied')
                                    LIMIT 3
                                `) as any[];
                                samples.forEach((sample, idx) => {
                                    console.log(`   [Sample ${idx + 1}] ID: ${sample.id}`);
                                    console.log(`      Has brackets: ${sample.has_brackets}, Has unbracketed: ${sample.has_unbracketed}`);
                                    console.log(`      Preview: ${sample.content_preview}`);
                                });
                            }
                        } catch (checkError: any) {
                            console.log(`   ⚠️  Could not check after state: ${checkError.message}`);
                        }
                    }
                }

                const duration = Date.now() - startTime;
                stats.executed++;

                // Pause between statements if requested
                if (pauseBetweenStatements && i < statements.length - 1) {
                    const continue_ = await askQuestion('\nPress Enter to continue to next statement, or "q" to quit: ');
                    if (continue_.toLowerCase() === 'q') {
                        console.log('\n⚠️  Migration stopped by user.');
                        break;
                    }
                }
            }
        } catch (error: any) {
            const errorMessage = error.message || String(error);
            console.log(`❌ Error: ${errorMessage}`);
            stats.failed++;
            stats.errors.push({
                statement: truncatedPreview,
                error: errorMessage,
                line: lineNumber
            });

            if (stopOnError) {
                console.log('\n🛑 Stopping execution due to error (stopOnError=true)');
                break;
            }
        }

        // Progress indicator
        if ((statementNumber) % 10 === 0 || statementNumber === stats.total) {
            const progress = ((statementNumber / stats.total) * 100).toFixed(1);
            console.log(`\n📊 Progress: ${statementNumber}/${stats.total} (${progress}%)`);
        }
    }

    console.log(`\n${  '═'.repeat(80)}`);
    console.log('\n📊 Migration Summary');
    console.log('===================');
    console.log(`Total statements: ${stats.total}`);
    console.log(`✅ Executed: ${stats.executed}`);
    console.log(`⏭️  Skipped: ${stats.skipped}`);
    console.log(`❌ Failed: ${stats.failed}`);

    if (stats.errors.length > 0) {
        console.log('\n❌ Errors encountered:');
        stats.errors.forEach((err, index) => {
            console.log(`\n${index + 1}. Line ${err.line || 'unknown'}:`);
            console.log(`   Statement: ${err.statement}`);
            console.log(`   Error: ${err.error}`);
        });
    }

    return stats;
}

/**
 * Migration registry - stores all available migrations
 */
interface MigrationDefinition {
    name: string;
    description: string;
    file: string;
    group?: string;
}

const MIGRATIONS: MigrationDefinition[] = [
    {
        name: 'activity-translation-keys',
        description: 'Update Activity Translation Keys - Complete migration for activity titles and content',
        file: 'migrate_activity_translation_keys_complete.sql',
        group: 'translation'
    },
    {
        name: 'last-call-result-values',
        description: 'Standardize last_call_result values in CustomerCollectionPeriod table to match translation keys',
        file: 'migrate_last_call_result_values.sql',
        group: 'translation'
    }
];

/**
 * Get migration by name
 */
function getMigration(name: string): MigrationDefinition | undefined {
    return MIGRATIONS.find(m => m.name === name);
}

/**
 * Get migrations by group
 */
function getMigrationsByGroup(group: string): MigrationDefinition[] {
    return MIGRATIONS.filter(m => m.group === group);
}

/**
 * List all available migrations
 */
function listMigrations(): void {
    console.log('\n📋 Available Migrations:');
    console.log('========================\n');

    const grouped = MIGRATIONS.reduce((acc, migration) => {
        const group = migration.group || 'uncategorized';
        if (!acc[group]) {
            acc[group] = [];
        }
        acc[group].push(migration);
        return acc;
    }, {} as Record<string, MigrationDefinition[]>);

    for (const [group, migrations] of Object.entries(grouped)) {
        console.log(`\n📁 Group: ${group}`);
        migrations.forEach((migration, index) => {
            console.log(`  ${index + 1}. ${migration.name}`);
            console.log(`     ${migration.description}`);
            console.log(`     File: ${migration.file}`);
        });
    }

    console.log('\n');
}

/**
 * Main function
 */
async function main() {
    const args = process.argv.slice(2);

    // Parse arguments
    const dryRun = args.includes('--dry-run');
    const skipVerification = args.includes('--skip-verification');
    const pauseBetweenStatements = args.includes('--pause');
    const stopOnError = args.includes('--stop-on-error');
    const list = args.includes('--list');
    const group = args.find(arg => arg.startsWith('--group='))?.replace('--group=', '');
    const migrationName = args.find(arg => !arg.startsWith('--') && !arg.includes('='));

    // List migrations if requested
    if (list) {
        listMigrations();
        process.exit(0);
    }

    // Get SQL file path
    let sqlFilePath: string;

    // Check if migration name was provided
    if (migrationName && !migrationName.endsWith('.sql')) {
        const migration = getMigration(migrationName);
        if (!migration) {
            console.error(`\n❌ Migration not found: ${migrationName}`);
            console.log('\nRun with --list to see available migrations.\n');
            process.exit(1);
        }
        sqlFilePath = path.join(__dirname, migration.file);
        console.log(`\n📦 Using registered migration: ${migration.name}`);
        console.log(`   Description: ${migration.description}\n`);
    } else if (group) {
        // Run all migrations in a group
        const migrations = getMigrationsByGroup(group);
        if (migrations.length === 0) {
            console.error(`\n❌ No migrations found in group: ${group}`);
            listMigrations();
            process.exit(1);
        }

        console.log(`\n📁 Running migrations in group: ${group}`);
        console.log(`   Found ${migrations.length} migration(s)\n`);

        let totalFailed = 0;
        for (const migration of migrations) {
            console.log(`\n${  '═'.repeat(80)}`);
            console.log(`\n📦 Running: ${migration.name}`);
            console.log(`   ${migration.description}`);
            console.log(`   File: ${migration.file}\n`);

            const migrationPath = path.join(__dirname, migration.file);
            try {
                const stats = await runMigration(migrationPath, {
                    dryRun,
                    skipVerification,
                    pauseBetweenStatements,
                    stopOnError
                });

                if (stats.failed > 0) {
                    totalFailed += stats.failed;
                }
            } catch (error: any) {
                console.error(`\n❌ Error running migration ${migration.name}:`, error.message || error);
                totalFailed++;
                if (stopOnError) {
                    break;
                }
            }
        }

        console.log(`\n${  '═'.repeat(80)}`);
        console.log('\n📊 Group Migration Summary');
        console.log('==========================');
        console.log(`Total migrations: ${migrations.length}`);
        console.log(`Total failed: ${totalFailed}`);

        if (totalFailed === 0) {
            console.log('\n✅ All migrations in group completed successfully!');
            process.exit(0);
        } else {
            console.log(`\n⚠️  Group migration completed with ${totalFailed} error(s).`);
            process.exit(1);
        }
    } else {
        // Use file path (backward compatibility)
        sqlFilePath = migrationName?.endsWith('.sql')
            ? path.join(__dirname, migrationName)
            : args.find(arg => !arg.startsWith('--')) ||
            path.join(__dirname, 'migrate_activity_translation_keys_complete.sql');
    }

    try {
        console.log('');
        console.log('🔧 Database Migration Runner');
        console.log('============================\n');

        const stats = await runMigration(sqlFilePath, {
            dryRun,
            skipVerification,
            pauseBetweenStatements,
            stopOnError
        });

        if (stats.failed === 0) {
            console.log('\n✅ Migration completed successfully!');
            process.exit(0);
        } else {
            console.log(`\n⚠️  Migration completed with ${stats.failed} error(s).`);
            process.exit(1);
        }
    } catch (error: any) {
        console.error('\n❌ Fatal error:', error.message || error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

// Run if executed directly
if (require.main === module) {
    main();
}

export { runMigration, parseSQLFile, MIGRATIONS, getMigration, getMigrationsByGroup, listMigrations };

