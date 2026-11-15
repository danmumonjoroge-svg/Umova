-- phase44_budgets.sql   -- NOT YET RUN on any database. Run on STAGING first. Re-runnable.
--
-- WHY
--   A target/budget page: for a month (or quarter, year, or any dates) the owner sets
--     * a SALES TARGET for each product class (Restaurant, Bar, Accommodation, Outdoor ...) and
--     * a SPENDING BUDGET for each expense category (Rent, Salaries, Electricity ...),
--   and the app shows, side by side: BUDGET . ACTUAL . VARIANCE (and % of budget used).
--
-- HOW THE NUMBERS ARE WORKED OUT (nothing is typed twice, nothing is stored that can go stale)
--   * Sales actual   = pos_sales_by_class() from phase42 (same rule as Total Sales in the daily closing; Nairobi days).
--   * Spending actual= lb_expenses with status PAID and expense_date inside the period, by expense category.
--   * Variance       = what is GOOD is positive: for sales  actual - budget (above target = good),
--                                                for spending budget - actual (under budget = good).
--     So a red negative number always means "behind target" or "overspent". A line with no budget set shows variance
--     against 0 and is flagged `unbudgeted` (money was earned or spent where nothing was planned).
--   * Profit line    = sales - spending, for budget and for actual, worked out by the app from the lines.
--
-- WHO: see the budget -> finance.view. Create / change it -> payments.approve or settings.manage (manager and owner by default;
--   the accountant can read it but not move the goalposts). No new permission key is needed, so the phase28 catalogue is unchanged.
--   Budget tables can only be written through pos_save_budget() (clients have no INSERT/UPDATE/DELETE).
--
-- RUN ORDER: after phase28 and phase42. ROLLBACK: DROP FUNCTION pos_save_budget(...), pos_budget_vs_actual(uuid), pos_delete_budget(uuid);
--   DROP TABLE lb_budget_lines, lb_budgets;

DO $$ BEGIN
  IF to_regprocedure('pos_require(text[])') IS NULL THEN RAISE EXCEPTION 'phase44 needs phase28_permissions.sql first.'; END IF;
  IF to_regprocedure('_pos_sales_by_class_core(uuid,date,date)') IS NULL THEN RAISE EXCEPTION 'phase44 needs phase42_product_classes.sql first.'; END IF;
END $$;

CREATE TABLE IF NOT EXISTS lb_budgets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  business_id  uuid NOT NULL REFERENCES lb_businesses(id),
  name         text NOT NULL,
  period_type  text NOT NULL DEFAULT 'MONTH' CHECK (period_type IN ('MONTH','QUARTER','YEAR','CUSTOM')),
  period_start date NOT NULL,
  period_end   date NOT NULL,
  notes        text,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lb_budget_dates CHECK (period_end >= period_start)
);
-- one budget per business per period
CREATE UNIQUE INDEX IF NOT EXISTS uq_lb_budgets_period ON lb_budgets (business_id, period_start, period_end);

