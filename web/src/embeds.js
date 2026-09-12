// Mirrors server/src/embeds.js's detectProvider - kept as a tiny duplicate
// rather than a shared package, since it's a handful of lines and the
// server is the one that actually enforces the allowlist on save.
export function detectProvider(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host.includes("strava.com")) return "Strava";
    if (host.includes("komoot.")) return "Komoot";
    if (host.includes("garmin.com")) return "Garmin Connect";
    return "Route";
  } catch {
    return "Route";
  }
}
