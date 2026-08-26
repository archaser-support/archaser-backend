#!/usr/bin/env bash
# First-time staging reverse-proxy setup: remove Apache, install nginx + TLS,
# enable api.staging.archaser.com and grafana.staging.archaser.com.
#
# UI is on Amplify (staging.archaser.com) — this EC2 is Nest API + Grafana only.
# Do not enable nginx/archaser-staging.conf (legacy Next-on-EC2).
#
# Run on the staging API EC2 as ubuntu (uses sudo):
#   cd /home/ubuntu/api   # or your checkout
#   bash scripts/deployment/setup-staging-nginx.sh
#   bash scripts/deployment/setup-staging-nginx.sh --email you@archaser.com
#   bash scripts/deployment/setup-staging-nginx.sh --skip-certs   # configs only
#   bash scripts/deployment/setup-staging-nginx.sh --with-monitoring
#
# Prerequisites:
#   - DNS A/ALIAS for api.staging.archaser.com and grafana.staging.archaser.com
#     already pointing at this host (required for Let's Encrypt HTTP-01)
#   - Ports 80/443 free after Apache is stopped
#
# Idempotent: safe to re-run; skips certbot when certs already exist unless
# --force-certs is passed.

if [ -z "${BASH_VERSION:-}" ]; then
    exec /usr/bin/env bash "$0" "$@"
fi

set -euo pipefail

EMAIL=""
SKIP_CERTS="false"
FORCE_CERTS="false"
WITH_MONITORING="false"
KEEP_APACHE="false"
API_DOMAIN="api.staging.archaser.com"
GRAFANA_DOMAIN="grafana.staging.archaser.com"

usage() {
    cat <<'EOF'
Usage:
  bash scripts/deployment/setup-staging-nginx.sh [options]

Options:
  --email <addr>       Let's Encrypt registration / renewal notices
  --skip-certs         Install nginx site configs only (no certbot)
  --force-certs        Re-issue certs even if they already exist
  --with-monitoring    After nginx: recreate Grafana/Loki/Prometheus stack
  --keep-apache        Do not stop/purge Apache 2 (not recommended)
  --api-domain <name>  Default: api.staging.archaser.com
  --grafana-domain <name>  Default: grafana.staging.archaser.com
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

require_sudo() {
    if [[ "$(id -u)" -eq 0 ]]; then
        return 0
    fi
    if ! command -v sudo >/dev/null 2>&1; then
        die "sudo is required"
    fi
    sudo -v || die "sudo authentication failed"
}

run() {
    # Always go through env so VAR=value prefixes work under both root and sudo.
    # (Bare `run FOO=bar cmd` would try to exec a command named "FOO=bar".)
    if [[ "$(id -u)" -eq 0 ]]; then
        env "$@"
    else
        sudo env "$@"
    fi
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# scripts/deployment → repo root guesses: …/backend/scripts/deployment or …/scripts/deployment
ROOT_CANDIDATES=(
    "$(cd "$SCRIPT_DIR/../.." && pwd)"
    "$(cd "$SCRIPT_DIR/../../.." && pwd)"
    "$(pwd)"
)

BACKEND_DIR=""
NGINX_SRC=""
for root in "${ROOT_CANDIDATES[@]}"; do
    if [[ -d "$root/nginx" && -f "$root/nginx/archaser-staging-api.conf" ]]; then
        BACKEND_DIR="$root"
        NGINX_SRC="$root/nginx"
        break
    fi
    if [[ -d "$root/backend/nginx" && -f "$root/backend/nginx/archaser-staging-api.conf" ]]; then
        BACKEND_DIR="$root/backend"
        NGINX_SRC="$root/backend/nginx"
        break
    fi
done

[[ -n "$NGINX_SRC" ]] || die "Could not find nginx/archaser-staging-api.conf (run from the api/backend checkout)"

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
        --with-monitoring)
            WITH_MONITORING="true"
            shift
            ;;
        --keep-apache)
            KEEP_APACHE="true"
            shift
            ;;
        --api-domain)
            API_DOMAIN="${2:-}"
            shift 2
            ;;
        --grafana-domain)
            GRAFANA_DOMAIN="${2:-}"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            die "Unknown option: $1 (see --help)"
            ;;
    esac
done

require_sudo

write_http_bootstrap() {
    local domain="$1"
    local out="$2"
    run tee "$out" >/dev/null <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${domain};

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 200 'archaser staging nginx bootstrap for ${domain}\\n';
        add_header Content-Type text/plain;
    }
}
EOF
}

