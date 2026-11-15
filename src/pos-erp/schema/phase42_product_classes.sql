-- phase42_product_classes.sql   -- NOT YET RUN on any database. Run on STAGING first. Re-runnable.
--
-- WHY
--   A business often sells in several distinct "sections": a restaurant may have a General Restaurant (food and soft
--   drinks), a Lounge / Bar (alcohol), Accommodation and Outdoor Activities. Each section needs its own sales, stock
--   and profit report. Product CATEGORIES (Sodas, Beers, Mains ...) are about what the item is; a product CLASS is
--   about WHICH PART OF THE BUSINESS earns or holds it. The two are independent: both stay on the product.
--
-- WHAT THIS ADDS (nothing existing is changed or removed)
--   1. lb_product_classes      one row per class, per business (name is editable, `kind` is a fixed label the app uses)
--   2. lb_products.class_id    which class an item or service belongs to (nullable: unclassified items still sell)
--   3. lb_folio_lines.class_id which class a hand-posted folio line (room night, package ...) belongs to (nullable)
--   4. seed_default_product_classes()     one click set-up of a ready-made list of classes
--   5. pos_auto_assign_product_classes()  suggests / applies a class for items that have none, from category + item name
--   6. pos_assign_class_to_category()     moves every item of one category into one class
--   7. pos_sales_by_class(), pos_sales_by_class_detail(), pos_stock_report()   the figures the reports and the budget read
--
-- RUN ORDER: after phase19 (folios), phase28 (permissions). phase44 (budgets) reads the functions below.
--
-- ASSUMED ABOUT THE LIVE DATABASE (all of these columns are already read by the app today; confirm on staging):
--   lb_products(id, tenant_id, business_id NULLABLE, name, category_id, cost_price, selling_price, reorder_level,
--               track_inventory, is_active = 'active'/'inactive')
--   lb_product_categories(id, name)
--   lb_inventory(product_id, warehouse_id, quantity, average_cost)
--   lb_sales(id, tenant_id, business_id, status, created_at)   lb_sale_items(sale_id, product_id, quantity, total_price, cost_price)
--   lb_folio_lines(... line_type, amount, sale_id, sale_item_id, status, created_at)
--
-- DAYS are Nairobi days (Africa/Nairobi), the same rule the daily closing uses.
--
-- ROLLBACK (additive only; reports then simply stop grouping by class):
--   DROP FUNCTION pos_sales_by_class(uuid,date,date), pos_sales_by_class_detail(uuid,date,date), pos_stock_report(uuid),
--     pos_auto_assign_product_classes(uuid,boolean), pos_assign_class_to_category(uuid,uuid,uuid), seed_default_product_classes(uuid,text),
--     _pos_sales_by_class_core(uuid,date,date);
--   ALTER TABLE lb_folio_lines DROP COLUMN class_id;  ALTER TABLE lb_products DROP COLUMN class_id;  DROP TABLE lb_product_classes;

DO $$ BEGIN
  IF to_regprocedure('pos_require(text[])') IS NULL THEN
    RAISE EXCEPTION 'phase42 needs phase28_permissions.sql (pos_require) to be applied first.';
  END IF;
END $$;

-- ---------- 1. the classes ----------
CREATE TABLE IF NOT EXISTS lb_product_classes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  name        text NOT NULL CHECK (btrim(name) <> ''),
  -- `kind` never changes what a class is called; it lets the app and the keyword helper treat "Lounge" and "Bar & Grill"
  -- the same way, and tells the report where hand-posted room charges belong (ACCOMMODATION).
  kind        text NOT NULL DEFAULT 'OTHER'
              CHECK (kind IN ('RESTAURANT','BAR','ACCOMMODATION','OUTDOOR','RETAIL','SERVICES','OTHER')),
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- one name per business, ignoring capitals and stray spaces
CREATE UNIQUE INDEX IF NOT EXISTS uq_lb_product_classes_name ON lb_product_classes (business_id, lower(btrim(name)));
CREATE INDEX IF NOT EXISTS idx_lb_product_classes_business ON lb_product_classes (business_id, sort_order);

ALTER TABLE lb_product_classes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_lb_product_classes ON lb_product_classes;
CREATE POLICY tenant_isolation_lb_product_classes ON lb_product_classes
  FOR ALL USING (tenant_id = get_current_tenant_id()) WITH CHECK (tenant_id = get_current_tenant_id());

