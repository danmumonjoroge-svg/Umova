CREATE TABLE lb_cash_movements (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, movement_type text, amount numeric, created_at timestamptz DEFAULT now());
CREATE TABLE lb_folio_payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, business_id uuid, payment_method text, amount numeric, created_at timestamptz DEFAULT now());
CREATE TABLE lb_expenses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, business_id uuid, expense_date date, amount numeric, payment_method text, status text);
CREATE TABLE lb_mpesa_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, business_id uuid, status text, sale_id uuid, created_at timestamptz DEFAULT now());
