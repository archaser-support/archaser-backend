#!/bin/bash

# scripts/deployment/deploy-staging.sh

# Ensure Bash execution (not sh/dash)
if [ -z "${BASH_VERSION:-}" ]; then
    exec /bin/bash "$0" "$@"
fi

# Staging UI is Amplify. This EC2 box is Nest-only (api.staging.archaser.com).
# Use: bash backend/scripts/deployment/deploy-backend-docker.sh --env staging
if [ "${ALLOW_LEGACY_EC2_UI:-}" != "1" ]; then
    echo "Error: deploy-staging.sh ships the Next UI to this EC2 and must not run here."
    echo "Staging UI is Amplify at staging.archaser.com."
    echo "Deploy Nest with: bash backend/scripts/deployment/deploy-backend-docker.sh --env staging"
    echo "Override only for rollback: ALLOW_LEGACY_EC2_UI=1 bash .../deploy-staging.sh"
    exit 1
fi

# Force npm scripts to use Linux shell in WSL/Linux.
# This avoids accidental cmd.exe usage from a persisted npm script-shell config.
export npm_config_script_shell="/bin/bash"

# ==========================================
# NODE.JS VERSION MANAGEMENT (nvm)
# ==========================================
# Source nvm so we use the correct Node.js version (v20+),
# not the system apt Node.js (v12) which causes segfaults with Next.js 15 / Prisma 6.
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"

if ! command -v node >/dev/null 2>&1; then
    echo "Error: node not found in PATH."
    exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
    echo "Error: npm not found in PATH."
    exit 1
fi

echo "Using Node.js: $(node -v)"
echo "Using npm: $(npm -v)"

# ==========================================
# CONFIGURATION
# ==========================================
EC2_HOST="ec2-51-20-111-232.eu-north-1.compute.amazonaws.com"
EC2_USER="ubuntu"
PEM_KEY_PATH="/home/bosenilotpal/archaser.pem"
REMOTE_APP_DIR="/home/ubuntu/staging"
BUILD_DIR="frontend/build"
PM2_APP_NAME="archaser-staging"

# ==========================================
# SCRIPT
# ==========================================

# Colors
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

LINUX_BUILD_DIR="$HOME/.archaser-build-staging"

# Parse arguments
START_STEP=1

while [[ "$#" -gt 0 ]]; do
    case $1 in
        --step) START_STEP="$2"; shift ;;
        *) echo "Unknown parameter passed: $1"; exit 1 ;;
    esac
    shift
done

echo -e "${CYAN}Starting STAGING deployment to $EC2_HOST...${NC}"
echo -e "${CYAN}Resuming from Step $START_STEP${NC}"

# 0. Check prerequisites
if ! command -v tar &> /dev/null; then
    echo -e "${RED}Error: 'tar' command not found.${NC}"
    exit 1
fi

