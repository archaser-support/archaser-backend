#!/bin/bash
set -e # Exit immediately if a command exits with a non-zero status

# Deployment Script for Archaser on Ubuntu EC2

# Navigate to project root (2 levels up from scripts/deployment)
cd "$(dirname "$0")/../.."

# Ensure the script is run with bash
if [ -z "$BASH_VERSION" ]; then
    echo "❌ This script requires bash. Please run: bash $0"
    exit 1
fi

echo "=========================================="
echo "Starting Deployment Process"
echo "=========================================="

# Determine environment based on current directory path
CURRENT_DIR=$(pwd)
if [[ "$CURRENT_DIR" == *"/staging"* ]] || [[ "$CURRENT_DIR" == *"/staging" ]]; then
    APP_NAME="archaser-staging"
    ENVIRONMENT="staging"
elif [[ "$CURRENT_DIR" == *"/production"* ]] || [[ "$CURRENT_DIR" == *"/production" ]]; then
    APP_NAME="archaser-main"
    ENVIRONMENT="production"
else
    # Default fallback
    APP_NAME="archaser"
    ENVIRONMENT="unknown"
fi

echo "Environment detected: $ENVIRONMENT"
echo "PM2 App Name: $APP_NAME"
echo "=========================================="

# Ensure /tmp exists (required by Prisma and other tools)
if [ ! -d /tmp ]; then
    echo "⚠️ /tmp directory not found. Attempting to create it..."
    sudo mkdir -p /tmp || mkdir -p /tmp || echo "❌ Failed to create /tmp"
    sudo chmod 1777 /tmp || chmod 1777 /tmp || echo "⚠️ Could not set permissions on /tmp"
fi
export TMPDIR=/tmp

# Function to check and install System Dependencies (Docker, Node, PM2)
check_and_install_dependencies() {
    echo "Checking system dependencies..."

    # --- Docker ---
    if ! command -v docker > /dev/null 2>&1; then
        echo "Docker not found. Installing Docker..."
        sudo apt-get update
        sudo apt-get install -y ca-certificates curl gnupg
        sudo install -m 0755 -d /etc/apt/keyrings
        curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
        sudo chmod a+r /etc/apt/keyrings/docker.gpg
        echo \
          "deb [arch=\"$(dpkg --print-architecture)\" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
          $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" | \
          sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
        sudo apt-get update
        sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
        sudo systemctl start docker
        sudo systemctl enable docker
        echo "✅ Docker installed successfully."
    else
        echo "✅ Docker is already installed."
    fi

    # --- Node.js & npm (Latest LTS) ---
    if ! command -v node &> /dev/null; then
        echo "Node.js not found. Installing latest Node.js..."
        # Using NodeSource for the latest Node.js version (adjust version 20.x as needed, 20 is current LTS)
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get install -y nodejs
        echo "✅ Node.js installed successfully."
    else
        echo "✅ Node.js is already installed: $(node -v)"
    fi

    # --- PM2 ---
    if ! command -v pm2 &> /dev/null; then
        echo "PM2 not found. Installing PM2 globally..."
        sudo npm install -g pm2
        echo "✅ PM2 installed successfully."
    else
        echo "✅ PM2 is already installed."
    fi
}

# 0. Check and Install Dependencies
echo "Step 0: Checking environment requirements..."
check_and_install_dependencies

# 1. Pull from git
echo "Step 1: Pulling latest changes from git..."

# Load .env variables if present
if [ -f .env ]; then
    echo "Loading .env file..."
    set -a
    source .env
    set +a
fi

# Configure authentication if GITHUB_TOKEN is present
if [ -n "$GITHUB_TOKEN" ]; then
    echo "Found GITHUB_TOKEN. Configuring git..."
    # Update remote to use token
    git remote set-url origin "https://${GITHUB_TOKEN}@github.com/archaser-support/archaser.git"
fi

# Fetch latest changes
git fetch origin

# Reset local state to match remote, discarding any local changes (EC2 artifacts)
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "Resetting branch $CURRENT_BRANCH to remote state..."
git reset --hard "origin/$CURRENT_BRANCH"

