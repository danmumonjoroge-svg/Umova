-- phase46: let the till hear about an M-Pesa result instantly (Supabase Realtime).
-- useMpesaPayment() subscribes to UPDATEs on lb_mpesa_transactions. Until this table is in the realtime publication
-- those events are never sent and the till relies on its polling fallback only. Safe to run more than once.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'lb_mpesa_transactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.lb_mpesa_transactions;
  END IF;
END $$;
-- Rollback: ALTER PUBLICATION supabase_realtime DROP TABLE public.lb_mpesa_transactions;
