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

// Komoot's own embed widget just needs a tour id + share token - present in
// every one of the three things Komoot calls a "share" link (the plain tour
// page, the <iframe> embed's src, and the <img>-based embed's src), each
// under a slightly different path/params. Re-deriving a fresh, canonical
// embed URL from whichever form the user pasted means all three "just
// work," including a plain tour-page link (which the old isEmbeddable
// below would've rejected for not already looking like an embed link) -
// and it works retroactively on anything already saved, no migration.
function komootTourInfo(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)komoot\.(com|de)$/.test(u.hostname)) return null;
    const m = u.pathname.match(/\/tour\/(\d+)/);
    const shareToken = u.searchParams.get("share_token");
    if (!m || !shareToken) return null;
    return { tourId: m[1], shareToken, hl: u.searchParams.get("hl") || "en" };
  } catch {
    return null;
  }
}

export function komootEmbedUrl(url) {
  const info = komootTourInfo(url);
  return info
    ? `https://www.komoot.com/tour/${info.tourId}/embed?share_token=${info.shareToken}&hl=${info.hl}&layout=classic&profile=1`
    : null;
}

// Komoot's embed endpoint doubles as a static image generator with
// `image=1` (`hm=true` keeps the route line drawn on it) - handed straight
// to the photobook export as a printable map, no screenshotting needed.
export function komootImageUrl(url) {
  const embed = komootEmbedUrl(url);
  return embed ? `${embed}&image=1&hm=true` : null;
}

// The URL actually put in an <iframe src>: Komoot gets re-derived (see
// above) so any of its three link forms works; every other provider has to
// already look like a real embed link (see isEmbeddable).
export function resolvedEmbedUrl(embed) {
  return komootEmbedUrl(embed.url) || embed.url;
}

// Strava's current embed mechanism isn't a plain <iframe src> at all - the
// share-link page (like the classic /activities/:id/embed/:token iframe
// URL) refuses to be framed now. The only thing that still works is their
// own placeholder-div + widget-script pair: a <div data-embed-id=...
// data-token=...> that a shared <script src="strava-embeds.com/embed.js">
// turns into a real embed at load time. There's no URL to store here in
// the first place, so parseStravaSnippet (below) encodes the two values
// that matter into one of our own device - never sent to Strava as a
// request, just something isAllowedEmbedHost accepts and this parses
// straight back at render time.
export function stravaActivityInfo(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)strava\.com$/.test(u.hostname)) return null;
    const m = u.pathname.match(/\/activities\/(\w+)/);
    const token = u.searchParams.get("embed_token");
    if (!m || !token) return null;
    return { activityId: m[1], token, style: u.searchParams.get("style") || "standard" };
  } catch {
    return null;
  }
}

// What actually gets rendered for a saved embed: Strava's own widget (a
// placeholder div, not an iframe - see stravaActivityInfo), a real <iframe>
// for anything else that qualifies (see isEmbeddable), or just a link-out
// card - safer than guessing, and honest about what will and won't embed.
export function embedKind(url) {
  if (stravaActivityInfo(url)) return "strava-widget";
  if (isEmbeddable(url)) return "iframe";
  return "link";
}

// Only a URL from an allowed host AND that looks like the provider's actual
// embed link (not just a regular activity/tour page, which usually refuses
// to be framed) gets rendered as an <iframe>. Everything else is a link-out
// card - safer, and honest about what will and won't actually embed.
export function isEmbeddable(url) {
  if (!isAllowedEmbedHost(url)) return false;
  if (komootTourInfo(url)) return true;
  try {
    const u = new URL(url);
    return /embed/i.test(u.pathname) || /embed/i.test(u.search);
  } catch {
    return false;
  }
}

function parseStravaSnippet(input) {
  const id = input.match(/data-embed-id\s*=\s*["']([^"']+)["']/i)?.[1];
  const token = input.match(/data-token\s*=\s*["']([^"']+)["']/i)?.[1];
  if (!id || !token) return null;
  const style = input.match(/data-style\s*=\s*["']([^"']+)["']/i)?.[1] || "standard";
  return `https://www.strava.com/activities/${encodeURIComponent(id)}?embed_token=${encodeURIComponent(token)}&style=${encodeURIComponent(style)}`;
}

// A user pasting a provider's ready-made embed snippet (the whole
// <div>+<script> block Strava hands out, or an <iframe>/<a><img></a> from
// Komoot, rather than just a bare link) shouldn't end up with that literal
// markup saved as the "url". Strava's snippet has no usable src=/href= at
// all (the only one in it is the *same* generic embed.js URL for every
// activity) - checked first, so it's never mistaken for one. Otherwise,
// pull the first src=/href= out of it; a plain URL passes through
// unchanged. Which attribute wins when a snippet has both (Komoot's
// <a href><img src></a> form) doesn't matter: either one still carries the
// tour id + share token komootTourInfo needs.
export function extractEmbedUrl(input) {
  const trimmed = String(input || "").trim();
  const strava = parseStravaSnippet(trimmed);
  if (strava) return strava;
  const match = trimmed.match(/\b(?:src|href)\s*=\s*["']([^"']+)["']/i);
  return match ? match[1] : trimmed;
}
