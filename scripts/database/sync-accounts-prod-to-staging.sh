#!/usr/bin/env bash
# =============================================================================
# Sync account data from production → staging by user email or username.
#
# Default identifiers (matched against email OR username):
#   dori.stopper+88@gmail.com
#   dori.stopper+100@gmail.com
#
# Copies the full AR graph (account, users, settings, customers, invoices,
# activities, policies, reports, …). Skips ephemeral data (sessions, caches,
# delivery logs, rewrite queues). Does not touch MongoDB / Redis.
#
# Usage:
#   export SOURCE_DATABASE_URL='postgresql://…'   # production
#   export TARGET_DATABASE_URL='postgresql://…'   # staging
#   ./scripts/database/sync-accounts-prod-to-staging.sh [--dry-run] [--yes]
#
# Options:
#   --dry-run              Resolve accounts and print counts; no writes
#   --yes / -y             Skip interactive confirmation
#   --emails=a,b           Comma-separated emails/usernames (overrides defaults)
#   --source-url=URL       Override SOURCE_DATABASE_URL
#   --target-url=URL       Override TARGET_DATABASE_URL
#   --help / -h            Show this header
#
# Requirements: psql on PATH. Source and target schemas must be compatible.
#
# Notes:
# - Preserves production primary keys.
# - Purges matching account IDs on staging first (never account 10013).
# - Also purges staging accounts that own colliding usernames from the export.
# - Uses session_replication_role=replica on each target COPY (FK checks off).
#   The DB role must be allowed to set that; otherwise COPY may fail on FKs.
# - BillingConnector credentials stay encrypted — staging needs the same
#   BILLING_CONNECTOR_ENCRYPTION_KEY as production for connectors to decrypt.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PURGE_SQL="${SCRIPT_DIR}/purge-accounts-by-ids.sql"

DEFAULT_EMAILS=(
  "dori.stopper+88@gmail.com"
  "dori.stopper+100@gmail.com"
)

DRY_RUN=0
ASSUME_YES=0
SOURCE_URL="${SOURCE_DATABASE_URL:-}"
TARGET_URL="${TARGET_DATABASE_URL:-}"
EMAILS=()

log()  { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '2,38p' "$0" | sed 's/^# \?//'
  exit 0
}

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    --emails=*) IFS=',' read -r -a EMAILS <<< "${arg#--emails=}" ;;
    --source-url=*) SOURCE_URL="${arg#--source-url=}" ;;
    --target-url=*) TARGET_URL="${arg#--target-url=}" ;;
    --help|-h) usage ;;
    *) die "Unknown argument: $arg (use --help)" ;;
  esac
done

