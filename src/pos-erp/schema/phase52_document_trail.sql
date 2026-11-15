-- phase52_document_trail.sql
-- Purchase triangulation: the supplier's invoice AMOUNT and DATE are recorded on the goods received note, next to the
-- invoice number that was already there, so PO <-> delivery <-> invoice can be matched. Additive and re-runnable.
-- Nothing here changes stock, balances or accounts: the amount is a reference figure used only for matching.
ALTER TABLE lb_goods_received_notes ADD COLUMN IF NOT EXISTS supplier_invoice_amount numeric(14,2) CHECK (supplier_invoice_amount IS NULL OR supplier_invoice_amount >= 0);
ALTER TABLE lb_goods_received_notes ADD COLUMN IF NOT EXISTS supplier_invoice_date date;
