-- AIA -> school accounting hand-off.
-- This migration DOES NOT post into the GL. It records balanced, idempotent journal
-- proposals in an outbox until the school's chart-of-accounts mappings and the
-- finance GL adapter are verified in staging. Never mark an event posted manually.

CREATE TABLE IF NOT EXISTS public.elimu_aia_accounting_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES public.lb_businesses(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('AIA_TRANSACTION','AIA_REMITTANCE')),
  source_id uuid NOT NULL,
  event_key text NOT NULL,
  event_date date NOT NULL,
  description text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'KES' CHECK (currency = 'KES'),
  journal_lines jsonb NOT NULL CHECK (jsonb_typeof(journal_lines) = 'array' AND jsonb_array_length(journal_lines) = 2),
  status text NOT NULL DEFAULT 'NEEDS_MAPPING' CHECK (status IN ('NEEDS_MAPPING','READY_FOR_ADAPTER','POSTED','FAILED')),
  external_journal_ref text,
  adapter_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, event_key),
  UNIQUE (business_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS elimu_aia_accounting_events_queue_idx
  ON public.elimu_aia_accounting_events (business_id, status, event_date DESC);

ALTER TABLE public.elimu_aia_accounting_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS elimu_aia_accounting_events_select ON public.elimu_aia_accounting_events;
CREATE POLICY elimu_aia_accounting_events_select ON public.elimu_aia_accounting_events
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_current_tenant_id() AND public.pos_has_permission('finance.view'));

GRANT SELECT ON public.elimu_aia_accounting_events TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.elimu_aia_accounting_events FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public._elimu_aia_enqueue_accounting_event(
  p_tenant uuid, p_business uuid, p_source_type text, p_source_id uuid,
  p_event_key text, p_event_date date, p_description text, p_amount numeric,
  p_debit_key text, p_credit_key text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RETURN NULL; END IF;
  INSERT INTO public.elimu_aia_accounting_events
    (tenant_id,business_id,source_type,source_id,event_key,event_date,description,amount,journal_lines,status)
  VALUES (
    p_tenant,p_business,p_source_type,p_source_id,p_event_key,p_event_date,p_description,p_amount,
    jsonb_build_array(
      jsonb_build_object('line_no',1,'account_key',p_debit_key,'debit',p_amount,'credit',0),
      jsonb_build_object('line_no',2,'account_key',p_credit_key,'debit',0,'credit',p_amount)
    ), 'NEEDS_MAPPING'
  )
  ON CONFLICT (business_id, event_key) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.elimu_aia_accounting_events
      WHERE business_id=p_business AND event_key=p_event_key;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public._elimu_aia_enqueue_accounting_event(uuid,uuid,text,uuid,text,date,text,numeric,text,text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.elimu_aia_capture_transaction_accounting()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_debit text; v_credit text;
BEGIN
  IF NEW.transaction_type = 'INCOME' THEN
    v_debit := 'AIA_RECEIVABLE_CLEARING'; v_credit := 'AIA_INCOME';
  ELSE
    v_debit := 'AIA_OPERATING_EXPENSE'; v_credit := 'AIA_PAYABLE_CLEARING';
  END IF;
  PERFORM public._elimu_aia_enqueue_accounting_event(
    NEW.tenant_id, NEW.business_id, 'AIA_TRANSACTION', NEW.id,
    'AIA_TRANSACTION:' || NEW.id::text, NEW.transaction_date,
    NEW.description, NEW.total_amount, v_debit, v_credit
  );
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.elimu_aia_capture_transaction_accounting() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS elimu_aia_transaction_accounting_trg ON public.elimu_aia_transactions;
CREATE TRIGGER elimu_aia_transaction_accounting_trg
  AFTER INSERT ON public.elimu_aia_transactions
  FOR EACH ROW EXECUTE FUNCTION public.elimu_aia_capture_transaction_accounting();

CREATE OR REPLACE FUNCTION public.elimu_aia_capture_remittance_accounting()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status = 'PAID' AND OLD.status IS DISTINCT FROM 'PAID' THEN
    PERFORM public._elimu_aia_enqueue_accounting_event(
      NEW.tenant_id, NEW.business_id, 'AIA_REMITTANCE', NEW.id,
      'AIA_REMITTANCE_PAID:' || NEW.id::text, NEW.remittance_date,
      'AIA proceeds remitted to school fund', NEW.amount,
      CASE NEW.payment_method
        WHEN 'BANK' THEN 'SCHOOL_BANK_CLEARING'
        WHEN 'MPESA' THEN 'SCHOOL_MPESA_CLEARING'
        WHEN 'CASH' THEN 'SCHOOL_CASH_CLEARING'
        WHEN 'CHEQUE' THEN 'SCHOOL_BANK_CLEARING'
      END,
      'AIA_RECEIVABLE_CLEARING'
    );
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.elimu_aia_capture_remittance_accounting() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS elimu_aia_remittance_accounting_trg ON public.elimu_aia_remittances;
CREATE TRIGGER elimu_aia_remittance_accounting_trg
  AFTER UPDATE OF status ON public.elimu_aia_remittances
  FOR EACH ROW EXECUTE FUNCTION public.elimu_aia_capture_remittance_accounting();

COMMENT ON TABLE public.elimu_aia_accounting_events IS
  'Balanced, idempotent AIA journal proposals. NEEDS_MAPPING until an approved chart mapping and tested GL adapter are configured; not a posted GL journal.';
COMMENT ON COLUMN public.elimu_aia_accounting_events.journal_lines IS
  'Two-line balanced proposal using account_key values, not GL account IDs. Adapter must resolve keys and validate tenant/account ownership before posting.';
