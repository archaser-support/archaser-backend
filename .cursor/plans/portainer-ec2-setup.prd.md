# PRD: Setup Portainer CE on EC2 behind Nginx with SSL

## Overview
Set up Portainer CE container management platform on the backend EC2 instance to monitor and manage Docker containers (API, Worker, Redis, SMS, Connectors, Reports, Loki, Prometheus, Grafana).

## Objectives
- Deploy Portainer CE (`portainer/portainer-ce:latest`) on EC2 bound to `127.0.0.1:9000`.
- Proxy Portainer via host Nginx (`portainer.archaser.com` / `portainer.staging.archaser.com`).
- Enable HTTPS/SSL via Let's Encrypt / Certbot.
- Support WebSockets for live container logs streaming and interactive console `exec`.

## Deliverables
- Nginx configuration template: `be/nginx/archaser-portainer.conf`
- Step-by-step EC2 deployment commands
- Verified non-colliding host ports (Portainer on 9000 vs Prometheus on 9090, Grafana Staging on 3200, Grafana Prod on 3201).

## How to Test
1. Access `https://portainer.archaser.com` (or `https://portainer.staging.archaser.com`) in the browser.
2. Log in with the initial Admin credentials.
3. Select the `local` environment to verify all Docker containers (Nest API, Worker, Redis, Loki, Grafana) are listed and healthy.
4. Test live console stream (`exec`) or logs view on any container to confirm WebSocket connection works cleanly without buffering errors.