if [[ ${#EMAILS[@]} -eq 0 ]]; then
  EMAILS=("${DEFAULT_EMAILS[@]}")
fi

[[ -n "$SOURCE_URL" ]] || die "SOURCE_DATABASE_URL (or --source-url) is required"
[[ -n "$TARGET_URL" ]] || die "TARGET_DATABASE_URL (or --target-url) is required"
[[ -f "$PURGE_SQL" ]] || die "Missing purge helper: $PURGE_SQL"
command -v psql >/dev/null || die "psql not found on PATH"

mask_url() {
  sed -E 's#(postgresql://[^:]+:)[^@]+@#\1***@#' <<<"$1"
}

psql_src() { psql "$SOURCE_URL" -v ON_ERROR_STOP=1 -X -q "$@"; }
psql_tgt() { psql "$TARGET_URL" -v ON_ERROR_STOP=1 -X -q "$@"; }

email_values() {
  local first=1 e escaped
  for e in "${EMAILS[@]}"; do
    escaped="${e//\'/\'\'}"
    if [[ $first -eq 1 ]]; then first=0; else printf ', '; fi
    printf "('%s')" "$escaped"
  done
}

sql_string_list() {
  # stdin: one value per line → 'a','b','c'
  local first=1 v escaped
  while IFS= read -r v; do
    [[ -z "$v" ]] && continue
    escaped="${v//\'/\'\'}"
    if [[ $first -eq 1 ]]; then first=0; else printf ','; fi
    printf "'%s'" "$escaped"
  done
}

sql_int_values() {
  # "1,2,3" → (1),(2),(3)
  echo "$1" | tr ',' '\n' | sed '/^$/d' | sed 's/.*/(&)/' | paste -sd, -
}

EMAIL_VALUES="$(email_values)"

log "Source: $(mask_url "$SOURCE_URL")"
log "Target: $(mask_url "$TARGET_URL")"
log "Identifiers (email or username): ${EMAILS[*]}"

# ---------------------------------------------------------------------------
# Resolve production users → account IDs (match email OR username)
# ---------------------------------------------------------------------------
log "Resolving accounts on production"

RESOLVE_SQL=$(cat <<SQL
SELECT u.id,
       u.email,
       u.username,
       u.account_id,
       COALESCE(a.name, ''),
       a.status::text,
       (SELECT COUNT(*) FROM "Customer" c WHERE c.account_id = a.id),
       (SELECT COUNT(*) FROM "Invoice" i WHERE i.account_id = a.id),
       (SELECT COUNT(*) FROM "User" uu WHERE uu.account_id = a.id)
FROM "User" u
JOIN "Account" a ON a.id = u.account_id
WHERE lower(u.email) IN (SELECT lower(e) FROM (VALUES ${EMAIL_VALUES}) AS t(e))
   OR lower(u.username) IN (SELECT lower(e) FROM (VALUES ${EMAIL_VALUES}) AS t(e))
ORDER BY u.account_id, u.email;
SQL
)

RESOLVE_OUT="$(psql_src -At -F $'\t' -c "$RESOLVE_SQL")"
[[ -n "$RESOLVE_OUT" ]] || die "No users found on production for those emails/usernames"

printf '%s\n' "$RESOLVE_OUT" | while IFS=$'\t' read -r user_id email username account_id account_name account_status customers invoices users; do
  printf '  user=%s  email=%s  username=%s  account_id=%s (%s) status=%s customers=%s invoices=%s users=%s\n' \
    "$user_id" "$email" "$username" "$account_id" "$account_name" "$account_status" "$customers" "$invoices" "$users"
done

ACCOUNT_IDS="$(printf '%s\n' "$RESOLVE_OUT" | awk -F $'\t' '{print $4}' | sort -nu | paste -sd, -)"
[[ "$ACCOUNT_IDS" != *10013* ]] || die "Refusing to sync admin account 10013"

ALL_USERNAMES="$(psql_src -At -c "SELECT username FROM \"User\" WHERE account_id IN (${ACCOUNT_IDS}) ORDER BY username;")"
ALL_USER_IDS="$(psql_src -At -c "SELECT id FROM \"User\" WHERE account_id IN (${ACCOUNT_IDS}) ORDER BY id;")"
USERNAME_VALUES="$(printf '%s\n' "$ALL_USERNAMES" | while IFS= read -r u; do [[ -z "$u" ]] && continue; printf "('%s')\n" "${u//\'/\'\'}"; done | paste -sd, -)"
USER_ID_IN="$(printf '%s\n' "$ALL_USER_IDS" | sql_string_list)"

[[ -n "$USERNAME_VALUES" ]] || die "No usernames found under resolved accounts"
[[ -n "$USER_ID_IN" ]] || die "No user ids found under resolved accounts"

log "Production account IDs to sync: ${ACCOUNT_IDS}"

# ---------------------------------------------------------------------------
# Staging collision check
# ---------------------------------------------------------------------------
log "Checking staging for existing accounts / username collisions"

STAGING_PURGE_IDS="$(psql_tgt -At -c "
SELECT DISTINCT account_id
FROM \"User\"
WHERE account_id IS NOT NULL
  AND (
    account_id IN (${ACCOUNT_IDS})
    OR username IN (SELECT u FROM (VALUES ${USERNAME_VALUES}) AS t(u))
    OR id IN (${USER_ID_IN})
  )
ORDER BY account_id;
" | paste -sd, - || true)"

# Always include production account IDs (Account row may exist without users)
STAGING_PURGE_IDS="$(printf '%s\n' ${STAGING_PURGE_IDS//,/ } ${ACCOUNT_IDS//,/ } | tr ' ' '\n' | grep -E '^[0-9]+$' | sort -nu | paste -sd, -)"
[[ "$STAGING_PURGE_IDS" != *10013* ]] || die "Staging purge set unexpectedly includes 10013"

EXISTING_ON_STAGING="$(psql_tgt -At -c "SELECT id FROM \"Account\" WHERE id IN (${ACCOUNT_IDS}) ORDER BY id;" | paste -sd, - || true)"
if [[ -n "$EXISTING_ON_STAGING" ]]; then
  warn "Staging already has Account rows: ${EXISTING_ON_STAGING} (will be purged)"
fi
log "Staging account IDs that will be purged before import: ${STAGING_PURGE_IDS}"

if [[ $DRY_RUN -eq 1 ]]; then
  log "Dry run complete — no changes made"
  exit 0
fi

if [[ $ASSUME_YES -ne 1 ]]; then
  printf '\nThis will DELETE staging data for account(s) [%s] and replace with production.\n' "$STAGING_PURGE_IDS"
  read -r -p "Type 'sync' to continue: " confirm
  [[ "$confirm" == "sync" ]] || die "Aborted"
fi

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/archaser-account-sync.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

# ---------------------------------------------------------------------------
# Purge staging
# ---------------------------------------------------------------------------
log "Purging staging accounts"
PURGE_VALUES="$(sql_int_values "$STAGING_PURGE_IDS")"
cat > "$WORK_DIR/purge.sql" <<SQL
BEGIN;
CREATE TEMP TABLE target_accounts (id integer PRIMARY KEY) ON COMMIT DROP;
INSERT INTO target_accounts (id) VALUES ${PURGE_VALUES};
$(cat "$PURGE_SQL")
COMMIT;
SQL
psql_tgt -f "$WORK_DIR/purge.sql"

log "Clearing leftover username / user-id collisions on staging"
psql_tgt <<SQL
BEGIN;
DO \$\$
BEGIN
  IF to_regclass('public."Company"') IS NOT NULL THEN
    UPDATE "Company" SET created_by = NULL
     WHERE created_by IN (${USER_ID_IN})
        OR created_by IN (SELECT id FROM "User" WHERE username IN (SELECT u FROM (VALUES ${USERNAME_VALUES}) AS t(u)));
    UPDATE "Company" SET modified_by = NULL
     WHERE modified_by IN (${USER_ID_IN})
        OR modified_by IN (SELECT id FROM "User" WHERE username IN (SELECT u FROM (VALUES ${USERNAME_VALUES}) AS t(u)));
  END IF;
  IF to_regclass('public."Person"') IS NOT NULL THEN
    UPDATE "Person" SET created_by = NULL
     WHERE created_by IN (${USER_ID_IN})
        OR created_by IN (SELECT id FROM "User" WHERE username IN (SELECT u FROM (VALUES ${USERNAME_VALUES}) AS t(u)));
    UPDATE "Person" SET modified_by = NULL
     WHERE modified_by IN (${USER_ID_IN})
        OR modified_by IN (SELECT id FROM "User" WHERE username IN (SELECT u FROM (VALUES ${USERNAME_VALUES}) AS t(u)));
  END IF;
  IF to_regclass('public."Session"') IS NOT NULL THEN
    DELETE FROM "Session"
     WHERE "userId" IN (${USER_ID_IN})
        OR "userId" IN (SELECT id FROM "User" WHERE username IN (SELECT u FROM (VALUES ${USERNAME_VALUES}) AS t(u)));
  END IF;
  IF to_regclass('public."UserPreferences"') IS NOT NULL THEN
    DELETE FROM "UserPreferences"
     WHERE "userId" IN (${USER_ID_IN})
        OR "userId" IN (SELECT id FROM "User" WHERE username IN (SELECT u FROM (VALUES ${USERNAME_VALUES}) AS t(u)));
  END IF;
  IF to_regclass('public."UserImportMappings"') IS NOT NULL THEN
    DELETE FROM "UserImportMappings"
     WHERE user_id IN (${USER_ID_IN})
        OR user_id IN (SELECT id FROM "User" WHERE username IN (SELECT u FROM (VALUES ${USERNAME_VALUES}) AS t(u)));
  END IF;
  IF to_regclass('public."Log"') IS NOT NULL THEN
    DELETE FROM "Log"
     WHERE user_id IN (${USER_ID_IN})
        OR user_id IN (SELECT id FROM "User" WHERE username IN (SELECT u FROM (VALUES ${USERNAME_VALUES}) AS t(u)));
  END IF;
  DELETE FROM "User"
   WHERE id IN (${USER_ID_IN})
      OR username IN (SELECT u FROM (VALUES ${USERNAME_VALUES}) AS t(u));
END \$\$;
COMMIT;
SQL

# ---------------------------------------------------------------------------
# Copy helpers
# ---------------------------------------------------------------------------
table_exists() {
  local url="$1" table="$2"
  local n
  n="$(psql "$url" -v ON_ERROR_STOP=1 -X -q -At -c "SELECT to_regclass('public.\"${table}\"') IS NOT NULL")"
  [[ "$n" == "t" ]]
}

# Stream SELECT from source → COPY into target (with replica role on target).
# Uses intersection of columns so minor schema drift (extra prod columns) is OK.
# Pre-deletes conflicting primary-key rows on target when an "id" column exists.
copy_select() {
  local table="$1"
  local where_sql="$2"
  local label="${3:-$table}"

  if ! table_exists "$SOURCE_URL" "$table"; then
    warn "Skip ${label}: missing on source"
    return 0
  fi
  if ! table_exists "$TARGET_URL" "$table"; then
    warn "Skip ${label}: missing on target"
    return 0
  fi

  # Shared columns in target ordinal order (stable COPY layout)
  local src_cols_file="$WORK_DIR/${table}.src_cols"
  local tgt_cols_file="$WORK_DIR/${table}.tgt_cols"
  psql_src -At -c "
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='${table}' ORDER BY ordinal_position
  " > "$src_cols_file"
  psql_tgt -At -c "
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='${table}' ORDER BY ordinal_position
  " > "$tgt_cols_file"

  local cols="" first_col=1 col
  while IFS= read -r col; do
    if grep -Fxq "$col" "$src_cols_file"; then
      if [[ $first_col -eq 1 ]]; then first_col=0; else cols+=","; fi
      cols+="\"${col}\""
    fi
  done < "$tgt_cols_file"

  if [[ -z "$cols" ]]; then
    warn "Skip ${label}: no shared columns"
    return 0
  fi

  local select_sql="SELECT ${cols} FROM \"${table}\" WHERE ${where_sql}"

  local count
  count="$(psql_src -At -c "SELECT COUNT(*) FROM (${select_sql}) AS q")"
  if [[ "$count" == "0" ]]; then
    printf '  %-42s %s\n' "$label" "0 rows"
    return 0
  fi

  local dump_file="$WORK_DIR/${table}.copy"
  psql_src -c "\\COPY (${select_sql}) TO STDOUT" > "$dump_file"

  local has_id
  has_id="$(psql_tgt -At -c "
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = '${table}' AND column_name = 'id'
    )")"
  if [[ "$has_id" == "t" ]]; then
    local id_type
    id_type="$(psql_tgt -At -c "
      SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = '${table}' AND column_name = 'id'")"
    local ids_file="$WORK_DIR/${table}.ids"
    psql_src -At -c "SELECT id FROM \"${table}\" WHERE ${where_sql}" > "$ids_file"
    if [[ -s "$ids_file" ]]; then
      local id_list
      if [[ "$id_type" == "integer" || "$id_type" == "bigint" || "$id_type" == "smallint" || "$id_type" == "numeric" ]]; then
        id_list="$(paste -sd, "$ids_file")"
        # Chunk deletes if list is huge
        psql_tgt -c "SET session_replication_role = replica" \
                 -c "DELETE FROM \"${table}\" WHERE id IN (${id_list})" >/dev/null
      else
        id_list="$(sql_string_list < "$ids_file")"
        psql_tgt -c "SET session_replication_role = replica" \
                 -c "DELETE FROM \"${table}\" WHERE id IN (${id_list})" >/dev/null
      fi
    fi
  fi

  # Explicit column list on target COPY
  psql "$TARGET_URL" -v ON_ERROR_STOP=1 -X -q \
    -c "SET session_replication_role = replica" \
    -c "\\COPY \"${table}\" (${cols}) FROM STDIN" \
    < "$dump_file"
  printf '  %-42s %s rows\n' "$label" "$count"
}