# 1. Build Locally
if [ $START_STEP -le 1 ]; then
    echo -e "\n${YELLOW}[1/4] Building project locally (Staging)...${NC}"
    build_start=$(date +%s)

    # ==========================================================================
    # WHY WE COPY TO A NATIVE LINUX DIRECTORY:
    # node_modules installed on a Windows NTFS mount (/mnt/d) only contains the
    # 'musl' SWC binary (linux-x64-musl, used in Alpine Docker containers).
    # Ubuntu WSL2 uses glibc, which requires the 'linux-x64-gnu' SWC binary.
    # Loading the musl binary on glibc causes a segmentation fault immediately.
    # Fix: rsync source to a native Linux dir, run npm install there to get the
    # correct glibc SWC binary, build, then copy results back for packaging.
    # ==========================================================================

    LINUX_BUILD_DIR="$HOME/.archaser-build-staging"
    SRC_DIR="$(pwd)"

    echo -e "-> Copying source to native Linux filesystem: $LINUX_BUILD_DIR"
    mkdir -p "$LINUX_BUILD_DIR"

    # Rsync everything except node_modules, .next, and build output
    rsync -a --delete \
        --exclude='node_modules/' \
        --exclude='.next/' \
        --exclude="$BUILD_DIR/" \
        --exclude='deploy-staging.tar.gz' \
        --exclude='deploy-production.tar.gz' \
        "$SRC_DIR/" "$LINUX_BUILD_DIR/"

    # Copy .env.staging as .env.production.local for the build
    if [ -f "$SRC_DIR/frontend/.env.staging" ]; then
        echo -e "-> Using .env.staging for build..."
        cp "$SRC_DIR/frontend/.env.staging" "$LINUX_BUILD_DIR/.env.production.local"
    else
        echo -e "${RED}Error: .env.staging file not found!${NC}"
        exit 1
    fi

    # Install dependencies on native Linux filesystem (gets correct linux-x64-gnu SWC binary)
    echo -e "-> Installing dependencies on native Linux filesystem (may take a moment)..."
    cd "$LINUX_BUILD_DIR"
    npm install --no-audit --ignore-scripts 2>&1 | tail -5

    # Run the Next.js build
    echo -e "-> Running Next.js production build..."
    npm run build:staging
    build_status=$?

    # Cleanup temp env file
    rm -f "$LINUX_BUILD_DIR/.env.production.local"

    if [ $build_status -ne 0 ]; then
        echo -e "${RED}Build failed. Aborting deployment.${NC}"
        cd "$SRC_DIR"
        exit 1
    fi

    # Copy build output back for local inspection. Use tar instead of rsync because
    # rsync to /mnt/d (NTFS) can truncate large JSON files like routes-manifest.json.
    echo -e "-> Copying build output back to source directory (via tar pipe)..."
    cd "$SRC_DIR"
    rm -rf "$BUILD_DIR"
    (cd "$LINUX_BUILD_DIR" && tar -cf - "$BUILD_DIR") | tar -xf -

    build_end=$(date +%s)
    echo -e "${GREEN}Build completed in $((build_end - build_start)) seconds${NC}"
else
    echo -e "\n${YELLOW}[1/4] Skipping Build (Already done)...${NC}"
fi


# 2. Package Artifacts
artifact_name="deploy-staging.tar.gz"

if [ $START_STEP -le 2 ]; then
    echo -e "\n${YELLOW}[2/4] Packaging artifacts...${NC}"

    rm -f "$artifact_name"

    SRC_DIR="$(pwd)"
    BUILD_SOURCE="$SRC_DIR"
    if [ -f "$LINUX_BUILD_DIR/$BUILD_DIR/routes-manifest.json" ]; then
        manifest_size=$(wc -c < "$LINUX_BUILD_DIR/$BUILD_DIR/routes-manifest.json")
        if [ "$manifest_size" -gt 5000 ]; then
            BUILD_SOURCE="$LINUX_BUILD_DIR"
            echo -e "-> Packaging build/ from native Linux dir (${manifest_size}-byte routes-manifest)"
        else
            echo -e "${YELLOW}Warning: Linux routes-manifest looks truncated (${manifest_size} bytes). Using local copy.${NC}"
        fi
    fi

    if [ ! -f "$BUILD_SOURCE/$BUILD_DIR/routes-manifest.json" ]; then
        echo -e "${RED}Error: routes-manifest.json not found in $BUILD_SOURCE/$BUILD_DIR${NC}"
        exit 1
    fi

    # Package build from native Linux dir when available; other files from project root.
    # Include logging/Grafana assets (same set as deploy-production.sh) so Postgres-logs
    # dashboards and alert rules land on EC2 with the app deploy.
    tar -czf "$SRC_DIR/$artifact_name" \
        -C "$BUILD_SOURCE" "$BUILD_DIR" \
        -C "$SRC_DIR" frontend/public frontend/next.config.js frontend/package.json frontend/nest-api-rewrite.cjs frontend/i18nConfig.ts frontend/middleware.ts backend/prisma package.json package-lock.json backend/ecosystem.config.js backend/scripts/deployment/fix-routes-manifest.js frontend/shared/templates/emails frontend/.env.staging backend/.env.staging \
        backend/grafana \

    if [ ! -f "$artifact_name" ]; then
        echo -e "${RED}Failed to create package $artifact_name${NC}"
        exit 1
    fi
    echo -e "${GREEN}Package created: $artifact_name${NC}"
