-- SCRATCH-ONLY extras for phase37 on top of phase35_stubs.sql. Shapes follow the LIVE lb_expenses / lb_expense_categories
-- columns the owner sent (2026-10-27). Never run on a real database.
CREATE TYPE lb_expense_status AS ENUM ('PENDING','APPROVED','PAID','REJECTED');
ALTER TABLE lb_expenses ADD COLUMN branch_id uuid, ADD COLUMN category_id uuid, ADD COLUMN expense_number text, ADD COLUMN expense_date date DEFAULT CURRENT_DATE,
  ADD COLUMN attachment_url text, ADD COLUMN status lb_expense_status DEFAULT 'PAID', ADD COLUMN created_by uuid, ADD COLUMN updated_by uuid,
  ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN updated_at timestamptz DEFAULT now();
CREATE TABLE lb_expense_categories (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, business_id uuid, name text NOT NULL, description text,
  is_system boolean DEFAULT false, is_active boolean DEFAULT true, sort_order integer DEFAULT 0, created_at timestamptz DEFAULT now());
INSERT INTO lb_expense_categories (name, is_system, sort_order) VALUES ('Rent', true, 1), ('Depreciation', true, 99);
-- the record_expense stub now fills the real columns
DROP FUNCTION record_expense(uuid, uuid, uuid, date, numeric, lb_payment_method, text, text, text, uuid);
CREATE FUNCTION record_expense(p_business_id uuid, p_branch_id uuid, p_category_id uuid, p_expense_date date, p_amount numeric, p_payment_method lb_payment_method, p_description text, p_attachment_url text, p_status text, p_created_by uuid)
RETURNS uuid LANGUAGE plpgsql AS $$ DECLARE v uuid; BEGIN
  INSERT INTO lb_expenses(tenant_id, business_id, branch_id, category_id, expense_number, expense_date, amount, payment_method, description, attachment_url, status, created_by)
  VALUES (get_current_tenant_id(), p_business_id, p_branch_id, p_category_id, 'EXP-' || substr(gen_random_uuid()::text, 1, 6), p_expense_date, p_amount, p_payment_method, p_description, p_attachment_url, p_status::lb_expense_status, p_created_by)
  RETURNING id INTO v; RETURN v; END $$;
-- mimic the live phase28 trigger: POS sessions need expenses.record to insert/update lb_expenses
CREATE FUNCTION stub_expense_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pos_require('expenses.record'); RETURN NEW; END $$;
CREATE TRIGGER trg_stub_expense_guard BEFORE INSERT OR UPDATE ON lb_expenses FOR EACH ROW EXECUTE FUNCTION stub_expense_guard();
-- owner flag for the session
CREATE FUNCTION is_pos_owner() RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce(nullif(current_setting('test.owner', true), ''), 'off') = 'on' $$;
CREATE TABLE pos_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), pos_tenant_id uuid, actor_type text, actor_id uuid, action text, entity_type text, entity_id uuid, metadata jsonb, created_at timestamptz DEFAULT now());
