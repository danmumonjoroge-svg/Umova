// Who to call for help. EDIT THIS FILE with your real details before release; nothing else needs changing.
// Leave a value as '' to hide that line.
export const SUPPORT = {
  name: 'Elimu Support',
  phone: '+254 700 000 000',
  whatsapp: '254700000000',        // digits only, with country code
  email: 'support@example.com',
  hours: 'Monday to Friday, 8:00 am to 5:00 pm (East Africa Time)',
  website: '',
};
export const phoneLink = (s = SUPPORT) => (s.phone ? `tel:${s.phone.replace(/[^+\d]/g, '')}` : '');
export const whatsappLink = (s = SUPPORT, text = 'Hello, I need help with Elimu.') => (s.whatsapp ? `https://wa.me/${s.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(text)}` : '');
export const emailLink = (s = SUPPORT) => (s.email ? `mailto:${s.email}?subject=${encodeURIComponent('Elimu help')}` : '');