copy_where() {
  local table="$1"
  local where_sql="$2"
  local label="${3:-$table}"
  copy_select "$table" "$where_sql" "$label"
}

# Upsert shared Company/Person rows (global tables, not account-scoped)
upsert_shared() {
  local table="$1"
  local ids="$2"
  local ref_col

  if [[ -z "$ids" ]]; then
    printf '  %-42s %s\n' "$table" "0 rows"
    return 0
  fi
  if ! table_exists "$SOURCE_URL" "$table" || ! table_exists "$TARGET_URL" "$table"; then
    warn "Skip ${table}: missing on source or target"
    return 0
  fi

  local dump_file="$WORK_DIR/${table}.copy"
  local count
  count="$(psql_src -At -c "SELECT COUNT(*) FROM \"${table}\" WHERE id IN (${ids})")"
  if [[ "$count" == "0" ]]; then
    printf '  %-42s %s\n' "$table" "0 rows"
    return 0
  fi

  psql_src -c "\\COPY (SELECT * FROM \"${table}\" WHERE id IN (${ids})) TO STDOUT" > "$dump_file"

  if [[ "$table" == "Company" ]]; then ref_col="company_id"; else ref_col="person_id"; fi

  cat > "$WORK_DIR/upsert_${table}.sql" <<SQL