# 2. Install packages
echo "Step 2: Installing dependencies..."
# Ensure all dependencies (including dev) are installed for the build process
# Next.js build requires @types and other dev dependencies
# ignore-scripts: lifecycle hooks blocked via .npmrc; run setup explicitly after install
NODE_ENV=development npm install --ignore-scripts

echo "Step 2.1: Running backend setup (Prisma generate + sync)..."
# Ensure DATABASE_URL is available
if [ -z "$DATABASE_URL" ]; then
    echo "WARNING: DATABASE_URL not set. Attempting to load .env again..."
    if [ -f .env ]; then
        set -a
        source .env
        set +a
    fi
fi
if [ -f backend/package.json ] && grep -q '"setup"' backend/package.json 2>/dev/null; then
    (cd backend && npm run setup)
elif grep -q '"setup"' package.json 2>/dev/null; then
    npm run setup
else
    echo "WARNING: no setup script found; run prisma generate manually"
fi

# 3. Run build
echo "Step 3: Building the application..."
npm run build

# 4. Start Monitoring Stack (Grafana, Loki, Prometheus)
if [ "$ENVIRONMENT" = "production" ]; then
    echo "Step 4: Starting Monitoring Stack (Production only)..."
    
    # Check if Docker is available
    if command -v docker &> /dev/null; then
        # Check if backend/grafana/docker-compose.logging.yml exists
        if [ -f "backend/grafana/docker-compose.logging.yml" ]; then
            # Ensure Docker daemon is running
            if ! sudo docker info > /dev/null 2>&1; then
                echo "⚠️  Docker daemon is not running. Attempting to start..."
                sudo systemctl start docker
                sleep 5
            fi
            
            # Create external network if it doesn't exist
            NETWORK_NAME="archaser_default"
            if ! sudo docker network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
                echo "Creating network '$NETWORK_NAME'..."
                sudo docker network create "$NETWORK_NAME"
            fi
            
            # Start/Update monitoring stack
            echo "Starting/Updating Grafana, Loki, and Prometheus containers..."
            sudo docker compose -f backend/grafana/docker-compose.logging.yml up -d --remove-orphans
            echo "✅ Monitoring stack started successfully."
            echo "   Grafana URL: https://grafana.staging.archaser.com (override GRAFANA_ROOT_URL for production)"
            echo "   Prometheus Management: http://localhost:9090"
        else
            echo "⚠️  backend/grafana/docker-compose.logging.yml not found. Skipping monitoring setup."
        fi
    else
        echo "⚠️  Docker not found. Skipping monitoring setup."
    fi
else
    echo "ℹ️  Skipping Monitoring Stack (only runs in production environment)"
fi

# 5. Start/Restart Application with PM2
echo "Step 5: Managing Application Process with PM2..."

# Set port based on environment
if [ "$ENVIRONMENT" = "production" ]; then
    APP_PORT=3000
elif [ "$ENVIRONMENT" = "staging" ]; then
    APP_PORT=3001
else
    APP_PORT=3000  # Default fallback
fi

echo "Port: $APP_PORT"

if pm2 describe "$APP_NAME" > /dev/null 2>&1; then
    echo "Process '$APP_NAME' exists. Restarting with environment update..."
    # Delete and restart to ensure port change takes effect
    pm2 delete "$APP_NAME"
    PORT=$APP_PORT pm2 start npm --name "$APP_NAME" -- start
    pm2 save
    echo "✅ Process '$APP_NAME' restarted successfully on port $APP_PORT."
else
    echo "Process '$APP_NAME' does not exist. Starting..."
    # 'npm start' usually runs 'next start'. We instruct PM2 to run npm start.
    PORT=$APP_PORT pm2 start npm --name "$APP_NAME" -- start
    pm2 save
    echo "✅ Process '$APP_NAME' started successfully on port $APP_PORT."
fi

echo "=========================================="
echo "Deployment Completed Successfully!"
echo "Environment: $ENVIRONMENT"
echo "PM2 App Name: $APP_NAME"
echo "Port: $APP_PORT"
echo "=========================================="