-- Who may change classes: whoever may change items and prices (phase28 trigger pattern; a non-POS session always passes).
DROP TRIGGER IF EXISTS trg_pos_perm_lb_product_classes_ins ON lb_product_classes;
DROP TRIGGER IF EXISTS trg_pos_perm_lb_product_classes_upd ON lb_product_classes;
DROP TRIGGER IF EXISTS trg_pos_perm_lb_product_classes_del ON lb_product_classes;
CREATE TRIGGER trg_pos_perm_lb_product_classes_ins BEFORE INSERT ON lb_product_classes FOR EACH ROW EXECUTE FUNCTION pos_enforce_permission('products.manage');
CREATE TRIGGER trg_pos_perm_lb_product_classes_upd BEFORE UPDATE ON lb_product_classes FOR EACH ROW EXECUTE FUNCTION pos_enforce_permission('products.manage');
CREATE TRIGGER trg_pos_perm_lb_product_classes_del BEFORE DELETE ON lb_product_classes FOR EACH ROW EXECUTE FUNCTION pos_enforce_permission('products.manage');

-- ---------- 2. the link on items and on hand-posted folio lines ----------
-- ON DELETE SET NULL: deleting a class never deletes an item; the item just becomes "not classified".
ALTER TABLE lb_products ADD COLUMN IF NOT EXISTS class_id uuid REFERENCES lb_product_classes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_lb_products_class ON lb_products (class_id) WHERE class_id IS NOT NULL;

