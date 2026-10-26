-- Apps and Integrations get their own permissions (docs/apps/PLAN.md, Phase A).
-- Whoever holds a permission one of them used to take is given its new ones,
-- so nobody loses access when the new server reads them, and nobody gains
-- anything else. The Meta App was admin only, and admins hold every
-- permission, so it gives no row.
--
-- The old rows stay: the running server reads them until it is replaced, and
-- a later release removes them.
--
-- Additive: new rows only; no existing row or value changes. Running it again
-- adds nothing.
WITH renamed(old_scope, new_scope) AS (
  VALUES
    ('settings:verification', 'dzverify:read'),
    ('settings:verification', 'dzverify:manage'),
    ('settings:verification', 'turnstile:read'),
    ('settings:verification', 'turnstile:manage'),
    ('settings:email', 'sendili:read'),
    ('settings:email', 'sendili:manage'),
    ('whatsapp_widget:read', 'whatsapp-button:read'),
    ('whatsapp_widget:manage', 'whatsapp-button:manage'),
    ('settings:integrations', 'integrations:read'),
    ('settings:integrations', 'integrations:manage')
)
INSERT INTO user_scopes (id, user_id, scope, granted_by, granted_at)
SELECT lower(hex(randomblob(16))), held.user_id, renamed.new_scope, min(held.granted_by), min(held.granted_at)
FROM user_scopes AS held
JOIN renamed ON renamed.old_scope = held.scope
WHERE NOT EXISTS (
  SELECT 1 FROM user_scopes AS present
  WHERE present.user_id = held.user_id AND present.scope = renamed.new_scope
)
GROUP BY held.user_id, renamed.new_scope;
