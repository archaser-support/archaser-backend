#!/usr/bin/env bash

# Setup script for Single-EC2 Nginx configuration:
# Enables both api.staging.archaser.com and api.production.archaser.com on one host.

if [ -z "${BASH_VERSION:-}" ]; then
    exec /usr/bin/env bash "$0" "$@"
fi

set -euo pipefail

EMAIL=""
SKIP_CERTS="false"
FORCE_CERTS="false"

usage() {
    cat <<'EOF'
Usage:
  bash scripts/deployment/setup-single-ec2-nginx.sh [options]

Options:
  --email <addr>       Let's Encrypt registration / renewal notices
  --skip-certs         Install nginx site configs only (no certbot)
  --force-certs        Re-issue certs even if they already exist
  -h, --help           Show help
EOF
}

log() {
    printf "\n==> %s\n" "$1"
}

die() {
    echo "Error: $1" >&2
    exit 1
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --email)
            EMAIL="${2:-}"
            shift 2
            ;;
        --skip-certs)
            SKIP_CERTS="true"
            shift
            ;;
        --force-certs)
            FORCE_CERTS="true"
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown argument: $1"
            usage
            exit 1
            ;;
    esac
done

if [[ "$EUID" -eq 0 ]]; then
    die "Do not run directly as root. Run as ubuntu (uses passwordless sudo)."
fi

require_sudo() {
    if ! sudo -n true 2>/dev/null; then
        die "Passwordless sudo required for ubuntu user."
    fi
}

require_sudo

log "Installing Nginx and Certbot dependencies..."
sudo apt-get update -qq
sudo apt-get install -y -qq nginx certbot python3-certbot-nginx

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

log "Copying single EC2 Nginx configuration..."
CONF_SRC="$BACKEND_DIR/nginx/archaser-single-ec2-api.conf"

if [[ ! -f "$CONF_SRC" ]]; then
    die "Nginx config not found at $CONF_SRC"
fi

sudo cp "$CONF_SRC" /etc/nginx/sites-available/archaser-single-ec2-api
sudo ln -sf /etc/nginx/sites-available/archaser-single-ec2-api /etc/nginx/sites-enabled/archaser-single-ec2-api
sudo rm -f /etc/nginx/sites-enabled/default

log "Testing Nginx configuration syntax..."
sudo nginx -t

log "Reloading Nginx..."
sudo systemctl reload nginx

if [[ "$SKIP_CERTS" == "true" ]]; then
    log "Skipping Let's Encrypt certificate generation (--skip-certs)"
    exit 0
fi

issue_cert() {
    local domain="$1"
    if [[ "$FORCE_CERTS" == "false" && -d "/etc/letsencrypt/live/$domain" ]]; then
        log "Certificate for $domain already exists (skipping certbot)"
        return 0
    fi

    log "Requesting Let's Encrypt SSL certificate for $domain..."
    local cmd=(sudo certbot --nginx -d "$domain" --non-interactive --agree-tos)
    if [[ -n "$EMAIL" ]]; then
        cmd+=(--email "$EMAIL")
    else
        cmd+=(--register-unsafely-without-email)
    fi

    "${cmd[@]}" || echo "Warning: Certbot issuance failed for $domain. Ensure DNS A record points to this EC2 instance."
}

issue_cert "api.staging.archaser.com"
issue_cert "api.production.archaser.com"

log "Reloading Nginx with active SSL certs..."
sudo nginx -t && sudo systemctl reload nginx

log "Single-EC2 Nginx setup completed successfully!"
EOF
