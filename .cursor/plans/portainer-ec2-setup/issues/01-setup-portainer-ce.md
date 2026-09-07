# Slice 01: Deploy Portainer CE and Nginx SSL configuration on EC2

**Status:** done

## Summary
Deploy `portainer/portainer-ce:latest` on EC2 bound to `127.0.0.1:9000` and configure host Nginx reverse proxy with SSL termination for `portainer.archaser.com` / `portainer.staging.archaser.com`.

## Scope of Changes
- Added [`be/nginx/archaser-portainer.conf`](file:///home/bosenilotpal/Documents/Work/archaser-rest/be/nginx/archaser-portainer.conf) with HTTP/HTTPS reverse proxy rules, WebSocket support (`Upgrade` & `Connection` headers), and buffering disabled.
- Audited ports to ensure `127.0.0.1:9000` does not collide with Prometheus (`9090`), Grafana (`3200`/`3201`), or Nest API (`4010`/`3010`).

## How to test
1. Navigate to `https://portainer.archaser.com`.
2. Verify Admin user login.
3. Open live container logs or console (`exec`) for any active Docker container.