SET session_replication_role = replica;
DELETE FROM "${table}" t
 WHERE t.id IN (${ids})
   AND NOT EXISTS (
     SELECT 1 FROM "Customer" cu
     WHERE cu.${ref_col} = t.id
       AND cu.account_id NOT IN (${ACCOUNT_IDS})
   );
CREATE TEMP TABLE _incoming (LIKE "${table}" INCLUDING DEFAULTS);
\\copy _incoming FROM '${dump_file}'
INSERT INTO "${table}" SELECT * FROM _incoming ON CONFLICT (id) DO NOTHING;
SQL
  psql_tgt -f "$WORK_DIR/upsert_${table}.sql"
  printf '  %-42s %s rows\n' "$table" "$count"
}

ACC="account_id IN (${ACCOUNT_IDS})"
ACC_ID="id IN (${ACCOUNT_IDS})"

# ---------------------------------------------------------------------------
# Probe replica role once
# ---------------------------------------------------------------------------
log "Checking session_replication_role privilege on staging"
if ! psql_tgt -c "SET session_replication_role = replica; SET session_replication_role = DEFAULT;" >/dev/null 2>"$WORK_DIR/repl_err.txt"; then
  die "Staging DB role cannot SET session_replication_role=replica (needed to bypass FKs during COPY). Use a role with that privilege, or grant it. Detail: $(tr '\n' ' ' < "$WORK_DIR/repl_err.txt")"
