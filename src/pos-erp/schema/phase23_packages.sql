-- ============================================================
-- phase23 — Packages (Phase 6 of the hospitality/production upgrade)
--
-- A package is ONE price for a bundle of things you already sell:
--   Family Package        = swimming + lunch + drinks            -> 4,500
--   Bed & Breakfast       = breakfast + a drink + late checkout   -> 1,200 (the ROOM itself still comes from the stay)
-- It is not a new kind of product. Components are existing products/services/activities
-- (or a free-text item such as "Late check-out"). Charging a package to a folio writes ONE
-- ordinary folio line PER COMPONENT, so every existing report, statement, invoice and receipt
-- keeps working; the lines just carry package_id / package_charge_id.
--
-- PRICE ALLOCATION: the package price is split across components in proportion to their normal
-- price (qty x list price). The split is rounded to cents and the LAST line takes the rounding
-- difference, so the lines always add up to EXACTLY the package price. If every component is
-- free (list price 0) the price is split equally.
--
-- STOCK: a stocked product component is issued from the default warehouse at the moment the
-- package is charged (movement_type SALE, same table the till writes). Services and free-text
-- items touch no stock. Voiding the charge returns the stock.
--
-- Needs: phase19 (folios), phase20 (rooms; void_folio_line is redefined with its guard), phase21 (service kind), phase22 (_col_accepts). Safe to re-run. No enum change.
-- Not touched: login, auth, tenant isolation, any existing table's meaning.
-- ============================================================

CREATE TABLE IF NOT EXISTS lb_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  name text NOT NULL,
  description text,
  price numeric(15,2) NOT NULL CHECK (price >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, name)
);
CREATE TABLE IF NOT EXISTS lb_package_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  package_id uuid NOT NULL REFERENCES lb_packages(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  product_id uuid REFERENCES lb_products(id),   -- NULL = free-text item
  description text NOT NULL,
  quantity numeric(15,4) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  list_price numeric(15,2) NOT NULL DEFAULT 0 CHECK (list_price >= 0),  -- normal price per unit, used only to split the package price
  category text
);
CREATE INDEX IF NOT EXISTS idx_lb_package_items_pkg ON lb_package_items(package_id);

