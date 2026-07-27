/**
 * Migration Script: Convert time_zone enum to IANA timezone identifiers
 *
 * This script migrates the User.time_zone field from enum values to IANA timezone identifiers.
 *
 * Usage:
 *   npx ts-node scripts/database/migrate-timezone-to-iana.ts --dry-run
 *   npx ts-node scripts/database/migrate-timezone-to-iana.ts
 */

import { PrismaClient } from "@prisma/client";

import { TimeZoneLabels } from "../../frontend/utils/timezones";

// Reverse mapping from display names to IANA identifiers
const DISPLAY_NAME_TO_IANA: Record<string, string> = {};
for (const [iana, display] of Object.entries(TimeZoneLabels)) {
    DISPLAY_NAME_TO_IANA[display] = iana;
}

// Temporary TIMEZONE_MAP for migration (matches the old TIMEZONE_MAP from datetimeOperations.ts)
// Maps enum format to IANA identifiers
const TIMEZONE_MAP: Record<string, string> = {
    // UTC-12 to UTC-01
    UTC_12_00__International_Date_Line_West: "Etc/GMT+12",
    UTC_11_00__Coordinated_Universal_Time_11: "Etc/GMT+11",
    UTC_10_00__Hawaii: "Pacific/Honolulu",
    UTC_09_00__Alaska: "America/Anchorage",
    UTC_08_00__Pacific_Time__US___Canada_: "America/Los_Angeles",
    UTC_07_00__Arizona: "America/Phoenix",
    UTC_07_00__Chihuahua__La_Paz__Mazatlan: "America/Mazatlan",
    UTC_07_00__Mountain_Time__US___Canada_: "America/Denver",
    UTC_06_00__Central_America: "America/Guatemala",
    UTC_06_00__Central_Time__US___Canada_: "America/Chicago",
    UTC_06_00__Guadalajara__Mexico_City__Monterrey: "America/Mexico_City",
    UTC_06_00__Saskatchewan: "America/Regina",
    UTC_05_00__Bogota__Lima__Quito__Rio_Branco: "America/Bogota",
    UTC_05_00__Eastern_Time__US___Canada_: "America/New_York",
    UTC_05_00__Indiana__East_: "America/Indiana/Indianapolis",
    UTC_04_30__Caracas: "America/Caracas",
    UTC_04_00__Asuncion: "America/Asuncion",
    UTC_04_00__Atlantic_Time__Canada_: "America/Halifax",
    UTC_04_00__Cuiaba: "America/Cuiaba",
    UTC_04_00__Georgetown__La_Paz__Manaus__San_Juan: "America/La_Paz",
    UTC_04_00__Santiago: "America/Santiago",
    UTC_03_30__Newfoundland: "America/St_Johns",
    UTC_03_00__Brasilia: "America/Sao_Paulo",
    UTC_03_00__Buenos_Aires: "America/Argentina/Buenos_Aires",
    UTC_03_00__Cayenne__Fortaleza: "America/Cayenne",
    UTC_03_00__Greenland: "America/Godthab",
    UTC_03_00__Montevideo: "America/Montevideo",
    UTC_03_00__Salvador: "America/Bahia",
    UTC_02_00__Coordinated_Universal_Time_02: "Etc/GMT+2",
    UTC_01_00__Azores: "Atlantic/Azores",
    UTC_01_00__Cape_Verde_Is_: "Atlantic/Cape_Verde",

    // UTC+00
    UTC_00_00__Casablanca: "Africa/Casablanca",
    UTC_00_00__Coordinated_Universal_Time: "UTC",
    UTC_00_00__Dublin__Edinburgh__Lisbon__London: "Europe/London",
    UTC_00_00__Monrovia__Reykjavik: "Atlantic/Reykjavik",

    // UTC+01
    UTC_01_00__Amsterdam__Berlin__Bern__Rome__Stockholm__Vienna:
        "Europe/Berlin",
    UTC_01_00__Belgrade__Bratislava__Budapest__Ljubljana__Prague:
        "Europe/Budapest",
    UTC_01_00__Brussels__Copenhagen__Madrid__Paris: "Europe/Paris",
    UTC_01_00__Sarajevo__Skopje__Warsaw__Zagreb: "Europe/Warsaw",
    UTC_01_00__West_Central_Africa: "Africa/Lagos",

    // UTC+02
    UTC_02_00__Amman: "Asia/Amman",
    UTC_02_00__Athens__Bucharest__Istanbul: "Europe/Athens",
    UTC_02_00__Beirut: "Asia/Beirut",
    UTC_02_00__Cairo: "Africa/Cairo",
    UTC_02_00__Damascus: "Asia/Damascus",
    UTC_02_00__Harare__Pretoria: "Africa/Johannesburg",
    UTC_02_00__Helsinki__Kyiv__Riga__Sofia__Tallinn__Vilnius: "Europe/Helsinki",
    UTC_02_00__Jerusalem: "Asia/Jerusalem",
    UTC_02_00__Tripoli: "Africa/Tripoli",
    UTC_02_00__Windhoek: "Africa/Windhoek",

    // UTC+03
    UTC_03_00__Baghdad: "Asia/Baghdad",
    UTC_03_00__Istanbul: "Europe/Istanbul",
    UTC_03_00__Kuwait__Riyadh: "Asia/Riyadh",
    UTC_03_00__Minsk: "Europe/Minsk",
    UTC_03_00__Moscow__St__Petersburg__Volgograd: "Europe/Moscow",
    UTC_03_30__Tehran: "Asia/Tehran",

    // UTC+04
    UTC_04_00__Abu_Dhabi__Muscat: "Asia/Dubai",
    UTC_04_00__Baku: "Asia/Baku",
    UTC_04_00__Port_Louis: "Indian/Mauritius",
    UTC_04_00__Tbilisi: "Asia/Tbilisi",
    UTC_04_00__Yerevan: "Asia/Yerevan",
    UTC_04_30__Kabul: "Asia/Kabul",

    // UTC+05
    UTC_05_00__Ekaterinburg: "Asia/Yekaterinburg",
    UTC_05_00__Islamabad__Karachi: "Asia/Karachi",
    UTC_05_30__Chennai__Kolkata__Mumbai__New_Delhi: "Asia/Kolkata",
    UTC_05_30__Sri_Jayawardenepura: "Asia/Colombo",
    UTC_05_45__Kathmandu: "Asia/Kathmandu",

    // UTC+06
    UTC_06_00__Astana: "Asia/Almaty",
    UTC_06_00__Dhaka: "Asia/Dhaka",
    UTC_06_00__Novosibirsk: "Asia/Novosibirsk",
    UTC_06_30__Yangon__Rangoon_: "Asia/Yangon",

    // UTC+07
    UTC_07_00__Bangkok__Hanoi__Jakarta: "Asia/Bangkok",
    UTC_07_00__Krasnoyarsk: "Asia/Krasnoyarsk",

    // UTC+08
    UTC_08_00__Beijing__Chongqing__Hong_Kong__Urumqi: "Asia/Shanghai",
    UTC_08_00__Irkutsk: "Asia/Irkutsk",
    UTC_08_00__Kuala_Lumpur__Singapore: "Asia/Singapore",
    UTC_08_00__Perth: "Australia/Perth",
    UTC_08_00__Taipei: "Asia/Taipei",
    UTC_08_00__Ulaanbaatar: "Asia/Ulaanbaatar",

    // UTC+09
    UTC_09_00__Osaka__Sapporo__Tokyo: "Asia/Tokyo",
    UTC_09_00__Seoul: "Asia/Seoul",
    UTC_09_00__Yakutsk: "Asia/Yakutsk",
    UTC_09_30__Adelaide: "Australia/Adelaide",
    UTC_09_30__Darwin: "Australia/Darwin",

    // UTC+10
    UTC_10_00__Brisbane: "Australia/Brisbane",
    UTC_10_00__Canberra__Melbourne__Sydney: "Australia/Sydney",
    UTC_10_00__Guam__Port_Moresby: "Pacific/Guam",
    UTC_10_00__Hobart: "Australia/Hobart",
    UTC_10_00__Vladivostok: "Asia/Vladivostok",

    // UTC+11
    UTC_11_00__Magadan__Solomon_Is___New_Caledonia: "Pacific/Guadalcanal",

    // UTC+12
    UTC_12_00__Auckland__Wellington: "Pacific/Auckland",
    UTC_12_00__Coordinated_Universal_Time_12: "Etc/GMT-12",
    UTC_12_00__Fiji: "Pacific/Fiji",
    UTC_12_00__Petropavlovsk_Kamchatsky: "Asia/Kamchatka",

    // UTC+13 and UTC+14
    UTC_13_00__Nuku_alofa: "Pacific/Tongatapu",
    UTC_13_00__Samoa: "Pacific/Apia",
    UTC_14_00__Kiritimati_Island: "Pacific/Kiritimati",
};

