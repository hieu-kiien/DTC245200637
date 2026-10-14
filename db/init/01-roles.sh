#!/bin/sh
# Tách quyền: ứng dụng chỉ đọc/ghi dữ liệu, không được tạo hay xóa bảng. Exporter chỉ có quyền giám sát.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
  CREATE ROLE soviec_app LOGIN PASSWORD '${APP_DB_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO soviec_app;
  GRANT USAGE ON SCHEMA public TO soviec_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO soviec_app;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO soviec_app;

  CREATE ROLE soviec_exporter LOGIN PASSWORD '${EXPORTER_DB_PASSWORD}' NOSUPERUSER;
  GRANT pg_monitor TO soviec_exporter;
  GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO soviec_exporter;
SQL
