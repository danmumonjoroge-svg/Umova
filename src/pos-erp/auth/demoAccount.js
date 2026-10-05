// src/pos-erp/auth/demoAccount.js
//
// Demo account for "UMOVA — MY BUSINESS".
//
// The DEMO tenant + owner login are created by schema/phase18_demo_account.sql
// (through the real register_pos_tenant() RPC, so nothing about auth,
// tenant isolation or RLS is special-cased). This file holds:
//   1. the public demo credentials used by the "Try the demo" button, and
//   2. seedDemoDataIfEmpty(): fills the DEMO business with realistic Kenyan
//      sample data THROUGH THE APP'S OWN SERVICES (productService,
//      saleService, ...), so every row is written exactly the way a real
//      owner's would be. No raw INSERTs guessing at lb_* columns.
//
// The credentials are intentionally public — the DEMO tenant holds only
// sample data. Never put real customer data or real M-Pesa credentials in it.

import { posSupabase } from "../services/posSupabaseClient";
import { productService } from "../services/productService";
import { customerService } from "../services/customerService";
import { supplierService } from "../services/supplierService";
import { expensesService } from "../services/expensesService";
import { inventoryService } from "../services/inventoryService";
import { saleService } from "../services/saleService";
import { cashierService } from "../services/cashierService";

export const DEMO_BUSINESS_CODE = "DEMO";
export const DEMO_USERNAME = "demo";
export const DEMO_PASSWORD = "Demo@1234";

export const isDemoTenant = (tenant) => tenant?.business_code === DEMO_BUSINESS_CODE;

// name, sku, cost, price, opening stock, reorder level
const PRODUCTS = [
  ["Unga Maize Flour 2kg",     "UNGA-2KG",  135, 155, 40, 10],
  ["Sugar 1kg",                "SUG-1KG",   150, 175, 30, 10],
  ["Cooking Oil 1L",           "OIL-1L",    260, 310, 24,  6],
  ["Rice Pishori 1kg",         "RICE-1KG",  170, 200, 25,  8],
  ["Tea Leaves 250g",          "TEA-250",    70,  90, 36, 12],
  ["Fresh Milk 500ml",         "MILK-500",   48,  60, 50, 15],
  ["Bread White 400g",         "BREAD-400",  52,  65, 20, 10],
  ["Eggs Tray (30)",           "EGG-30",    380, 450, 10,  4],
  ["Bar Soap 800g",            "SOAP-800",  110, 140, 18,  6],
  ["Toothpaste 100ml",         "TPASTE-100", 95, 130, 12,  5],
  ["Airtime Voucher 50",       "AIR-50",     47,  50,  0,  0], // stock left 0 on purpose: shows an "out of stock" state
  ["Matchbox (pack of 10)",    "MATCH-10",   22,  35,  4,  8], // below reorder level on purpose: shows "low stock"
];

const CUSTOMERS = [
  { name: "Mama Njeri",   phone: "0712345001", customer_type: "CREDIT", credit_limit: 3000 },
  { name: "Mwangi Hardware Shop", phone: "0722345002", customer_type: "CREDIT", credit_limit: 5000 },
  { name: "Aisha Hassan", phone: "0733345003", customer_type: "REGISTERED", credit_limit: 0 },
  { name: "Otieno (Boda)", phone: "0700345004", customer_type: "REGISTERED", credit_limit: 0 },
];

const SUPPLIERS = [
  { name: "Wakulima Wholesalers", phone: "0711000111", contact_person: "Peter Kamau", address: "Gikomba, Nairobi" },
  { name: "Unga & Sugar Distributors", phone: "0722000222", contact_person: "Grace Wanjiru", address: "Industrial Area, Nairobi" },
];

const EXPENSES = [
  { description: "Shop rent",          amount: 8000, paymentMethod: "CASH" },
  { description: "Electricity tokens", amount: 1200, paymentMethod: "MOBILE_MONEY" },
  { description: "Transport — stock delivery", amount: 600, paymentMethod: "CASH" },
];

/**
 * Seeds the demo business once. Safe to call on every demo login: it does
 * nothing if the business already has products. Returns
 * { seeded: boolean, error?: string }.
 *
 * @param {{ tenant: object, staffId: string }} ctx — from usePosErpAuth()
 */
