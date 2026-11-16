-- Elimu AIA (Appropriation in Aid) foundation. Apply only after the host POS core
-- migrations that define lb_businesses, get_current_tenant_id(), and pos_has_permission().
-- All amounts are KES decimals. A remittance is a transfer of already-recorded AIA
-- proceeds and is intentionally excluded from operating expense totals.

CREATE TABLE IF NOT EXISTS public.elimu_aia_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES public.lb_businesses(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 160),
  activity_type text NOT NULL CHECK (activity_type IN ('POULTRY','LIVESTOCK','DAIRY','CROP_FARMING','HORTICULTURE','FISH_FARMING','OTHER')),
  description text,
  location text,
  manager_name text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, name)
);

CREATE TABLE IF NOT EXISTS public.elimu_aia_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES public.lb_businesses(id) ON DELETE CASCADE,
  activity_id uuid NOT NULL REFERENCES public.elimu_aia_activities(id),
  transaction_type text NOT NULL CHECK (transaction_type IN ('INCOME','EXPENSE')),
  category text NOT NULL,
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 2 AND 300),
  transaction_date date NOT NULL DEFAULT current_date,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL DEFAULT 'item',
  unit_price numeric(14,2) NOT NULL CHECK (unit_price >= 0),
  total_amount numeric(14,2) GENERATED ALWAYS AS (round(quantity * unit_price, 2)) STORED,
  reference text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.elimu_aia_remittances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES public.lb_businesses(id) ON DELETE CASCADE,
  activity_id uuid NOT NULL REFERENCES public.elimu_aia_activities(id),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  remittance_date date NOT NULL DEFAULT current_date,
  payment_method text NOT NULL CHECK (payment_method IN ('BANK','MPESA','CASH','CHEQUE')),
  reference text,
  notes text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','PAID')),
  recorded_by uuid,
  decided_by uuid,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS elimu_aia_tx_business_date_idx ON public.elimu_aia_transactions (business_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS elimu_aia_tx_activity_idx ON public.elimu_aia_transactions (activity_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS elimu_aia_remit_business_date_idx ON public.elimu_aia_remittances (business_id, remittance_date DESC);

ALTER TABLE public.elimu_aia_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.elimu_aia_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.elimu_aia_remittances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS elimu_aia_activities_select ON public.elimu_aia_activities;
CREATE POLICY elimu_aia_activities_select ON public.elimu_aia_activities FOR SELECT TO authenticated
  USING (tenant_id = public.get_current_tenant_id() AND public.pos_has_permission('finance.view'));
DROP POLICY IF EXISTS elimu_aia_activities_write ON public.elimu_aia_activities;
CREATE POLICY elimu_aia_activities_write ON public.elimu_aia_activities FOR ALL TO authenticated
  USING (tenant_id = public.get_current_tenant_id() AND public.pos_has_permission('finance.view') AND EXISTS (SELECT 1 FROM public.lb_businesses b WHERE b.id = business_id AND b.tenant_id = tenant_id))
  WITH CHECK (tenant_id = public.get_current_tenant_id() AND public.pos_has_permission('finance.view') AND EXISTS (SELECT 1 FROM public.lb_businesses b WHERE b.id = business_id AND b.tenant_id = tenant_id));

DROP POLICY IF EXISTS elimu_aia_transactions_select ON public.elimu_aia_transactions;
CREATE POLICY elimu_aia_transactions_select ON public.elimu_aia_transactions FOR SELECT TO authenticated
  USING (tenant_id = public.get_current_tenant_id() AND public.pos_has_permission('finance.view'));
DROP POLICY IF EXISTS elimu_aia_transactions_insert ON public.elimu_aia_transactions;
CREATE POLICY elimu_aia_transactions_insert ON public.elimu_aia_transactions FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_current_tenant_id() AND public.pos_has_permission('finance.view') AND EXISTS (SELECT 1 FROM public.lb_businesses b WHERE b.id = business_id AND b.tenant_id = tenant_id) AND EXISTS (SELECT 1 FROM public.elimu_aia_activities a WHERE a.id = activity_id AND a.business_id = business_id AND a.tenant_id = tenant_id));

DROP POLICY IF EXISTS elimu_aia_remittances_select ON public.elimu_aia_remittances;
CREATE POLICY elimu_aia_remittances_select ON public.elimu_aia_remittances FOR SELECT TO authenticated
  USING (tenant_id = public.get_current_tenant_id() AND public.pos_has_permission('finance.view'));
DROP POLICY IF EXISTS elimu_aia_remittances_insert ON public.elimu_aia_remittances;
CREATE POLICY elimu_aia_remittances_insert ON public.elimu_aia_remittances FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_current_tenant_id() AND public.pos_has_permission('finance.view') AND EXISTS (SELECT 1 FROM public.lb_businesses b WHERE b.id = business_id AND b.tenant_id = tenant_id) AND EXISTS (SELECT 1 FROM public.elimu_aia_activities a WHERE a.id = activity_id AND a.business_id = business_id AND a.tenant_id = tenant_id));
DROP POLICY IF EXISTS elimu_aia_remittances_decide ON public.elimu_aia_remittances;
CREATE POLICY elimu_aia_remittances_decide ON public.elimu_aia_remittances FOR UPDATE TO authenticated
  USING (tenant_id = public.get_current_tenant_id() AND public.pos_has_permission('finance.approve'))
  WITH CHECK (tenant_id = public.get_current_tenant_id() AND public.pos_has_permission('finance.approve'));

GRANT SELECT, INSERT, UPDATE ON public.elimu_aia_activities TO authenticated;
GRANT SELECT, INSERT ON public.elimu_aia_transactions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.elimu_aia_remittances TO authenticated;