DO $$ BEGIN
  IF to_regclass('public.lb_folio_lines') IS NOT NULL THEN
    ALTER TABLE lb_folio_lines ADD COLUMN IF NOT EXISTS class_id uuid REFERENCES lb_product_classes(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ---------- 3. one-click starter set ----------
-- p_preset: 'hospitality' (restaurant + bar + rooms + outdoor), 'restaurant' (restaurant + bar), 'retail', 'services'.
-- Safe to run twice: a class whose name already exists is left alone. Returns how many were created.
CREATE OR REPLACE FUNCTION seed_default_product_classes(p_business_id uuid, p_preset text DEFAULT 'hospitality')
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid; v_n integer := 0; r record; v_rows integer;
BEGIN
  PERFORM pos_require('products.manage');
  SELECT tenant_id INTO v_tenant FROM lb_businesses WHERE id = p_business_id AND tenant_id = get_current_tenant_id();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Business not found.'; END IF;

  FOR r IN
    SELECT * FROM (VALUES
      ('hospitality', 'General Restaurant',   'RESTAURANT',    1),
      ('hospitality', 'Lounge & Bar',         'BAR',           2),
      ('hospitality', 'Accommodation',        'ACCOMMODATION', 3),
      ('hospitality', 'Outdoor Activities',   'OUTDOOR',       4),
      ('restaurant',  'General Restaurant',   'RESTAURANT',    1),
      ('restaurant',  'Lounge & Bar',         'BAR',           2),
      ('retail',      'General Goods',        'RETAIL',        1),
      ('retail',      'Services',             'SERVICES',      2),
      ('services',    'Services',             'SERVICES',      1),
      ('services',    'Products',             'RETAIL',        2)
    ) AS v(preset, name, kind, ord)
    WHERE v.preset = lower(coalesce(p_preset, 'hospitality'))
  LOOP
    INSERT INTO lb_product_classes (tenant_id, business_id, name, kind, sort_order)
    VALUES (v_tenant, p_business_id, r.name, r.kind, r.ord)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_n := v_n + v_rows;
  END LOOP;
  RETURN v_n;
END $$;

-- ---------- 4. move a whole category into a class ----------
-- Only touches items of this business. Returns how many items were moved. p_class_id NULL = clear the class.
CREATE OR REPLACE FUNCTION pos_assign_class_to_category(p_business_id uuid, p_category_id uuid, p_class_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_n integer;
BEGIN
  PERFORM pos_require('products.manage');
  IF NOT EXISTS (SELECT 1 FROM lb_businesses WHERE id = p_business_id AND tenant_id = get_current_tenant_id()) THEN
    RAISE EXCEPTION 'Business not found.';
  END IF;
  IF p_class_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM lb_product_classes WHERE id = p_class_id AND business_id = p_business_id AND tenant_id = get_current_tenant_id()) THEN
    RAISE EXCEPTION 'That class does not belong to this business.';
  END IF;
  UPDATE lb_products SET class_id = p_class_id, updated_at = now()
   WHERE tenant_id = get_current_tenant_id() AND category_id = p_category_id
     AND (business_id IS NULL OR business_id = p_business_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- ---------- 5. suggest (or apply) a class for items that have none ----------
-- A starting point, never a verdict: it reads the CATEGORY name and the ITEM name for plain words (beer, whisky, soda,
-- room, horse ride ...). Items it cannot place are left alone. Default is a PREVIEW (p_apply = false): nothing changes.
-- It only ever fills items whose class_id is empty, so it can never overwrite a choice a person made.
-- Needs the class of that kind to exist (run seed_default_product_classes first); a kind with no class is skipped.
CREATE OR REPLACE FUNCTION pos_auto_assign_product_classes(p_business_id uuid, p_apply boolean DEFAULT false)
RETURNS TABLE (product_id uuid, product_name text, category_name text, suggested_class_id uuid, suggested_class text, matched_on text, applied boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  -- order matters: BAR words are tested first so "Tusker Lager" never lands in the restaurant.
  c_bar  constant text := '(beer|lager|tusker|guinness|heineken|pilsner|stout|cider|savanna|smirnoff|whisk|vodka|gin\M|rum\M|brandy|cognac|tequila|liquor|spirit|wine|champagne|prosecco|cocktail|shot\M|jameson|johnnie|jack daniel|hennessy|chivas|baileys|vodka|bar\M|lounge|alcohol)';
  c_room constant text := '(room|suite|bed ?& ?breakfast|bed and breakfast|accommodation|lodging|night\M|villa|cottage|banda|tent\M|camp ?site|campsite)';
  c_out  constant text := '(swim|pool|horse|quad|bike|cycling|hike|hiking|game drive|safari|zip ?line|archery|paintball|boat|kayak|fishing|bonfire|team building|camp ?fire|nature walk|outdoor|activity|activities|golf|sport)';
  c_food constant text := '(soda|coke|fanta|sprite|juice|water|tea\M|coffee|milk|smoothie|food|meal|breakfast|lunch|dinner|nyama|ugali|rice|chips|fries|pizza|burger|chicken|beef|fish|salad|soup|stew|githeri|mandazi|samosa|snack|dessert|cake|bread|restaurant|kitchen|menu|starter|main|side)';
  v_tenant uuid := get_current_tenant_id();
  v_bar uuid; v_room uuid; v_out uuid; v_food uuid;
BEGIN
  PERFORM pos_require('products.manage');
  IF NOT EXISTS (SELECT 1 FROM lb_businesses WHERE id = p_business_id AND tenant_id = v_tenant) THEN RAISE EXCEPTION 'Business not found.'; END IF;

  SELECT id INTO v_bar  FROM lb_product_classes WHERE business_id = p_business_id AND kind = 'BAR'           AND is_active ORDER BY sort_order, created_at LIMIT 1;
  SELECT id INTO v_room FROM lb_product_classes WHERE business_id = p_business_id AND kind = 'ACCOMMODATION' AND is_active ORDER BY sort_order, created_at LIMIT 1;
  SELECT id INTO v_out  FROM lb_product_classes WHERE business_id = p_business_id AND kind = 'OUTDOOR'       AND is_active ORDER BY sort_order, created_at LIMIT 1;
  SELECT id INTO v_food FROM lb_product_classes WHERE business_id = p_business_id AND kind = 'RESTAURANT'    AND is_active ORDER BY sort_order, created_at LIMIT 1;

  RETURN QUERY
  WITH cand AS (
    SELECT p.id AS pid, p.name AS pname, c.name AS cname,
           lower(coalesce(c.name, '') || ' | ' || coalesce(p.name, '')) AS hay
      FROM lb_products p LEFT JOIN lb_product_categories c ON c.id = p.category_id
     WHERE p.tenant_id = v_tenant AND (p.business_id IS NULL OR p.business_id = p_business_id)
       AND p.class_id IS NULL AND p.is_active = 'active'
  ), picked AS (
    SELECT cand.*,
      CASE WHEN v_bar  IS NOT NULL AND hay ~ c_bar  THEN v_bar
           WHEN v_room IS NOT NULL AND hay ~ c_room THEN v_room
           WHEN v_out  IS NOT NULL AND hay ~ c_out  THEN v_out
           WHEN v_food IS NOT NULL AND hay ~ c_food THEN v_food END AS cid,
      CASE WHEN v_bar  IS NOT NULL AND hay ~ c_bar  THEN substring(hay from c_bar)
           WHEN v_room IS NOT NULL AND hay ~ c_room THEN substring(hay from c_room)
           WHEN v_out  IS NOT NULL AND hay ~ c_out  THEN substring(hay from c_out)
           WHEN v_food IS NOT NULL AND hay ~ c_food THEN substring(hay from c_food) END AS why
      FROM cand
  ), done AS (
    UPDATE lb_products up SET class_id = picked.cid, updated_at = now()
      FROM picked WHERE p_apply AND picked.cid IS NOT NULL AND up.id = picked.pid AND up.class_id IS NULL
    RETURNING up.id AS did
  )
  SELECT picked.pid, picked.pname, picked.cname, picked.cid, k.name, picked.why, (picked.pid IN (SELECT did FROM done))
    FROM picked JOIN lb_product_classes k ON k.id = picked.cid
   WHERE picked.cid IS NOT NULL
   ORDER BY k.sort_order, picked.pname;
END $$;

-- ---------- 6. the figures ----------
-- Revenue per class per item for a date range. "Sold" = lines of COMPLETED / PARTIALLY_REFUNDED sales (the same rule as
-- Total Sales in the daily closing); reversed or voided sales are left out. Hand-posted folio lines that did NOT come
-- from a till sale (room nights, packages, adjustments) are added, so Accommodation is not empty. Folio lines that came
-- from a till sale are NOT added again (they already count as sale items), so nothing is counted twice.
-- Internal core: no permission check, so it is NOT granted to clients; only the SECURITY DEFINER functions below
-- (which check the permission and that the business is the caller's own) and phase44 call it. Every table it reads is
-- filtered by get_current_tenant_id() explicitly, so running with definer rights shows one tenant only.
CREATE OR REPLACE FUNCTION _pos_own_business(p_business_id uuid) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM lb_businesses WHERE id = p_business_id AND tenant_id = get_current_tenant_id()) THEN
    RAISE EXCEPTION 'Business not found.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION _pos_sales_by_class_core(p_business_id uuid, p_from date, p_to date)
RETURNS TABLE (class_id uuid, class_name text, class_kind text, product_id uuid, product_name text, category_name text,
               units numeric, revenue numeric, cost numeric, lines bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH room_class AS (
    SELECT id FROM lb_product_classes
     WHERE business_id = p_business_id AND tenant_id = get_current_tenant_id() AND kind = 'ACCOMMODATION' AND is_active
     ORDER BY sort_order, created_at LIMIT 1
  ), items AS (
    SELECT p.class_id AS cid, p.id AS pid, coalesce(p.name, 'Custom / open item') AS pname, cat.name AS cname,
           si.quantity AS qty, si.total_price AS rev, si.quantity * coalesce(si.cost_price, 0) AS cst
      FROM lb_sales s
      JOIN lb_sale_items si ON si.sale_id = s.id
      LEFT JOIN lb_products p ON p.id = si.product_id
      LEFT JOIN lb_product_categories cat ON cat.id = p.category_id
     WHERE s.tenant_id = get_current_tenant_id() AND s.business_id = p_business_id
       AND s.status IN ('COMPLETED', 'PARTIALLY_REFUNDED')
       AND (s.created_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to
  ), hand AS (
    SELECT coalesce(fl.class_id, CASE WHEN fl.line_type = 'ROOM' THEN (SELECT id FROM room_class) END) AS cid,
           NULL::uuid AS pid,
           CASE fl.line_type WHEN 'ROOM' THEN 'Room & stay charges' WHEN 'PACKAGE' THEN 'Packages' WHEN 'ADJUSTMENT' THEN 'Folio adjustments'
                ELSE coalesce(nullif(btrim(fl.description), ''), initcap(lower(fl.line_type))) END AS pname,
           NULL::text AS cname, fl.quantity AS qty, fl.amount AS rev, 0::numeric AS cst
      FROM lb_folio_lines fl JOIN lb_folios f ON f.id = fl.folio_id
     WHERE fl.tenant_id = get_current_tenant_id() AND fl.business_id = p_business_id
       AND fl.status = 'POSTED' AND f.status <> 'VOID'
       AND fl.sale_id IS NULL AND fl.sale_item_id IS NULL
       AND (fl.created_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to
  ), allrows AS (
    SELECT * FROM items UNION ALL SELECT * FROM hand
  )
  SELECT a.cid, coalesce(k.name, 'Not classified'), coalesce(k.kind, 'OTHER'), a.pid, a.pname, a.cname,
         sum(a.qty), sum(a.rev), sum(a.cst), count(*)
    FROM allrows a LEFT JOIN lb_product_classes k ON k.id = a.cid AND k.tenant_id = get_current_tenant_id()
   GROUP BY a.cid, k.name, k.kind, a.pid, a.pname, a.cname
$$;

-- Item level (for the printed "Sales by class" report).
CREATE OR REPLACE FUNCTION pos_sales_by_class_detail(p_business_id uuid, p_from date, p_to date)
RETURNS TABLE (class_id uuid, class_name text, class_kind text, product_id uuid, product_name text, category_name text,
               units numeric, revenue numeric, cost numeric, lines bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM pos_require('sales.view', 'finance.view');
  PERFORM _pos_own_business(p_business_id);
  RETURN QUERY SELECT * FROM _pos_sales_by_class_core(p_business_id, p_from, p_to)
   ORDER BY 2, 8 DESC, 5;
END $$;

-- Class level (one row per class, "Not classified" last).
CREATE OR REPLACE FUNCTION pos_sales_by_class(p_business_id uuid, p_from date, p_to date)
RETURNS TABLE (class_id uuid, class_name text, class_kind text, units numeric, revenue numeric, cost numeric, gross_profit numeric, items bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM pos_require('sales.view', 'finance.view');
  PERFORM _pos_own_business(p_business_id);
  RETURN QUERY
  SELECT c.class_id, c.class_name, c.class_kind, sum(c.units), sum(c.revenue), sum(c.cost), sum(c.revenue) - sum(c.cost), count(*)
    FROM _pos_sales_by_class_core(p_business_id, p_from, p_to) c
   GROUP BY c.class_id, c.class_name, c.class_kind
   ORDER BY (c.class_id IS NULL), sum(c.revenue) DESC, c.class_name;
END $$;

-- Stock on hand, item by item, with class and category, for the stock reports (by class, by category, low stock).
-- Quantity is summed over warehouses. Value uses the item's average cost when the stock row has one, else its cost price.
CREATE OR REPLACE FUNCTION pos_stock_report(p_business_id uuid)
RETURNS TABLE (product_id uuid, product_name text, sku text, class_id uuid, class_name text, category_id uuid, category_name text,
               quantity numeric, reorder_level numeric, cost_price numeric, selling_price numeric,
               value_at_cost numeric, value_at_retail numeric, stock_state text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM pos_require('inventory.view', 'finance.view');
  PERFORM _pos_own_business(p_business_id);
  RETURN QUERY
  SELECT p.id, p.name, p.sku, k.id, coalesce(k.name, 'Not classified'), cat.id, coalesce(cat.name, 'No category'),
         coalesce(sum(i.quantity), 0)::numeric,
         coalesce(p.reorder_level, 0)::numeric,
         coalesce(p.cost_price, 0)::numeric,
         coalesce(p.selling_price, 0)::numeric,
         coalesce(sum(i.quantity * coalesce(nullif(i.average_cost, 0), p.cost_price, 0)), 0)::numeric,
         coalesce(sum(i.quantity) * coalesce(p.selling_price, 0), 0)::numeric,
         CASE WHEN coalesce(sum(i.quantity), 0) <= 0 THEN 'OUT'
              WHEN coalesce(p.reorder_level, 0) > 0 AND coalesce(sum(i.quantity), 0) <= p.reorder_level THEN 'LOW'
              ELSE 'OK' END
    FROM lb_products p
    LEFT JOIN lb_product_classes k ON k.id = p.class_id
    LEFT JOIN lb_product_categories cat ON cat.id = p.category_id
    LEFT JOIN lb_inventory i ON i.product_id = p.id
   WHERE p.tenant_id = get_current_tenant_id() AND (p.business_id IS NULL OR p.business_id = p_business_id)
     AND p.is_active = 'active' AND coalesce(p.track_inventory, true)
   GROUP BY p.id, p.name, p.sku, k.id, k.name, cat.id, cat.name, p.reorder_level, p.cost_price, p.selling_price
   ORDER BY coalesce(k.name, 'zzz'), coalesce(cat.name, 'zzz'), p.name;
END $$;

REVOKE ALL ON FUNCTION seed_default_product_classes(uuid, text), pos_assign_class_to_category(uuid, uuid, uuid),
  pos_auto_assign_product_classes(uuid, boolean), pos_sales_by_class(uuid, date, date),
  pos_sales_by_class_detail(uuid, date, date), pos_stock_report(uuid), _pos_sales_by_class_core(uuid, date, date), _pos_own_business(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION seed_default_product_classes(uuid, text), pos_assign_class_to_category(uuid, uuid, uuid),
  pos_auto_assign_product_classes(uuid, boolean), pos_sales_by_class(uuid, date, date),
  pos_sales_by_class_detail(uuid, date, date), pos_stock_report(uuid) TO authenticated;
-- _pos_sales_by_class_core and _pos_own_business are deliberately NOT granted: only the functions above (and phase44) reach them.

-- ---------- 7. OPTIONAL: set up YOUR business now (edit the two values, then run this block by hand) ----------
-- SELECT seed_default_product_classes('<your business id>', 'hospitality');
-- SELECT * FROM pos_auto_assign_product_classes('<your business id>', false);   -- preview
-- SELECT * FROM pos_auto_assign_product_classes('<your business id>', true);    -- apply
