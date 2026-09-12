-- ============================================================
-- Phase 4 — fix perform_daily_closing()'s cash-movement totals
--
-- WHY: every other aggregate in this function (sales, payments,
-- expenses, refunds) is scoped by business_id (+ branch_id, which
-- this app never populates — no branch concept is exposed anywhere
-- in the POS UI, by design). The cash_movements subquery is the one
-- exception: it filters ONLY on `branch_id = p_branch_id`. Since
-- lb_cash_movements.branch_id is always NULL here, and this function
-- is always called with p_branch_id = NULL too (see
-- cashierService.performDailyClosing()), the comparison is
-- `NULL = NULL`, which in SQL evaluates to NULL, not TRUE — so the
-- WHERE clause never matches a single row, regardless of how many
-- real cash movements were logged. total_cash_in/total_cash_out on
-- every lb_daily_closings row have been silently zero.
--
-- lb_cash_movements already has its own business_id column (confirmed
-- against the live schema) — just never referenced by this function.
-- Filtering on it directly is both correct (matches every other
-- aggregate in this same function) and multi-tenant-safe (unlike the
-- old branch_id filter, which — if two businesses both leave
-- branch_id NULL — would never have leaked data, since it never
-- matched anything at all, but would also never have worked).
--
-- Everything else in this function is untouched — only the one
-- subquery's WHERE clause changes, from:
--   WHERE branch_id = p_branch_id AND created_at::DATE = p_closing_date
-- to:
--   WHERE business_id = p_business_id AND created_at::DATE = p_closing_date
-- ============================================================

CREATE OR REPLACE FUNCTION public.perform_daily_closing(p_business_id uuid, p_branch_id uuid, p_closing_date date, p_closed_by uuid, p_notes text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_tenant_id UUID;
    v_closing_id UUID;
    v_total_sales DECIMAL(15,4);
    v_cash DECIMAL(15,4);
    v_mobile DECIMAL(15,4);
    v_card DECIMAL(15,4);
    v_credit DECIMAL(15,4);
    v_other DECIMAL(15,4);
    v_expenses DECIMAL(15,4);
    v_refunds DECIMAL(15,4);
    v_cash_in DECIMAL(15,4);
    v_cash_out DECIMAL(15,4);
    v_stock_moves INTEGER;
BEGIN
    SELECT tenant_id INTO v_tenant_id FROM lb_businesses WHERE id = p_business_id;

    IF EXISTS (
        SELECT 1 FROM lb_daily_closings
        WHERE business_id = p_business_id AND branch_id = p_branch_id AND closing_date = p_closing_date AND status = 'CLOSED'
    ) THEN
        RAISE EXCEPTION 'Day % has already been closed for this branch', p_closing_date;
    END IF;

    SELECT COALESCE(SUM(total_amount), 0) INTO v_total_sales
    FROM lb_sales
    WHERE business_id = p_business_id AND branch_id = p_branch_id AND status IN ('COMPLETED','PARTIALLY_REFUNDED')
      AND created_at::DATE = p_closing_date;

    SELECT
        COALESCE(SUM(p.amount) FILTER (WHERE p.payment_method = 'CASH'), 0),
        COALESCE(SUM(p.amount) FILTER (WHERE p.payment_method = 'MOBILE_MONEY'), 0),
        COALESCE(SUM(p.amount) FILTER (WHERE p.payment_method = 'CARD'), 0),
        COALESCE(SUM(p.amount) FILTER (WHERE p.payment_method = 'CREDIT'), 0),
        COALESCE(SUM(p.amount) FILTER (WHERE p.payment_method NOT IN ('CASH','MOBILE_MONEY','CARD','CREDIT')), 0)
    INTO v_cash, v_mobile, v_card, v_credit, v_other
    FROM lb_payments p
    JOIN lb_sales s ON s.id = p.sale_id
    WHERE s.business_id = p_business_id AND s.branch_id = p_branch_id AND p.status = 'COMPLETED'
      AND p.created_at::DATE = p_closing_date;

    SELECT COALESCE(SUM(amount), 0) INTO v_expenses
    FROM lb_expenses
    WHERE business_id = p_business_id AND branch_id = p_branch_id AND expense_date = p_closing_date;

    SELECT COALESCE(SUM(total_amount), 0) INTO v_refunds
    FROM lb_refunds
    WHERE business_id = p_business_id AND branch_id = p_branch_id AND created_at::DATE = p_closing_date;

    -- FIXED: was `WHERE branch_id = p_branch_id` — see header comment.
    SELECT
        COALESCE(SUM(amount) FILTER (WHERE movement_type = 'CASH_IN'), 0),
        COALESCE(SUM(amount) FILTER (WHERE movement_type = 'CASH_OUT'), 0)
    INTO v_cash_in, v_cash_out
    FROM lb_cash_movements
    WHERE business_id = p_business_id AND created_at::DATE = p_closing_date;

    SELECT COUNT(*) INTO v_stock_moves
    FROM lb_stock_movements
    WHERE business_id = p_business_id AND branch_id = p_branch_id AND created_at::DATE = p_closing_date;

    INSERT INTO lb_daily_closings (
        tenant_id, business_id, branch_id, closing_date, status,
        total_sales, total_cash_payments, total_mobile_payments, total_card_payments,
        total_credit_sales, total_other_payments, total_expenses, total_refunds,
        total_cash_in, total_cash_out, stock_movement_count, notes, closed_by, closed_at
    ) VALUES (
        v_tenant_id, p_business_id, p_branch_id, p_closing_date, 'CLOSED',
        v_total_sales, v_cash, v_mobile, v_card, v_credit, v_other, v_expenses, v_refunds,
        v_cash_in, v_cash_out, v_stock_moves, p_notes, p_closed_by, now()
    )
    ON CONFLICT (tenant_id, business_id, branch_id, closing_date)
    DO UPDATE SET
        status = 'CLOSED', total_sales = EXCLUDED.total_sales, total_cash_payments = EXCLUDED.total_cash_payments,
        total_mobile_payments = EXCLUDED.total_mobile_payments, total_card_payments = EXCLUDED.total_card_payments,
        total_credit_sales = EXCLUDED.total_credit_sales, total_other_payments = EXCLUDED.total_other_payments,
        total_expenses = EXCLUDED.total_expenses, total_refunds = EXCLUDED.total_refunds,
        total_cash_in = EXCLUDED.total_cash_in, total_cash_out = EXCLUDED.total_cash_out,
        stock_movement_count = EXCLUDED.stock_movement_count, notes = EXCLUDED.notes,
        closed_by = EXCLUDED.closed_by, closed_at = now()
    RETURNING id INTO v_closing_id;

    RETURN v_closing_id;
END;
$function$;
