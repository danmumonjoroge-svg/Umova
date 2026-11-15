// src/pos-erp/utils/paymentMethods.js
//
// Which payment methods the till offers. Driven ONLY by the owner's "Payment methods accepted" setting
// (Settings -> Payments & tax). Whether Daraja / M-Pesa prompts are set up is deliberately NOT an input here:
// M-Pesa as a way to pay (typing the SMS code) must stay available without any Daraja setup.

export const ALL_TILL_METHODS = ['CASH', 'MOBILE_MONEY', 'CARD', 'CREDIT'];

/**
 * @param {string[]|undefined|null} saved  settings.payment_methods_enabled as saved by the owner (undefined = never saved)
 * @returns {string[]} the methods to show, in till order. An explicit choice is respected; a saved list that leaves
 *   nothing the till can use falls back to all of them rather than leaving the cashier with no way to take payment.
 */
export function resolveEnabledMethods(saved) {
  const filtered = Array.isArray(saved) ? ALL_TILL_METHODS.filter((m) => saved.includes(m)) : ALL_TILL_METHODS;
  return filtered.length > 0 ? filtered : ALL_TILL_METHODS;
}
