#!/usr/bin/env bash
# Shared API EC2 nginx bootstrap — staging + production on one host.
#
# Installs the current split site configs from nginx/ (same set used in prod):
#   archaser-staging-api.conf
#   archaser-production-api.conf
#   archaser-staging-grafana.conf
#   archaser-production-grafana.conf
#   archaser-portainer.conf
#
# Does NOT enable:
#   archaser-single-ec2-api.conf  (legacy; conflicts with the split API sites)
#   archaser-staging.conf / archaser-production.conf  (legacy Next / marketing)
#   archaser-staging-amplify-cutover.conf
#
# Run on the API EC2 as ubuntu (passwordless sudo):
#   cd /home/ubuntu/api
#   bash scripts/deployment/setup-single-ec2-nginx.sh
#   bash scripts/deployment/setup-single-ec2-nginx.sh --email you@archaser.com
#   bash scripts/deployment/setup-single-ec2-nginx.sh --skip-certs
#
# Prerequisites:
#   DNS A records for the domains below already point at this host (HTTP-01).
#   Ports 80/443 free.
#
# Idempotent: safe to re-run; skips certbot when certs exist unless --force-certs.

if [ -z "${BASH_VERSION:-}" ]; then
    exec /usr/bin/env bash "$0" "$@"
fi

set -euo pipefail

EMAIL=""
SKIP_CERTS="false"
FORCE_CERTS="false"
USE_STANDALONE="false"
WITH_PORTAINER="true"

# Primary cert names must match ssl_certificate paths in the repo nginx/*.conf files.
CERT_STAGING_API="api.staging.archaser.com"
CERT_PROD_API="api.portal.archaser.com"
CERT_STAGING_GRAFANA="grafana.staging.archaser.com"
CERT_PROD_GRAFANA="grafana.portal.archaser.com"
CERT_PORTAINER="portainer.archaser.com"

usage() {
    cat <<'EOF'
Usage:
  bash scripts/deployment/setup-single-ec2-nginx.sh [options]

Installs all shared-EC2 nginx site configs from nginx/ and issues Let's Encrypt
certs for the hostnames those configs reference.

Options:
  --email <addr>       Let's Encrypt registration / renewal notices
  --skip-certs         Install nginx site configs only (no certbot)
  --force-certs        Re-issue certs even if they already exist
  --standalone         Use certbot standalone (stops nginx during issue)
  --no-portainer       Skip portainer.archaser.com site + cert
  -h, --help           Show help

Enabled sites (from repo nginx/):
  archaser-staging-api.conf
  archaser-production-api.conf
  archaser-staging-grafana.conf
  archaser-production-grafana.conf
  archaser-portainer.conf          (unless --no-portainer)

Disabled / never enabled (conflict or out of scope on this box):
  archaser-single-ec2-api.conf
  archaser-staging.conf
  archaser-production.conf
  archaser-staging-amplify-cutover.conf
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
        die "Do not run as root. Run as ubuntu (uses sudo)."
    fi
    if ! command -v sudo >/dev/null 2>&1; then
        die "sudo is required"
    fi
    if ! sudo -n true 2>/dev/null; then
        die "Passwordless sudo required for ubuntu user."
    fi
}

run() {
    sudo env "$@"
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
        --no-portainer)
            WITH_PORTAINER="false"
            shift
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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

# site file name in sites-available/enabled → source file under nginx/
SITE_MAP=(
    "archaser-staging-api.conf:archaser-staging-api.conf"
    "archaser-production-api.conf:archaser-production-api.conf"
    "archaser-staging-grafana.conf:archaser-staging-grafana.conf"
    "archaser-production-grafana.conf:archaser-production-grafana.conf"
)
if [[ "$WITH_PORTAINER" == "true" ]]; then
    SITE_MAP+=("archaser-portainer.conf:archaser-portainer.conf")
fi

cert_exists() {
    local name="$1"
    [[ -f "/etc/letsencrypt/live/$name/fullchain.pem" && -f "/etc/letsencrypt/live/$name/privkey.pem" ]]
}

cert_covers_name() {
    local cert_name="$1"
    local expect_cn="$2"
    local cert="/etc/letsencrypt/live/$cert_name/fullchain.pem"
    [[ -f "$cert" ]] || return 1
    sudo openssl x509 -in "$cert" -noout -text 2>/dev/null \
        | grep -E "DNS:${expect_cn}(,|$)|CN[[:space:]]*=[[:space:]]*${expect_cn}" >/dev/null
}

