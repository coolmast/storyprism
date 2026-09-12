// crypto.randomUUID() only exists in secure contexts (HTTPS or localhost) -
// it's undefined on a phone hitting this app over plain HTTP via a LAN IP.
// These ids are only used as local/React keys until save, never for
// anything security-sensitive, so a Math.random-based fallback is fine.
export function uid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
