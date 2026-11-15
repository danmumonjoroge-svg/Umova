-- phase36_network.sql   (My Business Network, Phase 2: database + security)
-- STATUS: written for a STAGING database only. NOT run on any real database. Read "BEFORE YOU RUN" first.
--
-- WHAT IT DOES
--   Lets one business (the supplier) publish chosen products, and another business (the buyer) find them, order them, and
--   track the order, while each side keeps its own private records.
--   * 7 new tables: network_offers, network_offer_buyer_prices, network_connections, network_orders, network_order_lines,
--     network_reservations, network_order_events.
--   * NOBODY signed in through the API can read or write those tables directly (RLS on, no policies, no grants).
--     Everything goes through the functions below. Each function works out the caller's business from the signed-in session
--     (get_current_tenant_id()) -- the browser never says "I am business X" -- and returns ONLY the fields that side may see.
--   * Existing lb_* tables are only READ here (products, units, categories, inventory, warehouses). No existing table,
--     function, policy or permission is altered. No new permission keys: existing ones are reused (see PERMISSIONS).
--
-- PERMISSIONS (existing keys, checked in the database with pos_require)
--   publish / pause / price an offer ........ products.manage
--   place or cancel a purchase order ......... purchases.create
--   confirm / reject / prepare / dispatch / cancel an incoming order ... sales.create
--   accept or reject a business connection ... settings.manage   (a trust decision: owner by default)
--   see purchases / see incoming orders ...... purchases.create|inventory.receive  /  sales.view|sales.create
--
-- STOCK RULES
--   * Submitting an order never reserves stock. It is "awaiting confirmation". The server re-checks price, minimum quantity,
--     offer status and available stock at submit time, and refuses if they no longer hold.
--   * Confirming reserves stock atomically: the supplier's stock row is locked FOR UPDATE, so two confirmations for the same
--     product are served one after the other and can never reserve more than is available.
--     available = lb_inventory.quantity (default warehouse) - ACTIVE reservations.
--   * Cancelling or rejecting releases the reservations that were actually made.
--   * Dispatch records what was sent. It does NOT move stock or create a sale: that is Phase 6 (it must go through the existing
--     sale/stock workflow). Until then the reservation stays ACTIVE, so the goods are never offered twice.
--   * Receiving (buyer side stock-in / purchase order / payable) is Phase 6, NOT in this file.
--
-- MONEY RULES
--   invoice_status and payment_status live on the order, separate from the fulfilment status, and nothing here changes them.
--   Nothing here writes to any accounting table of either business.
--
-- RETRIES
--   submit / confirm / dispatch use the phase35 "already done" ledger (_pos_claim_op / _pos_finish_op): the same reference with
--   the same request returns the first result (duplicate=true); the same reference with a different request is refused (P0409).
--
-- ERROR CODES the app can rely on:  42501 not allowed / not found for you   22023 bad input
--   P0409 reference reused for another request   P0410 price changed (re-show the offer)   P0411 offer no longer orderable
--   P0412 not enough stock   P0413 order is not in a state that allows this
--
-- BEFORE YOU RUN (staging only)
--   1. Run schema/diagnostics/network_precheck.sql and send me the results (it is read-only).
--   2. phase28_permissions.sql and phase35_offline_idempotency.sql must already be on that database. This file stops if not.
--   3. Run this file once. Safe to run twice (IF NOT EXISTS / CREATE OR REPLACE).
-- ROLLBACK
--   DROP FUNCTION network_* and _net_* (see the list at the bottom);  DROP TABLE network_order_events, network_reservations,
--   network_order_lines, network_orders, network_connections, network_offer_buyer_prices, network_offers;
--   DROP SEQUENCE network_order_seq;   (existing data is untouched; only network data is lost)

DO $$ BEGIN
  IF to_regprocedure('pos_require(text[])') IS NULL OR to_regprocedure('_pos_claim_op(text,text,text)') IS NULL
     OR to_regprocedure('_pos_finish_op(text,jsonb)') IS NULL OR to_regprocedure('get_current_tenant_id()') IS NULL THEN
    RAISE EXCEPTION 'phase36 needs phase28_permissions.sql and phase35_offline_idempotency.sql first (pos_require / _pos_claim_op / _pos_finish_op not found).';
  END IF;
END $$;

-- ============================================================ tables ============================================================

CREATE TABLE IF NOT EXISTS network_offers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,                                   -- the supplier
  product_id       uuid NOT NULL REFERENCES lb_products(id),        -- the supplier's own product (never deleted, only deactivated)
  status           text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED','REMOVED')),
  price_mode       text NOT NULL DEFAULT 'REQUEST' CHECK (price_mode IN ('SHOW','REQUEST')),
  network_price    numeric CHECK (network_price IS NULL OR network_price > 0),  -- NOT lb_products.selling_price: that stays private
  min_order_qty    numeric NOT NULL DEFAULT 1 CHECK (min_order_qty > 0),
  show_stock       boolean NOT NULL DEFAULT false,
  accept_new_buyers boolean NOT NULL DEFAULT true,
  delivery_areas   text[]  NOT NULL DEFAULT '{}',
  delivery_days    integer CHECK (delivery_days IS NULL OR delivery_days >= 0),
  delivery_fee     numeric NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  notes            text,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, product_id),
  CHECK (price_mode <> 'SHOW' OR network_price IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS network_offers_active_idx ON network_offers (status, tenant_id);

CREATE TABLE IF NOT EXISTS network_offer_buyer_prices (          -- contract price for ONE approved buyer; visible only to that buyer
  offer_id     uuid NOT NULL REFERENCES network_offers(id) ON DELETE CASCADE,
  buyer_tenant uuid NOT NULL,
  price        numeric NOT NULL CHECK (price > 0),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (offer_id, buyer_tenant)
);

CREATE TABLE IF NOT EXISTS network_connections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_tenant uuid NOT NULL,
  target_tenant    uuid NOT NULL,
  status           text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','REJECTED','ENDED')),
  message          text,
  requested_by     uuid,
  decided_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  decided_at       timestamptz,
  CHECK (requester_tenant <> target_tenant)
);
CREATE UNIQUE INDEX IF NOT EXISTS network_connections_pair_uq
  ON network_connections (LEAST(requester_tenant, target_tenant), GREATEST(requester_tenant, target_tenant));

CREATE SEQUENCE IF NOT EXISTS network_order_seq;

