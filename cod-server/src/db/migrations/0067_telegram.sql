-- The Telegram App (docs/events/PLAN.md, Phase 12; ADR 0020): the merchant's
-- own bot, kept beside the Telegram Consumer it sends through. Its token and
-- the secret Telegram sends back on each update are secrets: kept here,
-- never returned. The chat is null until the merchant presses Start on the
-- pairing link; the pairing code is kept as its SHA-256, never as itself.
--
-- The Consumer keeps the language and the chosen events; disconnecting
-- deletes this row and keeps the Consumer, with its delivery history.
--
-- Additive: a new table; no existing row or value changes.
CREATE TABLE store_telegram_config (
  consumer_id TEXT PRIMARY KEY NOT NULL REFERENCES event_consumers(id) ON DELETE CASCADE,
  bot_token TEXT NOT NULL,
  bot_id INTEGER NOT NULL,
  bot_username TEXT NOT NULL,
  webhook_secret TEXT NOT NULL,
  chat_id INTEGER,
  chat_name TEXT,
  connected_at TEXT,
  pairing_code_hash TEXT,
  pairing_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
