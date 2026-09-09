#!/usr/bin/env bash
# ==============================================================================
# Update AWS RDS Security Group Inbound IP Rule
# ==============================================================================
# Automatically detects current public IP address and updates the AWS EC2
# Security Group allowing inbound access to AWS RDS (PostgreSQL/MySQL).
#
# Usage:
#   bash scripts/development/update-rds-ip.sh [options]
#   npm run update:rds-ip
#
# Options:
#   --profile, -profile <name>  AWS CLI Profile name (or use AWS_PROFILE env var)
#   --sso                       Force AWS SSO login before updating
#   -g, --group-id <sg-id>      Security Group ID (e.g., sg-0123456789abcdef0)
#   -i, --instance-id <rds-id>  RDS Instance/Cluster Identifier (default: archaser-db-encrypted)
#   -r, --region <region>       AWS Region (default: eu-north-1)
#   -p, --port <port>           DB Port (default: 5432)
#   -d, --description <desc>    Rule description (default: archaser-dev:$USER)
#   --ip <ip>                   Specify IP manually instead of auto-detecting
#   -h, --help                  Show help message
# ==============================================================================

set -eo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Defaults
DEFAULT_REGION="eu-north-1"
DEFAULT_INSTANCE_ID="archaser-db-encrypted"
DEFAULT_PORT="5432"
DEFAULT_DESCRIPTION="archaser-dev:${USER:-bosenilotpal}"

SG_ID=""
RDS_INSTANCE_ID=""
AWS_REGION_VAL=""
DB_PORT=""
RULE_DESC=""
MANUAL_IP=""
AWS_PROFILE_VAL=""
FORCE_SSO=false
DATABASE_URL_VAL=""
STATIC_KEY_ID=""
STATIC_SECRET=""

# Helper functions to print logs
log_info() { echo -e "${CYAN}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

show_help() {
  cat << EOF
Usage: $(basename "$0") [options]

Automatically update AWS RDS Security Group inbound rule with your current public IP.

Options:
  --profile, -profile <name>  AWS CLI Profile name (or use AWS_PROFILE env var)
  --sso                       Force AWS SSO login before updating
  -g, --group-id <sg-id>      AWS EC2 Security Group ID (e.g. sg-0d1c18c2cf82dcfa3)
  -i, --instance-id <rds-id>  RDS Instance or Cluster Identifier (default: archaser-db-encrypted)
  -r, --region <region>       AWS Region (default: eu-north-1)
  -p, --port <port>           Database Port (default: 5432)
  -d, --description <desc>    Description label for security group rule (default: archaser-dev:$USER)
  --ip <ip-address>           Override public IP detection with specified IPv4 address
  -h, --help                  Show this help menu

Environment Variables (Optional):
  AWS_PROFILE                 AWS CLI Profile name
  DATABASE_URL                Database Connection String (used to auto-detect RDS host)
  AWS_SECURITY_GROUP_ID       Security Group ID
  RDS_INSTANCE_ID             RDS Instance or Cluster Identifier
  AWS_REGION                  AWS Region
  DB_PORT                     Database Port
EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile|-profile)
      AWS_PROFILE_VAL="$2"
      shift 2
      ;;
    --sso)
      FORCE_SSO=true
      shift 1
      ;;
    -g|--group-id)
      SG_ID="$2"
      shift 2
      ;;
    -i|--instance-id|--cluster-id)
      RDS_INSTANCE_ID="$2"
      shift 2
      ;;
    -r|--region)
      AWS_REGION_VAL="$2"
      shift 2
      ;;
    -p|--port)
      DB_PORT="$2"
      shift 2
      ;;
    -d|--description)
      RULE_DESC="$2"
      shift 2
      ;;
    --ip)
      MANUAL_IP="$2"
      shift 2
      ;;
    -h|--help)
      show_help
      exit 0
      ;;
    *)
      log_error "Unknown option: $1"
      show_help
      exit 1
      ;;
  esac
done