fi

# ---------------------------------------------------------------------------
# Import
# ---------------------------------------------------------------------------
log "Copying account graph from production → staging"

copy_where "Account" "$ACC_ID"
copy_where "User" "$ACC"
copy_where "BusinessUnit" "$ACC"
copy_where "RolePermission" "$ACC"
copy_where "UserPreferences" "\"userId\" IN (SELECT id FROM \"User\" WHERE ${ACC})"
copy_where "UserImportMappings" "user_id IN (SELECT id FROM \"User\" WHERE ${ACC})"

copy_where "Report" "$ACC"
copy_where "ReportShare" "report_id IN (SELECT id FROM \"Report\" WHERE ${ACC})"
copy_where "ReportSchedule" "report_id IN (SELECT id FROM \"Report\" WHERE ${ACC})"
copy_where "ReportExecution" "report_id IN (SELECT id FROM \"Report\" WHERE ${ACC})"
copy_where "UserDefaultReport" "report_id IN (SELECT id FROM \"Report\" WHERE ${ACC})"

copy_where "BillingConnector" "$ACC"
copy_where "ConnectorFieldMapping" "connector_id IN (SELECT id FROM \"BillingConnector\" WHERE ${ACC})"
copy_where "ConnectorSyncState" "connector_id IN (SELECT id FROM \"BillingConnector\" WHERE ${ACC})"

