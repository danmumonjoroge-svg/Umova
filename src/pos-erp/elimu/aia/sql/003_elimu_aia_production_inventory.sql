-- AIA production and inventory subledgers.
-- Apply after 001_elimu_aia.sql and 002_elimu_aia_accounting_outbox.sql.
-- These records are operational subledgers; they do not post to the general ledger.

CREATE TABLE IF NOT EXISTS public.elimu_aia_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES public.lb_businesses(id) ON DELETE CASCADE,
  activity_id uuid NOT NULL REFERENCES public.elimu_aia_activities(id),
  batch_code text NOT NULL CHECK (length(trim(batch_code)) BETWEEN 2 AND 80),
  batch_type text NOT NULL CHECK (batch_type IN ('POULTRY_FLOCK','LIVESTOCK_HERD','DAIRY_HERD','CROP_CYCLE','FISH_POND','OTHER')),
  subject text NOT NULL CHECK (length(trim(subject)) BETWEEN 2 AND 160),
  started_on date NOT NULL DEFAULT current_date,
  opening_quantity numeric(14,3) NOT NULL CHECK (opening_quantity >= 0),
  current_quantity numeric(14,3) NOT NULL DEFAULT 0 CHECK (current_quantity >= 0),
  quantity_unit text NOT NULL DEFAULT 'head' CHECK (length(trim(quantity_unit)) BETWEEN 1 AND 24),
  expected_close_on date,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','COMPLETED','CANCELLED')),
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, batch_code),
  CHECK (expected_close_on IS NULL OR expected_close_on >= started_on)
);

-- One append-only register for biological movements and production outputs.
-- QUANTITY_IN and MORTALITY affect headcount; YIELD records outputs (eggs, milk, crops, fish).
CREATE TABLE IF NOT EXISTS public.elimu_aia_production_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES public.lb_businesses(id) ON DELETE CASCADE,
  activity_id uuid NOT NULL REFERENCES public.elimu_aia_activities(id),
  batch_id uuid REFERENCES public.elimu_aia_batches(id),
  record_type text NOT NULL CHECK (record_type IN ('QUANTITY_IN','MORTALITY','YIELD','HARVEST','NOTE')),
  record_date date NOT NULL DEFAULT current_date,
  item_name text NOT NULL CHECK (length(trim(item_name)) BETWEEN 1 AND 120),
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL DEFAULT 'item' CHECK (length(trim(unit)) BETWEEN 1 AND 24),
  unit_price numeric(14,2) CHECK (unit_price IS NULL OR unit_price >= 0),
  reference text,
  notes text,
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((record_type IN ('MORTALITY','QUANTITY_IN') AND batch_id IS NOT NULL) OR record_type NOT IN ('MORTALITY','QUANTITY_IN'))
);

CREATE TABLE IF NOT EXISTS public.elimu_aia_inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES public.lb_businesses(id) ON DELETE CASCADE,
  activity_id uuid NOT NULL REFERENCES public.elimu_aia_activities(id),
  item_name text NOT NULL CHECK (length(trim(item_name)) BETWEEN 2 AND 120),
  category text NOT NULL CHECK (category IN ('FEED','VETERINARY','SEEDS','FERTILIZER','FUEL','TOOLS','PACKAGING','OTHER')),
  unit text NOT NULL DEFAULT 'kg' CHECK (length(trim(unit)) BETWEEN 1 AND 24),
  reorder_level numeric(14,3) NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  quantity_on_hand numeric(14,3) NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, activity_id, item_name),
  UNIQUE (id, business_id, tenant_id)
);

