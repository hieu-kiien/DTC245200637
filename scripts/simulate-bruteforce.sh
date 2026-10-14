#!/usr/bin/env bash
# Mô phỏng sự cố: một IP thử mật khẩu liên tiếp vào trang đăng nhập.
# Dùng: ./scripts/simulate-bruteforce.sh [URL] [số lần]
# Chỉ chạy trên hệ thống của chính mình trong bài thực hành.
set -u
URL="${1:-https://localhost}"
N="${2:-15}"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

token() { sed -n 's/.*name="_csrf" value="\([a-f0-9]*\)".*/\1/p' | head -1; }
TOKEN="$(curl -sk -c "$JAR" -b "$JAR" "$URL/login" | token)"
[ -n "$TOKEN" ] || { echo "Không lấy được trang đăng nhập tại $URL/login"; exit 1; }

echo "Bắt đầu $(date '+%H:%M:%S'): $N lần đăng nhập sai vào tài khoản admin"
for i in $(seq 1 "$N"); do
  code="$(curl -sk -o /dev/null -w '%{http_code}' -c "$JAR" -b "$JAR" \
    --data-urlencode "_csrf=$TOKEN" --data-urlencode "username=admin" \
    --data-urlencode "password=thu-mat-khau-$i" "$URL/login")"
  printf 'lần %02d -> HTTP %s\n' "$i" "$code"
  sleep 0.3
done
echo "Xong $(date '+%H:%M:%S'). Mở Grafana > Alerting để xem cảnh báo, rồi truy vết bằng LogQL (xem README mục 6)."
