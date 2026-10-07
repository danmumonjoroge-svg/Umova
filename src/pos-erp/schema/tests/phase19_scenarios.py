"""Phase 19 scenarios. Needs: pip install pgserver psycopg2-binary. Scratch DB only.
Run from schema/: python tests/phase19_scenarios.py"""
import pgserver, psycopg2, tempfile, pathlib, sys
T1='00000000-0000-0000-0000-0000000000aa'; T2='00000000-0000-0000-0000-0000000000bb'
B1='b1000000-0000-0000-0000-000000000001'; B2='b2000000-0000-0000-0000-000000000002'
JOHN='c0000000-0000-0000-0000-000000000001'; OTHER='c0000000-0000-0000-0000-000000000009'
here=pathlib.Path(__file__).parent
srv=pgserver.get_server(tempfile.mkdtemp()); con=psycopg2.connect(srv.get_uri()); con.autocommit=True; cur=con.cursor()
cur.execute((here/'phase19_stubs.sql').read_text())
# lb_receipts etc are not touched by phase19. Create the few phase19 prerequisites then run it.
cur.execute((here.parent/'phase19_folios.sql').read_text())
fails=[]
def ok(name,cond,extra=''):
    print(('PASS ' if cond else 'FAIL ')+name+(' '+str(extra) if extra and not cond else ''))
    if not cond: fails.append(name)
def q(sql,*a): cur.execute(sql,a); return cur.fetchall() if cur.description else None
def err(sql,*a):
    try: cur.execute(sql,a); return None
    except Exception as e: return str(e).splitlines()[0]
def as_tenant(t): cur.execute("select set_config('test.tenant',%s,false)",(t,))

cur.execute("insert into lb_businesses values (%s,%s,'Umova Hotel'),(%s,%s,'Other Co')",(B1,T1,B2,T2))
cur.execute("insert into lb_customers(id,tenant_id,business_id,name) values (%s,%s,%s,'John Kamau'),(%s,%s,%s,'Stranger')",(JOHN,T1,B1,OTHER,T2,B2))
prods={}
for n,tr in [('Breakfast',True),('Dinner',True),('Drinks',True),('Swimming',False),('Football',False)]:
    cur.execute("insert into lb_products(tenant_id,name,track_inventory) values (%s,%s,%s) returning id",(T1,n,tr)); prods[n]=cur.fetchone()[0]
as_tenant(T1)

def charged_sale(items, folio_id, customer=JOHN):
    cur.execute("insert into lb_sales(tenant_id,business_id,customer_id,status,folio_id) values (%s,%s,%s,'COMPLETED',%s) returning id",(T1,B1,customer,folio_id))
    sid=cur.fetchone()[0]
    for n,qty,price in items:
        cur.execute("insert into lb_sale_items(sale_id,product_id,quantity,unit_price,total_price) values (%s,%s,%s,%s,%s)",(sid,prods[n],qty,price,qty*price))
    return sid

# --- acceptance: John Kamau, one bill ---
fid=q("select open_folio(%s,%s,'Room 204')",B1,JOHN)[0][0]
ok('open_folio returns same folio for same customer', q("select open_folio(%s,%s)",B1,JOHN)[0][0]==fid)
q("select post_folio_line(%s,'ROOM','Room 204 · 2 nights',2,4000,'Room')",fid)
s1=charged_sale([('Breakfast',1,800)],fid); s2=charged_sale([('Drinks',1,900)],fid)
s3=charged_sale([('Swimming',1,500),('Football',1,300)],fid); s4=charged_sale([('Dinner',1,1800)],fid)
for s in (s1,s2,s3,s4): q("select post_sale_to_folio(%s,%s)",fid,s)
ok('re-posting a sale is idempotent', q("select post_sale_to_folio(%s,%s)",fid,s1)[0][0]==0)
bal=q("select total_charges,total_paid,balance_due from lb_folio_summary where id=%s",fid)[0]
ok('one bill totals 12,300', float(bal[0])==12300 and float(bal[2])==12300, bal)
types=dict(q("select line_type,sum(amount) from lb_folio_lines where folio_id=%s group by 1",fid))
ok('services typed SERVICE, goods PRODUCT, room ROOM', float(types['SERVICE'])==800 and float(types['PRODUCT'])==3500 and float(types['ROOM'])==8000, types)
ok('customer balance NOT touched (no double count)', float(q("select outstanding_balance from lb_customers where id=%s",JOHN)[0][0])==0)