-- Stock is calculated from the movement ledger; no mutable balance can drift from its audit trail.
CREATE TABLE IF NOT EXISTS public.elimu_aia_inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES public.lb_businesses(id) ON DELETE CASCADE,
  activity_id uuid NOT NULL REFERENCES public.elimu_aia_activities(id),
  item_id uuid NOT NULL,
  movement_type text NOT NULL CHECK (movement_type IN ('RECEIPT','ISSUE','ADJUSTMENT_IN','ADJUSTMENT_OUT')),
  movement_date date NOT NULL DEFAULT current_date,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(14,2) CHECK (unit_cost IS NULL OR unit_cost >= 0),
  reference text,
  notes text,
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (item_id, business_id, tenant_id)
    REFERENCES public.elimu_aia_inventory_items(id, business_id, tenant_id),
  CHECK (movement_type NOT IN ('RECEIPT','ADJUSTMENT_IN') OR unit_cost IS NULL OR unit_cost >= 0)
);

CREATE INDEX IF NOT EXISTS elimu_aia_batches_business_idx ON public.elimu_aia_batches (business_id, started_on DESC);
CREATE INDEX IF NOT EXISTS elimu_aia_prod_business_date_idx ON public.elimu_aia_production_records (business_id, record_date DESC);
CREATE INDEX IF NOT EXISTS elimu_aia_prod_batch_idx ON public.elimu_aia_production_records (batch_id, record_date DESC);
CREATE INDEX IF NOT EXISTS elimu_aia_inventory_business_idx ON public.elimu_aia_inventory_items (business_id, activity_id);
CREATE INDEX IF NOT EXISTS elimu_aia_stock_movements_item_idx ON public.elimu_aia_inventory_movements (item_id, movement_date DESC);

ALTER TABLE public.elimu_aia_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.elimu_aia_production_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.elimu_aia_inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.elimu_aia_inventory_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS elimu_aia_batches_select ON public.elimu_aia_batches;
CREATE POLICY elimu_aia_batches_select ON public.elimu_aia_batches FOR SELECT TO authenticated
  USING (elimu_aia_batches.tenant_id = public.get_current_tenant_id() AND public.pos_has_permission('finance.view'));
DROP POLICY IF EXISTS elimu_aia_batches_insert ON public.elimu_aia_batches;
CREATE POLICY elimu_aia_batches_insert ON public.elimu_aia_batches FOR INSERT TO authenticated
  WITH CHECK (elimu_aia_batches.tenant_id = public.get_current_tenant_id() AND public.pos_has_permission('finance.view')
    AND EXISTS (SELECT 1 FROM public.lb_businesses b WHERE b.id = elimu_aia_batches.business_id AND b.tenant_id = elimu_aia_batches.tenant_id)
    AND EXISTS (SELECT 1 FROM public.elimu_aia_activities a WHERE a.id = elimu_aia_batches.activity_id AND a.business_id = elimu_aia_batches.business_id AND a.tenant_id = elimu_aia_batches.tenant_id));


DROP POLICY IF EXISTS elimu_aia_production_select ON public.elimu_aia_production_records;
CREATE POLICY elimu_aia_production_select ON public.elimu_aia_production_records FOR SELECT TO authenticated
  USING (elimu_aia_production_records.tenant_id = public.get_current_tenant_id() AND public.pos_has_permission('finance.view'));
DROP POLICY IF EXISTS elimu_aia_production_insert ON public.elimu_aia_production_records;
CREATE POLICY elimu_aia_production_insert ON public.elimu_aia_production_records FOR INSERT TO authenticated
  WITH CHECK (elimu_aia_production_records.tenant_id = public.get_current_tenant_id() AND public.pos_has_permission('finance.view')
    AND EXISTS (SELECT 1 FROM public.lb_businesses b WHERE b.id = elimu_aia_production_records.business_id AND b.tenant_id = elimu_aia_production_records.tenant_id)
    AND EXISTS (SELECT 1 FROM public.elimu_aia_activities a WHERE a.id = elimu_aia_production_records.activity_id AND a.business_id = elimu_aia_production_records.business_id AND a.tenant_id = elimu_aia_production_records.tenant_id)
    AND (elimu_aia_production_records.batch_id IS NULL OR EXISTS (SELECT 1 FROM public.elimu_aia_batches x WHERE x.id = elimu_aia_production_records.batch_id AND x.activity_id = elimu_aia_production_records.activity_id AND x.business_id = elimu_aia_production_records.business_id AND x.tenant_id = elimu_aia_production_records.tenant_id)));