# Load .env / .env.local if present in current or parent directory
load_env_file() {
  local env_file="$1"
  if [[ -f "$env_file" ]]; then
    log_info "Reading environment variables from $(basename "$env_file")..."
    while IFS= read -r line || [[ -n "$line" ]]; do
      # Strip comments and carriage returns
      line=$(echo "$line" | sed -e 's/\r//g' -e 's/#.*//')
      [[ -z "$line" ]] && continue
      
      if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
        local key="${BASH_REMATCH[1]}"
        local val="${BASH_REMATCH[2]}"
        # Strip surrounding quotes if present
        val=$(echo "$val" | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
        
        case "$key" in
          DATABASE_URL) [[ -z "$DATABASE_URL_VAL" ]] && DATABASE_URL_VAL="$val" ;;
          AWS_PROFILE) [[ -z "$AWS_PROFILE_VAL" ]] && AWS_PROFILE_VAL="$val" ;;
          AWS_ACCESS_KEY_ID) [[ -z "$STATIC_KEY_ID" ]] && STATIC_KEY_ID="$val" ;;
          AWS_SECRET_ACCESS_KEY) [[ -z "$STATIC_SECRET" ]] && STATIC_SECRET="$val" ;;
          NEXT_APP_AWS_REGION) [[ -z "$AWS_REGION_VAL" ]] && AWS_REGION_VAL="$val" ;;
          AWS_REGION) [[ -z "$AWS_REGION_VAL" ]] && AWS_REGION_VAL="$val" ;;
          RDS_SECURITY_GROUP_ID|AWS_SECURITY_GROUP_ID) [[ -z "$SG_ID" ]] && SG_ID="$val" ;;
          RDS_INSTANCE_ID) [[ -z "$RDS_INSTANCE_ID" ]] && RDS_INSTANCE_ID="$val" ;;
        esac
      fi
    done < "$env_file"
  fi
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [[ -f "$PROJECT_ROOT/.env" ]]; then
  load_env_file "$PROJECT_ROOT/.env"
elif [[ -f "$PROJECT_ROOT/.env.local" ]]; then
  load_env_file "$PROJECT_ROOT/.env.local"
fi

# Auto-extract RDS host and identifier from DATABASE_URL if available
if [[ -n "$DATABASE_URL_VAL" && -z "$SG_ID" && ( -z "$RDS_INSTANCE_ID" || "$RDS_INSTANCE_ID" == "$DEFAULT_INSTANCE_ID" ) ]]; then
  HOST_MATCH=$(echo "$DATABASE_URL_VAL" | sed -nE 's/.*@([^:\/]+).*/\1/p')
  if [[ "$HOST_MATCH" =~ ^([a-zA-Z0-9-]+)\.c[a-zA-Z0-9]+\.([a-z0-9-]+)\.rds\.amazonaws\.com$ ]]; then
    EXTRACTED_ID="${BASH_REMATCH[1]}"
    EXTRACTED_REGION="${BASH_REMATCH[2]}"
    if [[ -n "$EXTRACTED_ID" ]]; then
      RDS_INSTANCE_ID="$EXTRACTED_ID"
      AWS_REGION_VAL="${EXTRACTED_REGION:-$AWS_REGION_VAL}"
      log_info "Detected RDS target '${GREEN}${RDS_INSTANCE_ID}${NC}' from DATABASE_URL."
    fi
  fi
fi

# Set final values with fallbacks
AWS_REGION_VAL="${AWS_REGION_VAL:-${AWS_REGION:-$DEFAULT_REGION}}"
RDS_INSTANCE_ID="${RDS_INSTANCE_ID:-$DEFAULT_INSTANCE_ID}"
DB_PORT="${DB_PORT:-$DEFAULT_PORT}"
RULE_DESC="${RULE_DESC:-$DEFAULT_DESCRIPTION}"
SG_ID="${SG_ID:-${AWS_SECURITY_GROUP_ID:-${RDS_SECURITY_GROUP_ID:-}}}"

export AWS_REGION="$AWS_REGION_VAL"

# Auto-detect AWS profile from ~/.aws/config if not explicitly set
AWS_PROFILE="${AWS_PROFILE_VAL:-${AWS_PROFILE:-}}"
if [[ -z "$AWS_PROFILE" && -f "$HOME/.aws/config" ]]; then
  DETECTED_PROFILE=$(grep -E '^\[profile ' "$HOME/.aws/config" | head -n 1 | sed -E 's/\[profile (.*)\]/\1/' | tr -d '\r')
  if [[ -n "$DETECTED_PROFILE" ]]; then
    AWS_PROFILE="$DETECTED_PROFILE"
  fi
