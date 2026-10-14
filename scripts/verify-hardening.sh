#!/usr/bin/env bash
# In ra bằng chứng cho từng biện pháp hardening. Chạy sau khi `docker compose up -d`.
# Dùng: ./scripts/verify-hardening.sh [URL]
set -u
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
URL="${1:-https://localhost}"
h() { printf '\n== %s\n' "$*"; }

h "1. Tiến trình chạy bằng người dùng nào (không được là uid=0)"
for s in webapp nginx db; do printf '%-7s ' "$s"; docker compose exec -T "$s" id; done

h "2. Hệ thống tệp của webapp chỉ đọc (lệnh ghi phải thất bại)"
docker compose exec -T webapp sh -c 'touch /app/thu.txt' 2>&1 || true

h "3. Cổng publish ra máy chủ (DB và ứng dụng không được có mặt)"
docker compose ps --format 'table {{.Service}}\t{{.Ports}}' | grep -v '^$'

h "4. Cô lập mạng: db_net là internal, Nginx không với tới DB"
docker network inspect dtc245200637_db_net --format '{{.Name}} internal={{.Internal}}'
docker compose exec -T nginx sh -c 'nc -z -w2 db 5432 && echo "nginx thấy db: SAI" || echo "nginx không kết nối được db: ĐÚNG"'

h "5. Security headers của Nginx"
curl -skI "$URL/login" | grep -iE '^(strict-transport|x-frame|x-content|x-xss|referrer|permissions|content-security)' || true

h "6. /metrics và /internal bị chặn từ ngoài (phải là 404)"
for path in /metrics /internal/alert-hook; do printf '%-22s ' "$path"; curl -sk -o /dev/null -w '%{http_code}\n' "$URL$path"; done

h "7. Quyền tối thiểu của tài khoản ứng dụng trong DB (DROP phải bị từ chối)"
docker compose exec -T -e PGPASSWORD="$APP_DB_PASSWORD" db psql -h 127.0.0.1 -U soviec_app -d "$DB_NAME" -c 'DROP TABLE tasks;' 2>&1 || true

h "8. Mật khẩu không nằm trong mã nguồn (không được có kết quả)"
git grep -nE "(PASSWORD|SECRET)=[0-9a-f]{16,}" -- . ':!.env' || echo "không tìm thấy mật khẩu trong mã nguồn đã commit"
