-- phase34_mpesa_confirm_lockdown.sql   (MVP audit D-03)   -- NOT YET RUN on any database. Test on STAGING first.
-- confirm_mpesa_payment() marks a payment PAID and completes the sale. Only the mpesa-callback Edge Function (service role)
-- calls it (the only rpc() caller in the code base). It must not be callable by signed-in staff or anonymous users.
ALTER FUNCTION confirm_mpesa_payment(text, integer, text, text, jsonb) SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION confirm_mpesa_payment(text, integer, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION confirm_mpesa_payment(text, integer, text, text, jsonb) TO service_role;
-- Verify afterwards (as a cashier via the API) that calling it is refused, and that a real STK callback still completes.
-- Rollback: GRANT EXECUTE ON FUNCTION confirm_mpesa_payment(text, integer, text, text, jsonb) TO PUBLIC;