copy_where "InsurancePolicy" "$ACC"
copy_where "InsurancePolicyCountry" "insurance_policy_id IN (SELECT id FROM \"InsurancePolicy\" WHERE ${ACC})"
copy_where "NamedPolicy" "insurance_policy_id IN (SELECT id FROM \"InsurancePolicy\" WHERE ${ACC})"

copy_where "AccountSMSProviderPreferences" "$ACC"
copy_where "AccountBankAccounts" "$ACC"
copy_where "BusinessUnitBankAccounts" "$ACC"
copy_where "SequenceContainer" "$ACC"
copy_where "ActivitiesTemplate" "$ACC"
copy_where "ActivityTemplateLanguage" "template_id IN (SELECT id FROM \"ActivitiesTemplate\" WHERE ${ACC})"
copy_where "ActivitiesSequence" "$ACC"
copy_where "DisputeReason" "$ACC"
copy_where "DisputeReasonLanguage" "dispute_reason_id IN (SELECT id FROM \"DisputeReason\" WHERE ${ACC})"
copy_where "InternalEmailTemplate" "$ACC"

copy_where "NotificationRuleSet" "$ACC"
copy_where "NotificationRule" "rule_set_id IN (SELECT id FROM \"NotificationRuleSet\" WHERE ${ACC})"
copy_where "NotificationRuleRoleDefault" "rule_id IN (SELECT r.id FROM \"NotificationRule\" r JOIN \"NotificationRuleSet\" s ON s.id = r.rule_set_id WHERE s.${ACC})"
copy_where "NotificationRuleUserOverride" "rule_id IN (SELECT r.id FROM \"NotificationRule\" r JOIN \"NotificationRuleSet\" s ON s.id = r.rule_set_id WHERE s.${ACC})"
copy_where "Notification" "$ACC"

COMPANY_IDS="$(psql_src -At -c "SELECT DISTINCT company_id FROM \"Customer\" WHERE ${ACC} AND company_id IS NOT NULL" | paste -sd, - || true)"
PERSON_IDS="$(psql_src -At -c "SELECT DISTINCT person_id FROM \"Customer\" WHERE ${ACC} AND person_id IS NOT NULL" | paste -sd, - || true)"
upsert_shared "Company" "$COMPANY_IDS"
upsert_shared "Person" "$PERSON_IDS"

