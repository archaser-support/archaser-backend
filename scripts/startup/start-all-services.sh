#!/bin/bash

# Startup script to run all services after server crash/reboot
# This script starts PM2 processes and Docker containers

echo "=========================================="
echo "Starting All Archaser Services"
echo "=========================================="
echo ""

# Create logs directory if it doesn't exist
mkdir -p /var/snap/amazon-ssm-agent/12322/archaser/logs

echo "Step 1: Starting PM2 processes..."
echo "---"

# Navigate to repository root; PM2 ecosystem lives under backend/
cd /var/snap/amazon-ssm-agent/12322/archaser/production

# Start PM2 with backend ecosystem file
pm2 start backend/ecosystem.config.js

# Save PM2 process list
pm2 save

echo "✅ PM2 processes started"
echo ""

echo "Step 2: Starting Docker containers (Production only)..."
echo "---"

# Navigate to production directory for Docker
cd /var/snap/amazon-ssm-agent/12322/archaser/production

# Check if Docker is running
if ! sudo docker info > /dev/null 2>&1; then
    echo "⚠️  Docker is not running. Starting Docker..."
    sudo systemctl start docker
    sleep 5
fi

# Check if backend/grafana/docker-compose.logging.yml exists
if [ -f "backend/grafana/docker-compose.logging.yml" ]; then
    echo "Starting Grafana and Loki containers..."
    
    # Create network if it doesn't exist
    sudo docker network inspect archaser-network >/dev/null 2>&1 || \
        sudo docker network create archaser-network
    
    # Start containers
    sudo docker compose -f backend/grafana/docker-compose.logging.yml up -d
    
    echo "✅ Docker containers started"
else
    echo "⚠️  backend/grafana/docker-compose.logging.yml not found"
fi

echo ""
echo "Step 3: Verifying services..."
echo "---"

# Check PM2 status
echo "PM2 Processes:"
pm2 list

echo ""

# Check Docker status
echo "Docker Containers:"
sudo docker ps --filter "name=archaser"

echo ""
echo "=========================================="
echo "All Services Started!"
echo "=========================================="
echo ""
echo "Access URLs:"
echo "  Production:  https://portal.archaser.com"
echo "  Staging:     https://staging.archaser.com"
echo "  Grafana:     https://grafana.archaser.com"
echo ""
echo "To check logs:"
echo "  PM2 Production:  pm2 logs archaser-main"
echo "  PM2 Staging:     pm2 logs archaser-staging"
echo "  Docker Grafana:  sudo docker logs archaser-grafana"
echo "  Docker Loki:     sudo docker logs archaser-loki"
echo ""
