-- ============================================================
-- phase25 — Unified receipts (Phase 8): the data side
--
-- The guest's invoice and receipt are RENDERED from the folio (utils/folioDocument.js) and
-- read like one story: Room, Food, Drinks, Activities, each package as one block, discounts,
-- then payment. To split Food from Drinks honestly the lines need the product's real category.
-- Lines posted from the till (post_sale_to_folio) now carry the product category name.
-- Manual and package lines already carry a category. Nothing else changes; old lines keep
-- working (no category = grouped by line type, exactly as before).
--
-- Needs phase19 + phase21 (this redefines phase21's post_sale_to_folio). Safe to re-run.
-- ============================================================
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

  INSERT INTO lb_folio_lines (tenant_id, business_id, folio_id, line_type, category, description, quantity, unit_price, amount, sale_id, sale_item_id, created_by)
  SELECT v_f.tenant_id, v_f.business_id, v_f.id,
         CASE WHEN sd.kind = 'ACTIVITY' THEN 'ACTIVITY'
              WHEN p.track_inventory IS FALSE THEN 'SERVICE'
              ELSE 'PRODUCT' END,
         pc.name,
         coalesce(p.name, 'Item'), si.quantity, si.unit_price, si.total_price, v_sale.id, si.id, p_created_by
  FROM lb_sale_items si
  LEFT JOIN lb_products p ON p.id = si.product_id
  LEFT JOIN lb_product_categories pc ON pc.id = p.category_id
  LEFT JOIN lb_service_details sd ON sd.product_id = si.product_id
  WHERE si.sale_id = v_sale.id
  ON CONFLICT (sale_item_id) WHERE sale_item_id IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION post_sale_to_folio FROM PUBLIC;
GRANT EXECUTE ON FUNCTION post_sale_to_folio TO authenticated;
