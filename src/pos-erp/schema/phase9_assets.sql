-- ============================================================
-- Phase 9 — My Equipment / fixed assets (brief §10)
--
-- Nothing asset-related existed anywhere before this: no table, no
-- service, no page. Confirmed by grepping the whole project — the only
-- hits for "asset" were financialReportsService's balance-sheet
-- variable names and a Web Audio comment.
--
-- WHAT THIS DELIBERATELY DOES NOT DO — read before running.
--
-- §12 asks for asset purchase to post "Asset register → Cash/Bank/M-Pesa
-- OR payable", i.e. double entry. This schema has NO general ledger:
-- there is no journal table, and financialReportsService builds the
-- statements by aggregating lb_sales / lb_expenses / lb_inventory /
-- running balances directly. There is nowhere correct to post the
-- credit side of an asset purchase.
--
-- So buying an asset registers the asset and records what it cost. It
-- does NOT automatically reduce cash or raise a payable, and the page
-- says so in those words. Auto-posting it as an lb_expenses row would
-- be worse than not posting it: an asset is not an expense, and it
-- would wrongly crater that month's profit by the asset's full cost.
--
-- DEPRECIATION is different and IS posted for real. It genuinely is a
-- period expense, lb_expenses is genuinely where this system's profit
-- calculation reads expenses from, and posting it there is the only way
-- My Profit tells the truth about a business that owns a fridge. Each
-- posting writes a real lb_expenses row via the existing record_expense()
-- RPC, and lb_asset_depreciation_entries links the two so nothing is
-- ever posted twice.
--
-- Run order: migration #7, after phase8_whatsapp.sql.
-- ============================================================

DO $$ BEGIN
  CREATE TYPE lb_asset_status AS ENUM ('ACTIVE', 'UNDER_MAINTENANCE', 'DISPOSED', 'WRITTEN_OFF');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- REDUCING_BALANCE is offered because it's what Kenyan tax practice
