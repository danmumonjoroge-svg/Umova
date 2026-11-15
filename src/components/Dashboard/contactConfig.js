// src/components/Dashboard/contactConfig.js
//
// Where member messages go. Set these in .env (Create React App only exposes REACT_APP_* variables) and rebuild:
//
//   REACT_APP_SACCO_WHATSAPP=0712345678      (or 254712345678; a leading 0 is read as Kenya, +254)
//   REACT_APP_SACCO_EMAIL=info@yoursacco.co.ke
//   REACT_APP_SACCO_NAME=Umova SACCO          (optional, used in the greeting line)
//
// Nothing is sent through Umova's servers: the buttons open the member's own WhatsApp / email app with the message
// already written, and the member taps Send there. So nothing is stored by the app and no secret is involved.

const digits = (s) => String(s || "").replace(/\D/g, "");

function toInternational(n) {
  const d = digits(n);
  if (!d) return "";
  return d.startsWith("0") ? `254${d.slice(1)}` : d;
}

export const CONTACT = {
  whatsapp: toInternational(process.env.REACT_APP_SACCO_WHATSAPP),
  email: String(process.env.REACT_APP_SACCO_EMAIL || "").trim(),
  orgName: String(process.env.REACT_APP_SACCO_NAME || "Umova SACCO").trim(),
};

export const TOPICS = ["Loan enquiry", "Statement request", "Deposit / payment", "Account details", "Other"];

/** The text both channels start from. Includes who is writing, so the office can find the account at once. */
export function buildMessage({ name, memberNo, topic, text }) {
  const who = name ? `${name}` : "a member";
  const no = memberNo ? ` (Member No: ${memberNo})` : "";
  const body = String(text || "").trim();
  return `Hello ${CONTACT.orgName}, this is ${who}${no}.\nTopic: ${topic}${body ? `\n\n${body}` : "\n\n"}`;
}

export const whatsappUrl = (message) =>
  CONTACT.whatsapp ? `https://wa.me/${CONTACT.whatsapp}?text=${encodeURIComponent(message)}` : null;

export const mailtoUrl = (subject, message) =>
  CONTACT.email
    ? `mailto:${CONTACT.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`
    : null;
