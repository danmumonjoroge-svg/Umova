-- phase45_mpesa_account_type.sql
-- A Buy Goods TILL and a PAYBILL are prompted differently by Safaricom (STK Push):
--   Paybill : TransactionType CustomerPayBillOnline,   BusinessShortCode = PartyB = the paybill number
--   Till    : TransactionType CustomerBuyGoodsOnline,  BusinessShortCode = the Store / Head Office number,
--                                                      PartyB = the Till number customers pay to
-- The app always used the paybill form, so a till's prompt was accepted by Safaricom but never reached the phone.
-- RUN ONCE in the Supabase SQL editor, BEFORE deploying mpesa-save-config / mpesa-stk-push. Safe to re-run.
-- UNDO: ALTER TABLE lb_mpesa_config DROP COLUMN account_type, DROP COLUMN till_number;
ALTER TABLE lb_mpesa_config ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'paybill';
ALTER TABLE lb_mpesa_config ADD COLUMN IF NOT EXISTS till_number text;
ALTER TABLE lb_mpesa_config DROP CONSTRAINT IF EXISTS lb_mpesa_config_account_type_chk;
ALTER TABLE lb_mpesa_config ADD CONSTRAINT lb_mpesa_config_account_type_chk CHECK (account_type IN ('paybill','till'));
