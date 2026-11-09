-- The Order Protection App: the merchant's rules for incoming orders, the
-- Block List, and one row per screened submission.
CREATE TABLE store_order_protection_config (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL UNIQUE REFERENCES stores(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE order_rules (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  mode TEXT NOT NULL,
  action TEXT NOT NULL,
  conditions_json TEXT NOT NULL,
  template_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE order_block_list (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX order_block_list_entry ON order_block_list (kind, value);

CREATE TABLE order_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  phone TEXT NOT NULL,
  ip_key TEXT,
  device_key TEXT,
  outcome TEXT NOT NULL,
  order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
  order_number TEXT,
  checkout_key TEXT,
  matches_json TEXT NOT NULL DEFAULT '[]',
  signals_json TEXT NOT NULL DEFAULT '{}',
  submission_json TEXT,
  answer_json TEXT
);

CREATE INDEX order_attempts_phone ON order_attempts (phone, created_at);
CREATE INDEX order_attempts_ip ON order_attempts (ip_key, created_at) WHERE ip_key IS NOT NULL;
CREATE INDEX order_attempts_device ON order_attempts (device_key, created_at) WHERE device_key IS NOT NULL;
CREATE INDEX order_attempts_outcome ON order_attempts (outcome, created_at);
CREATE INDEX order_attempts_order ON order_attempts (order_id) WHERE order_id IS NOT NULL;
CREATE UNIQUE INDEX order_attempts_spam_number ON order_attempts (order_number) WHERE outcome = 'spam';
CREATE UNIQUE INDEX order_attempts_spam_checkout ON order_attempts (checkout_key) WHERE outcome = 'spam' AND checkout_key IS NOT NULL;
