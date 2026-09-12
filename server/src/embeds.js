// Hosts we trust enough to put in an <iframe>. Anything else renders as a
// plain "view on X" link instead - never iframed, even if the URL happens
// to contain "embed" somewhere.
const ALLOWED_EMBED_HOSTS = [
  "strava.com",
  "www.strava.com",
  "komoot.com",
  "www.komoot.com",
  "komoot.de",
  "www.komoot.de",
  "garmin.com",
  "connect.garmin.com",
];

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

export function isAllowedEmbedHost(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return ALLOWED_EMBED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

// Only a URL from an allowed host AND that looks like the provider's actual
// embed link (not just a regular activity/tour page, which usually refuses
// to be framed) gets rendered as an <iframe>. Everything else is a link-out
// card - safer, and honest about what will and won't actually embed.
export function isEmbeddable(url) {
  if (!isAllowedEmbedHost(url)) return false;
  try {
    const u = new URL(url);
    return /embed/i.test(u.pathname) || /embed/i.test(u.search);
  } catch {
    return false;
  }
}