fi

AWS_CLI_ARGS=()
if [[ -n "$AWS_PROFILE" ]]; then
  AWS_CLI_ARGS+=("--profile" "$AWS_PROFILE")
  # Ensure static credentials in environment don't override SSO profile
  unset AWS_ACCESS_KEY_ID
  unset AWS_SECRET_ACCESS_KEY
  log_info "Using AWS Profile: ${GREEN}${AWS_PROFILE}${NC}"
elif [[ -n "$STATIC_KEY_ID" ]]; then
  export AWS_ACCESS_KEY_ID="$STATIC_KEY_ID"
  export AWS_SECRET_ACCESS_KEY="$STATIC_SECRET"
fi

# Check AWS CLI installation
if ! command -v aws &> /dev/null; then
  log_error "AWS CLI ('aws') is not installed or not in PATH."
  log_error "Please install AWS CLI: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
  exit 1
fi

# Authenticate via AWS SSO or verify existing credentials
ensure_aws_authentication() {
  if [[ "$FORCE_SSO" == "true" ]]; then
    log_info "Initiating AWS SSO login${AWS_PROFILE:+ for profile '$AWS_PROFILE'}..."
    aws sso login "${AWS_CLI_ARGS[@]}"
    return 0
  fi

  log_info "Verifying AWS credentials..."
  if ! aws sts get-caller-identity "${AWS_CLI_ARGS[@]}" >/dev/null 2>&1; then
    log_warn "AWS credentials invalid or expired. Triggering AWS SSO login..."
    if aws sso login "${AWS_CLI_ARGS[@]}"; then
      log_success "AWS SSO login successful!"
    else
      log_error "AWS SSO login failed."
      log_error "Please run 'aws sso login ${AWS_PROFILE:+--profile $AWS_PROFILE}' manually."
      exit 1
    fi
  else
    log_success "AWS authentication verified."
  fi
}

ensure_aws_authentication

# Determine public IP address
if [[ -n "$MANUAL_IP" ]]; then
  PUBLIC_IP="$MANUAL_IP"
  log_info "Using manually provided IP: $PUBLIC_IP"