else
    echo -e "\n${YELLOW}[2/4] Skipping Packaging (Already done)...${NC}"
fi

# 3. Upload to EC2
if [ $START_STEP -le 3 ]; then
    echo -e "\n${YELLOW}[3/4] Uploading to EC2...${NC}"
    echo -e "-> Removing previous remote artifact (if exists)..."
    ssh -i "$PEM_KEY_PATH" "$EC2_USER@$EC2_HOST" "rm -f /home/ubuntu/$artifact_name"

    scp -i "$PEM_KEY_PATH" "$artifact_name" "$EC2_USER@$EC2_HOST:/home/ubuntu/"

    if [ $? -ne 0 ]; then
        echo -e "${RED}Upload failed.${NC}"
        exit 1
    fi
else
    echo -e "\n${YELLOW}[3/4] Skipping Upload (Already done)...${NC}"
fi

# 4. Remote Deployment (Mapped to Step 4 for user simplicity)
if [ $START_STEP -le 4 ]; then
    echo -e "\n${YELLOW}[4/4] Executing remote deployment commands...${NC}"

    remote_commands="
    set -e
    echo '-> Stopping application before file replacement...'
    pm2 stop $PM2_APP_NAME || true

    echo '-> Disk usage before extraction:'
    df -h /home/ubuntu || true

    echo '-> Preparing target directory...'
    mkdir -p $REMOTE_APP_DIR

    echo '-> Cleaning previous build artifacts to avoid stale chunk mix...'
    rm -rf $REMOTE_APP_DIR/build

    echo '-> Cleaning previous Next.js build cache to free disk space...'
    rm -rf $REMOTE_APP_DIR/build/cache

    echo '-> Extracting artifacts to $REMOTE_APP_DIR...'
    tar -xzf /home/ubuntu/$artifact_name -C $REMOTE_APP_DIR --overwrite

    echo '-> Configuring Environment Variables...'
    # Rename .env.staging to .env so pm2/next picks it up automatically
    cp $REMOTE_APP_DIR/frontend/.env.staging $REMOTE_APP_DIR/frontend/.env 2>/dev/null || true
    cp $REMOTE_APP_DIR/backend/.env.staging $REMOTE_APP_DIR/backend/.env 2>/dev/null || true
    cp $REMOTE_APP_DIR/backend/.env.staging $REMOTE_APP_DIR/.env 2>/dev/null || true

    echo '-> Installing production dependencies...'
    cd $REMOTE_APP_DIR
    npm install --production --no-audit --ignore-scripts

    echo '-> Running backend setup (Prisma generate + sync)...'
    if [ -f backend/package.json ]; then
        (cd backend && npm run setup)
    else
        npm run setup
    fi

    echo '-> Verifying routes-manifest.json...'
    node backend/scripts/deployment/fix-routes-manifest.js

    echo '-> Starting Application ($PM2_APP_NAME)...'
    pm2 start backend/ecosystem.config.js --only $PM2_APP_NAME --env production || pm2 restart $PM2_APP_NAME

    echo '-> Cleanup...'
    rm /home/ubuntu/$artifact_name

    echo '-> Deployment Successful!'
    "

    ssh -i "$PEM_KEY_PATH" "$EC2_USER@$EC2_HOST" "$remote_commands"

    if [ $? -ne 0 ]; then
        echo -e "${RED}Remote deployment failed.${NC}"
        exit 1
    fi

    echo -e "\n${GREEN}Staging deployment finished successfully!${NC}"
else
    echo -e "\n${YELLOW}[4/4] Skipping Remote Deployment... Done.${NC}"
fi
