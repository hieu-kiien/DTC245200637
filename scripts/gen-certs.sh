#!/usr/bin/env bash
# Tạo chứng chỉ HTTPS tự ký cho localhost (hiệu lực 365 ngày).
set -euo pipefail
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."
openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
  -keyout nginx/certs/server.key -out nginx/certs/server.crt \
  -subj "/C=VN/O=DTC245200637/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
# Nginx chạy bằng uid 101 nên cần đọc được khóa. File đã nằm trong .gitignore.
chmod 644 nginx/certs/server.key nginx/certs/server.crt
echo "Đã tạo nginx/certs/server.crt và server.key"