else
  log_info "Detecting public IP address..."
  PUBLIC_IP=""
  for service in "https://checkip.amazonaws.com" "https://ifconfig.me" "https://api.ipify.org" "https://icanhazip.com"; do
    PUBLIC_IP=$(curl -s --max-time 5 "$service" | tr -d '[:space:]') || true
    if [[ "$PUBLIC_IP" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
      break
    fi
  done
fi

if [[ ! "$PUBLIC_IP" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
  log_error "Failed to retrieve valid public IPv4 address (got '$PUBLIC_IP')."
  log_error "Please specify your IP address manually using --ip <your-ip>."
  exit 1
fi

log_info "Detected Public IP: ${GREEN}${PUBLIC_IP}${NC}"

# Find Security Group ID if not specified
if [[ -z "$SG_ID" ]]; then
  log_info "Fetching Security Group ID for RDS Target '${RDS_INSTANCE_ID}' in region '${AWS_REGION_VAL}'..."
  
  # 1. Check Standalone DB Instance
  SG_ID=$(aws rds describe-db-instances "${AWS_CLI_ARGS[@]}" \
    --db-instance-identifier "$RDS_INSTANCE_ID" \
    --query "DBInstances[0].VpcSecurityGroups[0].VpcSecurityGroupId" \
    --output text 2>/dev/null || true)
    
  # 2. Check Aurora DB Cluster if instance lookup returned nothing
  if [[ -z "$SG_ID" || "$SG_ID" == "None" ]]; then
    SG_ID=$(aws rds describe-db-clusters "${AWS_CLI_ARGS[@]}" \
      --db-cluster-identifier "$RDS_INSTANCE_ID" \
      --query "DBClusters[0].VpcSecurityGroups[0].VpcSecurityGroupId" \
      --output text 2>/dev/null || true)
  fi

  # 3. Fallback: List available instances & clusters to assist user
  if [[ -z "$SG_ID" || "$SG_ID" == "None" ]]; then
    log_error "Could not resolve Security Group ID for RDS target '$RDS_INSTANCE_ID'."
    log_info "Available RDS Instances & Clusters in region '${AWS_REGION_VAL}':"
    aws rds describe-db-instances "${AWS_CLI_ARGS[@]}" \
      --query "DBInstances[*].[DBInstanceIdentifier, Endpoint.Address, VpcSecurityGroups[0].VpcSecurityGroupId]" \
      --output table 2>/dev/null || true
    aws rds describe-db-clusters "${AWS_CLI_ARGS[@]}" \
      --query "DBClusters[*].[DBClusterIdentifier, Endpoint, VpcSecurityGroups[0].VpcSecurityGroupId]" \
      --output table 2>/dev/null || true
    log_error "Pass target using: -i <instance-or-cluster-id> or -g <security-group-id>"
    exit 1
  fi
fi

log_info "Target Security Group ID: ${GREEN}${SG_ID}${NC}"
log_info "Database Port: ${GREEN}${DB_PORT}${NC}"

# Check current Security Group Ingress rules
log_info "Checking existing security group rules..."
EXISTING_RULES=$(aws ec2 describe-security-group-rules "${AWS_CLI_ARGS[@]}" \
  --filters "Name=group-id,Values=$SG_ID" \
  --output json 2>/dev/null || true)

IS_EXACT_MATCH=false
OLD_RULE_ID=""
OLD_CIDR=""

if [[ -n "$EXISTING_RULES" ]]; then
  RULE_INFO=$(aws ec2 describe-security-group-rules "${AWS_CLI_ARGS[@]}" \
    --filters "Name=group-id,Values=$SG_ID" \
    --query "SecurityGroupRules[?IsEgress==\`false\` && FromPort==\`$DB_PORT\`].[SecurityGroupRuleId, CidrIpv4, Description]" \
    --output text 2>/dev/null || true)

  while read -r rule_id cidr desc; do
    if [[ -z "$rule_id" ]]; then continue; fi
    if [[ "$cidr" == "${PUBLIC_IP}/32" ]]; then
      IS_EXACT_MATCH=true
      log_success "IP ${PUBLIC_IP}/32 is already authorized in Security Group $SG_ID on port $DB_PORT!"
      exit 0
    fi
    if [[ "$desc" == "$RULE_DESC" ]]; then
      OLD_RULE_ID="$rule_id"
      OLD_CIDR="$cidr"
    fi
  done <<< "$RULE_INFO"
fi

# Revoke old rule if found with matching description label
if [[ -n "$OLD_RULE_ID" ]]; then
  log_info "Revoking previous rule ($OLD_RULE_ID for $OLD_CIDR)..."
  aws ec2 revoke-security-group-ingress "${AWS_CLI_ARGS[@]}" \
    --group-id "$SG_ID" \
    --security-group-rule-ids "$OLD_RULE_ID" >/dev/null 2>&1 || true
fi

# Authorize new IP
log_info "Adding rule for ${PUBLIC_IP}/32 on port ${DB_PORT} (Description: '${RULE_DESC}')..."
if aws ec2 authorize-security-group-ingress "${AWS_CLI_ARGS[@]}" \
  --group-id "$SG_ID" \
  --ip-permissions "IpProtocol=tcp,FromPort=$DB_PORT,ToPort=$DB_PORT,IpRanges=[{CidrIp=${PUBLIC_IP}/32,Description='${RULE_DESC}'}]" >/dev/null 2>&1; then
  log_success "Successfully updated RDS Security Group ($SG_ID)!"
  log_success "Allowed IP: ${PUBLIC_IP}/32 on Port: ${DB_PORT}"
else
  # Fallback to simple CIDR authorization if description format fails
  if aws ec2 authorize-security-group-ingress "${AWS_CLI_ARGS[@]}" \
    --group-id "$SG_ID" \
    --protocol tcp \
    --port "$DB_PORT" \
    --cidr "${PUBLIC_IP}/32" >/dev/null 2>&1; then
    log_success "Successfully updated RDS Security Group ($SG_ID)!"
    log_success "Allowed IP: ${PUBLIC_IP}/32 on Port: ${DB_PORT}"
  else
    log_error "Failed to authorize IP ${PUBLIC_IP}/32 on Security Group $SG_ID."
    log_error "Verify that your AWS SSO user/role has 'ec2:AuthorizeSecurityGroupIngress' permission."
    exit 1
  fi
fi
