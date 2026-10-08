-- ============================================================
-- phase21 — Services & Activities (Phase 4 of the hospitality/production upgrade)
--
-- A service or activity (haircut, massage, swimming, football, gym, conference
-- room...) is ALREADY a lb_products row with track_inventory = false plus a 1:1
-- lb_service_details row (phase6). The till already sells it and never touches
-- stock. This phase adds only what was missing:
--   * lb_service_details.kind  'SERVICE' | 'ACTIVITY'  (so a guest's bill can say
--     "Activities" instead of lumping swimming in with haircuts)
--   * post_sale_to_folio now types a charged line from that kind.
-- No new catalog, no new table, no new sale path: a guest buying swimming is an
-- ordinary POS sale charged to the folio (phase19), revenue counted once via lb_sales.
--
-- NOT RUN against a live database. Needs phase6 and phase19. Safe to re-run.
-- ============================================================

ALTER TABLE lb_service_details ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'SERVICE';
DO $$ BEGIN
  ALTER TABLE lb_service_details ADD CONSTRAINT lb_service_details_kind_chk CHECK (kind IN ('SERVICE','ACTIVITY'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Same function as phase19, with one change: the line type of a non-stock item
-- comes from lb_service_details.kind (ACTIVITY or SERVICE); stocked goods stay PRODUCT.
CREATE OR REPLACE FUNCTION post_sale_to_folio(p_folio_id uuid, p_sale_id uuid, p_created_by uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_f lb_folios; v_sale lb_sales; v_n integer;
BEGIN
  v_f := _folio_for_update(p_folio_id);
  IF v_f.status <> 'OPEN' THEN RAISE EXCEPTION 'This folio is % and cannot take new charges', lower(v_f.status); END IF;
  SELECT * INTO v_sale FROM lb_sales WHERE id = p_sale_id AND tenant_id = v_f.tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale not found'; END IF;
  IF v_sale.customer_id IS DISTINCT FROM v_f.customer_id THEN RAISE EXCEPTION 'The sale belongs to a different customer than this folio'; END IF;
  IF v_sale.folio_id IS DISTINCT FROM v_f.id THEN RAISE EXCEPTION 'The sale was not marked for this folio'; END IF;

  INSERT INTO lb_folio_lines (tenant_id, business_id, folio_id, line_type, description, quantity, unit_price, amount, sale_id, sale_item_id, created_by)
  SELECT v_f.tenant_id, v_f.business_id, v_f.id,
         CASE WHEN sd.kind = 'ACTIVITY' THEN 'ACTIVITY'
              WHEN p.track_inventory IS FALSE THEN 'SERVICE'
              ELSE 'PRODUCT' END,
         coalesce(p.name, 'Item'), si.quantity, si.unit_price, si.total_price, v_sale.id, si.id, p_created_by
  FROM lb_sale_items si
  LEFT JOIN lb_products p ON p.id = si.product_id
  LEFT JOIN lb_service_details sd ON sd.product_id = si.product_id
  WHERE si.sale_id = v_sale.id
  ON CONFLICT (sale_item_id) WHERE sale_item_id IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION post_sale_to_folio FROM PUBLIC;
GRANT EXECUTE ON FUNCTION post_sale_to_folio TO authenticated;