const prisma = new PrismaClient();

async function main() {
    const isDryRun = process.argv.includes("--dry-run");

    console.log("🔄 Timezone Enum to IANA Migration");
    console.log("===================================\n");
    console.log(
        `Mode: ${isDryRun ? "DRY RUN (no changes will be made)" : "LIVE (will update database)"}\n`
    );

    try {
        // Get all users with their current timezone using raw query to bypass Prisma type checking
        // This handles cases where timezone might be in different formats
        const allUsers = await prisma.$queryRaw<
            Array<{ id: string; time_zone: string }>
        >`
            SELECT id, time_zone 
            FROM "User" 
            WHERE time_zone IS NOT NULL;
        `;

        console.log(`Found ${allUsers.length} users with timezone set\n`);

        // Count migrations needed
        const migrations: Array<{
            userId: string;
            oldTimezone: string;
            newTimezone: string;
        }> = [];
        const alreadyIana: string[] = [];
        const unmapped: Array<{ userId: string; value: string }> = [];

        for (const user of allUsers) {
            const timezoneValue = user.time_zone as string;
            let ianaTimezone: string | undefined;

            // Check if it's already in IANA format (contains /)
            if (timezoneValue.includes("/")) {
                alreadyIana.push(user.id);
                continue;
            }

            // Check if it's a formatted display string (starts with (UTC)
            if (timezoneValue.startsWith("(UTC")) {
                ianaTimezone = DISPLAY_NAME_TO_IANA[timezoneValue];
            }
            // Check if it's an enum format value
            else if (timezoneValue.startsWith("UTC_")) {
                ianaTimezone = TIMEZONE_MAP[timezoneValue];
            }

            if (ianaTimezone) {
                migrations.push({
                    userId: user.id,
                    oldTimezone: timezoneValue,
                    newTimezone: ianaTimezone,
                });
            } else {
                unmapped.push({
                    userId: user.id,
                    value: timezoneValue,
                });
            }
        }

        console.log(`📊 Migration Summary:`);
        console.log(`   - Users to migrate: ${migrations.length}`);
        console.log(`   - Users already in IANA format: ${alreadyIana.length}`);
        console.log(`   - Users with unmapped timezones: ${unmapped.length}\n`);

        if (unmapped.length > 0) {
            console.log(`⚠️  Unmapped timezone values (first 5):`);
            unmapped.slice(0, 5).forEach((u) => {
                console.log(`   User ${u.userId}: "${u.value}"`);
            });
            if (unmapped.length > 5) {
                console.log(`   ... and ${unmapped.length - 5} more`);
            }
            console.log();
        }

        if (migrations.length === 0) {
            console.log(
                "✅ No migrations needed. All timezones are already IANA or unmapped.\n"
            );
            return;
        }

        // Show sample migrations
        console.log("📋 Sample migrations (first 5):");
        migrations.slice(0, 5).forEach((migration) => {
            console.log(
                `   ${migration.oldTimezone} → ${migration.newTimezone}`
            );
        });
        if (migrations.length > 5) {
            console.log(`   ... and ${migrations.length - 5} more\n`);
        } else {
            console.log();
        }

        if (isDryRun) {
            console.log(
                "🔍 DRY RUN: No changes made. Run without --dry-run to apply migrations.\n"
            );
            return;
        }

        // Perform migrations
        console.log("🚀 Starting migration...\n");

        let successCount = 0;
        let errorCount = 0;

        // First, we need to convert the enum column to text type
        // Then we can update the values to IANA identifiers
        console.log(
            "📝 Step 1: Converting time_zone column from enum to text...\n"
        );

        try {
            // Convert enum column to text using ALTER TYPE ... USING
            // This converts all enum values to their text representation
            await prisma.$executeRawUnsafe(`
                ALTER TABLE "User" 
                ALTER COLUMN time_zone TYPE VARCHAR(50) 
                USING time_zone::text
            `);
            console.log("✅ Column type converted successfully\n");
        } catch (error: any) {
            // If column is already text type, that's fine
            if (
                error.message?.includes("is not of type") ||
                error.message?.includes("already")
            ) {
                console.log("ℹ️  Column is already text type, continuing...\n");
            } else {
                console.error("❌ Error converting column type:", error);
                throw error;
            }
        }

        // Now update the values to IANA identifiers
        console.log(
            "📝 Step 2: Updating timezone values to IANA identifiers...\n"
        );

        for (const migration of migrations) {
            try {
                await prisma.$executeRaw`
                    UPDATE "User"
                    SET time_zone = ${migration.newTimezone}
                    WHERE id = ${migration.userId}
                `;
                successCount++;
            } catch (error) {
                console.error(
                    `❌ Error migrating user ${migration.userId}:`,
                    error
                );
                errorCount++;
            }
        }

        console.log("\n✅ Migration Complete!");
        console.log(`   - Successful: ${successCount}`);
        console.log(`   - Failed: ${errorCount}`);
        console.log("\n⚠️  Next Steps:");
        console.log(
            "   1. Update Prisma schema to change time_zone from enum to String"
        );
        console.log("   2. Run: npx prisma generate");
        console.log(
            "   3. Run: npx prisma migrate dev --name migrate_timezone_to_iana\n"
        );
    } catch (error) {
        console.error("❌ Migration failed:", error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

main();
