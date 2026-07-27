#!/bin/bash

# Stop all Archaser services gracefully

echo "=========================================="
echo "Stopping All Archaser Services"
echo "=========================================="
echo ""

echo "Step 1: Stopping PM2 processes..."
pm2 stop all
echo "✅ PM2 processes stopped"
echo ""

echo "Step 2: Stopping Docker containers..."
cd /var/snap/amazon-ssm-agent/12322/archaser/production
if [ -f "backend/grafana/docker-compose.logging.yml" ]; then
    sudo docker compose -f backend/grafana/docker-compose.logging.yml down
    echo "✅ Docker containers stopped"
else
    echo "⚠️  backend/grafana/docker-compose.logging.yml not found"
fi

echo ""
echo "=========================================="
echo "All Services Stopped"
echo "=========================================="