CREATE TABLE IF NOT EXISTS network_orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_ref         text NOT NULL UNIQUE,                          -- the shared, stable reference both businesses see
  buyer_tenant      uuid NOT NULL,
  supplier_tenant   uuid NOT NULL,
  buyer_name        text NOT NULL,                                 -- snapshots, so history survives a rename
  supplier_name     text NOT NULL,
  client_reference  text NOT NULL,
  status            text NOT NULL DEFAULT 'AWAITING_CONFIRMATION'
                    CHECK (status IN ('AWAITING_CONFIRMATION','CONFIRMED','PREPARING','DISPATCHED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED','DISPUTED')),
  invoice_status    text NOT NULL DEFAULT 'NOT_INVOICED',          -- tracked separately; this file never changes them
  payment_status    text NOT NULL DEFAULT 'UNPAID',
  delivery_method   text NOT NULL CHECK (delivery_method IN ('DELIVERY','COLLECTION')),
  delivery_address  text,
  buyer_note        text,
  supplier_note     text,
  subtotal          numeric,                                       -- NULL while any line still needs a price
  delivery_fee      numeric NOT NULL DEFAULT 0,
  total             numeric,
  price_pending     boolean NOT NULL DEFAULT false,
  cancelled_by      text CHECK (cancelled_by IN ('BUYER','SUPPLIER')),
  cancel_reason     text,
  buyer_record_id   uuid,                                          -- the BUYER's own purchase order id (set in Phase 6)
  supplier_record_id uuid,                                         -- the SUPPLIER's own sale/invoice id (set in Phase 6)
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (buyer_tenant, client_reference),
  CHECK (buyer_tenant <> supplier_tenant)
);
CREATE INDEX IF NOT EXISTS network_orders_buyer_idx    ON network_orders (buyer_tenant, created_at DESC);
CREATE INDEX IF NOT EXISTS network_orders_supplier_idx ON network_orders (supplier_tenant, created_at DESC);

CREATE TABLE IF NOT EXISTS network_order_lines (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           uuid NOT NULL REFERENCES network_orders(id) ON DELETE CASCADE,
  offer_id           uuid NOT NULL REFERENCES network_offers(id),
  supplier_product_id uuid NOT NULL,                               -- supplier-private; never returned to the buyer
  product_name       text NOT NULL,                                -- snapshots
  unit_label         text,
  unit_price         numeric CHECK (unit_price IS NULL OR unit_price >= 0),
  qty_ordered        numeric NOT NULL CHECK (qty_ordered > 0),
  qty_confirmed      numeric NOT NULL DEFAULT 0 CHECK (qty_confirmed >= 0),
  qty_dispatched     numeric NOT NULL DEFAULT 0 CHECK (qty_dispatched >= 0),
  qty_received       numeric NOT NULL DEFAULT 0 CHECK (qty_received >= 0),   -- Phase 6
  buyer_product_id   uuid,                                         -- the buyer's own product (Phase 6)
  CHECK (qty_confirmed <= qty_ordered),
  CHECK (qty_dispatched <= qty_confirmed),
  CHECK (qty_received <= qty_dispatched)
);
CREATE INDEX IF NOT EXISTS network_order_lines_order_idx ON network_order_lines (order_id);

CREATE TABLE IF NOT EXISTS network_reservations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_line_id   uuid NOT NULL REFERENCES network_order_lines(id) ON DELETE CASCADE,
  supplier_tenant uuid NOT NULL,
  product_id      uuid NOT NULL,
  warehouse_id    uuid NOT NULL,
  quantity        numeric NOT NULL CHECK (quantity > 0),
  status          text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RELEASED','CONSUMED')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  released_at     timestamptz
);
CREATE INDEX IF NOT EXISTS network_reservations_active_idx ON network_reservations (supplier_tenant, product_id) WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS network_order_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid NOT NULL REFERENCES network_orders(id) ON DELETE CASCADE,
  actor_tenant uuid NOT NULL,
  actor_staff  uuid,
  event        text NOT NULL,
  detail       jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS network_order_events_order_idx ON network_order_events (order_id, created_at);

-- Lock every table: no policies and no grants means the API can touch none of them directly.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['network_offers','network_offer_buyer_prices','network_connections','network_orders',
                           'network_order_lines','network_reservations','network_order_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC, anon, authenticated', t);
  END LOOP;
END $$;
REVOKE ALL ON SEQUENCE network_order_seq FROM PUBLIC, anon, authenticated;

-- ============================================================ internal helpers (not callable from the API) ============================================================

CREATE OR REPLACE FUNCTION _net_me() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v uuid := get_current_tenant_id();
BEGIN
  IF v IS NULL THEN RAISE EXCEPTION 'No business in this session.' USING ERRCODE = '42501'; END IF;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION _net_staff() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$ SELECT nullif(auth.jwt() ->> 'pos_staff_id', '')::uuid $$;

CREATE OR REPLACE FUNCTION _net_connected(a uuid, b uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM network_connections c WHERE c.status = 'ACCEPTED'
                 AND LEAST(c.requester_tenant, c.target_tenant) = LEAST(a, b)
                 AND GREATEST(c.requester_tenant, c.target_tenant) = GREATEST(a, b))
$$;

