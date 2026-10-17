-- Offers gain a third kind, quantity pricing ("2 for 3,500 DA, 3 for 4,500
-- DA"), and the database now keeps every offer coherent on its own; an order
-- records which offer shaped it.
--
-- offers is rebuilt with CHECKs a write could not get around:
--   * a gift offer ('free') names its gift and gives at least one; the other
--     kinds name none;
--   * a reward variant needs a reward product;
--   * a schedule ends after it starts.
-- Rows the old code let through are repaired first and switched off, so the
-- merchant reviews them rather than losing them: a gift offer with no gift
-- gives the product it is about; a free-shipping offer drops a stray gift; an
-- end before the start is removed.
--
-- offer_price_tiers holds a quantity-pricing offer's tiers: from `quantity`
-- units the line costs `price` for that many (the per-unit price of the
-- highest tier reached applies to every unit), with free delivery on the tier
-- when `free_shipping`.
--
-- order_products.offer_id / reward and orders.delivery_offer_id say which
-- offer priced a line, which lines are gifts, and which offer made delivery
-- free. Gifts were marked so far by "🎁 مجاني" appended to the variant label:
-- those lines take reward = 1 and their label back.

UPDATE offers
SET reward_product_id = trigger_product_id,
    reward_variant_id = NULL,
    reward_quantity = max(reward_quantity, 1),
    status = 'inactive'
WHERE discount_type = 'free' AND (reward_product_id IS NULL OR reward_quantity < 1);

UPDATE offers
SET reward_product_id = NULL, reward_variant_id = NULL, reward_quantity = 0
WHERE discount_type = 'free_shipping' AND (reward_product_id IS NOT NULL OR reward_variant_id IS NOT NULL OR reward_quantity <> 0);

UPDATE offers SET ends_at = NULL, status = 'inactive' WHERE starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at <= starts_at;

UPDATE offers SET trigger_quantity = 1 WHERE trigger_quantity < 1;

PRAGMA defer_foreign_keys = true;

CREATE TABLE offers_next (
  id text PRIMARY KEY NOT NULL,
  name text NOT NULL,
  trigger_product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  trigger_variant_id text REFERENCES product_variants(id) ON DELETE SET NULL,
  trigger_quantity integer NOT NULL DEFAULT 2 CHECK (trigger_quantity >= 1),
  reward_product_id text REFERENCES products(id) ON DELETE CASCADE,
  reward_variant_id text REFERENCES product_variants(id) ON DELETE SET NULL,
  reward_quantity integer NOT NULL DEFAULT 1,
  discount_type text NOT NULL DEFAULT 'free' CHECK (discount_type IN ('free', 'free_shipping', 'quantity_price')),
  starts_at text,
  ends_at text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at text NOT NULL,
  updated_at text NOT NULL,
  CHECK ((discount_type = 'free') = (reward_product_id IS NOT NULL)),
  CHECK (discount_type <> 'free' OR reward_quantity >= 1),
  CHECK (discount_type = 'free' OR reward_quantity = 0),
  CHECK (reward_variant_id IS NULL OR reward_product_id IS NOT NULL),
  CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
);

INSERT INTO offers_next (id, name, trigger_product_id, trigger_variant_id, trigger_quantity, reward_product_id, reward_variant_id, reward_quantity, discount_type, starts_at, ends_at, status, created_at, updated_at)
SELECT id, name, trigger_product_id, trigger_variant_id, trigger_quantity, reward_product_id, reward_variant_id, reward_quantity, discount_type, starts_at, ends_at, status, created_at, updated_at FROM offers;

DROP TRIGGER translations_offer_deleted;
DROP TABLE offers;
ALTER TABLE offers_next RENAME TO offers;

CREATE INDEX idx_offers_trigger_product ON offers (trigger_product_id);
CREATE INDEX idx_offers_reward_product ON offers (reward_product_id) WHERE reward_product_id IS NOT NULL;
CREATE INDEX idx_offers_trigger_variant ON offers (trigger_variant_id) WHERE trigger_variant_id IS NOT NULL;
CREATE INDEX idx_offers_reward_variant ON offers (reward_variant_id) WHERE reward_variant_id IS NOT NULL;
CREATE TRIGGER translations_offer_deleted AFTER DELETE ON offers BEGIN DELETE FROM translations WHERE resource_type = 'offer' AND resource_id = OLD.id; END;

CREATE TABLE offer_price_tiers (
  offer_id text NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 1000),
  price integer NOT NULL CHECK (price >= 0),
  free_shipping integer NOT NULL DEFAULT 0 CHECK (free_shipping IN (0, 1)),
  PRIMARY KEY (offer_id, quantity)
);

ALTER TABLE order_products ADD COLUMN offer_id text REFERENCES offers(id) ON DELETE SET NULL;
ALTER TABLE order_products ADD COLUMN reward integer NOT NULL DEFAULT 0 CHECK (reward IN (0, 1));
ALTER TABLE orders ADD COLUMN delivery_offer_id text REFERENCES offers(id) ON DELETE SET NULL;

CREATE INDEX idx_order_products_offer ON order_products (offer_id) WHERE offer_id IS NOT NULL;

UPDATE order_products
SET reward = 1,
    variant_label = CASE
      WHEN variant_label = '🎁 مجاني' THEN NULL
      ELSE substr(variant_label, 1, length(variant_label) - length(' — 🎁 مجاني'))
    END
WHERE line_total = 0 AND (variant_label = '🎁 مجاني' OR variant_label LIKE '% — 🎁 مجاني');
