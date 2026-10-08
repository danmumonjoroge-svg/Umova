-- ============================================================
-- phase24 — Efficiency report (Phase 7 of the hospitality/production upgrade)
--
-- ONE read-only function that returns real numbers for a date range. It creates no table and
-- stores nothing. A section is only present when the underlying data exists, so a retailer who
-- never used rooms or production gets an almost empty object, and the page shows nothing for them.
-- SECURITY INVOKER: the caller's row-level security applies, so one tenant can never see another's figures.
--
-- Definitions (also printed on the page):
--   days measured         = from .. least(to, today)   (the future cannot be measured)
--   room nights available = active rooms x days measured
--   room nights sold      = nights guests actually occupied in the range (checked-in and checked-out stays)
--   occupancy %           = sold / available
--   ADR                   = room revenue / room nights sold     (room revenue = nights x the stay's rate)
--   RevPAR                = room revenue / room nights available
--   guest spend           = average total of folios SETTLED in the range
--   yield %               = actual output / expected output of POSTED production runs
-- Needs phase19, phase20, phase22 (and phase23 for the packages section; absent = skipped).
-- ============================================================
CREATE OR REPLACE FUNCTION efficiency_report(p_business_id uuid, p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE
  v_today date := _local_today(); v_to date; v_days integer; v_out jsonb := '{}'::jsonb;
  v_rooms integer; v_sold numeric; v_rev numeric; v_avail numeric; v_x jsonb;
  v_has_pkg boolean := to_regclass('public.lb_packages') IS NOT NULL;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM lb_businesses WHERE id = p_business_id AND tenant_id = get_current_tenant_id()) THEN RAISE EXCEPTION 'Business not found'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN RAISE EXCEPTION 'Choose a start date that is not after the end date'; END IF;
  IF p_to - p_from > 366 THEN RAISE EXCEPTION 'Choose a range of one year or less'; END IF;
  v_to := least(p_to, v_today);
  v_days := greatest(v_to - p_from + 1, 0);
  v_out := jsonb_build_object('from', p_from, 'to', p_to, 'measured_to', v_to, 'days_measured', v_days);

  -- ---- rooms ----
  SELECT count(*) INTO v_rooms FROM lb_rooms WHERE business_id = p_business_id AND is_active;
  IF v_rooms > 0 THEN
    SELECT COALESCE(sum(GREATEST(0,
             LEAST(CASE WHEN s.status = 'CHECKED_OUT' THEN s.check_in_date + COALESCE(s.nights_charged, 1)
                        ELSE GREATEST(s.expected_check_out, v_today) END, v_to + 1)
             - GREATEST(s.check_in_date, p_from))), 0),
           COALESCE(sum(s.rate * GREATEST(0,
             LEAST(CASE WHEN s.status = 'CHECKED_OUT' THEN s.check_in_date + COALESCE(s.nights_charged, 1)
                        ELSE GREATEST(s.expected_check_out, v_today) END, v_to + 1)
             - GREATEST(s.check_in_date, p_from))), 0)
      INTO v_sold, v_rev
      FROM lb_stays s WHERE s.business_id = p_business_id AND s.status IN ('CHECKED_IN', 'CHECKED_OUT');
    v_avail := v_rooms * v_days;
    v_x := jsonb_build_object(
      'rooms', v_rooms, 'room_nights_available', v_avail, 'room_nights_sold', v_sold, 'room_revenue', round(v_rev, 2),
      'occupancy_pct', CASE WHEN v_avail > 0 THEN round(v_sold / v_avail * 100, 1) END,
      'adr', CASE WHEN v_sold > 0 THEN round(v_rev / v_sold, 2) END,
      'revpar', CASE WHEN v_avail > 0 THEN round(v_rev / v_avail, 2) END,
      'in_house_now', (SELECT count(*) FROM lb_stays WHERE business_id = p_business_id AND status = 'CHECKED_IN'),
      'avg_stay_nights', (SELECT round(avg(nights_charged), 1) FROM lb_stays WHERE business_id = p_business_id AND status = 'CHECKED_OUT'
                           AND (checked_out_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to),
      'stays_checked_out', (SELECT count(*) FROM lb_stays WHERE business_id = p_business_id AND status = 'CHECKED_OUT'
                           AND (checked_out_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to));
    v_out := v_out || jsonb_build_object('rooms', v_x);
  END IF;

  -- ---- guest folios: spend, revenue by type, open balance ----
  IF EXISTS (SELECT 1 FROM lb_folios WHERE business_id = p_business_id) THEN
    SELECT jsonb_build_object(
      'settled_count', count(*), 'avg_guest_spend', CASE WHEN count(*) > 0 THEN round(avg(total_charges), 2) END, 'settled_total', COALESCE(round(sum(total_charges), 2), 0))
      INTO v_x
      FROM lb_folio_summary WHERE business_id = p_business_id AND status = 'SETTLED' AND (settled_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to;
    v_x := v_x || jsonb_build_object(
      'open_count', (SELECT count(*) FROM lb_folios WHERE business_id = p_business_id AND status = 'OPEN'),
      'open_balance', (SELECT COALESCE(round(sum(balance_due), 2), 0) FROM lb_folio_summary WHERE business_id = p_business_id AND status = 'OPEN'),
      'by_type', COALESCE((SELECT jsonb_agg(jsonb_build_object('type', line_type, 'amount', amt) ORDER BY amt DESC)
                  FROM (SELECT line_type, round(sum(amount), 2) amt FROM lb_folio_lines
                        WHERE business_id = p_business_id AND status = 'POSTED' AND (created_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to
                        GROUP BY line_type) t), '[]'::jsonb),
      'top_activities', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', n, 'quantity', q, 'amount', a) ORDER BY a DESC)
                  FROM (SELECT regexp_replace(description, '^.* · ', '') n, sum(quantity) q, round(sum(amount), 2) a FROM lb_folio_lines
                        WHERE business_id = p_business_id AND status = 'POSTED' AND line_type = 'ACTIVITY' AND (created_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to
                        GROUP BY 1 ORDER BY 3 DESC LIMIT 5) t), '[]'::jsonb));
    v_out := v_out || jsonb_build_object('folios', v_x);
  END IF;

  -- ---- packages ----
  IF v_has_pkg THEN
    SELECT jsonb_build_object('sold', COALESCE((SELECT sum(q) FROM (SELECT max(package_qty) q FROM lb_folio_lines WHERE business_id = p_business_id AND status = 'POSTED' AND package_charge_id IS NOT NULL AND (created_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to GROUP BY package_charge_id) c), 0), 'revenue', COALESCE(round(sum(amount), 2), 0),
      'by_package', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', n, 'sold', c, 'revenue', a) ORDER BY a DESC)
                  FROM (SELECT package_name n, sum(q) c, sum(a) a FROM (SELECT package_name, package_charge_id, max(package_qty) q, round(sum(amount), 2) a FROM lb_folio_lines
                        WHERE business_id = p_business_id AND status = 'POSTED' AND package_charge_id IS NOT NULL AND (created_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to
                        GROUP BY package_name, package_charge_id) x GROUP BY package_name ORDER BY 3 DESC LIMIT 5) t), '[]'::jsonb))
      INTO v_x
      FROM lb_folio_lines WHERE business_id = p_business_id AND status = 'POSTED' AND package_charge_id IS NOT NULL AND (created_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN p_from AND p_to;
    IF (v_x->>'sold')::int > 0 THEN v_out := v_out || jsonb_build_object('packages', v_x); END IF;
  END IF;

  -- ---- production ----
  IF EXISTS (SELECT 1 FROM lb_production_runs WHERE business_id = p_business_id AND status = 'POSTED' AND run_date BETWEEN p_from AND p_to) THEN
    SELECT jsonb_build_object('runs', count(*), 'expected', round(sum(expected_output), 2), 'actual', round(sum(actual_output), 2),
             'yield_pct', CASE WHEN sum(expected_output) > 0 THEN round(sum(actual_output) / sum(expected_output) * 100, 1) END,
             'wastage_qty', round(sum(COALESCE(wastage_qty, 0)), 2), 'wastage_cost', round(sum(COALESCE(wastage_cost, 0)), 2), 'input_cost', round(sum(COALESCE(input_cost, 0)), 2))
      INTO v_x FROM lb_production_runs WHERE business_id = p_business_id AND status = 'POSTED' AND run_date BETWEEN p_from AND p_to;
    v_x := v_x || jsonb_build_object(
      'by_recipe', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', n, 'runs', c, 'expected', e, 'actual', a, 'yield_pct', y, 'wastage_cost', w) ORDER BY w DESC)
                  FROM (SELECT rc.name n, count(*) c, round(sum(r.expected_output), 2) e, round(sum(r.actual_output), 2) a,
                               CASE WHEN sum(r.expected_output) > 0 THEN round(sum(r.actual_output) / sum(r.expected_output) * 100, 1) END y, round(sum(COALESCE(r.wastage_cost, 0)), 2) w
                        FROM lb_production_runs r JOIN lb_production_recipes rc ON rc.id = r.recipe_id
                        WHERE r.business_id = p_business_id AND r.status = 'POSTED' AND r.run_date BETWEEN p_from AND p_to GROUP BY rc.name) t), '[]'::jsonb),
      'wastage_by_reason', COALESCE((SELECT jsonb_agg(jsonb_build_object('reason', reason, 'cost', w, 'qty', q) ORDER BY w DESC)
                  FROM (SELECT COALESCE(wastage_reason, 'No reason given') reason, round(sum(COALESCE(wastage_cost, 0)), 2) w, round(sum(COALESCE(wastage_qty, 0)), 2) q
                        FROM lb_production_runs WHERE business_id = p_business_id AND status = 'POSTED' AND run_date BETWEEN p_from AND p_to AND COALESCE(wastage_qty, 0) > 0
                        GROUP BY 1) t), '[]'::jsonb));
    v_out := v_out || jsonb_build_object('production', v_x);
  END IF;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION efficiency_report FROM PUBLIC;
GRANT EXECUTE ON FUNCTION efficiency_report TO authenticated;