export async function seedDemoDataIfEmpty({ tenant, staffId }) {
  if (!isDemoTenant(tenant) || !tenant?.id || !staffId) return { seeded: false };

  try {
    const { count, error: countErr } = await posSupabase
      .from("lb_products")
      .select("id", { count: "exact", head: true });
    if (countErr) throw countErr;
    if (count > 0) return { seeded: false }; // already seeded (or the owner added their own)

    const base = { tenant_id: tenant.id, business_id: tenant.business_id ?? null };

    // 1. Products + opening stock (OPENING_STOCK is a real manual movement type)
    const products = [];
    for (const [name, sku, cost, price, qty, reorder] of PRODUCTS) {
      const p = await productService.create({
        ...base, name, sku, selling_price: price, cost_price: cost,
        reorder_level: reorder, track_inventory: true, allow_negative_stock: false,
        selling_mode: "PER_UNIT",
      });
      products.push(p);
      if (qty > 0) {
        await inventoryService.adjustStock({
          tenantId: tenant.id, businessId: tenant.business_id ?? null,
          productId: p.id, movementType: "OPENING_STOCK", quantity: qty,
          reason: "Demo opening stock", createdBy: staffId,
        });
      }
    }
    const bySku = Object.fromEntries(products.map((p) => [p.sku, p]));

    // 2. People
    const customers = [];
    for (const c of CUSTOMERS) {
      customers.push(await customerService.create({ ...base, ...c, created_by: staffId }));
    }
    for (const s of SUPPLIERS) {
      await supplierService.create({ ...base, ...s, is_active: true, created_by: staffId });
    }

    // 3. Spending (record_expense RPC, same path as the My Spending screen)
    const cats = await expensesService.getCategories();
    for (const e of EXPENSES) {
      await expensesService.create({
        businessId: tenant.business_id, categoryId: cats[0]?.id ?? null,
        createdBy: staffId, status: "PAID", ...e,
      });
    }

    // 4. A till shift + a few real sales (cash, M-Pesa, credit). The shift is
    //    left OPEN so the demo user can sell straight away.
    const { data: openShift } = await posSupabase
      .from("lb_cashier_shifts").select("*").eq("status", "OPEN").limit(1).maybeSingle();
    const shift = openShift || await cashierService.openShift({
      cashier_id: staffId, tenant_id: tenant.id, business_id: tenant.business_id ?? null,
      shift_number: `SH-${tenant.business_code}-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`,
      opening_float: 2000, status: "OPEN",
    });

    const line = (sku, quantity) => {
      const p = bySku[sku];
      return { product_id: p.id, quantity, unit_price: p.selling_price, cost_price: p.cost_price, name: p.name };
    };
    const sale = (items, method, extra = {}) => {
      const total = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
      return saleService.create({
        ...base, cashier_id: staffId, shift_id: shift.id, items,
        payments: [{ payment_method: method, amount: total, ...(method === "MOBILE_MONEY" ? { reference_no: "DEMO-MPESA" } : {}) }],
        ...extra,
      });
    };

    await sale([line("UNGA-2KG", 2), line("SUG-1KG", 1)], "CASH");
    await sale([line("MILK-500", 3), line("BREAD-400", 2)], "CASH");
    await sale([line("OIL-1L", 1), line("RICE-1KG", 2), line("TEA-250", 1)], "MOBILE_MONEY");
    await sale([line("EGG-30", 1), line("SOAP-800", 2)], "MOBILE_MONEY");
    await sale([line("UNGA-2KG", 4), line("SUG-1KG", 2), line("OIL-1L", 2)], "CREDIT", { customer_id: customers[0].id });
    await sale([line("SOAP-800", 3), line("TPASTE-100", 2)], "CREDIT", { customer_id: customers[1].id });

    return { seeded: true };
  } catch (err) {
    // Never block the demo login on a seeding problem — the user can still
    // explore an empty business. Surface the real message for debugging.
    console.error("[demo] sample-data seeding failed:", err);
    return { seeded: false, error: err?.message || String(err) };
  }
}
