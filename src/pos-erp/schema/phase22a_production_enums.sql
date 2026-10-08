-- ============================================================
-- phase22a — OPTIONAL: give stock movements their own Production labels.
-- Run this BEFORE phase22_production.sql and let it commit first (an enum value
-- cannot be used in the transaction that adds it).
--
-- If lb_stock_movements.movement_type / reference_type are plain text, or if you
-- skip this file, nothing breaks: phase22 detects what the live columns accept and
-- falls back to the labels the till and goods receiving already use
-- (STOCK_ISSUE for materials used, STOCK_ADJUSTMENT for finished goods made),
-- with reference_type 'PRODUCTION_RUN' / the run id kept for the audit trail.
-- No-op on text columns. Safe to re-run.
-- ============================================================
DO $$
DECLARE r record; v text;
BEGIN
  FOR r IN SELECT c.column_name, c.udt_name FROM information_schema.columns c
           WHERE c.table_schema = 'public' AND c.table_name = 'lb_stock_movements'
             AND c.column_name IN ('movement_type', 'reference_type') AND c.data_type = 'USER-DEFINED'
  LOOP
    FOREACH v IN ARRAY (CASE WHEN r.column_name = 'movement_type' THEN ARRAY['PRODUCTION_CONSUMPTION','PRODUCTION_OUTPUT'] ELSE ARRAY['PRODUCTION_RUN'] END)
    LOOP
      EXECUTE format('ALTER TYPE %I ADD VALUE IF NOT EXISTS %L', r.udt_name, v);
    END LOOP;
  END LOOP;
END $$;
