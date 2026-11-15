-- The confirmation team (marketing analytics Phase 2.T): who each order is
-- assigned to, who first decided it and who confirmed it, the members who
-- take orders, their pay, and how the store shares orders out.
--
-- Additive. Every order keeps its data and starts unassigned; nothing is
-- shared out until the merchant turns it on. Who decided and who confirmed
-- each order live on the order because the Event Log is pruned after 90
-- days, and pay and team results must not change when it is. They are read
-- here from the log the store still keeps; an older order stays unknown.
-- The id columns that credit work carry no foreign key: the credit outlives
-- the member. No CHECK on a vocabulary (the distribution, the pay kind): they
-- grow, and a CHECK in SQLite changes only by rebuilding the table.
ALTER TABLE orders ADD COLUMN assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN assigned_at TEXT;
ALTER TABLE orders ADD COLUMN take_backs INTEGER NOT NULL DEFAULT 0 CHECK (take_backs >= 0);
ALTER TABLE orders ADD COLUMN callback_at TEXT;
ALTER TABLE orders ADD COLUMN decided_at TEXT;
ALTER TABLE orders ADD COLUMN decided_by TEXT;
ALTER TABLE orders ADD COLUMN confirmed_at TEXT;
ALTER TABLE orders ADD COLUMN confirmed_by TEXT;

-- data-safety: orders.confirmed_at — a new column, filled from the order's first order.confirmed event
-- data-safety: orders.confirmed_by — a new column, filled with the member behind that event
UPDATE orders SET confirmed_at = (SELECT e.occurred_at FROM business_events e WHERE e.order_id = orders.id AND e.type = 'order.confirmed' ORDER BY e.seq LIMIT 1), confirmed_by = (SELECT e.actor_id FROM business_events e WHERE e.order_id = orders.id AND e.type = 'order.confirmed' ORDER BY e.seq LIMIT 1) WHERE EXISTS (SELECT 1 FROM business_events e WHERE e.order_id = orders.id AND e.type = 'order.confirmed');

-- data-safety: orders.decided_at — a new column, filled from the order's first move away from new
-- data-safety: orders.decided_by — a new column, filled with the member behind that move
UPDATE orders SET decided_at = (SELECT e.occurred_at FROM business_events e WHERE e.order_id = orders.id AND e.type IN ('order.confirmed', 'order.unreachable', 'order.cancelled') ORDER BY e.seq LIMIT 1), decided_by = (SELECT e.actor_id FROM business_events e WHERE e.order_id = orders.id AND e.type IN ('order.confirmed', 'order.unreachable', 'order.cancelled') ORDER BY e.seq LIMIT 1) WHERE EXISTS (SELECT 1 FROM business_events e WHERE e.order_id = orders.id AND e.type IN ('order.confirmed', 'order.unreachable', 'order.cancelled'));

-- The orders waiting (status new) are found through idx_orders_status_created_id.
CREATE INDEX orders_assignee ON orders (assignee_id, status, created_at DESC, id DESC) WHERE assignee_id IS NOT NULL;
CREATE INDEX orders_callbacks ON orders (callback_at) WHERE callback_at IS NOT NULL;
CREATE INDEX orders_confirmed ON orders (confirmed_at) WHERE confirmed_at IS NOT NULL;
CREATE INDEX shipments_delivered ON shipments (delivered_at) WHERE delivered_at IS NOT NULL;

CREATE TABLE team_agents (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiving INTEGER NOT NULL DEFAULT 0 CHECK (receiving IN (0, 1)),
  turn INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Each time a member is on the team, from the day they joined to the day
-- they left, so a past month's payroll never changes when someone leaves.
-- Kept by team_agents itself: whoever adds or removes a member.
CREATE TABLE team_memberships (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL,
  left_at TEXT
);

CREATE INDEX team_memberships_period ON team_memberships (joined_at, left_at);
CREATE UNIQUE INDEX team_memberships_open ON team_memberships (user_id) WHERE left_at IS NULL;

CREATE TRIGGER team_agents_joined AFTER INSERT ON team_agents BEGIN INSERT INTO team_memberships (id, user_id, joined_at) VALUES (lower(hex(randomblob(16))), NEW.user_id, NEW.created_at); END;
CREATE TRIGGER team_agents_left AFTER DELETE ON team_agents BEGIN UPDATE team_memberships SET left_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE user_id = OLD.user_id AND left_at IS NULL; END;

-- The rule gives new orders only to members who can see orders, read
-- from each member's permissions; this keeps that lookup off a full scan.
CREATE INDEX IF NOT EXISTS user_scopes_user_scope ON user_scopes (user_id, scope);

CREATE TABLE team_pay (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  valid_from TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT
);

CREATE UNIQUE INDEX team_pay_from ON team_pay (user_id, kind, valid_from);

CREATE TABLE store_team_config (
  id TEXT PRIMARY KEY NOT NULL,
  store_id TEXT NOT NULL UNIQUE REFERENCES stores(id) ON DELETE CASCADE,
  distribution TEXT NOT NULL DEFAULT 'manual',
  take_back_minutes INTEGER CHECK (take_back_minutes IS NULL OR take_back_minutes > 0),
  take_back_limit INTEGER NOT NULL DEFAULT 2 CHECK (take_back_limit >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- A member's turn: a number that grows each time any member gets an order,
-- however it was given, so the member with the lowest (or none) is next.
CREATE TRIGGER orders_assignee_turn_insert AFTER INSERT ON orders WHEN NEW.assignee_id IS NOT NULL BEGIN UPDATE team_agents SET turn = (SELECT COALESCE(MAX(turn), 0) + 1 FROM team_agents) WHERE user_id = NEW.assignee_id; END;
CREATE TRIGGER orders_assignee_turn_update AFTER UPDATE OF assignee_id ON orders WHEN NEW.assignee_id IS NOT NULL BEGIN UPDATE team_agents SET turn = (SELECT COALESCE(MAX(turn), 0) + 1 FROM team_agents) WHERE user_id = NEW.assignee_id; END;
