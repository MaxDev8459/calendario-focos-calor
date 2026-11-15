// Tiny global store with change events. AI-assisted code — see README "Use of AI".
const listeners = new Map();

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function safeSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage blocked: ignore */ }
}

const prefersLight = typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: light)").matches;
export const reducedMotion = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export const state = {
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  theme: safeGet("ha-theme") ?? (prefersLight ? "day" : "night"),
  section: "hero",
  metadata: null,
};

export function set(key, value) {
  if (state[key] === value) return;
  state[key] = value;
  (listeners.get(key) ?? []).forEach((fn) => fn(value));
}
export function on(key, fn) {
  if (!listeners.has(key)) listeners.set(key, []);
  listeners.get(key).push(fn);
}

// simple pub/sub for app events
const bus = new EventTarget();
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));
export const listen = (name, fn) => bus.addEventListener(name, (e) => fn(e.detail));
