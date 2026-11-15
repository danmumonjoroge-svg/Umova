// src/pos-erp/services/businessIdentity.js
//
// The ONE place that knows the business's REGISTERED name — the name given
// when the business was registered (pos_tenants.business_name, the same name
// shown on the sign-in status and top bar). Every customer/supplier message,
// receipt message and invoice message uses it for {{business_name}}.
//
// Why a tiny module and not a parameter on every call: seven different
// screens build messages, and most of them never passed business_name at all,
// so customers received the literal text "{{business_name}}". Rendering now
// takes the name from here, so no screen can forget it.
//
// POSAuthContext keeps this in step with the signed-in business and clears it
// on sign-out, so one business's name can never leak into another's messages.

let registeredName = '';

export function setRegisteredBusinessName(name) {
  registeredName = typeof name === 'string' ? name.trim() : '';
}

export function getRegisteredBusinessName() {
  return registeredName;
}
