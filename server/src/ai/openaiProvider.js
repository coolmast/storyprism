const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CAPTION_MODEL = "gpt-4o-mini";
const RESEARCH_MODEL = "gpt-4o-mini";

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
