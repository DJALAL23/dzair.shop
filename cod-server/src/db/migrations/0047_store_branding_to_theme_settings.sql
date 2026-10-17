-- A store's colors and font are its theme's settings now (store_theme_settings,
-- migration 0045), edited in the theme editor instead of the dashboard. This
-- copies what each store chose into Theme-00's settings, so no storefront
-- changes look: `primaryColor`, `accentColor` and `backgroundColor` take the
-- stores' colors when they are #rgb or #rrggbb (the theme's color rule), and
-- `font` takes the first family of font_family when Theme-00 ships that face —
-- any other renders in Theme-00's default face today, and still will.
--
-- A value the store already saved for Theme-00 wins: json_patch applies the
-- saved values over the copied ones. The stores columns stay, frozen:
-- /store/config sends them to @wocart/storefront up to 1.7, which requires
-- them.

INSERT INTO store_theme_settings (store_id, theme_key, "values", updated_at)
SELECT
  s.id,
  'theme-00',
  json_patch('{}', json_object(
    'primaryColor', CASE WHEN length(s.primary_color) IN (4, 7) AND substr(s.primary_color, 1, 1) = '#' AND trim(lower(substr(s.primary_color, 2)), '0123456789abcdef') = '' THEN s.primary_color END,
    'accentColor', CASE WHEN length(s.accent_color) IN (4, 7) AND substr(s.accent_color, 1, 1) = '#' AND trim(lower(substr(s.accent_color, 2)), '0123456789abcdef') = '' THEN s.accent_color END,
    'backgroundColor', CASE WHEN length(s.bg_color) IN (4, 7) AND substr(s.bg_color, 1, 1) = '#' AND trim(lower(substr(s.bg_color, 2)), '0123456789abcdef') = '' THEN s.bg_color END,
    'font', (
      SELECT family FROM (
        SELECT 'Readex Pro' AS family UNION ALL SELECT 'Tajawal' UNION ALL SELECT 'Almarai'
        UNION ALL SELECT 'Noto Kufi Arabic' UNION ALL SELECT 'IBM Plex Sans Arabic'
      )
      WHERE lower(family) = lower(trim(replace(replace(
        CASE WHEN instr(s.font_family, ',') > 0 THEN substr(s.font_family, 1, instr(s.font_family, ',') - 1) ELSE s.font_family END,
        '"', ''), '''', '')))
    )
  )),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM stores s
WHERE true
ON CONFLICT (store_id, theme_key) DO UPDATE SET
  "values" = json_patch(excluded."values", store_theme_settings."values"),
  updated_at = excluded.updated_at;
