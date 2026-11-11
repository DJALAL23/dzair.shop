-- Where an order came from: the ad, the click and the landing page, captured
-- from the shopper's visit or chosen by the merchant (ADR 0026). One row per
-- attributed order, written in the order's own batch; no row means nothing is
-- known. `captured_at` is when the credited touch happened, so a report can
-- apply its click window.
--
-- abandoned_orders.attribution_json keeps the visit's touches with the
-- checkout, for the order a recovery creates.
--
-- Additive: a new table and a new nullable column. No row is written or
-- changed, and the running server reads neither.
CREATE TABLE order_attribution (
  order_id TEXT PRIMARY KEY NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  captured_at TEXT,
  platform TEXT NOT NULL,
  click_id TEXT,
  click_id_type TEXT,
  campaign_id TEXT,
  adset_id TEXT,
  ad_id TEXT,
  placement TEXT,
  site_source TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,
  names_json TEXT,
  landing_path TEXT,
  landing_page_type TEXT,
  referrer_host TEXT,
  first_touch_at TEXT,
  first_touch_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE abandoned_orders ADD COLUMN attribution_json TEXT;