CREATE TABLE IF NOT EXISTS lb_budget_lines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  business_id         uuid NOT NULL,
  budget_id           uuid NOT NULL REFERENCES lb_budgets(id) ON DELETE CASCADE,
  line_type           text NOT NULL CHECK (line_type IN ('REVENUE','EXPENSE')),
  class_id            uuid REFERENCES lb_product_classes(id) ON DELETE CASCADE,       -- REVENUE lines. NULL = sales not in any class
  expense_category_id uuid REFERENCES lb_expense_categories(id) ON DELETE CASCADE,    -- EXPENSE lines (always set)
  amount              numeric(15,2) NOT NULL CHECK (amount >= 0),
  CONSTRAINT lb_budget_line_shape CHECK (
    (line_type = 'REVENUE' AND expense_category_id IS NULL) OR (line_type = 'EXPENSE' AND expense_category_id IS NOT NULL AND class_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lb_budget_lines_target ON lb_budget_lines
  (budget_id, line_type, coalesce(class_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(expense_category_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS idx_lb_budget_lines_budget ON lb_budget_lines (budget_id);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['lb_budgets','lb_budget_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_%I ON %I', t, t);
    EXECUTE format('CREATE POLICY tenant_isolation_%I ON %I FOR SELECT USING (tenant_id = get_current_tenant_id())', t, t);
    EXECUTE format('DROP POLICY IF EXISTS finance_permission_%I ON %I', t, t);
    EXECUTE format('CREATE POLICY finance_permission_%I ON %I AS RESTRICTIVE FOR SELECT USING (NOT is_pos_session() OR pos_has_permission(''finance.view''))', t, t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON %I TO authenticated', t);
  END LOOP;
END $$;

-- ---------- save (create or replace the lines of) one budget ----------
-- p_lines: [{"line_type":"REVENUE","class_id":"<uuid or null>","amount":150000}, {"line_type":"EXPENSE","expense_category_id":"<uuid>","amount":40000}, ...]
-- The whole set is replaced in one transaction, so a budget is never half-saved. A line with amount 0 or empty is dropped.
CREATE OR REPLACE FUNCTION pos_save_budget(
  p_business_id uuid, p_period_start date, p_period_end date, p_name text, p_period_type text, p_lines jsonb, p_notes text DEFAULT NULL, p_by uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_tenant uuid := get_current_tenant_id(); v_id uuid; l jsonb; v_amt numeric; v_type text; v_class uuid; v_cat uuid;
BEGIN
  PERFORM pos_require('payments.approve', 'settings.manage');
  PERFORM _pos_own_business(p_business_id);
  IF p_period_start IS NULL OR p_period_end IS NULL OR p_period_end < p_period_start THEN RAISE EXCEPTION 'Choose a start date and an end date that is the same or later.'; END IF;
  IF p_period_end - p_period_start > 400 THEN RAISE EXCEPTION 'A budget can cover at most about a year.'; END IF;
  IF jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' THEN RAISE EXCEPTION 'The budget lines must be a list.'; END IF;

  INSERT INTO lb_budgets (tenant_id, business_id, name, period_type, period_start, period_end, notes, created_by)
  VALUES (v_tenant, p_business_id, coalesce(nullif(btrim(p_name), ''), to_char(p_period_start, 'FMMonth YYYY') || ' budget'),
          coalesce(nullif(p_period_type, ''), 'MONTH'), p_period_start, p_period_end, p_notes, p_by)
  ON CONFLICT (business_id, period_start, period_end)
  DO UPDATE SET name = EXCLUDED.name, period_type = EXCLUDED.period_type, notes = EXCLUDED.notes, updated_at = now()
  RETURNING id INTO v_id;

  DELETE FROM lb_budget_lines WHERE budget_id = v_id;
  FOR l IN SELECT * FROM jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) LOOP
    v_amt := nullif(l ->> 'amount', '')::numeric;
    CONTINUE WHEN v_amt IS NULL OR v_amt <= 0;
    v_type := upper(l ->> 'line_type');
    v_class := nullif(l ->> 'class_id', '')::uuid;
    v_cat := nullif(l ->> 'expense_category_id', '')::uuid;
    IF v_type = 'REVENUE' THEN
      IF v_class IS NOT NULL AND NOT EXISTS (SELECT 1 FROM lb_product_classes WHERE id = v_class AND business_id = p_business_id AND tenant_id = v_tenant) THEN
        RAISE EXCEPTION 'A sales target points at a class that is not in this business.';
      END IF;
      INSERT INTO lb_budget_lines (tenant_id, business_id, budget_id, line_type, class_id, amount) VALUES (v_tenant, p_business_id, v_id, 'REVENUE', v_class, v_amt);
    ELSIF v_type = 'EXPENSE' THEN
      IF v_cat IS NULL OR NOT EXISTS (SELECT 1 FROM lb_expense_categories WHERE id = v_cat AND tenant_id IN (v_tenant)) THEN
        RAISE EXCEPTION 'A spending budget points at a spending category that does not exist.';
      END IF;
      INSERT INTO lb_budget_lines (tenant_id, business_id, budget_id, line_type, expense_category_id, amount) VALUES (v_tenant, p_business_id, v_id, 'EXPENSE', v_cat, v_amt);
    ELSE
      RAISE EXCEPTION 'Unknown budget line type %.', l ->> 'line_type';
    END IF;
  END LOOP;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION pos_delete_budget(p_budget_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM pos_require('payments.approve', 'settings.manage');
  DELETE FROM lb_budgets WHERE id = p_budget_id AND tenant_id = get_current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Budget not found.'; END IF;
END $$;

-- ---------- budget vs actual ----------
-- One row per line that has a budget OR an actual. line_type is REVENUE or EXPENSE; `label` is the class or category name.
-- variance: positive = good (see header). pct_used = actual / budget * 100 (NULL when there is no budget).
CREATE OR REPLACE FUNCTION pos_budget_vs_actual(p_budget_id uuid)
RETURNS TABLE (line_type text, class_id uuid, expense_category_id uuid, label text, budget numeric, actual numeric,
               variance numeric, pct_used numeric, unbudgeted boolean, sort_key integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE b lb_budgets%ROWTYPE;
BEGIN
  PERFORM pos_require('finance.view');
  SELECT * INTO b FROM lb_budgets WHERE id = p_budget_id AND tenant_id = get_current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Budget not found.'; END IF;

  RETURN QUERY
  WITH rev_actual AS (
    SELECT s.class_id AS cid, sum(s.revenue) AS amt FROM _pos_sales_by_class_core(b.business_id, b.period_start, b.period_end) s GROUP BY s.class_id
  ), exp_actual AS (
    SELECT e.category_id AS xid, sum(e.amount) AS amt
      FROM lb_expenses e
     WHERE e.tenant_id = b.tenant_id AND e.business_id = b.business_id AND e.status = 'PAID'
       AND e.expense_date BETWEEN b.period_start AND b.period_end
     GROUP BY e.category_id
  ), rev_budget AS (
    SELECT l.class_id AS cid, sum(l.amount) AS amt FROM lb_budget_lines l WHERE l.budget_id = b.id AND l.line_type = 'REVENUE' GROUP BY l.class_id
  ), exp_budget AS (
    SELECT l.expense_category_id AS xid, sum(l.amount) AS amt FROM lb_budget_lines l WHERE l.budget_id = b.id AND l.line_type = 'EXPENSE' GROUP BY l.expense_category_id
  ), rev AS (
    SELECT 'REVENUE'::text AS lt, coalesce(rb.cid, ra.cid) AS cid, NULL::uuid AS xid,
           coalesce(rb.amt, 0) AS bud, coalesce(ra.amt, 0) AS act
      FROM rev_budget rb FULL OUTER JOIN rev_actual ra ON coalesce(ra.cid, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(rb.cid, '00000000-0000-0000-0000-000000000000'::uuid)
  ), exp AS (
    SELECT 'EXPENSE'::text, NULL::uuid, coalesce(eb.xid, ea.xid), coalesce(eb.amt, 0), coalesce(ea.amt, 0)
      FROM exp_budget eb FULL OUTER JOIN exp_actual ea ON coalesce(ea.xid, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(eb.xid, '00000000-0000-0000-0000-000000000000'::uuid)
  ), allr AS (
    SELECT * FROM rev UNION ALL SELECT * FROM exp
  )
  SELECT a.lt, a.cid, a.xid,
         CASE WHEN a.lt = 'REVENUE' THEN coalesce(k.name, 'Sales not in a class') ELSE coalesce(x.name, 'No category') END,
         round(a.bud, 2), round(a.act, 2),
         round(CASE WHEN a.lt = 'REVENUE' THEN a.act - a.bud ELSE a.bud - a.act END, 2),
         CASE WHEN a.bud > 0 THEN round(a.act / a.bud * 100, 1) END,
         (a.bud = 0 AND a.act <> 0),
         CASE WHEN a.lt = 'REVENUE' THEN 0 ELSE 1 END
    FROM allr a
    LEFT JOIN lb_product_classes k ON k.id = a.cid AND k.tenant_id = b.tenant_id
    LEFT JOIN lb_expense_categories x ON x.id = a.xid
   WHERE a.bud <> 0 OR a.act <> 0
   ORDER BY 10, (a.cid IS NULL AND a.xid IS NULL), 4;
END $$;

REVOKE ALL ON FUNCTION pos_save_budget(uuid, date, date, text, text, jsonb, text, uuid), pos_delete_budget(uuid), pos_budget_vs_actual(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION pos_save_budget(uuid, date, date, text, text, jsonb, text, uuid), pos_delete_budget(uuid), pos_budget_vs_actual(uuid) TO authenticated;
