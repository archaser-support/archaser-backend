#!/bin/bash

# Restart all Archaser services

echo "=========================================="
echo "Restarting All Archaser Services"
echo "=========================================="
echo ""

echo "Step 1: Restarting PM2 processes..."
pm2 restart all
echo "✅ PM2 processes restarted"
echo ""

echo "Step 2: Restarting Docker containers..."
cd /var/snap/amazon-ssm-agent/12322/archaser/production
if [ -f "backend/grafana/docker-compose.logging.yml" ]; then
    sudo docker compose -f backend/grafana/docker-compose.logging.yml restart
    echo "✅ Docker containers restarted"
else
    echo "⚠️  backend/grafana/docker-compose.logging.yml not found"
fi

echo ""
echo "Step 3: Checking status..."
pm2 list
echo ""
sudo docker ps --filter "name=archaser"

echo ""
echo "=========================================="
echo "All Services Restarted"
echo "=========================================="