DROP POLICY IF EXISTS elimu_aia_inventory_items_select ON public.elimu_aia_inventory_items;
CREATE POLICY elimu_aia_inventory_items_select ON public.elimu_aia_inventory_items FOR SELECT TO authenticated
  USING (elimu_aia_inventory_items.tenant_id = public.get_current_tenant_id() AND public.pos_has_permission('finance.view'));
DROP POLICY IF EXISTS elimu_aia_inventory_items_insert ON public.elimu_aia_inventory_items;
CREATE POLICY elimu_aia_inventory_items_insert ON public.elimu_aia_inventory_items FOR INSERT TO authenticated
  WITH CHECK (elimu_aia_inventory_items.tenant_id = public.get_current_tenant_id() AND public.pos_has_permission('finance.view')
    AND EXISTS (SELECT 1 FROM public.lb_businesses b WHERE b.id = elimu_aia_inventory_items.business_id AND b.tenant_id = elimu_aia_inventory_items.tenant_id)
    AND EXISTS (SELECT 1 FROM public.elimu_aia_activities a WHERE a.id = elimu_aia_inventory_items.activity_id AND a.business_id = elimu_aia_inventory_items.business_id AND a.tenant_id = elimu_aia_inventory_items.tenant_id));

DROP POLICY IF EXISTS elimu_aia_inventory_movements_select ON public.elimu_aia_inventory_movements;
CREATE POLICY elimu_aia_inventory_movements_select ON public.elimu_aia_inventory_movements FOR SELECT TO authenticated
  USING (elimu_aia_inventory_movements.tenant_id = public.get_current_tenant_id() AND public.pos_has_permission('finance.view'));
DROP POLICY IF EXISTS elimu_aia_inventory_movements_insert ON public.elimu_aia_inventory_movements;
CREATE POLICY elimu_aia_inventory_movements_insert ON public.elimu_aia_inventory_movements FOR INSERT TO authenticated
  WITH CHECK (elimu_aia_inventory_movements.tenant_id = public.get_current_tenant_id() AND public.pos_has_permission('finance.view')
    AND EXISTS (SELECT 1 FROM public.lb_businesses b WHERE b.id = elimu_aia_inventory_movements.business_id AND b.tenant_id = elimu_aia_inventory_movements.tenant_id)
    AND EXISTS (SELECT 1 FROM public.elimu_aia_activities a WHERE a.id = elimu_aia_inventory_movements.activity_id AND a.business_id = elimu_aia_inventory_movements.business_id AND a.tenant_id = elimu_aia_inventory_movements.tenant_id)
    AND EXISTS (SELECT 1 FROM public.elimu_aia_inventory_items i WHERE i.id = elimu_aia_inventory_movements.item_id AND i.activity_id = elimu_aia_inventory_movements.activity_id AND i.business_id = elimu_aia_inventory_movements.business_id AND i.tenant_id = elimu_aia_inventory_movements.tenant_id));

GRANT SELECT, INSERT ON public.elimu_aia_batches TO authenticated;
GRANT SELECT, INSERT ON public.elimu_aia_production_records TO authenticated;
GRANT SELECT, INSERT ON public.elimu_aia_inventory_items TO authenticated;
GRANT SELECT, INSERT ON public.elimu_aia_inventory_movements TO authenticated;

-- Stock balances are maintained atomically by the movement trigger from the append-only ledger.
CREATE OR REPLACE VIEW public.elimu_aia_inventory_balances
WITH (security_invoker = true) AS
SELECT i.id AS item_id, i.tenant_id, i.business_id, i.activity_id, i.item_name, i.category, i.unit,
       i.reorder_level, i.is_active, i.quantity_on_hand
FROM public.elimu_aia_inventory_items i;
GRANT SELECT ON public.elimu_aia_inventory_balances TO authenticated;

