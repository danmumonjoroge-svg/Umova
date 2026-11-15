// Print / download PDF / share / message for one confirmed payment. Rendering is done by the POS print + PDF engines.
import React, { useState } from 'react';
import { Printer, Download, Share2, MessageSquare } from 'lucide-react';
import { buildReportPdf, savePdf, sharePdf, reportFileName, loadLogoPng } from '../../../utils/reportPdf';
import { receiptReport, printReceipt } from '../receipts/receiptReport';
import { buildVars } from '../../communication/finance/financeComm';
import { fromDb } from '../utils/money';
import MessageComposer from './MessageComposer';
import { Notice, TextBtn } from '../../../components/CardKit';

export default function ReceiptActions({ ctx, receipt, guardian, studentId }) {
  const [err, setErr] = useState(null); const [compose, setCompose] = useState(false);
  const pdf = async () => { const logo = receipt.school?.logo_url ? await loadLogoPng(receipt.school.logo_url).catch(() => null) : null; const r = receiptReport(receipt);
    return { doc: buildReportPdf(r, { business: receipt.school, logo, generatedBy: receipt.received_by }), name: reportFileName({ ...r, title: `receipt-${receipt.receipt_no}` }) }; };
  const run = (fn) => async () => { setErr(null); try { await fn(); } catch (e) { setErr(e.message || 'Could not complete that.'); } };
  const vars = buildVars({ school: receipt.school, student: { ...receipt.student, guardian_name: guardian?.name }, guardian, balanceCents: fromDb(receipt.balance_after),
    payment: { amount: receipt.amount, receipt_no: receipt.receipt_no, method: receipt.method, transaction_ref: receipt.transaction_ref } });
  return (
    <div>
      <div className="flex gap-2 flex-wrap">
        <TextBtn onClick={run(async () => printReceipt(receipt))}><Printer size={14} className="inline" /> Print</TextBtn>
        <TextBtn onClick={run(async () => { const { doc, name } = await pdf(); await savePdf(doc, name, `Receipt ${receipt.receipt_no}`); })}><Download size={14} className="inline" /> PDF</TextBtn>
        <TextBtn onClick={run(async () => { const { doc, name } = await pdf(); await sharePdf(doc, name, `Receipt ${receipt.receipt_no}`); })}><Share2 size={14} className="inline" /> Share</TextBtn>
        <TextBtn onClick={() => setCompose(true)}><MessageSquare size={14} className="inline" /> Message</TextBtn>
      </div>
      {err && <Notice tone="bad">{err}</Notice>}
      {compose && <MessageComposer ctx={ctx} purpose="ELIMU_RECEIPT_ISSUED" vars={vars} contact={{ phone: guardian?.phone, email: guardian?.email }} studentId={studentId}
        reference={{ type: 'ELIMU_PAYMENT', id: receipt.payment_id, label: receipt.receipt_no }} onClose={() => setCompose(false)} />}
    </div>
  );
}
