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

log "Installing Nginx, OpenSSL, and Certbot dependencies..."
sudo apt-get update -qq
sudo apt-get install -y -qq nginx certbot python3-certbot-nginx openssl curl

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Ensure webroot directory exists for Let's Encrypt HTTP-01 challenge
sudo mkdir -p /var/www/html

# Ensure ssl parameters exist
sudo mkdir -p /etc/letsencrypt
if [[ ! -f /etc/letsencrypt/options-ssl-nginx.conf ]]; then
    log "Creating default /etc/letsencrypt/options-ssl-nginx.conf..."
    sudo curl -sSL https://raw.githubusercontent.com/certbot/certbot/master/certbot-nginx/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf -o /etc/letsencrypt/options-ssl-nginx.conf || true
fi

if [[ ! -f /etc/letsencrypt/ssl-dhparams.pem ]]; then
    log "Generating /etc/letsencrypt/ssl-dhparams.pem..."
    sudo openssl dhparam -out /etc/letsencrypt/ssl-dhparams.pem 2048 >/dev/null 2>&1 || true
fi

# Ensure self-signed temporary certificates exist so Nginx can validate config before Certbot runs
ensure_dummy_cert() {
    local domain="$1"
    local cert_dir="/etc/letsencrypt/live/$domain"
    if [[ ! -f "$cert_dir/fullchain.pem" || ! -f "$cert_dir/privkey.pem" ]]; then
        log "Creating temporary certificate placeholder for $domain..."
        sudo mkdir -p "$cert_dir"
        sudo openssl req -x509 -nodes -days 1 -newkey rsa:2048 \
            -keyout "$cert_dir/privkey.pem" \
            -out "$cert_dir/fullchain.pem" \
            -subj "/CN=$domain" >/dev/null 2>&1
    fi
}

ensure_dummy_cert "api.staging.archaser.com"
ensure_dummy_cert "api.production.archaser.com"

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
    log "Requesting official Let's Encrypt SSL certificate for $domain via webroot..."
    local cmd=(sudo certbot certonly --webroot -w /var/www/html -d "$domain" --non-interactive --agree-tos)
    if [[ "$FORCE_CERTS" == "true" ]]; then
        cmd+=(--force-renewal)
    fi
    if [[ -n "$EMAIL" ]]; then
        cmd+=(--email "$EMAIL")
    else
        cmd+=(--register-unsafely-without-email)
    fi

    if "${cmd[@]}"; then
        log "✅ Successfully issued valid Let's Encrypt certificate for $domain"
    else
        echo "❌ Certbot webroot issuance failed for $domain."
        echo "Please check:"
        echo " 1. DNS A record for $domain points to this EC2 public IP."
        echo " 2. AWS Security Group / Firewall allows HTTP (port 80) and HTTPS (port 443)."
    fi
}

issue_cert "api.staging.archaser.com"
issue_cert "api.production.archaser.com"

log "Reloading Nginx with active valid SSL certs..."
sudo nginx -t && sudo systemctl reload nginx

log "Single-EC2 Nginx setup completed successfully!"