-- Current cohort size is maintained atomically by the production-event trigger.
CREATE OR REPLACE VIEW public.elimu_aia_batch_balances
WITH (security_invoker = true) AS
SELECT b.id AS batch_id, b.tenant_id, b.business_id, b.activity_id, b.batch_code, b.batch_type,
       b.subject, b.started_on, b.opening_quantity, b.quantity_unit, b.status, b.current_quantity
FROM public.elimu_aia_batches b;
GRANT SELECT ON public.elimu_aia_batch_balances TO authenticated;

-- Use row-locked counters so concurrent transactions cannot overstate a cohort or overspend stock.
CREATE OR REPLACE FUNCTION public.elimu_aia_set_batch_opening_quantity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  NEW.current_quantity := NEW.opening_quantity;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS elimu_aia_set_batch_opening_quantity_trg ON public.elimu_aia_batches;
CREATE TRIGGER elimu_aia_set_batch_opening_quantity_trg
BEFORE INSERT ON public.elimu_aia_batches
FOR EACH ROW EXECUTE FUNCTION public.elimu_aia_set_batch_opening_quantity();

CREATE OR REPLACE FUNCTION public.elimu_aia_guard_batch_quantity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_current numeric(14,3);
  v_delta numeric(14,3);
BEGIN
  IF NEW.record_type NOT IN ('MORTALITY','QUANTITY_IN') THEN RETURN NEW; END IF;
  SELECT current_quantity INTO v_current FROM public.elimu_aia_batches
   WHERE id = NEW.batch_id AND business_id = NEW.business_id AND tenant_id = NEW.tenant_id
     AND activity_id = NEW.activity_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AIA batch not found for this school/activity'; END IF;
  v_delta := CASE WHEN NEW.record_type = 'QUANTITY_IN' THEN NEW.quantity ELSE -NEW.quantity END;
  IF v_delta < 0 AND NEW.quantity > v_current THEN
    RAISE EXCEPTION 'Mortality quantity (%) exceeds available batch quantity (%)', NEW.quantity, v_current;
  END IF;
  UPDATE public.elimu_aia_batches SET current_quantity = v_current + v_delta
   WHERE id = NEW.batch_id AND business_id = NEW.business_id AND tenant_id = NEW.tenant_id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS elimu_aia_guard_batch_quantity_trg ON public.elimu_aia_production_records;
CREATE TRIGGER elimu_aia_guard_batch_quantity_trg
BEFORE INSERT ON public.elimu_aia_production_records
FOR EACH ROW EXECUTE FUNCTION public.elimu_aia_guard_batch_quantity();

CREATE OR REPLACE FUNCTION public.elimu_aia_guard_inventory_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_current numeric(14,3);
  v_delta numeric(14,3);
BEGIN
  SELECT quantity_on_hand INTO v_current FROM public.elimu_aia_inventory_items
   WHERE id = NEW.item_id AND business_id = NEW.business_id AND tenant_id = NEW.tenant_id
     AND activity_id = NEW.activity_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AIA inventory item not found for this school/activity'; END IF;
  v_delta := CASE WHEN NEW.movement_type IN ('RECEIPT','ADJUSTMENT_IN') THEN NEW.quantity ELSE -NEW.quantity END;
  IF v_delta < 0 AND NEW.quantity > v_current THEN
    RAISE EXCEPTION 'Issue quantity (%) exceeds stock on hand (%)', NEW.quantity, v_current;
  END IF;
  UPDATE public.elimu_aia_inventory_items SET quantity_on_hand = v_current + v_delta
   WHERE id = NEW.item_id AND business_id = NEW.business_id AND tenant_id = NEW.tenant_id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS elimu_aia_guard_inventory_stock_trg ON public.elimu_aia_inventory_movements;
CREATE TRIGGER elimu_aia_guard_inventory_stock_trg
BEFORE INSERT ON public.elimu_aia_inventory_movements
FOR EACH ROW EXECUTE FUNCTION public.elimu_aia_guard_inventory_stock();

REVOKE ALL ON FUNCTION public.elimu_aia_set_batch_opening_quantity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.elimu_aia_guard_batch_quantity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.elimu_aia_guard_inventory_stock() FROM PUBLIC, anon, authenticated;
