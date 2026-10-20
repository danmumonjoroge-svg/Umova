import fs from 'fs'; import os from 'os'; import path from 'path'; let fail=0;
const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m); if(!c) fail++;};
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'sf-')); fs.copyFileSync('utils/singleFlight.js',path.join(tmp,'sf.mjs'));
const { singleFlight, _inflightCount } = await import(path.join(tmp,'sf.mjs'));
// 1 double tap runs once
let runs=0; const slow=singleFlight('t.a', async()=>{ runs++; await new Promise(r=>setTimeout(r,30)); return 'done'; });
const [a,b]=await Promise.all([slow(),slow()]);
ok(runs===1 && a==='done' && b===undefined,'two simultaneous taps run the handler once');
await slow(); ok(runs===2,'a later tap runs again after the first finished');
// 2 failure releases the lock
let n=0; const bad=singleFlight('t.b', async()=>{ n++; throw new Error('x'); });
await bad().catch(()=>{}); await bad().catch(()=>{}); ok(n===2 && _inflightCount()===0,'a failed save releases the lock so the user can retry');
// 3 dropped submit still prevents the browser's own submit
let prevented=0; const ev={preventDefault(){prevented++;}};
const f=singleFlight('t.c', async()=>{ await new Promise(r=>setTimeout(r,20)); });
await Promise.all([f(ev),f(ev)]); ok(prevented===2,'a dropped form submit is still prevented (no page reload)');
// 4 different handlers do not block each other
let x=0,y=0; const h1=singleFlight('t.d',async()=>{x++; await new Promise(r=>setTimeout(r,20));}); const h2=singleFlight('t.e',async()=>{y++;});
await Promise.all([h1(),h2()]); ok(x===1&&y===1,'different handlers are independent');
// static: money/stock handlers are guarded
const rd=p=>fs.readFileSync(p,'utf8');
for (const [file,name] of [['pages/POSPage.jsx','completeSale'],['pages/InventoryPage.jsx','submit'],['pages/FoliosPage.jsx','act'],['pages/CustomersPage.jsx','submitPayment'],['pages/GoodsReceivingPage.jsx','postGRN'],['pages/ExpensesPage.jsx','submit'],['pages/PurchaseOrdersPage.jsx','submit'],['pages/ProductionPage.jsx','post'],['pages/StaysPage.jsx','onAct'],['pages/SaleCorrectionsPage.jsx','act']])
  ok(new RegExp(`const ${name} = singleFlight\\(`).test(rd(file)), `guarded: ${file} ${name}`);
for (const f of fs.readdirSync('pages').filter(f=>f.endsWith('.jsx')).map(f=>'pages/'+f).concat(fs.readdirSync('components').filter(f=>f.endsWith('.jsx')).map(f=>'components/'+f))) {
  const s=rd(f); if (s.includes('singleFlight(')) ok((s.match(/import \{ singleFlight \}/g)||[]).length===1,'exactly one singleFlight import in '+f);
}
const pos=rd('pages/POSPage.jsx'), off=rd('offline/offlineSaleService.js'), fol=rd('pages/FoliosPage.jsx');
ok(/client_reference: checkoutRef\.current\.ref/.test(pos) && /checkoutRef\.current = null/.test(pos),'POS sends a stable idempotency key per checkout');
ok(/const clientReference = sale\.client_reference \|\| await nextLocalId/.test(off) && !/const clientReference = await nextLocalId\('SALE'\);\n  const totals/.test(off),'online attempt and offline fallback share ONE key');
ok(/clientReference: \(chargeKey\.current \|\|= newKey\(\)\)/.test(fol),'folio charge carries an idempotency key');
console.log(fail?'\nFAILURES: '+fail:'\nALL DOUBLE-POSTING JS CHECKS PASSED'); process.exit(fail?1:0);
