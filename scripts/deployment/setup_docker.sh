#!/bin/bash
set -e

# Navigate to project root (2 levels up from scripts/deployment)
cd "$(dirname "$0")/../.."

# Ensure the script is run with bash
if [ -z "$BASH_VERSION" ]; then
    echo "❌ This script requires bash. Please run: bash $0"
    exit 1
fi

echo "=========================================="
echo "Docker Setup and Run Script"
echo "=========================================="

# Function to check and install Docker (Ubuntu/Debian focus)
check_and_install_docker() {
    if ! command -v docker > /dev/null 2>&1; then
        echo "Docker not found."
        
        # Check OS
        if [ -f /etc/os-release ]; then
            . /etc/os-release
            if [[ "$ID" == "ubuntu" || "$ID" == "debian" ]]; then
                echo "Detected $NAME. Installing Docker..."
                sudo apt-get update
                sudo apt-get install -y ca-certificates curl gnupg
                sudo install -m 0755 -d /etc/apt/keyrings
                # Determine GPG and repo based on distro
                if [ "$ID" == "ubuntu" ]; then
                     curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
                     sudo chmod a+r /etc/apt/keyrings/docker.gpg
                     echo \
                      "deb [arch=\"$(dpkg --print-architecture)\" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
                      $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" | \
                      sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
                elif [ "$ID" == "debian" ]; then
                     curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
                     sudo chmod a+r /etc/apt/keyrings/docker.gpg
                     echo \
                      "deb [arch=\"$(dpkg --print-architecture)\" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
                      $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" | \
                      sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
                fi

                sudo apt-get update
                sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
                
                sudo systemctl start docker
                sudo systemctl enable docker
                echo "✅ Docker installed successfully."
            else
                echo "⚠️  Unsupported Linux distribution for automatic installation: $ID"
                echo "Please install Docker manually."
                exit 1
            fi
        elif [[ "$OSTYPE" == "darwin"* ]]; then
            echo "⚠️  macOS detected. Automatic Docker installation via script is not supported."
            echo "Please install Docker Desktop from https://www.docker.com/products/docker-desktop/"
            exit 1
        else
            echo "⚠️  Unsupported OS. Please install Docker manually."
            exit 1
        fi
    else
        echo "✅ Docker is already installed."
    fi
}

check_and_install_docker

echo "Checking Docker configuration..."

# Determine docker-compose file
COMPOSE_FILE=""
if [ -f "docker-compose.yml" ]; then
    COMPOSE_FILE="docker-compose.yml"
elif [ -f "backend/grafana/docker-compose.logging.yml" ]; then
    COMPOSE_FILE="backend/grafana/docker-compose.logging.yml"
    echo "Using backend/grafana/docker-compose.logging.yml"
fi

if [ -n "$COMPOSE_FILE" ]; then
    # Ensure Docker daemon is running
    if ! docker info > /dev/null 2>&1; then
        echo "Docker daemon is not running. Attempting to start..."
        if [[ "$OSTYPE" == "linux-gnu"* ]]; then
            sudo systemctl start docker
        elif [[ "$OSTYPE" == "darwin"* ]]; then
             echo "Please start Docker Desktop."
             exit 1
        fi
        sleep 5
    fi

    # Run Docker Compose
    echo "Starting containers..."
    
    # Create external network if it doesn't exist
    NETWORK_NAME="archaser_default"
    echo "Checking for network '$NETWORK_NAME'..."
    if [[ "$OSTYPE" == "linux-gnu"* ]] && ! groups | grep -q docker; then
        if ! sudo docker network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
            echo "Network '$NETWORK_NAME' not found. Creating..."
            sudo docker network create "$NETWORK_NAME"
        else
            echo "Network '$NETWORK_NAME' exists."
        fi
    else
        if ! docker network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
             echo "Network '$NETWORK_NAME' not found. Creating..."
             docker network create "$NETWORK_NAME"
        else
             echo "Network '$NETWORK_NAME' exists."
        fi
    fi

    # If on Linux, likely need sudo if not in docker group
    if [[ "$OSTYPE" == "linux-gnu"* ]] && ! groups | grep -q docker; then
        sudo docker compose -f "$COMPOSE_FILE" up -d
    else
        docker compose -f "$COMPOSE_FILE" up -d
    fi
    echo "✅ Docker Compose started successfully."
else
    echo "❌ No docker-compose.yml or backend/grafana/docker-compose.logging.yml found."
    exit 1
fi