install_site() {
    local src_name="$1"
    local site_name="$2"
    local src="$NGINX_SRC/$src_name"
    [[ -f "$src" ]] || die "Missing site template: $src"
    run cp "$src" "/etc/nginx/sites-available/$site_name"
    run ln -sfn "/etc/nginx/sites-available/$site_name" "/etc/nginx/sites-enabled/$site_name"
    log "Enabled site: $site_name"
}

cert_exists() {
    local domain="$1"
    [[ -f "/etc/letsencrypt/live/$domain/fullchain.pem" && -f "/etc/letsencrypt/live/$domain/privkey.pem" ]]
}

# --- 1) Remove Apache (frees :80 / :443) ------------------------------------
if [[ "$KEEP_APACHE" != "true" ]]; then
    log "Stopping and purging Apache 2"
    run systemctl stop apache2 2>/dev/null || true
    run systemctl disable apache2 2>/dev/null || true
    # Purge packages if present (ignore if already gone)
    if dpkg -l apache2 2>/dev/null | grep -q '^ii'; then
        run apt-get remove -y --purge apache2 apache2-bin apache2-data apache2-utils libapache2-mod-php* 2>/dev/null || \
            run apt-get remove -y --purge apache2 apache2-bin apache2-data apache2-utils
        run apt-get autoremove -y
    else
        log "Apache 2 packages not installed (already clean)"
    fi
else
    log "Keeping Apache (--keep-apache); ensure it is not bound to :80/:443"
fi

# --- 2) Install nginx + certbot ---------------------------------------------
log "Installing nginx and certbot (API + Grafana only; UI stays on Amplify)"
run apt-get update -y
run DEBIAN_FRONTEND=noninteractive apt-get install -y nginx certbot python3-certbot-nginx

# Ensure legacy Next-on-EC2 site is not enabled (Amplify owns staging.archaser.com).
run rm -f /etc/nginx/sites-enabled/archaser-staging \
    /etc/nginx/sites-enabled/default \
    /etc/nginx/sites-enabled/000-default 2>/dev/null || true

run mkdir -p /var/www/html/.well-known/acme-challenge
run chown -R www-data:www-data /var/www/html

# --- 3) Bootstrap HTTP (so nginx starts before certs exist) -----------------
log "Installing HTTP bootstrap vhosts for ACME"
write_http_bootstrap "$API_DOMAIN" "/etc/nginx/sites-available/archaser-staging-api"
write_http_bootstrap "$GRAFANA_DOMAIN" "/etc/nginx/sites-available/archaser-staging-grafana"
run ln -sfn /etc/nginx/sites-available/archaser-staging-api /etc/nginx/sites-enabled/archaser-staging-api
run ln -sfn /etc/nginx/sites-available/archaser-staging-grafana /etc/nginx/sites-enabled/archaser-staging-grafana

run nginx -t
run systemctl enable nginx
run systemctl restart nginx

# --- 4) Certificates --------------------------------------------------------
issue_cert() {
    local domain="$1"
    local args=(certonly --webroot -w /var/www/html --non-interactive --agree-tos -d "$domain")
    if [[ -n "$EMAIL" ]]; then
        args+=(--email "$EMAIL")
    else
        args+=(--register-unsafely-without-email)
    fi
    if [[ "$FORCE_CERTS" == "true" ]]; then
        args+=(--force-renewal)
    fi
    run certbot "${args[@]}"
}

if [[ "$SKIP_CERTS" == "true" ]]; then
    log "Skipping certbot (--skip-certs)"
else
    for domain in "$API_DOMAIN" "$GRAFANA_DOMAIN"; do
        if cert_exists "$domain" && [[ "$FORCE_CERTS" != "true" ]]; then
            log "Cert already present for $domain — skipping issue"
        else
            log "Issuing Let's Encrypt cert for $domain (DNS must point here)"
            issue_cert "$domain"
        fi
    done
fi

# Ensure dhparam exists (referenced by repo templates)
if [[ ! -f /etc/letsencrypt/ssl-dhparams.pem ]]; then
    log "Creating /etc/letsencrypt/ssl-dhparams.pem (one-time, may take a minute)"
    run openssl dhparam -out /etc/letsencrypt/ssl-dhparams.pem 2048
fi
if [[ ! -f /etc/letsencrypt/options-ssl-nginx.conf ]]; then
    log "Writing /etc/letsencrypt/options-ssl-nginx.conf (Mozilla/Certbot defaults)"
    # Inline copy of certbot's options-ssl-nginx.conf — avoid brittle GitHub raw URLs.
    run tee /etc/letsencrypt/options-ssl-nginx.conf >/dev/null <<'SSL_OPTS'
# This file contains important security parameters. Contents are based on
# https://ssl-config.mozilla.org (Certbot nginx intermediate profile).

