-- Product cost (marketing analytics plan, Phase 2.1): a variant can have its
-- own cost, and every order line freezes its product's unit cost when it is
-- written, so a later change to the catalog never rewrites a past order's
-- profit. The trigger does it for every writer (storefront, dashboard, API,
-- AI agent, a rescued spam order): the variant's cost, else the product's.
-- A line written with its own cost keeps it; an unknown cost stays null,
-- never zero.
--
-- Additive: new nullable columns and a trigger on new lines. No row is
-- written or changed; lines written before keep a null cost.
ALTER TABLE product_variants ADD COLUMN cost_price INTEGER;
ALTER TABLE order_products ADD COLUMN unit_cost INTEGER;
ALTER TABLE order_products ADD COLUMN unit_cost_source TEXT;
CREATE TRIGGER order_products_freeze_unit_cost AFTER INSERT ON order_products WHEN NEW.unit_cost IS NULL BEGIN UPDATE order_products SET unit_cost = COALESCE((SELECT cost_price FROM product_variants WHERE id = NEW.variant_id), (SELECT cost_price FROM products WHERE id = NEW.product_id)), unit_cost_source = 'catalog' WHERE id = NEW.id AND COALESCE((SELECT cost_price FROM product_variants WHERE id = NEW.variant_id), (SELECT cost_price FROM products WHERE id = NEW.product_id)) IS NOT NULL; END;
