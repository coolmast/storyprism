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
