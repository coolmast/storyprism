// Mirrors server/src/embeds.js's detectProvider/extractEmbedUrl - kept as a
// tiny duplicate rather than a shared package, since it's a handful of
// lines and the server is the one that actually enforces the allowlist and
// re-runs this same extraction on save.
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

// Strava's embed snippet (a <div data-embed-id=... data-token=...> plus a
// shared widget <script>) has no usable src=/href= of its own - the only
// one in it is the same generic embed.js URL for every activity - so it's
// parsed out separately, into a URL of our own device that the server's
// stravaActivityInfo (embeds.js) reads back at render time.
function parseStravaSnippet(input) {
  const id = input.match(/data-embed-id\s*=\s*["']([^"']+)["']/i)?.[1];
  const token = input.match(/data-token\s*=\s*["']([^"']+)["']/i)?.[1];
  if (!id || !token) return null;
  const style = input.match(/data-style\s*=\s*["']([^"']+)["']/i)?.[1] || "standard";
  return `https://www.strava.com/activities/${encodeURIComponent(id)}?embed_token=${encodeURIComponent(token)}&style=${encodeURIComponent(style)}`;
}

// A user pasting a provider's ready-made embed snippet (Strava's <div>+
// <script> block, or Komoot's <iframe>/<a><img></a>, rather than the bare
// link) shouldn't end up with that literal markup saved as the route's url
// - pull the actual identifying URL out of it instead. A plain URL passes
// through unchanged.
export function extractEmbedUrl(input) {
  const trimmed = String(input || "").trim();
  const strava = parseStravaSnippet(trimmed);
  if (strava) return strava;
  const match = trimmed.match(/\b(?:src|href)\s*=\s*["']([^"']+)["']/i);
  return match ? match[1] : trimmed;
}
