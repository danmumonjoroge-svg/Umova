-- phase46_generate_sale_number.sql
-- confirm_mpesa_payment() (phase12/14/17/39) creates the sale with generate_sale_number(), but no phase ever defined it.
-- On a database where it is missing, every successful M-Pesa prompt failed at "function generate_sale_number() does not exist":
-- the whole confirmation rolled back and the till spun forever. The till's own sales number sales in the app (S-000123); this
-- one numbers sales created by the database, with a date inside so it can never collide with those (e.g. S-261106-00001).
-- RUN ONCE in the Supabase SQL editor. Safe to re-run. UNDO: DROP FUNCTION generate_sale_number(); DROP SEQUENCE lb_sale_number_seq;
CREATE SEQUENCE IF NOT EXISTS lb_sale_number_seq;

CREATE OR REPLACE FUNCTION generate_sale_number() RETURNS text
LANGUAGE sql VOLATILE
SET search_path = public, pg_temp
AS $$
  SELECT 'S-' || to_char(now() AT TIME ZONE 'Africa/Nairobi', 'YYMMDD') || '-' || lpad(nextval('public.lb_sale_number_seq')::text, 5, '0')
$$;

GRANT EXECUTE ON FUNCTION generate_sale_number() TO service_role;