copy_where "Customer" "$ACC"
copy_where "Contact" "customer_id IN (SELECT id FROM \"Customer\" WHERE ${ACC})"
copy_where "CommunicationChannelPreference" "customer_id IN (SELECT id FROM \"Customer\" WHERE ${ACC})"
copy_where "CustomerPolicy" "customer_id IN (SELECT id FROM \"Customer\" WHERE ${ACC})"
copy_where "CustomerTopUp" "customer_id IN (SELECT id FROM \"Customer\" WHERE ${ACC})"
copy_where "CustomerAggregatedData" "customer_id IN (SELECT id FROM \"Customer\" WHERE ${ACC})"
copy_where "CustomerCollectionPeriod" "customer_id IN (SELECT id FROM \"Customer\" WHERE ${ACC})"
copy_where "CustomerDispute" "customer_id IN (SELECT id FROM \"Customer\" WHERE ${ACC})"
copy_where "CustomerBanks" "$ACC"
copy_where "CustomerCheckpoint" "$ACC"

copy_where "Invoice" "$ACC"
copy_where "InvoicePayment" "$ACC"
copy_where "DisputeInvoice" "invoice_id IN (SELECT id FROM \"Invoice\" WHERE ${ACC})"

copy_where "Activity" "$ACC"
copy_where "ActivityContact" "activity_id IN (SELECT id FROM \"Activity\" WHERE ${ACC})"
copy_where "CommunicationLearningData" "activity_id IN (SELECT id FROM \"Activity\" WHERE ${ACC})"
copy_where "ActivityAttachment" "$ACC"

copy_where "ImportJob" "$ACC"
copy_where "ImportRecord" "import_job_id IN (SELECT id FROM \"ImportJob\" WHERE ${ACC})"

copy_where "CustomerPolicyTrend" "$ACC"
copy_where "InsurancePolicyTrend" "$ACC"
copy_where "InsurancePolicyCountryTrend" "$ACC"
copy_where "NamedPolicyTrend" "$ACC"

# ---------------------------------------------------------------------------
# Reset sequences
# ---------------------------------------------------------------------------
log "Resetting sequences on staging"
psql_tgt <<'SQL'
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT quote_ident(n.nspname) AS schem,
           quote_ident(c.relname) AS tbl,
           quote_ident(a.attname) AS col,
           pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname) AS seq
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
    WHERE n.nspname = 'public'
      AND pg_get_expr(d.adbin, d.adrelid) LIKE 'nextval%'
  LOOP
    IF r.seq IS NOT NULL THEN
      EXECUTE format(
        'SELECT setval(%L, COALESCE((SELECT MAX(%I) FROM %s.%s), 1))',
        r.seq, r.col, r.schem, r.tbl
      );
    END IF;
  END LOOP;
END $$;
SQL

# ---------------------------------------------------------------------------
# Verify
# ---------------------------------------------------------------------------
log "Verification"
psql_tgt <<SQL
SELECT a.id,
       a.name,
       (SELECT COUNT(*) FROM "User" u WHERE u.account_id = a.id) AS users,
       (SELECT COUNT(*) FROM "Customer" c WHERE c.account_id = a.id) AS customers,
       (SELECT COUNT(*) FROM "Invoice" i WHERE i.account_id = a.id) AS invoices,
       (SELECT COUNT(*) FROM "Activity" act WHERE act.account_id = a.id) AS activities
FROM "Account" a
WHERE a.id IN (${ACCOUNT_IDS})
ORDER BY a.id;

SELECT id, email, username, account_id, role, status
FROM "User"
WHERE account_id IN (${ACCOUNT_IDS})
ORDER BY account_id, email;
SQL

log "Done. Staging now has production data for account(s): ${ACCOUNT_IDS}"
warn "Skipped: Session, DashboardCache, NotificationDeliveryLog, credit rewrite queues, Mongo/Redis."
warn "If BillingConnector is used, ensure BILLING_CONNECTOR_ENCRYPTION_KEY matches production."