CREATE OR REPLACE FUNCTION _net_wh(p_tenant uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT id FROM lb_warehouses WHERE tenant_id = p_tenant AND is_default = true ORDER BY id LIMIT 1
$$;

-- Stock the supplier could still promise: on hand in the default warehouse minus what is already reserved. Never below zero in the answer.
CREATE OR REPLACE FUNCTION _net_available(p_tenant uuid, p_product uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT greatest(
    coalesce((SELECT i.quantity FROM lb_inventory i WHERE i.tenant_id = p_tenant AND i.product_id = p_product
              AND i.warehouse_id = _net_wh(p_tenant) LIMIT 1), 0)
    - coalesce((SELECT sum(r.quantity) FROM network_reservations r
                WHERE r.supplier_tenant = p_tenant AND r.product_id = p_product AND r.status = 'ACTIVE'), 0), 0)
$$;

CREATE OR REPLACE FUNCTION _net_event(p_order uuid, p_tenant uuid, p_event text, p_detail jsonb DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO network_order_events (order_id, actor_tenant, actor_staff, event, detail) VALUES (p_order, p_tenant, _net_staff(), p_event, p_detail);
  IF to_regclass('public.pos_audit_log') IS NOT NULL THEN
    INSERT INTO pos_audit_log (pos_tenant_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
    VALUES (p_tenant, 'staff', _net_staff(), 'NETWORK_' || p_event, 'network_orders', p_order, p_detail);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION _net_audit(p_tenant uuid, p_action text, p_entity_type text, p_entity uuid, p_meta jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF to_regclass('public.pos_audit_log') IS NOT NULL THEN
    INSERT INTO pos_audit_log (pos_tenant_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
    VALUES (p_tenant, 'staff', _net_staff(), p_action, p_entity_type, p_entity, p_meta);
  END IF;
END $$;

-- ============================================================ offers (supplier side) ============================================================

CREATE OR REPLACE FUNCTION network_publish_offer(
  p_product_id uuid, p_price_mode text, p_network_price numeric, p_min_order_qty numeric, p_show_stock boolean,
  p_accept_new_buyers boolean, p_delivery_areas text[], p_delivery_days integer, p_delivery_fee numeric, p_notes text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_me uuid; v_id uuid;
BEGIN
  PERFORM pos_require('products.manage');
  v_me := _net_me();
  IF p_price_mode NOT IN ('SHOW','REQUEST') THEN RAISE EXCEPTION 'Choose to show a price or to let buyers request one.' USING ERRCODE = '22023'; END IF;
  IF p_price_mode = 'SHOW' AND (p_network_price IS NULL OR p_network_price <= 0) THEN
    RAISE EXCEPTION 'Enter a price greater than zero, or choose "Request price".' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_min_order_qty, 1) <= 0 THEN RAISE EXCEPTION 'Minimum order must be more than zero.' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM lb_products WHERE id = p_product_id AND tenant_id = v_me AND is_active::text = 'active') THEN
    RAISE EXCEPTION 'Item not found in your business, or it is not active.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO network_offers (tenant_id, product_id, status, price_mode, network_price, min_order_qty, show_stock, accept_new_buyers,
                              delivery_areas, delivery_days, delivery_fee, notes, created_by)
  VALUES (v_me, p_product_id, 'ACTIVE', p_price_mode, CASE WHEN p_price_mode = 'SHOW' THEN p_network_price END, coalesce(p_min_order_qty, 1),
          coalesce(p_show_stock, false), coalesce(p_accept_new_buyers, true), coalesce(p_delivery_areas, '{}'), p_delivery_days,
          coalesce(p_delivery_fee, 0), nullif(btrim(p_notes), ''), _net_staff())
  ON CONFLICT (tenant_id, product_id) DO UPDATE SET
    status = CASE WHEN network_offers.status = 'REMOVED' THEN 'ACTIVE' ELSE network_offers.status END,   -- editing a PAUSED offer keeps it paused; republishing a REMOVED one makes it live
    price_mode = EXCLUDED.price_mode, network_price = EXCLUDED.network_price, min_order_qty = EXCLUDED.min_order_qty,
    show_stock = EXCLUDED.show_stock, accept_new_buyers = EXCLUDED.accept_new_buyers, delivery_areas = EXCLUDED.delivery_areas,
    delivery_days = EXCLUDED.delivery_days, delivery_fee = EXCLUDED.delivery_fee, notes = EXCLUDED.notes, updated_at = now()
  RETURNING id INTO v_id;
  PERFORM _net_audit(v_me, 'NETWORK_OFFER_PUBLISHED', 'network_offers', v_id,
                     jsonb_build_object('product_id', p_product_id, 'price_mode', p_price_mode, 'network_price', p_network_price));
  RETURN jsonb_build_object('ok', true, 'offer_id', v_id);
END $$;

CREATE OR REPLACE FUNCTION network_set_offer_status(p_offer_id uuid, p_status text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_me uuid;
BEGIN
  PERFORM pos_require('products.manage');
  v_me := _net_me();
  IF p_status NOT IN ('ACTIVE','PAUSED','REMOVED') THEN RAISE EXCEPTION 'Unknown offer status.' USING ERRCODE = '22023'; END IF;
  UPDATE network_offers SET status = p_status, updated_at = now() WHERE id = p_offer_id AND tenant_id = v_me;
  IF NOT FOUND THEN RAISE EXCEPTION 'Offer not found.' USING ERRCODE = '42501'; END IF;
  PERFORM _net_audit(v_me, 'NETWORK_OFFER_' || p_status, 'network_offers', p_offer_id, NULL);
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION network_my_offers() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_me uuid;
BEGIN
  PERFORM pos_require('products.manage', 'inventory.view');
  v_me := _net_me();
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'offer_id', o.id, 'product_id', o.product_id, 'product_name', p.name, 'image_url', p.image_url, 'status', o.status,
      'price_mode', o.price_mode, 'network_price', o.network_price, 'min_order_qty', o.min_order_qty, 'show_stock', o.show_stock,
      'accept_new_buyers', o.accept_new_buyers, 'delivery_areas', o.delivery_areas, 'delivery_days', o.delivery_days,
      'delivery_fee', o.delivery_fee, 'notes', o.notes, 'updated_at', o.updated_at) ORDER BY p.name)
    FROM network_offers o JOIN lb_products p ON p.id = o.product_id WHERE o.tenant_id = v_me AND o.status <> 'REMOVED'), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION network_set_buyer_price(p_offer_id uuid, p_buyer_tenant uuid, p_price numeric) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_me uuid;
BEGIN
  PERFORM pos_require('products.manage');
  v_me := _net_me();
  IF NOT EXISTS (SELECT 1 FROM network_offers WHERE id = p_offer_id AND tenant_id = v_me) THEN RAISE EXCEPTION 'Offer not found.' USING ERRCODE = '42501'; END IF;
  IF NOT _net_connected(v_me, p_buyer_tenant) THEN RAISE EXCEPTION 'Special prices are only for businesses you are connected with.' USING ERRCODE = '42501'; END IF;
  IF p_price IS NULL THEN
    DELETE FROM network_offer_buyer_prices WHERE offer_id = p_offer_id AND buyer_tenant = p_buyer_tenant;
  ELSE
    IF p_price <= 0 THEN RAISE EXCEPTION 'Price must be more than zero.' USING ERRCODE = '22023'; END IF;
    INSERT INTO network_offer_buyer_prices (offer_id, buyer_tenant, price) VALUES (p_offer_id, p_buyer_tenant, p_price)
    ON CONFLICT (offer_id, buyer_tenant) DO UPDATE SET price = EXCLUDED.price, updated_at = now();
  END IF;
  PERFORM _net_audit(v_me, 'NETWORK_BUYER_PRICE_SET', 'network_offers', p_offer_id, jsonb_build_object('buyer', p_buyer_tenant, 'price', p_price));
  RETURN jsonb_build_object('ok', true);
END $$;

-- ============================================================ find stock (buyer side) ============================================================
-- SECURITY DEFINER reads the supplier's rows, so it returns ONLY approved fields: no SKU, cost, selling price, exact stock, customers.

CREATE OR REPLACE FUNCTION network_search_offers(
  p_query text DEFAULT NULL, p_category text DEFAULT NULL, p_sort text DEFAULT 'relevance', p_limit integer DEFAULT 30, p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_me uuid; v_q text := lower(btrim(coalesce(p_query, ''))); v_lim integer := least(greatest(coalesce(p_limit, 30), 1), 100); v_res jsonb;
BEGIN
  PERFORM pos_require('purchases.create', 'inventory.view');
  v_me := _net_me();
  WITH base AS (
    SELECT o.id AS offer_id, o.tenant_id AS supplier_tenant, t.business_name AS supplier_name, p.name AS product_name, p.image_url,
           c.name AS category, u.name AS unit_name, u.code AS unit_code, o.price_mode, o.network_price, bp.price AS buyer_price,
           o.min_order_qty, o.show_stock, o.accept_new_buyers, o.delivery_areas, o.delivery_days, o.delivery_fee, o.notes,
           p.track_inventory, coalesce(p.reorder_level, 0) AS reorder_level, _net_available(o.tenant_id, p.id) AS avail,
           (SELECT max(i.last_movement_at) FROM lb_inventory i WHERE i.tenant_id = o.tenant_id AND i.product_id = p.id) AS stock_as_of,
           _net_connected(v_me, o.tenant_id) AS connected
    FROM network_offers o
    JOIN pos_tenants t ON t.id = o.tenant_id AND t.status = 'approved'
    JOIN lb_products p ON p.id = o.product_id AND p.tenant_id = o.tenant_id AND p.is_active::text = 'active'
    LEFT JOIN lb_product_categories c ON c.id = p.category_id
    LEFT JOIN lb_product_units u ON u.id = p.unit_id
    LEFT JOIN network_offer_buyer_prices bp ON bp.offer_id = o.id AND bp.buyer_tenant = v_me AND _net_connected(v_me, o.tenant_id)
    WHERE o.status = 'ACTIVE' AND o.tenant_id <> v_me
      AND (v_q = '' OR position(v_q IN lower(p.name)) > 0 OR position(v_q IN lower(t.business_name)) > 0
           OR position(v_q IN lower(coalesce(c.name, ''))) > 0 OR (p.barcode IS NOT NULL AND lower(p.barcode) = v_q))
      AND (p_category IS NULL OR p_category = '' OR c.name = p_category)
  ), shaped AS (
    SELECT b.*, CASE WHEN b.price_mode = 'SHOW' THEN coalesce(b.buyer_price, b.network_price) ELSE b.buyer_price END AS price_now
    FROM base b
  ), ranked AS (
    SELECT s.*, row_number() OVER (ORDER BY
        CASE WHEN p_sort = 'price'    THEN s.price_now END ASC NULLS LAST,
        CASE WHEN p_sort = 'delivery' THEN s.delivery_days END ASC NULLS LAST,
        CASE WHEN p_sort = 'moq'      THEN s.min_order_qty END ASC,
        s.product_name, s.supplier_name, s.offer_id) AS rn
    FROM shaped s
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'offer_id', r.offer_id, 'supplier_tenant', r.supplier_tenant, 'supplier_name', r.supplier_name, 'product_name', r.product_name,
      'image_url', r.image_url, 'category', r.category, 'unit', coalesce(r.unit_name, r.unit_code),
      'price_mode', r.price_mode, 'price', r.price_now, 'price_is_special', r.buyer_price IS NOT NULL,
      'min_order_qty', r.min_order_qty, 'delivery_days', r.delivery_days, 'delivery_fee', r.delivery_fee, 'delivery_areas', r.delivery_areas,
      'est_total_at_min', CASE WHEN r.price_now IS NULL THEN NULL ELSE r.price_now * r.min_order_qty + r.delivery_fee END,
      'stock', CASE WHEN NOT r.show_stock THEN NULL WHEN NOT r.track_inventory THEN 'AVAILABLE'
                    WHEN r.avail <= 0 THEN 'OUT' WHEN r.avail <= r.reorder_level THEN 'LOW' ELSE 'IN_STOCK' END,
      'stock_as_of', CASE WHEN r.show_stock THEN r.stock_as_of END,
      'can_order', r.accept_new_buyers OR r.connected, 'connected', r.connected, 'notes', r.notes) ORDER BY r.rn), '[]'::jsonb)
  INTO v_res FROM ranked r WHERE r.rn > greatest(coalesce(p_offset, 0), 0) AND r.rn <= greatest(coalesce(p_offset, 0), 0) + v_lim;
  RETURN v_res;
END $$;

CREATE OR REPLACE FUNCTION network_offer_categories() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_me uuid;
BEGIN
  PERFORM pos_require('purchases.create', 'inventory.view');
  v_me := _net_me();
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('name', x.name, 'count', x.n) ORDER BY x.name) FROM (
    SELECT c.name, count(*) AS n FROM network_offers o
    JOIN pos_tenants t ON t.id = o.tenant_id AND t.status = 'approved'
    JOIN lb_products p ON p.id = o.product_id AND p.is_active::text = 'active'
    JOIN lb_product_categories c ON c.id = p.category_id
    WHERE o.status = 'ACTIVE' AND o.tenant_id <> v_me GROUP BY c.name) x), '[]'::jsonb);
