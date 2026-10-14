-- Lược đồ cơ sở dữ liệu Sổ Việc. Chạy một lần khi volume dữ liệu còn trống.
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(32)  NOT NULL UNIQUE,
  full_name     VARCHAR(80)  NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE tasks (
  id          SERIAL PRIMARY KEY,
  title       VARCHAR(140) NOT NULL,
  description TEXT         NOT NULL DEFAULT '',
  status      VARCHAR(8)   NOT NULL DEFAULT 'todo'   CHECK (status IN ('todo','doing','done')),
  priority    VARCHAR(8)   NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  due_date    DATE,
  assignee_id INT REFERENCES users(id) ON DELETE SET NULL,
  created_by  INT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX tasks_status_idx   ON tasks (status);
CREATE INDEX tasks_assignee_idx ON tasks (assignee_id);
