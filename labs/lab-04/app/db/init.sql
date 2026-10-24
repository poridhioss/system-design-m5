CREATE TABLE users (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 10,000 sample users for the reports and the export.
INSERT INTO users (name, email)
SELECT 'User ' || n, 'user' || n || '@example.com'
FROM generate_series(1, 10000) AS n;