-- folio lines remember which package sale they belong to and what stock they issued
ALTER TABLE lb_folio_lines ADD COLUMN IF NOT EXISTS package_id uuid REFERENCES lb_packages(id);
ALTER TABLE lb_folio_lines ADD COLUMN IF NOT EXISTS package_name text;
ALTER TABLE lb_folio_lines ADD COLUMN IF NOT EXISTS package_qty integer;               -- how many packages that sale was for
ALTER TABLE lb_folio_lines ADD COLUMN IF NOT EXISTS package_charge_id uuid;      -- groups the lines of ONE package sale
ALTER TABLE lb_folio_lines ADD COLUMN IF NOT EXISTS stock_product_id uuid;
ALTER TABLE lb_folio_lines ADD COLUMN IF NOT EXISTS stock_warehouse_id uuid;
ALTER TABLE lb_folio_lines ADD COLUMN IF NOT EXISTS stock_qty numeric(15,4);
ALTER TABLE lb_folio_lines ADD COLUMN IF NOT EXISTS stock_unit_cost numeric(15,4);
CREATE INDEX IF NOT EXISTS idx_lb_folio_lines_pkgcharge ON lb_folio_lines(package_charge_id) WHERE package_charge_id IS NOT NULL;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['lb_packages','lb_package_items'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_%I ON %I', t, t);
    EXECUTE format('CREATE POLICY tenant_isolation_%I ON %I FOR ALL USING (tenant_id = get_current_tenant_id()) WITH CHECK (tenant_id = get_current_tenant_id())', t, t);
  END LOOP;
END $$;
REVOKE INSERT, UPDATE, DELETE ON lb_packages, lb_package_items FROM anon, authenticated;
GRANT SELECT ON lb_packages, lb_package_items TO authenticated;

CREATE OR REPLACE VIEW lb_package_summary WITH (security_invoker = true) AS
SELECT p.id, p.tenant_id, p.business_id, p.name, p.description, p.price, p.is_active, p.created_at,
       COALESCE(i.n, 0)        AS item_count,
       COALESCE(i.list_total, 0) AS list_total,
       COALESCE(i.list_total, 0) - p.price AS guest_saving,
       COALESCE(i.cost_total, 0) AS est_cost,
       p.price - COALESCE(i.cost_total, 0) AS est_margin
FROM lb_packages p
LEFT JOIN (
  SELECT pi.package_id, count(*) AS n, sum(pi.quantity * pi.list_price) AS list_total,
         sum(pi.quantity * COALESCE(pr.cost_price, 0)) AS cost_total
  FROM lb_package_items pi LEFT JOIN lb_products pr ON pr.id = pi.product_id
  GROUP BY pi.package_id) i ON i.package_id = p.id;
GRANT SELECT ON lb_package_summary TO authenticated;

-- ---------- save a package (create or replace its components) ----------
-- p_items: [{"product_id":"..."|null,"description":"Swimming","quantity":2,"list_price":500,"category":"Activities"}]
-- When product_id is given and list_price/description are omitted they are read from the product.
CREATE OR REPLACE FUNCTION save_package(
  p_package_id uuid, p_business_id uuid, p_name text, p_description text, p_price numeric, p_items jsonb, p_created_by uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tid uuid := get_current_tenant_id(); v_id uuid; v_row jsonb; v_i integer := 0; v_pid uuid; v_desc text; v_price numeric; v_pname text; v_pprice numeric; v_qty numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM lb_businesses WHERE id = p_business_id AND tenant_id = v_tid) THEN RAISE EXCEPTION 'Business not found'; END IF;
  IF coalesce(btrim(p_name), '') = '' THEN RAISE EXCEPTION 'Give the package a name'; END IF;
  IF p_price IS NULL OR p_price < 0 THEN RAISE EXCEPTION 'The package price cannot be negative'; END IF;
  IF jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' OR jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'A package needs at least one item'; END IF;

  IF p_package_id IS NULL THEN
    INSERT INTO lb_packages (tenant_id, business_id, name, description, price, created_by)
    VALUES (v_tid, p_business_id, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), round(p_price, 2), p_created_by) RETURNING id INTO v_id;
  ELSE
    UPDATE lb_packages SET name = btrim(p_name), description = nullif(btrim(coalesce(p_description, '')), ''), price = round(p_price, 2), updated_at = now()
     WHERE id = p_package_id AND tenant_id = v_tid AND business_id = p_business_id RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Package not found'; END IF;
    DELETE FROM lb_package_items WHERE package_id = v_id;   -- sold packages keep their own folio lines; nothing points back here
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_i := v_i + 1; v_pid := NULLIF(v_row->>'product_id', '')::uuid; v_pname := NULL; v_pprice := NULL;
    IF v_pid IS NOT NULL THEN
      SELECT name, selling_price INTO v_pname, v_pprice FROM lb_products WHERE id = v_pid AND tenant_id = v_tid;
      IF NOT FOUND THEN RAISE EXCEPTION 'Item % is not one of your products', v_i; END IF;
    END IF;
    v_desc := coalesce(nullif(btrim(coalesce(v_row->>'description', '')), ''), v_pname);
    IF v_desc IS NULL THEN RAISE EXCEPTION 'Item % needs a name', v_i; END IF;
    v_qty := coalesce(nullif(v_row->>'quantity', '')::numeric, 1);
    IF v_qty <= 0 THEN RAISE EXCEPTION 'Item "%" needs a quantity above zero', v_desc; END IF;
    v_price := coalesce(nullif(v_row->>'list_price', '')::numeric, v_pprice, 0);
    IF v_price < 0 THEN RAISE EXCEPTION 'Item "%" cannot have a negative price', v_desc; END IF;
    INSERT INTO lb_package_items (tenant_id, package_id, position, product_id, description, quantity, list_price, category)
    VALUES (v_tid, v_id, v_i, v_pid, v_desc, v_qty, round(v_price, 2), nullif(btrim(coalesce(v_row->>'category', '')), ''));
  END LOOP;
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'You already have a package called "%"', btrim(p_name);
END $$;