END $$;

-- ============================================================ connections ============================================================

CREATE OR REPLACE FUNCTION network_request_connection(p_target_tenant uuid, p_message text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_me uuid; v_row network_connections;
BEGIN
  PERFORM pos_require('purchases.create');
  v_me := _net_me();
  IF p_target_tenant = v_me THEN RAISE EXCEPTION 'You cannot connect with your own business.' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pos_tenants WHERE id = p_target_tenant AND status = 'approved') THEN RAISE EXCEPTION 'Business not found.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_row FROM network_connections
   WHERE LEAST(requester_tenant, target_tenant) = LEAST(v_me, p_target_tenant) AND GREATEST(requester_tenant, target_tenant) = GREATEST(v_me, p_target_tenant) FOR UPDATE;
  IF FOUND THEN
    IF v_row.status IN ('PENDING','ACCEPTED') THEN RETURN jsonb_build_object('ok', true, 'connection_id', v_row.id, 'status', v_row.status, 'duplicate', true); END IF;
    UPDATE network_connections SET status = 'PENDING', requester_tenant = v_me, target_tenant = p_target_tenant, message = nullif(btrim(p_message), ''),
           requested_by = _net_staff(), decided_by = NULL, decided_at = NULL WHERE id = v_row.id;
    RETURN jsonb_build_object('ok', true, 'connection_id', v_row.id, 'status', 'PENDING', 'duplicate', false);
  END IF;
  INSERT INTO network_connections (requester_tenant, target_tenant, message, requested_by) VALUES (v_me, p_target_tenant, nullif(btrim(p_message), ''), _net_staff())
  RETURNING * INTO v_row;
  PERFORM _net_audit(v_me, 'NETWORK_CONNECTION_REQUESTED', 'network_connections', v_row.id, jsonb_build_object('to', p_target_tenant));
  RETURN jsonb_build_object('ok', true, 'connection_id', v_row.id, 'status', 'PENDING', 'duplicate', false);
END $$;

CREATE OR REPLACE FUNCTION network_respond_connection(p_connection_id uuid, p_accept boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_me uuid; v_row network_connections;
BEGIN
  PERFORM pos_require('settings.manage');
  v_me := _net_me();
  SELECT * INTO v_row FROM network_connections WHERE id = p_connection_id AND target_tenant = v_me FOR UPDATE;   -- only the one asked may answer
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found.' USING ERRCODE = '42501'; END IF;
  IF v_row.status <> 'PENDING' THEN RETURN jsonb_build_object('ok', true, 'status', v_row.status, 'duplicate', true); END IF;
  UPDATE network_connections SET status = CASE WHEN p_accept THEN 'ACCEPTED' ELSE 'REJECTED' END, decided_by = _net_staff(), decided_at = now() WHERE id = v_row.id;
  PERFORM _net_audit(v_me, CASE WHEN p_accept THEN 'NETWORK_CONNECTION_ACCEPTED' ELSE 'NETWORK_CONNECTION_REJECTED' END, 'network_connections', v_row.id, NULL);
  RETURN jsonb_build_object('ok', true, 'status', CASE WHEN p_accept THEN 'ACCEPTED' ELSE 'REJECTED' END, 'duplicate', false);
END $$;

CREATE OR REPLACE FUNCTION network_my_connections() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_me uuid;
BEGIN
  PERFORM pos_require('purchases.create', 'sales.create', 'settings.manage');
  v_me := _net_me();
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
      'connection_id', c.id, 'status', c.status, 'direction', CASE WHEN c.requester_tenant = v_me THEN 'SENT' ELSE 'RECEIVED' END,
      'other_tenant', t.id, 'other_name', t.business_name, 'message', CASE WHEN c.target_tenant = v_me THEN c.message END,
      'order_count', (SELECT count(*) FROM network_orders o WHERE (o.buyer_tenant = v_me AND o.supplier_tenant = t.id) OR (o.supplier_tenant = v_me AND o.buyer_tenant = t.id)),
      'created_at', c.created_at) ORDER BY c.created_at DESC)
    FROM network_connections c JOIN pos_tenants t ON t.id = CASE WHEN c.requester_tenant = v_me THEN c.target_tenant ELSE c.requester_tenant END
    WHERE c.requester_tenant = v_me OR c.target_tenant = v_me), '[]'::jsonb);
