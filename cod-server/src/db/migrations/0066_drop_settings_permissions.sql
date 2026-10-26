-- The old permission names leave the store (docs/apps/PLAN.md, Phase B).
-- Migration 0065 gave every holder of one its new ones, and no server since
-- platform v4.0.0 reads them: settings:verification, settings:email,
-- settings:integrations, settings:notifications (never used) and
-- whatsapp_widget:read / :manage.
--
-- data-safety: user_scopes — rows holding an old permission name are deleted; each holder kept its new ones (0065), and nothing has read the old names since v4.0.0. Every other row stays as it was.
DELETE FROM user_scopes
WHERE scope IN (
  'settings:verification',
  'settings:email',
  'settings:integrations',
  'settings:notifications',
  'whatsapp_widget:read',
  'whatsapp_widget:manage'
);
