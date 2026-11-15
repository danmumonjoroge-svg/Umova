-- ELIMU FINANCE - PRE-FLIGHT CHECK. Run on STAGING before E001. Read-only. Every row says whether a POS object Elimu depends on exists in the live DB
-- with the shape the tests assumed. The in-process test suite uses STUBS of these objects; this script is what ties it to reality.
-- A row with ok = false is a blocker: fix or adapt before migrating.
WITH checks(name, ok, note) AS (
  VALUES
  ('table lb_businesses',                     to_regclass('public.lb_businesses') IS NOT NULL, 'school = a business row; needs id, tenant_id, name'),
  ('lb_businesses.tenant_id',                 EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lb_businesses' AND column_name='tenant_id'), ''),
  ('fn get_current_tenant_id()',              to_regprocedure('get_current_tenant_id()') IS NOT NULL, 'tenant isolation'),
  ('fn is_pos_session()',                     to_regprocedure('is_pos_session()') IS NOT NULL, 'staff session test'),
  ('fn is_pos_owner()',                       to_regprocedure('is_pos_owner()') IS NOT NULL, 'owner bypass'),
  ('fn pos_has_permission(text)',             to_regprocedure('pos_has_permission(text)') IS NOT NULL, 'permission test'),
  ('fn next_doc_number(uuid,text)',           to_regprocedure('next_doc_number(uuid,text)') IS NOT NULL, 'receipt/invoice numbers'),
  ('table pos_staff',                         to_regclass('public.pos_staff') IS NOT NULL, 'cashier names on receipts'),
  ('table pos_audit_log',                     to_regclass('public.pos_audit_log') IS NOT NULL, 'audit (Elimu skips auditing silently if absent - do NOT go live without it)'),
  ('pos_audit_log columns',                   (SELECT count(*) FROM information_schema.columns WHERE table_name='pos_audit_log' AND column_name IN ('pos_tenant_id','actor_type','actor_id','action','entity_type','entity_id','metadata')) = 7, 'E001 _elimu_fin_audit inserts these 7 columns'),
  ('table lb_expenses',                       to_regclass('public.lb_expenses') IS NOT NULL, 'expense engine'),
  ('table lb_expense_categories',             to_regclass('public.lb_expense_categories') IS NOT NULL, ''),
  ('fn record_expense(10 args)',              to_regprocedure('record_expense(uuid,uuid,uuid,date,numeric,text,text,text,text,uuid)') IS NOT NULL, 'E006 passes (business, branch, category, date, amount, method, description, attachment, status, created_by). If your live signature differs, edit E006 elimu_fin_record_expense.'),
  ('table lb_mpesa_c2b_payments',             to_regclass('public.lb_mpesa_c2b_payments') IS NOT NULL, 'Paybill inbox (optional: without it M-Pesa is manual-only - E003 queries it, so install the POS phase43 first or stub it)'),
  ('lb_mpesa_c2b_payments cols',              (SELECT count(*) FROM information_schema.columns WHERE table_name='lb_mpesa_c2b_payments' AND column_name IN ('trans_id','amount','amount_used','status','business_id','tenant_id','bill_ref_number','payer_name','trans_time')) = 9, ''),
  ('table lb_payments (reference_no)',        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lb_payments' AND column_name='reference_no'), 'duplicate M-Pesa check against POS sales'),
  ('table lb_mpesa_transactions (receipt)',   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lb_mpesa_transactions' AND column_name='mpesa_receipt_number'), 'duplicate check against STK prompts'),
  ('table lb_communication_log',              to_regclass('public.lb_communication_log') IS NOT NULL, 'messages'),
  ('lb_communication_log.purpose is text',    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lb_communication_log' AND column_name='purpose' AND data_type IN ('text','character varying')), 'Elimu writes purposes like ELIMU_PAYMENT_CONFIRMED'),
  ('message_type accepts OTHER',              EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname LIKE '%message%type%' AND e.enumlabel='OTHER') OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lb_communication_log' AND column_name='message_type' AND data_type='text'), 'Elimu logs message_type = OTHER'),
  ('role authenticated exists',               EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated'), 'RLS / grants'),
  ('role service_role exists',                EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role'), 'STK confirm grant (optional)'),
  ('no clash: elimu_fin_* tables',            NOT EXISTS (SELECT 1 FROM pg_class WHERE relname LIKE 'elimu\_fin\_%' AND relkind='r'), 'false = a previous run exists (re-running is safe)')
)
SELECT name, ok, note FROM checks ORDER BY ok, name;