END $$;

-- ============================================================ orders: place (buyer) ============================================================

CREATE OR REPLACE FUNCTION network_submit_order(
  p_client_reference text, p_lines jsonb, p_delivery_method text, p_delivery_address text, p_note text, p_expected_total numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_buyer uuid; v_prev jsonb; v_supplier uuid; v_n_off integer; v_n_sup integer; v_order uuid; v_ref text; v_buyer_name text; v_supplier_name text;
  r record; o network_offers; p record; v_price numeric; v_special numeric; v_avail numeric; v_fee numeric := 0; v_sub numeric := 0; v_pending boolean := false;
  v_unit text; v_connected boolean; v_total numeric;
BEGIN
  PERFORM pos_require('purchases.create');
  v_buyer := _net_me();
  IF p_delivery_method NOT IN ('DELIVERY','COLLECTION') THEN RAISE EXCEPTION 'Choose delivery or collection.' USING ERRCODE = '22023'; END IF;
  IF p_delivery_method = 'DELIVERY' AND coalesce(btrim(p_delivery_address), '') = '' THEN RAISE EXCEPTION 'Enter where the goods should be delivered.' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) = 0 OR jsonb_array_length(p_lines) > 50 THEN
    RAISE EXCEPTION 'An order needs between 1 and 50 lines.' USING ERRCODE = '22023';
  END IF;
  v_prev := _pos_claim_op('network_order', p_client_reference,
            md5(concat_ws('|', p_lines::text, p_delivery_method, coalesce(btrim(p_delivery_address), ''), coalesce(btrim(p_note), ''), coalesce(p_expected_total::text, ''))));
  IF v_prev IS NOT NULL THEN RETURN v_prev; END IF;

  -- merge duplicate offers into one line each; quantities must be positive numbers
  CREATE TEMP TABLE IF NOT EXISTS _net_in (offer_id uuid PRIMARY KEY, qty numeric NOT NULL) ON COMMIT DROP;
  DELETE FROM _net_in;
  FOR r IN SELECT (e ->> 'offer_id')::uuid AS offer_id, (e ->> 'quantity')::numeric AS qty FROM jsonb_array_elements(p_lines) e LOOP
    IF r.offer_id IS NULL OR r.qty IS NULL OR r.qty <= 0 THEN RAISE EXCEPTION 'Every line needs an offer and a quantity above zero.' USING ERRCODE = '22023'; END IF;
    INSERT INTO _net_in (offer_id, qty) VALUES (r.offer_id, r.qty) ON CONFLICT (offer_id) DO UPDATE SET qty = _net_in.qty + EXCLUDED.qty;
  END LOOP;

  SELECT count(*), count(DISTINCT o2.tenant_id), min(o2.tenant_id::text)::uuid INTO v_n_off, v_n_sup, v_supplier
    FROM _net_in i JOIN network_offers o2 ON o2.id = i.offer_id;
  IF v_n_off <> (SELECT count(*) FROM _net_in) THEN RAISE EXCEPTION 'One of the offers is no longer available.' USING ERRCODE = 'P0411'; END IF;
  IF v_n_sup <> 1 THEN RAISE EXCEPTION 'One order can only contain products from one supplier.' USING ERRCODE = '22023'; END IF;
  IF v_supplier = v_buyer THEN RAISE EXCEPTION 'You cannot order from your own business.' USING ERRCODE = '22023'; END IF;
  SELECT business_name INTO v_buyer_name FROM pos_tenants WHERE id = v_buyer AND status = 'approved';
  IF v_buyer_name IS NULL THEN RAISE EXCEPTION 'Your business is not approved to order on the network.' USING ERRCODE = '42501'; END IF;
  SELECT business_name INTO v_supplier_name FROM pos_tenants WHERE id = v_supplier AND status = 'approved';
  IF v_supplier_name IS NULL THEN RAISE EXCEPTION 'That supplier is not available.' USING ERRCODE = 'P0411'; END IF;
  v_connected := _net_connected(v_buyer, v_supplier);

  v_ref := 'NET-' || to_char(now(), 'YYMM') || '-' || lpad(nextval('network_order_seq')::text, 6, '0');
  INSERT INTO network_orders (order_ref, buyer_tenant, supplier_tenant, buyer_name, supplier_name, client_reference, delivery_method, delivery_address, buyer_note, created_by)
  VALUES (v_ref, v_buyer, v_supplier, v_buyer_name, v_supplier_name, p_client_reference, p_delivery_method, nullif(btrim(p_delivery_address), ''), nullif(btrim(p_note), ''), _net_staff())
  RETURNING id INTO v_order;

  FOR r IN SELECT i.offer_id, i.qty FROM _net_in i ORDER BY i.offer_id LOOP
    SELECT * INTO o FROM network_offers WHERE id = r.offer_id;
    SELECT lp.id, lp.name, lp.track_inventory, lp.is_active::text AS act, u.name AS uname, u.code AS ucode INTO p
      FROM lb_products lp LEFT JOIN lb_product_units u ON u.id = lp.unit_id WHERE lp.id = o.product_id AND lp.tenant_id = o.tenant_id;
    IF o.status <> 'ACTIVE' OR p.id IS NULL OR p.act <> 'active' THEN RAISE EXCEPTION '"%" is no longer on offer.', coalesce(p.name, 'An item') USING ERRCODE = 'P0411'; END IF;
    IF NOT (o.accept_new_buyers OR v_connected) THEN RAISE EXCEPTION 'This supplier only takes orders from connected businesses. Send a connection request first.' USING ERRCODE = 'P0411'; END IF;
    IF r.qty < o.min_order_qty THEN RAISE EXCEPTION 'The minimum order for "%" is %.', p.name, o.min_order_qty USING ERRCODE = '22023'; END IF;
    -- price is decided HERE, never taken from the browser
    v_special := CASE WHEN v_connected THEN (SELECT price FROM network_offer_buyer_prices WHERE offer_id = o.id AND buyer_tenant = v_buyer) END;
    v_price := CASE WHEN o.price_mode = 'SHOW' THEN coalesce(v_special, o.network_price) ELSE v_special END;   -- NULL = supplier will quote
    IF p.track_inventory THEN
      v_avail := _net_available(o.tenant_id, p.id);
      IF v_avail < r.qty THEN
        RAISE EXCEPTION '%', CASE WHEN o.show_stock THEN format('Only %s of "%s" available right now.', v_avail, p.name) ELSE format('Not enough stock of "%s" right now.', p.name) END USING ERRCODE = 'P0412';
      END IF;
    END IF;
    v_unit := coalesce(p.uname, p.ucode);
    INSERT INTO network_order_lines (order_id, offer_id, supplier_product_id, product_name, unit_label, unit_price, qty_ordered) VALUES (v_order, o.id, p.id, p.name, v_unit, v_price, r.qty);
    IF v_price IS NULL THEN v_pending := true; ELSE v_sub := v_sub + v_price * r.qty; END IF;
    v_fee := greatest(v_fee, o.delivery_fee);
  END LOOP;

  IF p_delivery_method = 'COLLECTION' THEN v_fee := 0; END IF;
  v_total := CASE WHEN v_pending THEN NULL ELSE v_sub + v_fee END;
  IF p_expected_total IS NOT NULL AND v_total IS NOT NULL AND abs(p_expected_total - v_total) > 0.005 THEN
    RAISE EXCEPTION 'The price has changed. Please check the new total.' USING ERRCODE = 'P0410', DETAIL = v_total::text;   -- rolls back the order AND the claim
  END IF;
  UPDATE network_orders SET subtotal = CASE WHEN v_pending THEN NULL ELSE v_sub END, delivery_fee = v_fee, total = v_total, price_pending = v_pending WHERE id = v_order;
  PERFORM _net_event(v_order, v_buyer, 'SUBMITTED', jsonb_build_object('order_ref', v_ref, 'lines', v_n_off, 'total', v_total));
  RETURN _pos_finish_op(p_client_reference, jsonb_build_object('order_id', v_order, 'order_ref', v_ref, 'status', 'AWAITING_CONFIRMATION', 'total', v_total, 'price_pending', v_pending));
