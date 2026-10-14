#!/usr/bin/env bash
# Tạo file .env từ .env.example, thay mọi giá trị "doi-bang-gen-secrets" bằng chuỗi ngẫu nhiên 32 ký tự hex.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env ]; then echo ".env đã tồn tại, không ghi đè."; exit 0; fi
cp .env.example .env
while grep -q "doi-bang-gen-secrets" .env; do
  secret="$(openssl rand -hex 16)"
  # thay từng dòng một để mỗi biến có một mật khẩu riêng
  sed -i "0,/doi-bang-gen-secrets/s//${secret}/" .env
done
chmod 600 .env
echo "Đã tạo .env (quyền 600). Mật khẩu quản trị Sổ Việc, Grafana, pgAdmin nằm trong file này."
