import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
globalThis.window = dom.window; globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.__online = true;
Object.defineProperty(dom.window.navigator, 'onLine', { get: () => globalThis.__online, configurable: true });
for (const k of ['HTMLElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'getComputedStyle', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  if (!(k in globalThis) || k === 'Event') globalThis[k] = dom.window[k];
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
