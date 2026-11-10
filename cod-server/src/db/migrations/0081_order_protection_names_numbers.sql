-- Order Protection: which template rule a rule came from, so its name reads in each
-- person's language; and an order number a Spam Order holds is never given to an order.
ALTER TABLE order_rules ADD COLUMN template_rule TEXT;

-- data-safety: order_rules.template_rule — a rule a template made, still under its template name, learns which template rule it is
UPDATE order_rules SET template_rule = CASE name
  WHEN 'Customers who received an order' THEN 'good_customer'
  WHEN 'Clients déjà livrés' THEN 'good_customer'
  WHEN 'زبائن استلموا طلبًا' THEN 'good_customer'
  WHEN 'Several orders from one phone' THEN 'same_phone'
  WHEN 'Plusieurs commandes d''un même numéro' THEN 'same_phone'
  WHEN 'عدة طلبات من نفس الرقم' THEN 'same_phone'
  WHEN 'Many orders from one network' THEN 'same_ip'
  WHEN 'Beaucoup de commandes d''un même réseau' THEN 'same_ip'
  WHEN 'طلبات كثيرة من نفس الشبكة' THEN 'same_ip'
  WHEN 'Sudden burst of orders' THEN 'burst'
  WHEN 'Afflux soudain de commandes' THEN 'burst'
  WHEN 'تدفق مفاجئ للطلبات' THEN 'burst'
  WHEN 'Several orders from one device' THEN 'same_device'
  WHEN 'Plusieurs commandes d''un même appareil' THEN 'same_device'
  WHEN 'عدة طلبات من نفس الجهاز' THEN 'same_device'
  WHEN 'Several phone numbers on one device' THEN 'many_numbers'
  WHEN 'Plusieurs numéros sur un même appareil' THEN 'many_numbers'
  WHEN 'عدة أرقام على نفس الجهاز' THEN 'many_numbers'
  WHEN 'Form filled in a few seconds' THEN 'fast_fill'
  WHEN 'Formulaire rempli en quelques secondes' THEN 'fast_fill'
  WHEN 'تعبئة النموذج في ثوانٍ' THEN 'fast_fill'
  WHEN 'Returned before, never delivered' THEN 'returner'
  WHEN 'Retours sans aucune livraison' THEN 'returner'
  WHEN 'مرتجعات دون أي تسليم' THEN 'returner'
END
WHERE template_key IS NOT NULL;

CREATE TRIGGER orders_number_not_held_insert BEFORE INSERT ON orders WHEN EXISTS (SELECT 1 FROM order_attempts WHERE order_number = NEW.order_number AND outcome = 'spam') BEGIN SELECT RAISE(ABORT, 'UNIQUE constraint failed: orders.order_number'); END;
CREATE TRIGGER orders_number_not_held_update BEFORE UPDATE OF order_number ON orders WHEN EXISTS (SELECT 1 FROM order_attempts WHERE order_number = NEW.order_number AND outcome = 'spam') BEGIN SELECT RAISE(ABORT, 'UNIQUE constraint failed: orders.order_number'); END;
