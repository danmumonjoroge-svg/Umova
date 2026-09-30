-- phase17a — run FIRST and ON ITS OWN (ALTER TYPE ... ADD VALUE can't share a transaction with code that uses the value).
ALTER TYPE lb_comm_message_type ADD VALUE IF NOT EXISTS 'INVOICE';
ALTER TYPE lb_mpesa_status      ADD VALUE IF NOT EXISTS 'REVERSED';
