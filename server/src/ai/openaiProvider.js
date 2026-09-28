import { fetchThumbBuffer } from "../photoprism.js";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// Web-search-backed facts (place research, info cards) stay on a fixed
// model rather than the user's own text-model choice below - not every
// model supports the Responses API's web_search tool, and getting facts
// right matters more here than matching writing style/creativity to taste.
const RESEARCH_MODEL = "gpt-4o-mini";

// The model behind every *prose* generation call (captions, interview
// replies, ghostwriter drafts, notes-import rewriting) - configurable per
// story (story.aiTextModel), "very basic" to "most advanced" so cost and
// writing quality are the user's own call rather than a single hardcoded
// default. All three support vision (captions send a photo) and none need
// tool use, so any of them is safe to swap in for any of these calls.
export const AI_TEXT_MODELS = {
  "gpt-4o-mini": { label: "Basic (fastest, cheapest)" },
  "gpt-4o": { label: "Balanced" },
  "gpt-4.1": { label: "Most advanced" },
};
export const DEFAULT_AI_TEXT_MODEL = "gpt-4o";
function resolveTextModel(id) {
  return AI_TEXT_MODELS[id] ? id : DEFAULT_AI_TEXT_MODEL;
}

// Omit the instruction for English - the model defaults there anyway, and
// it keeps prompts shorter for the common case.
function languageInstruction(language) {
  return language && language !== "English" ? ` Respond in ${language}.` : "";
}

