CREATE TABLE users (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 500,000 sample users: enough data that loading it all at once really hurts.
INSERT INTO users (name, email)
SELECT 'User ' || n, 'user' || n || '@example.com'
FROM generate_series(1, 500000) AS n;