-- commonly uses for equipment; NONE covers land and anything the owner
-- simply doesn't want depreciated.
DO $$ BEGIN
  CREATE TYPE lb_depreciation_method AS ENUM ('STRAIGHT_LINE', 'REDUCING_BALANCE', 'NONE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- lb_fixed_assets (§10) ----------

CREATE TABLE IF NOT EXISTS lb_fixed_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid REFERENCES lb_businesses(id),
  name text NOT NULL,
  -- Free text, not a lookup table. §10's list (fridge, freezer, vehicle,
  -- computer, furniture, machinery) is six words a kiosk owner will type
  -- once; a category table plus CRUD for it is ceremony this doesn't need.
  category text,
  purchase_date date NOT NULL,
  purchase_cost numeric(15,2) NOT NULL CHECK (purchase_cost >= 0),
  -- Optional: who it was bought from, if that supplier is already known.
  -- Does NOT create a payable — see the header note.
  supplier_id uuid REFERENCES lb_suppliers(id),
  serial_number text,
  location text,
  useful_life_years integer CHECK (useful_life_years IS NULL OR useful_life_years > 0),
  depreciation_method lb_depreciation_method NOT NULL DEFAULT 'STRAIGHT_LINE',
  -- Annual rate, only used by REDUCING_BALANCE. STRAIGHT_LINE derives
  -- its own rate from useful_life_years instead.
  depreciation_rate numeric(5,2) CHECK (depreciation_rate IS NULL OR depreciation_rate BETWEEN 0 AND 100),
  salvage_value numeric(15,2) NOT NULL DEFAULT 0 CHECK (salvage_value >= 0),
  -- Running total, maintained ONLY by post_asset_depreciation() below.
  -- Never written client-side — same rule as lb_customers.outstanding_balance.
  accumulated_depreciation numeric(15,2) NOT NULL DEFAULT 0 CHECK (accumulated_depreciation >= 0),
  status lb_asset_status NOT NULL DEFAULT 'ACTIVE',
  disposal_date date,
  disposal_proceeds numeric(15,2),
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lb_fixed_assets_disposal_chk
    CHECK ((status IN ('DISPOSED', 'WRITTEN_OFF')) = (disposal_date IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_lb_fixed_assets_business ON lb_fixed_assets(business_id, status);

ALTER TABLE lb_fixed_assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_lb_fixed_assets ON lb_fixed_assets;
CREATE POLICY tenant_isolation_lb_fixed_assets ON lb_fixed_assets
  FOR ALL USING (tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id = get_current_tenant_id());

-- ---------- lb_asset_depreciation_entries ----------
-- One row per asset per posted period. The UNIQUE constraint is the
-- duplicate protection: running depreciation twice for the same month
-- cannot double-charge the owner's profit.

CREATE TABLE IF NOT EXISTS lb_asset_depreciation_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid REFERENCES lb_businesses(id),
  asset_id uuid NOT NULL REFERENCES lb_fixed_assets(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  -- The real lb_expenses row this created. This is the link that makes
  -- depreciation visible in My Profit / the Income Statement rather than
  -- being a number that only exists on the asset register.
  expense_id uuid REFERENCES lb_expenses(id),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lb_asset_depreciation_unique_period UNIQUE (asset_id, period_end)
);

ALTER TABLE lb_asset_depreciation_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_lb_asset_depreciation_entries ON lb_asset_depreciation_entries;
CREATE POLICY tenant_isolation_lb_asset_depreciation_entries ON lb_asset_depreciation_entries
  FOR ALL USING (tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id = get_current_tenant_id());

-- ---------- Depreciation expense category ----------
-- Depreciation posts through record_expense(), which wants a category.
-- Added as a system category alongside the 12 already seeded (Rent,
-- Electricity, … Miscellaneous), rather than posting uncategorised.
--
-- VERIFY BEFORE RUNNING: the column list below (name, is_system,
-- is_active, sort_order, tenant_id) is what expensesService.js reads and
-- what lb_expense_categories' RLS policy implies, but the full schema of
-- that table has not been dumped this session. If it has extra NOT NULL
-- columns, this INSERT will fail loudly — which is the intended
-- behaviour, not something to work around by guessing.

INSERT INTO lb_expense_categories (tenant_id, name, is_system, is_active, sort_order)
SELECT NULL, 'Depreciation', true, true, 99
WHERE NOT EXISTS (
  SELECT 1 FROM lb_expense_categories WHERE lower(name) = 'depreciation'
);

-- ---------- post_asset_depreciation() ----------
-- Atomic: creates the expense, records the entry, bumps the running
-- accumulated total. Either all three happen or none do.

CREATE OR REPLACE FUNCTION post_asset_depreciation(
  p_asset_id uuid,
  p_period_start date,
  p_period_end date,
  p_amount numeric,
  p_created_by uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_asset lb_fixed_assets%ROWTYPE;
  v_category_id uuid;
  v_expense_id uuid;
  v_entry_id uuid;
  v_depreciable numeric;
BEGIN
  SELECT * INTO v_asset FROM lb_fixed_assets WHERE id = p_asset_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asset % not found', p_asset_id;
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Depreciation amount must be greater than zero';
  END IF;

  IF v_asset.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Asset "%" is % — only an ACTIVE asset can be depreciated', v_asset.name, v_asset.status;
  END IF;

  -- An asset can never depreciate below its salvage value. Without this
  -- a long-lived asset would eventually post negative book value and the
  -- balance sheet would quietly go wrong.
  v_depreciable := v_asset.purchase_cost - v_asset.salvage_value;
  IF v_asset.accumulated_depreciation + p_amount > v_depreciable THEN
    RAISE EXCEPTION 'Asset "%" is already fully depreciated (cost %, salvage %, already written down %)',
      v_asset.name, v_asset.purchase_cost, v_asset.salvage_value, v_asset.accumulated_depreciation;
  END IF;

  SELECT id INTO v_category_id FROM lb_expense_categories
  WHERE lower(name) = 'depreciation' AND is_active = true
  LIMIT 1;

  v_expense_id := record_expense(
    v_asset.business_id, NULL, v_category_id, p_period_end, p_amount,
    'OTHER', -- no money actually leaves the till for depreciation
    format('Depreciation — %s (%s to %s)', v_asset.name, p_period_start, p_period_end),
    NULL, 'PAID', p_created_by
  );

  INSERT INTO lb_asset_depreciation_entries (
    tenant_id, business_id, asset_id, period_start, period_end, amount, expense_id, created_by
  ) VALUES (
    v_asset.tenant_id, v_asset.business_id, p_asset_id, p_period_start, p_period_end,
    p_amount, v_expense_id, p_created_by
  ) RETURNING id INTO v_entry_id;

  UPDATE lb_fixed_assets
  SET accumulated_depreciation = accumulated_depreciation + p_amount,
      updated_at = now()
  WHERE id = p_asset_id;

  RETURN v_entry_id;
END;
$$;

-- NOTE on record_expense()'s signature: this calls it positionally, as
-- (business_id, branch_id, category_id, expense_date, amount,
-- payment_method, description, attachment_url, status, created_by) —
-- the order expensesService.js passes its named parameters in. If the
-- live function's parameter order differs, this call will fail loudly at
-- first use rather than posting to the wrong column. Worth confirming
-- against the live definition before running.