END $$;

-- ============================================================ orders: supplier actions ============================================================

CREATE OR REPLACE FUNCTION _net_release(p_order uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  UPDATE network_reservations SET status = 'RELEASED', released_at = now()
   WHERE status = 'ACTIVE' AND order_line_id IN (SELECT id FROM network_order_lines WHERE order_id = p_order);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Load an order the caller is a party to, locked. Reveals nothing about orders of other businesses (same error as "not found").
CREATE OR REPLACE FUNCTION _net_order_for_update(p_order uuid, p_side text) RETURNS network_orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_me uuid := _net_me(); v_o network_orders;
BEGIN
  SELECT * INTO v_o FROM network_orders WHERE id = p_order
    AND ((p_side = 'SUPPLIER' AND supplier_tenant = v_me) OR (p_side = 'BUYER' AND buyer_tenant = v_me)) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found.' USING ERRCODE = '42501'; END IF;
  RETURN v_o;
END $$;

CREATE OR REPLACE FUNCTION network_confirm_order(p_order_id uuid, p_client_reference text, p_lines jsonb DEFAULT NULL, p_note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_me uuid; v_o network_orders; v_prev jsonb; l record; ov jsonb; v_q numeric; v_price numeric; v_track boolean; v_wh uuid; v_onhand numeric; v_resv numeric;
  v_any boolean := false; v_sub numeric := 0; v_pending boolean := false; v_name text;
BEGIN
  PERFORM pos_require('sales.create');
  v_me := _net_me();
  v_o := _net_order_for_update(p_order_id, 'SUPPLIER');
  v_prev := _pos_claim_op('network_confirm', p_client_reference, md5(concat_ws('|', p_order_id, coalesce(p_lines::text, ''), coalesce(btrim(p_note), ''))));
  IF v_prev IS NOT NULL THEN RETURN v_prev; END IF;
  IF v_o.status <> 'AWAITING_CONFIRMATION' THEN RAISE EXCEPTION 'This order is already %.', lower(replace(v_o.status, '_', ' ')) USING ERRCODE = 'P0413'; END IF;
  v_wh := _net_wh(v_me);

  FOR l IN SELECT * FROM network_order_lines WHERE order_id = v_o.id ORDER BY id LOOP          -- fixed lock order: no deadlocks between two confirmations
    ov := (SELECT e FROM jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) e WHERE (e ->> 'line_id')::uuid = l.id LIMIT 1);
    v_q := coalesce((ov ->> 'quantity')::numeric, l.qty_ordered);
    IF v_q < 0 OR v_q > l.qty_ordered THEN RAISE EXCEPTION 'You can confirm between 0 and the quantity ordered.' USING ERRCODE = '22023'; END IF;
    v_price := l.unit_price;
    IF ov ? 'unit_price' AND (ov ->> 'unit_price') IS NOT NULL THEN
      IF l.unit_price IS NOT NULL AND (ov ->> 'unit_price')::numeric <> l.unit_price THEN RAISE EXCEPTION 'The agreed price of "%" cannot be changed here.', l.product_name USING ERRCODE = '22023'; END IF;
      IF (ov ->> 'unit_price')::numeric < 0 THEN RAISE EXCEPTION 'Price cannot be negative.' USING ERRCODE = '22023'; END IF;
      v_price := (ov ->> 'unit_price')::numeric;
    END IF;
    IF v_q > 0 AND v_price IS NULL THEN RAISE EXCEPTION 'Enter a price for "%" before confirming.', l.product_name USING ERRCODE = '22023'; END IF;
    IF v_q > 0 THEN
      v_any := true;
      SELECT track_inventory INTO v_track FROM lb_products WHERE id = l.supplier_product_id AND tenant_id = v_me;
      IF v_track THEN
        IF v_wh IS NULL THEN RAISE EXCEPTION 'Your business has no default warehouse.' USING ERRCODE = '22023'; END IF;
        -- the lock that makes two simultaneous confirmations safe:
        SELECT quantity INTO v_onhand FROM lb_inventory WHERE tenant_id = v_me AND product_id = l.supplier_product_id AND warehouse_id = v_wh FOR UPDATE;
        SELECT coalesce(sum(quantity), 0) INTO v_resv FROM network_reservations WHERE supplier_tenant = v_me AND product_id = l.supplier_product_id AND status = 'ACTIVE';
        IF coalesce(v_onhand, 0) - v_resv < v_q THEN
          RAISE EXCEPTION 'Not enough "%" in stock to confirm % (free: %).', l.product_name, v_q, greatest(coalesce(v_onhand, 0) - v_resv, 0) USING ERRCODE = 'P0412';
        END IF;
        INSERT INTO network_reservations (order_line_id, supplier_tenant, product_id, warehouse_id, quantity) VALUES (l.id, v_me, l.supplier_product_id, v_wh, v_q);
      END IF;
    END IF;
    UPDATE network_order_lines SET qty_confirmed = v_q, unit_price = v_price WHERE id = l.id;
    IF v_q > 0 THEN v_sub := v_sub + v_q * v_price; END IF;
  END LOOP;
  IF NOT v_any THEN RAISE EXCEPTION 'Nothing to confirm. Use Reject instead.' USING ERRCODE = '22023'; END IF;

  UPDATE network_orders SET status = 'CONFIRMED', subtotal = v_sub, total = v_sub + v_o.delivery_fee, price_pending = false,
         supplier_note = coalesce(nullif(btrim(p_note), ''), supplier_note), updated_at = now() WHERE id = v_o.id;
  PERFORM _net_event(v_o.id, v_me, 'CONFIRMED', jsonb_build_object('total', v_sub + v_o.delivery_fee));
  RETURN _pos_finish_op(p_client_reference, jsonb_build_object('order_id', v_o.id, 'order_ref', v_o.order_ref, 'status', 'CONFIRMED', 'total', v_sub + v_o.delivery_fee));
END $$;

CREATE OR REPLACE FUNCTION network_reject_order(p_order_id uuid, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_me uuid; v_o network_orders;
BEGIN
  PERFORM pos_require('sales.create');
  v_me := _net_me();
  v_o := _net_order_for_update(p_order_id, 'SUPPLIER');
  IF v_o.status = 'CANCELLED' THEN RETURN jsonb_build_object('ok', true, 'status', 'CANCELLED', 'duplicate', true); END IF;
  IF v_o.status <> 'AWAITING_CONFIRMATION' THEN RAISE EXCEPTION 'Only an order waiting for your answer can be rejected. Use Cancel instead.' USING ERRCODE = 'P0413'; END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'Give the buyer a short reason.' USING ERRCODE = '22023'; END IF;
  UPDATE network_orders SET status = 'CANCELLED', cancelled_by = 'SUPPLIER', cancel_reason = btrim(p_reason), updated_at = now() WHERE id = v_o.id;
  PERFORM _net_event(v_o.id, v_me, 'REJECTED', jsonb_build_object('reason', btrim(p_reason)));
  RETURN jsonb_build_object('ok', true, 'status', 'CANCELLED', 'duplicate', false);
END $$;

CREATE OR REPLACE FUNCTION network_mark_preparing(p_order_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_me uuid; v_o network_orders;
BEGIN
  PERFORM pos_require('sales.create');
  v_me := _net_me();
  v_o := _net_order_for_update(p_order_id, 'SUPPLIER');
  IF v_o.status = 'PREPARING' THEN RETURN jsonb_build_object('ok', true, 'status', 'PREPARING', 'duplicate', true); END IF;
  IF v_o.status <> 'CONFIRMED' THEN RAISE EXCEPTION 'Only a confirmed order can be marked as preparing.' USING ERRCODE = 'P0413'; END IF;
  UPDATE network_orders SET status = 'PREPARING', updated_at = now() WHERE id = v_o.id;
  PERFORM _net_event(v_o.id, v_me, 'PREPARING');
  RETURN jsonb_build_object('ok', true, 'status', 'PREPARING', 'duplicate', false);
END $$;

-- Records what physically left. Partial dispatches add up and can never exceed what was confirmed.
-- It does NOT move stock or create a sale (Phase 6 does that through the existing workflows).
CREATE OR REPLACE FUNCTION network_dispatch_order(p_order_id uuid, p_client_reference text, p_lines jsonb DEFAULT NULL, p_note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_me uuid; v_o network_orders; v_prev jsonb; l record; ov jsonb; v_q numeric; v_any boolean := false;
BEGIN
  PERFORM pos_require('sales.create');
  v_me := _net_me();
  v_o := _net_order_for_update(p_order_id, 'SUPPLIER');
  v_prev := _pos_claim_op('network_dispatch', p_client_reference, md5(concat_ws('|', p_order_id, coalesce(p_lines::text, ''), coalesce(btrim(p_note), ''))));
  IF v_prev IS NOT NULL THEN RETURN v_prev; END IF;
  IF v_o.status NOT IN ('CONFIRMED','PREPARING','DISPATCHED') THEN RAISE EXCEPTION 'This order cannot be dispatched while it is %.', lower(replace(v_o.status, '_', ' ')) USING ERRCODE = 'P0413'; END IF;
  FOR l IN SELECT * FROM network_order_lines WHERE order_id = v_o.id ORDER BY id LOOP
    ov := (SELECT e FROM jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) e WHERE (e ->> 'line_id')::uuid = l.id LIMIT 1);
    v_q := CASE WHEN p_lines IS NULL THEN l.qty_confirmed - l.qty_dispatched ELSE coalesce((ov ->> 'quantity')::numeric, 0) END;
    IF v_q < 0 OR v_q > l.qty_confirmed - l.qty_dispatched THEN RAISE EXCEPTION 'You can only send what was confirmed and not yet sent ("%").', l.product_name USING ERRCODE = '22023'; END IF;
    IF v_q > 0 THEN v_any := true; UPDATE network_order_lines SET qty_dispatched = qty_dispatched + v_q WHERE id = l.id; END IF;
  END LOOP;
  IF NOT v_any THEN RAISE EXCEPTION 'Nothing to dispatch.' USING ERRCODE = '22023'; END IF;
  UPDATE network_orders SET status = 'DISPATCHED', updated_at = now() WHERE id = v_o.id;
  PERFORM _net_event(v_o.id, v_me, 'DISPATCHED', jsonb_build_object('note', nullif(btrim(p_note), '')));
  RETURN _pos_finish_op(p_client_reference, jsonb_build_object('order_id', v_o.id, 'order_ref', v_o.order_ref, 'status', 'DISPATCHED'));
END $$;

-- ============================================================ orders: cancel / dispute ============================================================

CREATE OR REPLACE FUNCTION network_cancel_order(p_order_id uuid, p_side text, p_reason text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_me uuid; v_o network_orders; v_rel integer;
BEGIN
  IF p_side NOT IN ('BUYER','SUPPLIER') THEN RAISE EXCEPTION 'Unknown side.' USING ERRCODE = '22023'; END IF;
  PERFORM pos_require(CASE WHEN p_side = 'BUYER' THEN 'purchases.create' ELSE 'sales.create' END);
  v_me := _net_me();
  v_o := _net_order_for_update(p_order_id, p_side);
  IF v_o.status = 'CANCELLED' THEN RETURN jsonb_build_object('ok', true, 'status', 'CANCELLED', 'released', 0, 'duplicate', true); END IF;
  IF v_o.status NOT IN ('AWAITING_CONFIRMATION','CONFIRMED','PREPARING') THEN RAISE EXCEPTION 'Goods have already been sent. Raise a problem instead of cancelling.' USING ERRCODE = 'P0413'; END IF;
  IF p_side = 'SUPPLIER' AND coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'Give the buyer a short reason.' USING ERRCODE = '22023'; END IF;
  v_rel := _net_release(v_o.id);
  UPDATE network_orders SET status = 'CANCELLED', cancelled_by = p_side, cancel_reason = nullif(btrim(p_reason), ''), updated_at = now() WHERE id = v_o.id;
  PERFORM _net_event(v_o.id, v_me, 'CANCELLED', jsonb_build_object('by', p_side, 'reason', nullif(btrim(p_reason), ''), 'reservations_released', v_rel));
  RETURN jsonb_build_object('ok', true, 'status', 'CANCELLED', 'released', v_rel, 'duplicate', false);
END $$;

CREATE OR REPLACE FUNCTION network_dispute_order(p_order_id uuid, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_me uuid; v_o network_orders;
BEGIN
  PERFORM pos_require('purchases.create');
  v_me := _net_me();
  v_o := _net_order_for_update(p_order_id, 'BUYER');
  IF v_o.status = 'DISPUTED' THEN RETURN jsonb_build_object('ok', true, 'status', 'DISPUTED', 'duplicate', true); END IF;
  IF v_o.status NOT IN ('DISPATCHED','PARTIALLY_RECEIVED') THEN RAISE EXCEPTION 'A problem can only be raised once goods have been sent.' USING ERRCODE = 'P0413'; END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'Describe the problem briefly.' USING ERRCODE = '22023'; END IF;
  UPDATE network_orders SET status = 'DISPUTED', updated_at = now() WHERE id = v_o.id;
  PERFORM _net_event(v_o.id, v_me, 'DISPUTED', jsonb_build_object('reason', btrim(p_reason)));
  RETURN jsonb_build_object('ok', true, 'status', 'DISPUTED', 'duplicate', false);
END $$;

-- ============================================================ orders: read (each side sees only its own view) ============================================================

CREATE OR REPLACE FUNCTION network_my_orders(p_side text, p_status text DEFAULT NULL, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_me uuid; v_lim integer := least(greatest(coalesce(p_limit, 50), 1), 100);
BEGIN
  IF p_side NOT IN ('PURCHASES','SALES') THEN RAISE EXCEPTION 'Unknown list.' USING ERRCODE = '22023'; END IF;
  IF p_side = 'PURCHASES' THEN PERFORM pos_require('purchases.create', 'inventory.receive'); ELSE PERFORM pos_require('sales.view', 'sales.create'); END IF;
  v_me := _net_me();
  RETURN coalesce((SELECT jsonb_agg(x.j ORDER BY x.created_at DESC) FROM (
    SELECT o.created_at, jsonb_build_object(
      'order_id', o.id, 'order_ref', o.order_ref, 'other_name', CASE WHEN p_side = 'PURCHASES' THEN o.supplier_name ELSE o.buyer_name END,
      'created_at', o.created_at, 'status', o.status, 'total', o.total, 'price_pending', o.price_pending,
      'line_count', (SELECT count(*) FROM network_order_lines l WHERE l.order_id = o.id),
      'invoice_status', o.invoice_status, 'payment_status', o.payment_status) AS j
    FROM network_orders o
    WHERE ((p_side = 'PURCHASES' AND o.buyer_tenant = v_me) OR (p_side = 'SALES' AND o.supplier_tenant = v_me))
      AND (p_status IS NULL OR o.status = p_status)
    ORDER BY o.created_at DESC LIMIT v_lim OFFSET greatest(coalesce(p_offset, 0), 0)) x), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION network_get_order(p_order_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_me uuid; v_o network_orders; v_side text; v_other uuid;
BEGIN
  PERFORM pos_require('purchases.create', 'inventory.receive', 'sales.view', 'sales.create');
  v_me := _net_me();
  SELECT * INTO v_o FROM network_orders WHERE id = p_order_id AND (buyer_tenant = v_me OR supplier_tenant = v_me);
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found.' USING ERRCODE = '42501'; END IF;
  v_side := CASE WHEN v_o.buyer_tenant = v_me THEN 'BUYER' ELSE 'SUPPLIER' END;
  v_other := CASE WHEN v_side = 'BUYER' THEN v_o.supplier_tenant ELSE v_o.buyer_tenant END;
  RETURN jsonb_build_object(
    'order_id', v_o.id, 'order_ref', v_o.order_ref, 'my_side', v_side, 'status', v_o.status,
    'other_name', CASE WHEN v_side = 'BUYER' THEN v_o.supplier_name ELSE v_o.buyer_name END,
    'other_phone', (SELECT phone FROM pos_tenants WHERE id = v_other),
    'created_at', v_o.created_at, 'updated_at', v_o.updated_at, 'delivery_method', v_o.delivery_method, 'delivery_address', v_o.delivery_address,
    'buyer_note', v_o.buyer_note, 'supplier_note', v_o.supplier_note, 'subtotal', v_o.subtotal, 'delivery_fee', v_o.delivery_fee, 'total', v_o.total,
    'price_pending', v_o.price_pending, 'invoice_status', v_o.invoice_status, 'payment_status', v_o.payment_status,
    'cancelled_by', v_o.cancelled_by, 'cancel_reason', v_o.cancel_reason,
    'my_record_id', CASE WHEN v_side = 'BUYER' THEN v_o.buyer_record_id ELSE v_o.supplier_record_id END,   -- never the other business's id
    'lines', coalesce((SELECT jsonb_agg(jsonb_build_object('line_id', l.id, 'product_name', l.product_name, 'unit', l.unit_label, 'unit_price', l.unit_price,
        'qty_ordered', l.qty_ordered, 'qty_confirmed', l.qty_confirmed, 'qty_dispatched', l.qty_dispatched, 'qty_received', l.qty_received) ORDER BY l.id)
        FROM network_order_lines l WHERE l.order_id = v_o.id), '[]'::jsonb),
    'events', coalesce((SELECT jsonb_agg(jsonb_build_object('event', e.event, 'at', e.created_at, 'by_me', e.actor_tenant = v_me,
        'detail', CASE WHEN e.event IN ('REJECTED','CANCELLED','DISPUTED') THEN e.detail - 'reservations_released' ELSE NULL END) ORDER BY e.created_at)
        FROM network_order_events e WHERE e.order_id = v_o.id), '[]'::jsonb));
END $$;

-- ============================================================ who may call what ============================================================
-- Internal helpers: nobody. Public functions: signed-in sessions only (anon never).
DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY[
    '_net_me()', '_net_staff()', '_net_connected(uuid,uuid)', '_net_wh(uuid)', '_net_available(uuid,uuid)', '_net_event(uuid,uuid,text,jsonb)',
    '_net_audit(uuid,text,text,uuid,jsonb)', '_net_release(uuid)', '_net_order_for_update(uuid,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY[
    'network_publish_offer(uuid,text,numeric,numeric,boolean,boolean,text[],integer,numeric,text)', 'network_set_offer_status(uuid,text)',
    'network_my_offers()', 'network_set_buyer_price(uuid,uuid,numeric)',
    'network_search_offers(text,text,text,integer,integer)', 'network_offer_categories()',
    'network_request_connection(uuid,text)', 'network_respond_connection(uuid,boolean)', 'network_my_connections()',
    'network_submit_order(text,jsonb,text,text,text,numeric)', 'network_confirm_order(uuid,text,jsonb,text)', 'network_reject_order(uuid,text)',
    'network_mark_preparing(uuid)', 'network_dispatch_order(uuid,text,jsonb,text)', 'network_cancel_order(uuid,text,text)',
    'network_dispute_order(uuid,text)', 'network_my_orders(text,text,integer,integer)', 'network_get_order(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;
