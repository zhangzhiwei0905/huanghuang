#!/usr/bin/env bash
set -euo pipefail

DOMAIN="huanghuang.amazingzz.xyz"
PROJECT_DIR="/home/zhangzhiwei/huanghuang"
WEBROOT="/var/www/certbot/huanghuang"
NGINX_TARGET="/etc/nginx/conf.d/huanghuang.conf"

if [[ "${EUID}" -ne 0 ]]; then
  echo "请使用 sudo bash ${PROJECT_DIR}/deploy/enable-domain.sh 运行"
  exit 1
fi

install -d -m 0755 "${WEBROOT}"
install -m 0644 "${PROJECT_DIR}/deploy/nginx/huanghuang.http.conf" "${NGINX_TARGET}"

nginx -t
systemctl reload nginx

certbot certonly \
  --webroot \
  --webroot-path "${WEBROOT}" \
  --domain "${DOMAIN}" \
  --non-interactive \
  --agree-tos \
  --register-unsafely-without-email

install -m 0644 "${PROJECT_DIR}/deploy/nginx/huanghuang.conf" "${NGINX_TARGET}"

nginx -t
systemctl reload nginx

echo "https://${DOMAIN} 已启用"
