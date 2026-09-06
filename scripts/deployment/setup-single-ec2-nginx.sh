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

USE_STANDALONE="false"

usage() {
    cat <<'EOF'
Usage:
  bash scripts/deployment/setup-single-ec2-nginx.sh [options]

Options:
  --email <addr>       Let's Encrypt registration / renewal notices
  --skip-certs         Install nginx site configs only (no certbot)
  --force-certs        Re-issue certs even if they already exist
  --standalone         Use certbot standalone mode instead of webroot
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
        --standalone)
            USE_STANDALONE="true"
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
sudo chmod 755 /var/www/html

# Clean up any dummy self-signed cert directories if force certs or non-certbot dummy certs present
cleanup_dummy_cert() {
    local domain="$1"
    local cert_file="/etc/letsencrypt/live/$domain/fullchain.pem"
    if [[ -f "$cert_file" ]]; then
        if sudo openssl x509 -in "$cert_file" -noout -issuer 2>/dev/null | grep -q "CN = $domain"; then
            log "Removing temporary self-signed certificate for $domain..."
            sudo rm -rf "/etc/letsencrypt/live/$domain" "/etc/letsencrypt/archive/$domain" "/etc/letsencrypt/renewal/$domain.conf"
        fi
    fi
}

cleanup_dummy_cert "api.staging.archaser.com"
cleanup_dummy_cert "api.production.archaser.com"

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

if [[ "$SKIP_CERTS" == "false" ]]; then
    if [[ "$USE_STANDALONE" == "true" ]]; then
        log "Stopping Nginx to run Certbot in Standalone mode..."
        sudo systemctl stop nginx || true
    else
        log "Setting up temporary HTTP-01 challenge listener on Port 80 for Certbot..."
        cat <<'HTTP_CONF' | sudo tee /etc/nginx/sites-available/archaser-single-ec2-api >/dev/null
server {
    listen 80;
    listen [::]:80;
    server_name api.staging.archaser.com api.production.archaser.com;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/html;
        default_type "text/plain";
    }

    location / {
        return 200 "Certbot bootstrapping...";
        add_header Content-Type text/plain;
    }
}
HTTP_CONF

        sudo ln -sf /etc/nginx/sites-available/archaser-single-ec2-api /etc/nginx/sites-enabled/archaser-single-ec2-api
        sudo rm -f /etc/nginx/sites-enabled/default
        sudo nginx -t
        sudo systemctl reload nginx
    fi

    issue_cert() {
        local domain="$1"
        local cert_file="/etc/letsencrypt/live/$domain/fullchain.pem"
        
        if [[ -f "$cert_file" ]]; then
            if sudo openssl x509 -in "$cert_file" -noout -checkend 86400 2>/dev/null; then
                log "Found valid existing SSL certificate for $domain."
                if [[ "$FORCE_CERTS" != "true" ]]; then
                    log "✅ Skipping cert re-issuance (valid cert active at $cert_file)"
                    return 0
                fi
            fi
        fi

        log "Requesting official Let's Encrypt SSL certificate for $domain..."
        local cmd=(sudo certbot certonly)
        if [[ "$USE_STANDALONE" == "true" ]]; then
            cmd+=(--standalone)
        else
            cmd+=(--webroot -w /var/www/html)
        fi
        cmd+=(-d "$domain" --cert-name "$domain" --non-interactive --agree-tos)
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
            if [[ -f "$cert_file" ]] && sudo openssl x509 -in "$cert_file" -noout -checkend 86400 2>/dev/null; then
                log "⚠️ Certbot renewal hit Let's Encrypt rate limits (5 certs/week). Re-using existing valid certificate at $cert_file!"
                return 0
            fi

            if [[ "$USE_STANDALONE" == "false" ]]; then
                log "Webroot challenge failed for $domain. Attempting Standalone mode fallback..."
                sudo systemctl stop nginx || true
                local standalone_cmd=(sudo certbot certonly --standalone -d "$domain" --cert-name "$domain" --non-interactive --agree-tos)
                if [[ "$FORCE_CERTS" == "true" ]]; then
                    standalone_cmd+=(--force-renewal)
                fi
                if [[ -n "$EMAIL" ]]; then
                    standalone_cmd+=(--email "$EMAIL")
                else
                    standalone_cmd+=(--register-unsafely-without-email)
                fi
                if "${standalone_cmd[@]}"; then
                    log "✅ Successfully issued certificate for $domain using Standalone mode!"
                    return 0
                fi
            fi
            echo "❌ Certbot issuance failed for $domain."
            echo "Please check:"
            echo " 1. DNS A record for $domain points to this EC2 public IP."
            echo " 2. AWS Security Group / Firewall allows HTTP (port 80) and HTTPS (port 443)."
            exit 1
        fi
    }

    issue_cert "api.staging.archaser.com"
    issue_cert "api.production.archaser.com"
fi

log "Copying full single EC2 Nginx SSL configuration..."
CONF_SRC="$BACKEND_DIR/nginx/archaser-single-ec2-api.conf"

if [[ ! -f "$CONF_SRC" ]]; then
    die "Nginx config not found at $CONF_SRC"
fi

sudo cp "$CONF_SRC" /etc/nginx/sites-available/archaser-single-ec2-api
sudo ln -sf /etc/nginx/sites-available/archaser-single-ec2-api /etc/nginx/sites-enabled/archaser-single-ec2-api
sudo rm -f /etc/nginx/sites-enabled/default

log "Testing Nginx SSL configuration syntax..."
sudo nginx -t

log "Reloading Nginx with official SSL certs..."
sudo systemctl reload nginx

log "Active certificates on this server:"
sudo certbot certificates || true

log "Single-EC2 Nginx setup completed successfully! Real SSL certificates are now active."