ensure_ssl_params() {
    run mkdir -p /etc/letsencrypt
    if [[ ! -f /etc/letsencrypt/ssl-dhparams.pem ]]; then
        log "Creating /etc/letsencrypt/ssl-dhparams.pem (one-time)"
        run openssl dhparam -out /etc/letsencrypt/ssl-dhparams.pem 2048
    fi
    if [[ ! -f /etc/letsencrypt/options-ssl-nginx.conf ]]; then
        log "Writing /etc/letsencrypt/options-ssl-nginx.conf"
        run tee /etc/letsencrypt/options-ssl-nginx.conf >/dev/null <<'SSL_OPTS'
ssl_session_cache shared:le_nginx_SSL:10m;
ssl_session_timeout 1440m;
ssl_session_tickets off;
ssl_protocols TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers off;
ssl_ciphers "ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384";
SSL_OPTS
    fi
}

write_http_bootstrap_all() {
    local out="/etc/nginx/sites-available/archaser-acme-bootstrap"
    local names=(
        "$CERT_STAGING_API"
        api.production.archaser.com
        "$CERT_PROD_API"
        "$CERT_STAGING_GRAFANA"
        grafana.production.archaser.com
        "$CERT_PROD_GRAFANA"
    )
    if [[ "$WITH_PORTAINER" == "true" ]]; then
        names+=(portainer.archaser.com portainer.staging.archaser.com)
    fi

    {
        echo "server {"
        echo "    listen 80 default_server;"
        echo "    listen [::]:80 default_server;"
        echo -n "    server_name"
        for n in "${names[@]}"; do
            echo -n " $n"
        done
        echo ";"
        cat <<'EOF'

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/html;
        default_type "text/plain";
    }

    location / {
        return 200 "archaser shared-EC2 nginx ACME bootstrap\n";
        add_header Content-Type text/plain;
    }
}
EOF
    } | run tee "$out" >/dev/null

    run ln -sfn "$out" /etc/nginx/sites-enabled/archaser-acme-bootstrap
}

disable_conflicting_sites() {
    log "Disabling legacy / conflicting site links"
    run rm -f \
        /etc/nginx/sites-enabled/default \
        /etc/nginx/sites-enabled/000-default \
        /etc/nginx/sites-enabled/archaser-single-ec2-api \
        /etc/nginx/sites-enabled/archaser-single-ec2-api.conf \
        /etc/nginx/sites-enabled/archaser-staging \
        /etc/nginx/sites-enabled/archaser-staging.conf \
        /etc/nginx/sites-enabled/archaser-production \
        /etc/nginx/sites-enabled/archaser \
        /etc/nginx/sites-enabled/archaser-staging-amplify-cutover.conf \
        /etc/nginx/sites-enabled/archaser-acme-bootstrap \
        2>/dev/null || true
}

install_repo_sites() {
    local entry site_name src_name src
    log "Installing nginx site configs from $NGINX_SRC"
    for entry in "${SITE_MAP[@]}"; do
        site_name="${entry%%:*}"
        src_name="${entry##*:}"
        src="$NGINX_SRC/$src_name"
        [[ -f "$src" ]] || die "Missing site template: $src"
        run cp "$src" "/etc/nginx/sites-available/$site_name"
        run ln -sfn "/etc/nginx/sites-available/$site_name" "/etc/nginx/sites-enabled/$site_name"
        log "Enabled $site_name"
    done
}

issue_cert() {
    local cert_name="$1"
    shift
    local domains=("$@")
    local cmd=(certbot certonly --non-interactive --agree-tos --cert-name "$cert_name")
    local d

    if [[ "$USE_STANDALONE" == "true" ]]; then
        cmd+=(--standalone)
    else
        cmd+=(--webroot -w /var/www/html)
    fi
    for d in "${domains[@]}"; do
        cmd+=(-d "$d")
    done
    if [[ "$FORCE_CERTS" == "true" ]]; then
        cmd+=(--force-renewal)
    fi
    if [[ -n "$EMAIL" ]]; then
        cmd+=(--email "$EMAIL")
    else
        cmd+=(--register-unsafely-without-email)
    fi

    if [[ "$USE_STANDALONE" == "true" ]]; then
        run systemctl stop nginx || true
    fi
    if run "${cmd[@]}"; then
        log "Issued/refreshed cert lineage: $cert_name (${domains[*]})"
        if [[ "$USE_STANDALONE" == "true" ]]; then
            run systemctl start nginx || true
        fi
        return 0
    fi
    if [[ "$USE_STANDALONE" == "true" ]]; then
        run systemctl start nginx || true
    fi
    die "Certbot failed for $cert_name (${domains[*]}). Check DNS A records and SG 80/443."
}