CREATE OR REPLACE FUNCTION set_package_active(p_package_id uuid, p_active boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE lb_packages SET is_active = p_active, updated_at = now() WHERE id = p_package_id AND tenant_id = get_current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Package not found'; END IF;
END $$;

-- ---------- stock helper (one product, one direction) ----------
CREATE OR REPLACE FUNCTION _package_move_stock(
  p_tenant uuid, p_business uuid, p_warehouse uuid, p_product uuid, p_qty numeric, p_unit_cost numeric, p_ref uuid, p_note text, p_by uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_inv record; v_new numeric; v_reorder numeric; v_status text; v_mtype text;
BEGIN
  SELECT COALESCE(reorder_level, 0) INTO v_reorder FROM lb_products WHERE id = p_product;
  SELECT * INTO v_inv FROM lb_inventory WHERE product_id = p_product AND warehouse_id = p_warehouse FOR UPDATE;
  IF FOUND THEN
    v_new := v_inv.quantity + p_qty;
    v_status := CASE WHEN v_new <= 0 THEN 'OUT_OF_STOCK' WHEN v_new <= v_reorder THEN 'LOW_STOCK' ELSE 'NORMAL' END;
    EXECUTE format('UPDATE lb_inventory SET quantity = %L, last_movement_at = now(), stock_status = %L WHERE id = %L', v_new, v_status, v_inv.id);
  ELSE
    v_new := p_qty;
    v_status := CASE WHEN v_new <= 0 THEN 'OUT_OF_STOCK' WHEN v_new <= v_reorder THEN 'LOW_STOCK' ELSE 'NORMAL' END;
    EXECUTE format('INSERT INTO lb_inventory (tenant_id, business_id, warehouse_id, product_id, quantity, average_cost, last_movement_at, stock_status) VALUES (%L,%L,%L,%L,%L,%L,now(),%L)',
                   p_tenant, p_business, p_warehouse, p_product, v_new, 0, v_status);
  END IF;
  v_mtype := CASE WHEN p_qty < 0 THEN 'SALE'
                  WHEN _col_accepts('lb_stock_movements', 'movement_type', 'STOCK_RETURN') THEN 'STOCK_RETURN' ELSE 'STOCK_ADJUSTMENT' END;
  EXECUTE format('INSERT INTO lb_stock_movements (tenant_id, business_id, warehouse_id, product_id, movement_type, reference_id, quantity, unit_cost, total_cost, notes, created_by) VALUES (%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L)',
                 p_tenant, p_business, p_warehouse, p_product, v_mtype, p_ref, p_qty, p_unit_cost, abs(p_qty) * p_unit_cost, p_note, p_by);
END $$;

-- ---------- charge a package to an open folio ----------
CREATE OR REPLACE FUNCTION add_package_to_folio(
  p_folio_id uuid, p_package_id uuid, p_quantity numeric DEFAULT 1, p_client_reference text DEFAULT NULL, p_created_by uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_f lb_folios; v_p lb_packages; v_charge uuid := gen_random_uuid(); v_total numeric; v_wsum numeric := 0; v_alloc numeric := 0; v_n integer; v_i integer := 0;
  r record; v_w numeric; v_amt numeric; v_qty numeric; v_type text; v_track boolean; v_allow boolean; v_wh uuid; v_have numeric; v_cost numeric; v_line uuid; v_lines integer := 0;
BEGIN
  v_f := _folio_for_update(p_folio_id);
  IF v_f.status <> 'OPEN' THEN RAISE EXCEPTION 'This folio is % and cannot take new charges', lower(v_f.status); END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity <> trunc(p_quantity) THEN RAISE EXCEPTION 'Number of packages must be a whole number above zero'; END IF;
  SELECT * INTO v_p FROM lb_packages WHERE id = p_package_id AND tenant_id = v_f.tenant_id AND business_id = v_f.business_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Package not found'; END IF;
  IF NOT v_p.is_active THEN RAISE EXCEPTION 'The package "%" is no longer in use', v_p.name; END IF;

  IF p_client_reference IS NOT NULL THEN
    SELECT package_charge_id INTO v_line FROM lb_folio_lines WHERE client_reference = p_client_reference || ':1' AND tenant_id = v_f.tenant_id;
    IF v_line IS NOT NULL THEN
      RETURN jsonb_build_object('charge_id', v_line, 'lines', (SELECT count(*) FROM lb_folio_lines WHERE package_charge_id = v_line), 'total', (SELECT sum(amount) FROM lb_folio_lines WHERE package_charge_id = v_line), 'duplicate', true);
    END IF;
  END IF;

  SELECT count(*), COALESCE(sum(quantity * list_price), 0) INTO v_n, v_wsum FROM lb_package_items WHERE package_id = v_p.id;
  IF v_n = 0 THEN RAISE EXCEPTION 'The package "%" has no items', v_p.name; END IF;
  v_total := round(v_p.price * p_quantity, 2);
  SELECT id INTO v_wh FROM lb_warehouses WHERE tenant_id = v_f.tenant_id AND is_default LIMIT 1;

  FOR r IN SELECT pi.*, pr.track_inventory, pr.allow_negative_stock, pr.cost_price AS pr_cost, sd.kind AS sd_kind, inv.average_cost AS inv_cost
           FROM lb_package_items pi
           LEFT JOIN lb_products pr ON pr.id = pi.product_id
           LEFT JOIN lb_service_details sd ON sd.product_id = pi.product_id
           LEFT JOIN lb_inventory inv ON inv.product_id = pi.product_id AND inv.warehouse_id = v_wh
           WHERE pi.package_id = v_p.id
           ORDER BY pi.position, pi.id LOOP
    v_i := v_i + 1;
    v_w := CASE WHEN v_wsum > 0 THEN r.quantity * r.list_price / v_wsum ELSE 1.0 / v_n END;
    v_amt := CASE WHEN v_i = v_n THEN v_total - v_alloc ELSE round(v_total * v_w, 2) END;
    v_alloc := v_alloc + v_amt;
    v_qty := r.quantity * p_quantity;
    v_type := CASE WHEN r.product_id IS NULL THEN 'OTHER' WHEN r.sd_kind = 'ACTIVITY' THEN 'ACTIVITY' WHEN r.track_inventory IS FALSE THEN 'SERVICE' ELSE 'PRODUCT' END;
    v_track := r.product_id IS NOT NULL AND r.track_inventory IS NOT FALSE;
    v_cost := NULL;
    IF v_track THEN
      IF v_wh IS NULL THEN RAISE EXCEPTION 'Set a default warehouse before selling packages that contain stocked items'; END IF;
      SELECT COALESCE(quantity, 0) INTO v_have FROM lb_inventory WHERE product_id = r.product_id AND warehouse_id = v_wh;
      v_have := COALESCE(v_have, 0);
      IF v_have < v_qty AND NOT COALESCE(r.allow_negative_stock, false) THEN
        RAISE EXCEPTION 'Not enough % in stock (% needed, % available)', r.description, v_qty, v_have;
      END IF;
      v_cost := COALESCE(NULLIF(r.inv_cost, 0), r.pr_cost, 0);
    END IF;
    INSERT INTO lb_folio_lines (tenant_id, business_id, folio_id, line_type, category, description, quantity, unit_price, amount,
                                package_id, package_name, package_qty, package_charge_id, stock_product_id, stock_warehouse_id, stock_qty, stock_unit_cost, client_reference, created_by)
    VALUES (v_f.tenant_id, v_f.business_id, v_f.id, v_type, coalesce(r.category, 'Packages'), v_p.name || ' · ' || r.description, v_qty,
            CASE WHEN v_qty > 0 THEN round(v_amt / v_qty, 4) ELSE 0 END, v_amt,
            v_p.id, v_p.name, p_quantity::integer, v_charge, CASE WHEN v_track THEN r.product_id END, CASE WHEN v_track THEN v_wh END, CASE WHEN v_track THEN v_qty END, v_cost,
            CASE WHEN p_client_reference IS NOT NULL THEN p_client_reference || ':' || v_i END, p_created_by)
    RETURNING id INTO v_line;
    v_lines := v_lines + 1;
    IF v_track THEN
      PERFORM _package_move_stock(v_f.tenant_id, v_f.business_id, v_wh, r.product_id, -v_qty, v_cost, v_line, 'Package ' || v_p.name || ' · folio ' || v_f.folio_number, p_created_by);
    END IF;
  END LOOP;
  RETURN jsonb_build_object('charge_id', v_charge, 'lines', v_lines, 'total', v_total, 'duplicate', false);
END $$;

-- ---------- take a whole package sale off the bill (stock comes back) ----------
CREATE OR REPLACE FUNCTION void_package_charge(p_folio_id uuid, p_charge_id uuid, p_reason text, p_by uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_f lb_folios; r record; v_n integer := 0;
BEGIN
  v_f := _folio_for_update(p_folio_id);
  IF v_f.status <> 'OPEN' THEN RAISE EXCEPTION 'A settled folio cannot be changed'; END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  FOR r IN SELECT * FROM lb_folio_lines WHERE folio_id = v_f.id AND package_charge_id = p_charge_id AND status = 'POSTED' LOOP
    v_n := v_n + 1;
    UPDATE lb_folio_lines SET status = 'VOID', void_reason = p_reason WHERE id = r.id;
    IF r.stock_product_id IS NOT NULL THEN
      PERFORM _package_move_stock(r.tenant_id, r.business_id, r.stock_warehouse_id, r.stock_product_id, r.stock_qty, COALESCE(r.stock_unit_cost, 0), r.id, 'Package removed: ' || r.package_name || ' · ' || p_reason, p_by);
    END IF;
  END LOOP;
  IF v_n = 0 THEN RAISE EXCEPTION 'Package charge not found on this folio'; END IF;
END $$;

-- a single package line cannot be voided by hand: it would break the split
CREATE OR REPLACE FUNCTION void_folio_line(p_line_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_l lb_folio_lines; v_f lb_folios;
BEGIN
  SELECT * INTO v_l FROM lb_folio_lines WHERE id = p_line_id AND tenant_id = get_current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Line not found'; END IF;
  v_f := _folio_for_update(v_l.folio_id);
  IF v_f.status <> 'OPEN' THEN RAISE EXCEPTION 'A settled folio cannot be changed'; END IF;
  IF v_l.sale_id IS NOT NULL THEN RAISE EXCEPTION 'This charge came from a sale. Void the sale instead'; END IF;
  IF v_l.line_type = 'ROOM' AND v_l.stay_id IS NOT NULL THEN RAISE EXCEPTION 'The room charge follows the stay. Change the stay''s dates or rate instead'; END IF;
  IF v_l.package_charge_id IS NOT NULL THEN RAISE EXCEPTION 'This charge is part of a package. Remove the whole package instead'; END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  UPDATE lb_folio_lines SET status = 'VOID', void_reason = p_reason WHERE id = p_line_id;
END $$;

REVOKE ALL ON FUNCTION _package_move_stock FROM PUBLIC;
REVOKE ALL ON FUNCTION save_package, set_package_active, add_package_to_folio, void_package_charge FROM PUBLIC;
GRANT EXECUTE ON FUNCTION save_package, set_package_active, add_package_to_folio, void_package_charge TO authenticated;
