const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CAPTION_MODEL = "gpt-4o-mini";
const RESEARCH_MODEL = "gpt-4o-mini";
const INTERVIEW_MODEL = "gpt-4o-mini";

async function fetchImageAsDataUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not fetch photo for captioning: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const mime = res.headers.get("content-type") || "image/jpeg";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

export async function draftCaption({ photoUrl, place, date, storyTitle }) {
  const dataUrl = await fetchImageAsDataUrl(photoUrl);

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CAPTION_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You write short, warm, specific photo captions for a family travel story. " +
            "One sentence. Describe what's actually visible, not generic travel filler. No hashtags, no quotes around the caption.",
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

export async function researchPlace({ place, storyTitle, dateRange }) {
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
        `Plain prose, no headings, no citations markup.`,
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

export async function generateInfoCard({ placeName, context }) {
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
        "specific prose (no travel-brochure language).\n\n" +
        'Respond with ONLY this JSON, no other text: {"subtitle": string, "summary": string, ' +
        '"facts": [{"label": string, "value": string}]}',
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI info card request failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  const parsed = extractJson(extractResponseText(data));
  return {
    subtitle: parsed.subtitle || "",
    summary: parsed.summary || "",
    facts: Array.isArray(parsed.facts) ? parsed.facts.slice(0, 6) : [],
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

export async function interviewTurn({ heading, dateRange, narrative, captions, research, history }) {
  const context = describeStopContext({ heading, dateRange, narrative, captions, research });
  const messages = [
    { role: "system", content: `${INTERVIEWER_SYSTEM_PROMPT}\n\nContext:\n${context}` },
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
    body: JSON.stringify({ model: INTERVIEW_MODEL, messages, max_tokens: 220 }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI interview request failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

export async function draftFromInterview({ heading, narrative, captions, research, history }) {
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
        "and emotional details the traveler actually shared. Write like a specific person telling a friend " +
        'about their trip, not a travel brochure: avoid stock phrases ("heart swelled", "wrapped around us ' +
        'like an embrace", "little did we know", "we couldn\'t believe our eyes"). Prefer plain, concrete ' +
        "detail over generic sensory adjectives - name the actual thing, sound, or feeling they described " +
        "rather than reaching for a simile. Short sentences are fine. Also suggest one short, striking " +
        "pull-quote sentence drawn from or inspired by the conversation, or null if nothing in the " +
        'conversation fits well as a pull quote.\n\nRespond as JSON: {"narrative": string, "pullQuote": string|null}',
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
      model: INTERVIEW_MODEL,
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

const GHOSTWRITER_VOICE_RULES =
  'Write like a specific person telling a friend about their trip, not a travel brochure: avoid stock ' +
  'phrases ("heart swelled", "wrapped around us like an embrace", "little did we know", "we couldn\'t ' +
  'believe our eyes"). Prefer plain, concrete detail over generic sensory adjectives - name the actual ' +
  "thing, sound, or feeling rather than reaching for a simile. Short sentences are fine.";

export async function organizeNotesIntoStory({ storyTitle, stops, notesText }) {
  const stopList = stops
    .map(
      (s, i) =>
        `${i + 1}. id="${s.id}" - "${s.heading}"${s.dateRange ? ` (${s.dateRange})` : ""}\n` +
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
        "(match by place names, described activities, and chronological order), then rewrite each matched " +
        `portion into a polished 1-2 paragraph first-person narrative for that stop. ${GHOSTWRITER_VOICE_RULES} ` +
        "Only produce a suggestion for a stop when the notes actually say something about it - do not " +
        "invent content for stops the notes don't cover, and do not force every stop to get a suggestion. " +
        "If a stop already has a narrative and the notes add to it, write a richer combined version rather " +
        "than contradicting what's already there. Suggest a short pull-quote sentence for a stop only if " +
        "something in the notes genuinely fits as one.\n\n" +
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
      model: INTERVIEW_MODEL,
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
