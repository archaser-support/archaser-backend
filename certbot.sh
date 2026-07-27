#!/bin/bash

# Run certbot command
sudo ~/certbot-env/bin/certbot certonly \
  --authenticator dns-godaddy \
  --dns-godaddy-credentials /etc/letsencrypt/godaddy.ini \
  --dns-godaddy-propagation-seconds 90 \
  --keep-until-expiring --non-interactive --expand \
  --server https://acme-v02.api.letsencrypt.org/directory \
  -d "archaser.com" \
  -d "*.archaser.com"