async function fetchImageAsDataUrl(photoHash) {
  // Straight to PhotoPrism, in-process - the browser never sees a PhotoPrism
  // URL (see photoprism.js), but this call happens on the server, same as
  // every other AI request here.
  const { buffer, contentType } = await fetchThumbBuffer(photoHash);
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

export async function draftCaption({ photoHash, place, date, storyTitle, language, model }) {
  const dataUrl = await fetchImageAsDataUrl(photoHash);

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: resolveTextModel(model),
      messages: [
        {
          role: "system",
          content:
            "You write short, warm, specific photo captions for a family travel story. " +
            "One sentence. Describe what's actually visible, not generic travel filler. No hashtags, no quotes around the caption." +
            languageInstruction(language),
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Trip: ${storyTitle}. Location: ${place || "unknown"}. Date: ${date || "unknown"}. Write one caption for this photo.`,
            },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      max_tokens: 80,
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI caption request failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

function extractResponseText(data) {
  if (data.output_text) return data.output_text;
  const msg = data.output?.find((o) => o.type === "message");
  const textPart = msg?.content?.find((c) => c.type === "output_text");
  return textPart?.text || "";
}

export async function researchPlace({ place, storyTitle, dateRange, language }) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: RESEARCH_MODEL,
      tools: [{ type: "web_search" }],
      input:
        `Write a short (3-4 sentence) engaging paragraph about "${place}" for a travel story. ` +
        `The writer visited around ${dateRange} as part of a trip called "${storyTitle}". ` +
        `Mention 1-2 concrete, verifiable facts (history, geography, what it's known for). ` +
        `Plain prose, no headings, no citations markup.${languageInstruction(language)}`,
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI research request failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return extractResponseText(data).trim();
}

function extractJson(text) {
  // The Responses API doesn't take a response_format like chat completions
  // does, so we just ask for JSON in the prompt and parse leniently -
  // stripping a markdown code fence if the model wraps it in one anyway.
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  return JSON.parse(cleaned);
}

// Belt-and-suspenders: the web-search tool leads the model to occasionally
// leak its citations straight into prose as markdown links (observed in
// testing, e.g. "...100,000 visitors. ([site.com](https://site.com/...))")
// despite being told not to - those would render as literal unrendered
// markdown in the HTML output. Strips the pattern regardless of whether the
// prompt succeeded in preventing it.
function stripCitations(text) {
  if (!text) return text;
  return text
    .replace(/\(?\[[^\]]*\]\([^)]*\)\)?/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export async function generateInfoCard({ placeName, context, language }) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: RESEARCH_MODEL,
      tools: [{ type: "web_search" }],
      input:
        `Research "${placeName}"${context ? ` (${context})` : ""} and produce a short info card for a ` +
        "travel story reader. Figure out what kind of place this is (national park, city, museum, " +
        "waterfall, historic site, neighborhood, whatever it actually is) and pick 3-5 facts that are " +
        "actually relevant and interesting for THAT kind of place - e.g. a national park might get " +
        "established year/area/notable wildlife, a museum might get founded year/collection focus/a " +
        "standout piece, a waterfall might get height/water source. Don't force facts that don't fit. " +
        "Use only facts you can verify from search; omit a fact rather than guess. Write a one-sentence " +
        "subtitle (what kind of place, in a few words) and a short 2-3 sentence summary in plain, " +
        "specific prose (no travel-brochure language). The summary is prose only - never include " +
        "markdown links, citation markers, or source URLs inline in the subtitle/summary/fact text " +
        `itself; the separate websiteUrl field below is the only place a link belongs.${languageInstruction(language)} Also try to find ` +
        "this place's own official website (the park/museum/attraction's own site - not a travel blog, " +
        "review site, or Wikipedia) so a reader can click through for more information. Only include one " +
        "if you found a real URL you're confident is the place's own official site; leave it an empty " +
        "string rather than guess or fabricate one. The JSON field names themselves must stay in " +
        "English; only the subtitle/summary/fact label/fact value text should be in the requested " +
        "language.\n\n" +
        'Respond with ONLY this JSON, no other text: {"subtitle": string, "summary": string, ' +
        '"facts": [{"label": string, "value": string}], "websiteUrl": string}',
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI info card request failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  const parsed = extractJson(extractResponseText(data));
  const websiteUrl = typeof parsed.websiteUrl === "string" ? parsed.websiteUrl.trim() : "";
  return {
    subtitle: stripCitations(parsed.subtitle || ""),
    summary: stripCitations(parsed.summary || ""),
    facts: Array.isArray(parsed.facts)
      ? parsed.facts
          .slice(0, 6)
          .map((f) => ({ label: stripCitations(f.label || ""), value: stripCitations(f.value || "") }))
      : [],
    // Only trust it if it's actually URL-shaped - never render arbitrary
    // model output as a clickable link without at least this much of a check.
    websiteUrl: /^https?:\/\//i.test(websiteUrl) ? websiteUrl : "",
  };
}

function describeStopContext({ heading, dateRange, narrative, captions, research }) {
  return [
    `Stop: ${heading}${dateRange ? ` (visited ${dateRange})` : ""}.`,
    `Existing narrative: ${narrative ? `"${narrative}"` : "(nothing written yet)"}`,
    captions.length
      ? `Photo captions already written: ${captions.map((c) => `"${c}"`).join(", ")}`
      : "Photo captions: (none yet)",
    research ? `Background research on the place: "${research}"` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

const INTERVIEWER_SYSTEM_PROMPT = `You are a warm, perceptive ghostwriter helping someone turn their travel photos into a vivid, personal story. You are interviewing them about one stop on their trip, to draw out details they have not written down yet.

Ask short, specific, warm follow-up questions about what is missing: how the place looked, sounded, smelled, felt underfoot or on the skin, what it reminded them of, a small funny or odd moment, something someone said, a decision they made. Reference their actual photos and captions to make questions concrete and easy to answer ("What was it like right when you stepped out of the van?" not "How was the weather?").

Ask at most 2-3 questions per turn. Be conversational and curious, never a form or a checklist. Keep your own messages brief: at most one short sentence of warm reaction to what they just said, then your questions. Never write their story for them in this conversation - only ask questions. If they seem to be repeating themselves or say they are done, acknowledge it warmly and suggest they click "Draft rewrite" instead of asking more questions.`;

export async function interviewTurn({
  heading,
  dateRange,
  narrative,
  captions,
  research,
  history,
  language,
  model,
}) {
  const context = describeStopContext({ heading, dateRange, narrative, captions, research });
  const messages = [
    {
      role: "system",
      content: `${INTERVIEWER_SYSTEM_PROMPT}${languageInstruction(language)}\n\nContext:\n${context}`,
    },
    ...history,
  ];
  if (history.length === 0) {
    messages.push({
      role: "user",
      content: "Let's start - ask me your first questions about this stop.",
    });
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: resolveTextModel(model), messages, max_tokens: 220 }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI interview request failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

const GHOSTWRITER_VOICE_RULES =
  'Write like a specific person telling a friend about their trip, not a travel brochure: avoid stock ' +
  'phrases ("heart swelled", "wrapped around us like an embrace", "little did we know", "we couldn\'t ' +
  'believe our eyes"). Prefer plain, concrete detail over generic sensory adjectives - name the actual ' +
  "thing, sound, or feeling rather than reaching for a simile. Short sentences are fine.";

export async function draftFromInterview({ heading, narrative, captions, research, history, language, model }) {
  const context = describeStopContext({ heading, narrative, captions, research });
  const transcript = history
    .map((m) => `${m.role === "user" ? "Traveler" : "Ghostwriter"}: ${m.content}`)
    .join("\n");

  const messages = [
    {
      role: "system",
      content:
        "You are the same ghostwriter. Using the context and interview transcript below, write a polished, " +
        "vivid narrative (1-2 short paragraphs, first person) for this stop, weaving in the concrete sensory " +
        `and emotional details the traveler actually shared. ${GHOSTWRITER_VOICE_RULES} Also suggest one ` +
        "short, striking pull-quote sentence drawn from or inspired by the conversation, or null if nothing " +
        `in the conversation fits well as a pull quote.${languageInstruction(language)} (Keep the JSON field ` +
        'names in English; only the narrative/pullQuote text itself should be in the requested language.)\n\n' +
        'Respond as JSON: {"narrative": string, "pullQuote": string|null}',
    },
    {
      role: "user",
      content: `Context:\n${context}\n\nInterview transcript:\n${transcript || "(no conversation yet - just polish what is already there)"}`,
    },
  ];

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: resolveTextModel(model),
      messages,
      response_format: { type: "json_object" },
      max_tokens: 500,
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI draft request failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

// Same interview/draft dance as interviewTurn/draftFromInterview above,
// generalized to whatever else can be ghostwritten - the story's intro/
// outro, or one info card's summary - via `kind`. Kept as its own pair of
// functions rather than folded into the ones above: their context and
// response shapes differ enough (a whole-trip overview vs. one place's
// facts; {text} or {summary} instead of {narrative, pullQuote}) that a
// single mega-function would need just as much per-kind branching, only
// harder to follow.
const GHOSTWRITER_PROMPTS = {
  intro: {
    interview: `You are a warm, perceptive ghostwriter helping someone turn their travel photos into a vivid, personal story. You are interviewing them to write the OPENING of their whole trip story - the introduction a reader sees before any of the individual stops.

Ask short, specific, warm follow-up questions about the trip as a whole: why they went, who was with them, what they were hoping for or nervous about, how the trip came together, the mood setting off. Reference the actual places they visited (listed in the context) to make questions concrete. Ask at most 2-3 questions per turn. Be conversational and curious, never a form or a checklist. Keep your own messages brief. Never write the introduction for them in this conversation - only ask questions. If they seem to be repeating themselves or say they are done, acknowledge it warmly and suggest they click "Draft rewrite" instead of asking more questions.`,
    draft: (context, transcript, language) =>
      "You are the same ghostwriter. Using the context and interview transcript below, write a polished, " +
      "vivid opening (1-2 short paragraphs, first person) for this trip's story - the introduction a reader " +
      `sees before any of the stops, setting the scene for the trip as a whole. ${GHOSTWRITER_VOICE_RULES}` +
      `${languageInstruction(language)} (Keep the JSON field name in English; only the text itself should be ` +
      `in the requested language.)\n\nRespond as JSON: {"text": string}\n\nContext:\n${context}\n\nInterview ` +
      `transcript:\n${transcript}`,
  },
  outro: {
    interview: `You are the same warm, perceptive ghostwriter, now interviewing them to write the CLOSING reflection of their trip story - what a reader sees after all the stops.

Ask short, specific, warm follow-up questions about how the trip ended and what it left them with: a favorite memory in hindsight, something that surprised them, how it felt heading home, what they'd tell a friend thinking of doing something similar, anything they'd do differently. Reference the actual places they visited to make questions concrete. Ask at most 2-3 questions per turn. Be conversational and curious, never a form or a checklist. Keep your own messages brief. Never write the closing text for them in this conversation - only ask questions. If they seem to be repeating themselves or say they are done, acknowledge it warmly and suggest they click "Draft rewrite" instead of asking more questions.`,
    draft: (context, transcript, language) =>
      "You are the same ghostwriter. Using the context and interview transcript below, write a polished, " +
      "vivid closing reflection (1-2 short paragraphs, first person) for this trip's story - what a reader " +
      `sees after all the stops. ${GHOSTWRITER_VOICE_RULES}${languageInstruction(language)} (Keep the JSON ` +
      `field name in English; only the text itself should be in the requested language.)\n\nRespond as JSON: ` +
      `{"text": string}\n\nContext:\n${context}\n\nInterview transcript:\n${transcript}`,
  },
  infoCard: {
    interview: `You are a warm, perceptive ghostwriter. Someone has an info card about a specific place from their trip - factual background research (what kind of place it is, a few verified facts) - but its summary is still generic, tour-guide prose. You're interviewing them to turn it into a personal account of what THIS place meant to them or to their journey.

Ask short, specific, warm follow-up questions: why they went there, what they actually did or noticed, a specific moment, how it connected to the rest of the trip, whether it lived up to (or defied) expectations. Reference the place's own facts/subtitle (in the context) to ground your questions. Ask at most 2-3 questions per turn. Be conversational and curious, never a form or a checklist. Keep your own messages brief. Never write the summary for them in this conversation - only ask questions. If they seem to be repeating themselves or say they are done, acknowledge it warmly and suggest they click "Draft rewrite" instead of asking more questions.`,
    draft: (context, transcript, language) =>
      "You are the same ghostwriter. Using the context and interview transcript below, rewrite ONLY this " +
      "place's summary as a personal 2-4 sentence account (first person) of what it meant to them or their " +
      "journey - grounded in the real facts already gathered (never invent new facts), but no longer generic " +
      `tour-guide prose. ${GHOSTWRITER_VOICE_RULES}${languageInstruction(language)} (Keep the JSON field name ` +
      `in English; only the text itself should be in the requested language.)\n\nRespond as JSON: ` +
      `{"summary": string}\n\nContext:\n${context}\n\nInterview transcript:\n${transcript}`,
  },
};

function transcriptOf(history) {
  const lines = history.map((m) => `${m.role === "user" ? "Traveler" : "Ghostwriter"}: ${m.content}`).join("\n");
  return lines || "(no conversation yet - just polish what is already there)";
}

export async function ghostwriterTurn({ kind, context, history, language, model }) {
  const prompt = GHOSTWRITER_PROMPTS[kind];
  if (!prompt) throw new Error(`Unknown ghostwriter kind: ${kind}`);
  const messages = [
    { role: "system", content: `${prompt.interview}${languageInstruction(language)}\n\nContext:\n${context}` },
    ...history,
  ];
  if (history.length === 0) {
    messages.push({ role: "user", content: "Let's start - ask me your first questions." });
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: resolveTextModel(model), messages, max_tokens: 220 }),
  });
  if (!res.ok) throw new Error(`OpenAI interview request failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

export async function ghostwriterDraft({ kind, context, history, language, model }) {
  const prompt = GHOSTWRITER_PROMPTS[kind];
  if (!prompt) throw new Error(`Unknown ghostwriter kind: ${kind}`);
  const messages = [{ role: "user", content: prompt.draft(context, transcriptOf(history), language) }];

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: resolveTextModel(model),
      messages,
      response_format: { type: "json_object" },
      max_tokens: 500,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI draft request failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

// Trip-level context for the intro/outro ghostwriter - title, overall date
// range, and the stop headings as a quick itinerary overview, so its
// interview questions can reference actual places instead of speaking in
// the abstract. `text`/`textLabel` describe whichever of intro/outro is
// currently being written.
export function describeTripContext({ title, stops, text, textLabel }) {
  const dated = (stops || []).filter((s) => s.startedAt);
  const range = dated.length
    ? `${new Date(dated[0].startedAt).toLocaleDateString()} – ${new Date(
        dated[dated.length - 1].endedAt || dated[dated.length - 1].startedAt
      ).toLocaleDateString()}`
    : null;
  const headings = (stops || []).map((s) => s.heading).filter(Boolean);
  return [
    `Trip: "${title}"${range ? ` (${range})` : ""}.`,
    headings.length ? `Stops visited, in order: ${headings.join(", ")}.` : null,
    `Existing ${textLabel}: ${text ? `"${text}"` : "(nothing written yet)"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// Context for the info-card personalization ghostwriter: the card's own
// research (so questions can reference real facts, e.g. "you mentioned this
// place was founded in 1850 - what drew you to visit?"), plus the stop's
// own narrative if there is one, for a little more of the trip's own voice
// to draw on.
export function describeInfoCardContext({ card, stopHeading, stopNarrative }) {
  const facts = (card.facts || []).filter((f) => f.label || f.value);
  return [
    `Place: "${card.placeName}"${card.subtitle ? ` - ${card.subtitle}` : ""}.`,
    stopHeading ? `Part of the trip's stop: "${stopHeading}".` : null,
    facts.length ? `Known facts: ${facts.map((f) => `${f.label}: ${f.value}`).join("; ")}.` : null,
    `Current summary: ${card.summary ? `"${card.summary}"` : "(nothing written yet)"}`,
    stopNarrative ? `What the traveler already wrote about this stop overall: "${stopNarrative}"` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function organizeNotesIntoStory({ storyTitle, stops, notesText, language, model }) {
  const stopList = stops
    .map(
      (s, i) =>
        `${i + 1}. id="${s.id}" - "${s.heading}"${s.dateRange ? ` (${s.dateRange})` : ""}\n` +
        `   Places actually photographed here (often more specific than the heading above - ` +
        `prefer these for matching a place name mentioned in the notes): ${
          s.placeNames?.length ? s.placeNames.join(", ") : "(none known)"
        }\n` +
        `   Existing narrative: ${s.narrative ? `"${s.narrative}"` : "(none yet)"}\n` +
        `   Photo captions: ${s.captions.length ? s.captions.map((c) => `"${c}"`).join(", ") : "(none)"}`
    )
    .join("\n");

  const messages = [
    {
      role: "system",
      content:
        "You are a ghostwriter helping someone turn their own long-form travel notes into the narrative " +
        "text for specific stops in a photo-story app. You're given the stops of a trip, in chronological " +
        "order, and the traveler's raw notes (which may cover the whole trip, ramble, jump around, or only " +
        "describe some of the stops). Your job: figure out which parts of the notes belong to which stop " +
        "(match by place names - a stop's photographed-places list is more reliable than its heading for " +
        "this - plus described activities and chronological order), then rewrite each matched " +
        `portion into a polished 1-2 paragraph first-person narrative for that stop. ${GHOSTWRITER_VOICE_RULES} ` +
        "Only produce a suggestion for a stop when the notes actually say something about it - do not " +
        "invent content for stops the notes don't cover, and do not force every stop to get a suggestion. " +
        "If a stop already has a narrative and the notes add to it, write a richer combined version rather " +
        "than contradicting what's already there. Suggest a short pull-quote sentence for a stop only if " +
        `something in the notes genuinely fits as one.${languageInstruction(language)} The notes themselves ` +
        "may be in any language - translate as needed. (Keep the JSON field names in English; only the " +
        "narrative/pullQuote text should be in the requested language.)\n\n" +
        'Respond as JSON: {"suggestions": [{"stopId": string, "narrative": string, "pullQuote": string|null}]}',
    },
    {
      role: "user",
      content: `Trip: "${storyTitle}"\n\nStops:\n${stopList}\n\nTraveler's notes:\n${notesText}`,
    },
  ];

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: resolveTextModel(model),
      messages,
      response_format: { type: "json_object" },
      max_tokens: Math.min(4000, 400 * stops.length + 600),
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI notes-import request failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  const parsed = JSON.parse(data.choices[0].message.content);
  return Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
}