ensure_cert() {
    local cert_name="$1"
    shift
    local domains=("$@")
    local primary="${domains[0]}"

    if [[ "$FORCE_CERTS" != "true" ]] && cert_exists "$cert_name" && cert_covers_name "$cert_name" "$primary"; then
        if sudo openssl x509 -in "/etc/letsencrypt/live/$cert_name/fullchain.pem" -noout -checkend 86400 2>/dev/null; then
            log "Valid cert already present for $cert_name — skipping"
            return 0
        fi
    fi
    issue_cert "$cert_name" "${domains[@]}"
}

# --- 1) Packages ------------------------------------------------------------
log "Installing nginx, certbot, openssl"
run apt-get update -qq
run DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nginx certbot python3-certbot-nginx openssl curl

run mkdir -p /var/www/html/.well-known/acme-challenge
run chown -R www-data:www-data /var/www/html
ensure_ssl_params

# --- 2) ACME bootstrap (HTTP only) ------------------------------------------
disable_conflicting_sites
if [[ "$SKIP_CERTS" == "false" && "$USE_STANDALONE" == "false" ]]; then
    log "Installing temporary HTTP ACME bootstrap"
    write_http_bootstrap_all
    run nginx -t
    run systemctl enable nginx
    run systemctl restart nginx
fi

# --- 3) Certificates --------------------------------------------------------
if [[ "$SKIP_CERTS" == "true" ]]; then
    log "Skipping certbot (--skip-certs)"
else
    ensure_cert "$CERT_STAGING_API" "$CERT_STAGING_API"
    ensure_cert "$CERT_PROD_API" "$CERT_PROD_API" "api.production.archaser.com"
    ensure_cert "$CERT_STAGING_GRAFANA" "$CERT_STAGING_GRAFANA"
    ensure_cert "$CERT_PROD_GRAFANA" "$CERT_PROD_GRAFANA" "grafana.production.archaser.com"
    if [[ "$WITH_PORTAINER" == "true" ]]; then
        ensure_cert "$CERT_PORTAINER" "$CERT_PORTAINER" "portainer.staging.archaser.com"
    fi
fi

# --- 4) Full TLS sites from repo --------------------------------------------
disable_conflicting_sites
install_repo_sites

missing=0
for name in "$CERT_STAGING_API" "$CERT_PROD_API" "$CERT_STAGING_GRAFANA" "$CERT_PROD_GRAFANA"; do
    if ! cert_exists "$name"; then
        echo "Warning: cert missing for $name — corresponding HTTPS server will fail until issued."
        missing=1
    fi
done
if [[ "$WITH_PORTAINER" == "true" ]] && ! cert_exists "$CERT_PORTAINER"; then
    echo "Warning: cert missing for $CERT_PORTAINER"
    missing=1
fi

log "Testing nginx configuration"
if ! run nginx -t; then
    if [[ "$missing" -eq 1 ]]; then
        die "nginx -t failed (often missing cert files). Re-run without --skip-certs after DNS points here."
    fi
    die "nginx -t failed"
fi

run systemctl enable nginx
run systemctl reload nginx || run systemctl restart nginx

log "Active certificates"
run certbot certificates || true

log "Enabled sites"
run ls -la /etc/nginx/sites-enabled/

log "Done — shared EC2 nginx sites installed from $NGINX_SRC"
echo "  Staging API:      https://$CERT_STAGING_API"
echo "  Production API:   https://$CERT_PROD_API (also api.production.archaser.com)"
echo "  Staging Grafana:  https://$CERT_STAGING_GRAFANA"
echo "  Production Grafana: https://$CERT_PROD_GRAFANA"
if [[ "$WITH_PORTAINER" == "true" ]]; then
    echo "  Portainer:        https://$CERT_PORTAINER"
fi
echo
echo "Compose project names on this host (always pass -p):"
echo "  docker compose -p archaser-backend-staging -f docker-compose.backend.staging.yml …"
echo "  docker compose -p archaser-backend-production -f docker-compose.backend.production.yml …"
echo
echo "DNS for each hostname above must point at this EC2 (not CloudFront) for TLS to work."