# --- guards ---
ok('underpay rejected', 'must equal' in (err("select settle_folio(%s,%s::jsonb)",fid,'[{"payment_method":"MOBILE_MONEY","amount":12000}]') or ''))
ok('credit settlement rejected', 'credit' in (err("select settle_folio(%s,%s::jsonb)",fid,'[{"payment_method":"CREDIT","amount":12300}]') or '').lower())
ok('sale for other customer rejected', 'different customer' in (err("select post_sale_to_folio(%s,%s)",fid,charged_sale([('Dinner',1,100)],fid,OTHER)) or ''))
cur.execute("set role authenticated")
ok('authenticated cannot INSERT folio lines directly', 'permission denied' in (err("insert into lb_folio_lines(tenant_id,business_id,folio_id,line_type,description,amount) values (%s,%s,%s,'OTHER','x',1)",T1,B1,fid) or ''))
ok('authenticated can read own folio', len(q("select 1 from lb_folio_summary where id=%s",fid))==1)
cur.execute("reset role")
ok('line type check', 'Unknown line type' in (err("select post_folio_line(%s,'BOGUS','x',1,1)",fid) or ''))
ok('negative charge must be adjustment', 'adjustment' in (err("select post_folio_line(%s,'OTHER','x',1,-5)",fid) or '').lower())

# adjustment + void line
adj=q("select post_folio_line(%s,'ADJUSTMENT','Goodwill discount',1,300)",fid)[0][0]
ok('adjustment is negative', float(q("select amount from lb_folio_lines where id=%s",adj)[0][0])==-300)
q("select void_folio_line(%s,'Guest declined discount')",adj)
ok('voided line leaves total at 12,300', float(q("select balance_due from lb_folio_summary where id=%s",fid)[0][0])==12300)
ok('sale-derived line cannot be voided as a line', 'Void the sale' in (err("select void_folio_line((select id from lb_folio_lines where sale_id=%s limit 1),'oops')",s1) or ''))

# --- tenant isolation ---
as_tenant(T2)
ok('other tenant cannot see folio', 'not found' in (err("select post_folio_line(%s,'OTHER','x',1,1)",fid) or '').lower())
ok('other tenant cannot settle', 'not found' in (err("select settle_folio(%s,%s::jsonb)",fid,'[{"payment_method":"CASH","amount":12300}]') or '').lower())
ok('other tenant cannot open folio for my customer', 'Customer not found' in (err("select open_folio(%s,%s)",B2,JOHN) or ''))
as_tenant(T1)

# --- settle with M-Pesa ---
res=q("select settle_folio(%s,%s::jsonb)",fid,'[{"payment_method":"MOBILE_MONEY","amount":12300,"reference_no":"SHK7X9ABCD"}]')[0][0]
ok('settle returns invoice+receipt numbers', res['invoice_number'].startswith('INV-') and res['receipt_number'].startswith('RCT-'), res)
row=q("select status,balance_due from lb_folio_summary where id=%s",fid)[0]
ok('folio settled, balance 0', row[0]=='SETTLED' and float(row[1])==0, row)
ok('cannot settle twice', 'already' in (err("select settle_folio(%s,%s::jsonb)",fid,'[{"payment_method":"CASH","amount":1}]') or ''))
ok('cannot charge a settled folio', 'cannot take' in (err("select post_folio_line(%s,'OTHER','late',1,10)",fid) or ''))
# new bill after settlement
fid2=q("select open_folio(%s,%s)",B1,JOHN)[0][0]
ok('customer gets a fresh folio after settlement', fid2!=fid)
ok('empty folio can be cancelled', err("select void_folio(%s)",fid2) is None)
print('\n%d failure(s)'%len(fails)); sys.exit(1 if fails else 0)
