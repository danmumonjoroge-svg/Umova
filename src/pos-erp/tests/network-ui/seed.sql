\set S  '00000000-0000-0000-0000-0000000000a1'
\set B  '00000000-0000-0000-0000-0000000000a2'
\set X  '00000000-0000-0000-0000-0000000000a3'
INSERT INTO pos_tenants VALUES (:'S','Mwangi Wholesalers','0700000001','approved'),(:'B','Kikuyu Retail','0700000002','approved'),(:'X','Newbie Shop','0700000003','approved');
INSERT INTO lb_product_categories VALUES ('00000000-0000-0000-0000-00000000ca01','Groceries');
INSERT INTO lb_product_units VALUES ('00000000-0000-0000-0000-00000000de01','Carton','CTN');
INSERT INTO lb_warehouses VALUES ('00000000-0000-0000-0000-0000000000d1',:'S',true),('00000000-0000-0000-0000-0000000000d2',:'B',true);
INSERT INTO lb_products (id, tenant_id, track_inventory, reorder_level, name, barcode, category_id, unit_id, sku, cost_price, selling_price, is_active) VALUES
 ('00000000-0000-0000-0000-0000000000c1',:'S',true,10,'Sugar 50kg','6001','00000000-0000-0000-0000-00000000ca01','00000000-0000-0000-0000-00000000de01','SECRET-SKU-1',3000,3500,'active'),
 ('00000000-0000-0000-0000-0000000000c2',:'S',true,10,'Hidden Item',NULL,NULL,NULL,'SECRET-SKU-2',10,20,'active'),
 ('00000000-0000-0000-0000-0000000000c3',:'S',true,10,'Rice 25kg','6003','00000000-0000-0000-0000-00000000ca01',NULL,'SECRET-SKU-3',1000,1200,'active'),
 ('00000000-0000-0000-0000-0000000000c6',:'S',true,5,'Flour 2kg with a really long product name that must not break the card layout at all','6006','00000000-0000-0000-0000-00000000ca01',NULL,'SECRET-SKU-6',50,70,'active'),
 ('00000000-0000-0000-0000-0000000000c7',:'S',true,1,'Race Item',NULL,NULL,NULL,'SECRET-SKU-7',5,9,'active');
INSERT INTO lb_inventory (tenant_id, warehouse_id, product_id, quantity) VALUES
 (:'S','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000c1',100),
 (:'S','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000c3',50),
 (:'S','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000c6',3),
 (:'S','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000c7',10);
SELECT set_config('test.tenant', :'S', false), set_config('test.perms', 'products.manage', false);
SELECT network_publish_offer('00000000-0000-0000-0000-0000000000c1','SHOW',100,2,true,true,ARRAY['Kiambu'],2,50,'Fresh stock');
SELECT network_publish_offer('00000000-0000-0000-0000-0000000000c3','REQUEST',null,1,false,true,'{}',3,0,null);
SELECT network_publish_offer('00000000-0000-0000-0000-0000000000c6','SHOW',80,1,true,false,'{}',1,0,null);