ssl_session_cache shared:le_nginx_SSL:10m;
ssl_session_timeout 1440m;
ssl_session_tickets off;

ssl_protocols TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers off;

ssl_ciphers "ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384";
SSL_OPTS
fi

# --- 5) Install full TLS site configs from repo -----------------------------
if cert_exists "$API_DOMAIN" && cert_exists "$GRAFANA_DOMAIN"; then
    log "Installing full TLS nginx configs from $NGINX_SRC"
    # If domains were overridden, rewrite server_name / cert paths in a temp copy.
    tmpdir="$(mktemp -d)"
    trap 'rm -rf "$tmpdir"' EXIT
    cp "$NGINX_SRC/archaser-staging-api.conf" "$tmpdir/archaser-staging-api"
    cp "$NGINX_SRC/archaser-staging-grafana.conf" "$tmpdir/archaser-staging-grafana"
    if [[ "$API_DOMAIN" != "api.staging.archaser.com" ]]; then
        sed -i "s/api\\.staging\\.archaser\\.com/${API_DOMAIN}/g" "$tmpdir/archaser-staging-api"
    fi
    if [[ "$GRAFANA_DOMAIN" != "grafana.staging.archaser.com" ]]; then
        sed -i "s/grafana\\.staging\\.archaser\\.com/${GRAFANA_DOMAIN}/g" "$tmpdir/archaser-staging-grafana"
    fi
    run cp "$tmpdir/archaser-staging-api" /etc/nginx/sites-available/archaser-staging-api
    run cp "$tmpdir/archaser-staging-grafana" /etc/nginx/sites-available/archaser-staging-grafana
    run ln -sfn /etc/nginx/sites-available/archaser-staging-api /etc/nginx/sites-enabled/archaser-staging-api
    run ln -sfn /etc/nginx/sites-available/archaser-staging-grafana /etc/nginx/sites-enabled/archaser-staging-grafana
    run nginx -t
    run systemctl reload nginx
    log "nginx TLS sites active for $API_DOMAIN and $GRAFANA_DOMAIN"
else
    log "Certs missing — left HTTP bootstrap sites in place. Re-run without --skip-certs after DNS propagates."
fi

# --- 6) Optional monitoring stack -------------------------------------------
if [[ "$WITH_MONITORING" == "true" ]]; then
    log "Recreating monitoring stack (Grafana / Loki / Prometheus / Promtail)"
    COMPOSE="$BACKEND_DIR/grafana/docker-compose.logging.yml"
    ENV_FILE="$BACKEND_DIR/.env"
    [[ -f "$COMPOSE" ]] || die "Missing $COMPOSE"
    [[ -f "$ENV_FILE" ]] || die "Missing $ENV_FILE (copy .env.staging → .env first)"

    # Clear name conflicts from earlier compose project names
    for c in archaser-loki archaser-grafana archaser-grafana-db archaser-prometheus archaser-promtail; do
        run docker rm -f "$c" 2>/dev/null || true
    done

    if docker info >/dev/null 2>&1; then
        DOCKER=(docker)
    elif sudo -n docker info >/dev/null 2>&1; then
        DOCKER=(sudo -n docker)
    else
        die "Cannot talk to Docker daemon"
    fi

    MONITORING_ENV=staging \
    GRAFANA_ROOT_URL="https://${GRAFANA_DOMAIN}/" \
    GRAFANA_DOMAIN="$GRAFANA_DOMAIN" \
        "${DOCKER[@]}" compose \
        --project-name archaser-monitoring-staging \
        --env-file "$ENV_FILE" \
        -f "$COMPOSE" \
        up -d --remove-orphans --force-recreate

    "${DOCKER[@]}" ps --filter "name=archaser-loki" --filter "name=archaser-grafana" \
        --filter "name=archaser-prometheus" --filter "name=archaser-promtail"
fi

log "Done"
echo "  API:     https://$API_DOMAIN   (Nest on this EC2)"
echo "  Grafana: https://$GRAFANA_DOMAIN  (containers on 127.0.0.1:3200)"
echo "  UI:      Amplify — staging.archaser.com (not proxied here)"
echo
echo "If Grafana containers conflicted earlier:"
echo "  sudo docker rm -f archaser-loki archaser-grafana archaser-grafana-db archaser-prometheus archaser-promtail"
echo "  cd $BACKEND_DIR/grafana && MONITORING_ENV=staging docker compose --project-name archaser-monitoring-staging --env-file ../.env -f docker-compose.logging.yml up -d --force-recreate"
echo
echo "Or re-run: bash scripts/deployment/setup-staging-nginx.sh --with-monitoring"
