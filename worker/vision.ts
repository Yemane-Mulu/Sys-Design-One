// Cloudflare Worker: vision proxy for the System Surveyor import.
//
// The app is a static SPA — it has nowhere safe to keep an OpenRouter
// key. This Worker holds the key as a Cloudflare secret
// (OPENROUTER_API_KEY) and forwards one request: a rendered page image
// in, the labels + legend counts out.
//
// The model does NOT classify drops or decide anything — it only reads
// what is printed on the plan. The user assigns the device type for
// each label in the review popup, and the counts are checked against
// the legend there.

export interface VisionEnv {
  OPENROUTER_API_KEY: string;
  /** Optional model override, e.g. "anthropic/claude-sonnet-4.5". */
  VISION_MODEL?: string;
}

const DEFAULT_MODEL = "google/gemini-2.5-flash";
const ALLOWED_MODELS = new Set([
  "google/gemini-2.5-flash",
  "anthropic/claude-sonnet-4.5",
]);

const DEVICE_TYPES = ["Cam", "AP", "POS", "Speaker", "Tablet", "Office", "ATM"] as const;

export interface VisionLabel {
  text: string;
  /** Fractions of the image, origin top-left. */
  x: number;
  y: number;
}

export interface VisionKeyEntry {
  type: string;
  name: string;
  count: number | null;
}

export interface VisionResult {
  labels: VisionLabel[];
  key: VisionKeyEntry[];
  model: string;
}

const SYSTEM_PROMPT = `You read a single-page low-voltage floor plan (a System Surveyor layout export). Your job is to read what is printed on the plan and return it as JSON. Nothing more.

Rules:
- Find EVERY text label on the plan: device labels (e.g. FCAM-001, FSPST-001, WAP-002) AND jack labels (e.g. NJCK-022, LKPD-002). List each label once, exactly as printed. Do not merge labels, do not invent labels, and do not guess a label you cannot read — skip it.
- For each label give its position as fractions of the image: x from the left edge (0-1), y from the top edge (0-1).
- Read the legend / key on the plan. For each legend entry, map it to one of these device types: Cam, AP, POS, Speaker, Tablet, Office, ATM, and give the count the legend states for that type. If the legend states no count, use null. If a legend entry does not match any of the seven types, skip it.
- Return JSON only, no other text:
{"labels": [{"text": "FCAM-001", "x": 0.42, "y": 0.31}], "key": [{"type": "Cam", "name": "Fixed Camera", "count": 12}]}`;

/** Validate the model's JSON into a VisionResult. Throws on anything
 *  that is not a well-formed result — the caller turns that into a 502. */
export function parseVisionResponse(content: unknown, model: string): VisionResult {
  if (typeof content !== "string") throw new Error("not a string");
  let text = content.trim();
  // Some models wrap JSON in a markdown fence even when told not to.
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/i.exec(text);
  if (fence) text = fence[1].trim();
  const data: unknown = JSON.parse(text);
  if (!data || typeof data !== "object") throw new Error("not an object");
  const d = data as Record<string, unknown>;

  const labels: VisionLabel[] = [];
  if (!Array.isArray(d.labels)) throw new Error("labels missing");
  for (const raw of d.labels.slice(0, 500)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const labelText = typeof r.text === "string" ? r.text.trim() : "";
    const x = typeof r.x === "number" && isFinite(r.x) ? Math.min(1, Math.max(0, r.x)) : NaN;
    const y = typeof r.y === "number" && isFinite(r.y) ? Math.min(1, Math.max(0, r.y)) : NaN;
    if (!labelText || labelText.length > 40 || !isFinite(x) || !isFinite(y)) continue;
    labels.push({ text: labelText, x, y });
  }

  const key: VisionKeyEntry[] = [];
  if (Array.isArray(d.key)) {
    for (const raw of d.key) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      const type = typeof r.type === "string" ? r.type : "";
      const name = typeof r.name === "string" ? r.name.trim() : "";
      const count =
        typeof r.count === "number" && isFinite(r.count) && r.count >= 0
          ? Math.floor(r.count)
          : null;
      if (!(DEVICE_TYPES as readonly string[]).includes(type) || !name) continue;
      key.push({ type, name, count });
    }
  }

  return { labels, key, model };
}

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: VisionEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/api/surveyor-vision") {
      return json({ error: "not found" }, 404);
    }
    if (!env.OPENROUTER_API_KEY) {
      return json(
        {
          error:
            "Vision is not set up yet — add the OpenRouter key in Cloudflare (Workers & Pages → sys-design-one → Settings → Variables → OPENROUTER_API_KEY).",
        },
        500,
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "expected a JSON body" }, 400);
    }
    const b = (body ?? {}) as Record<string, unknown>;
    const image = typeof b.image === "string" ? b.image : "";
    if (!image.startsWith("data:image/")) {
      return json({ error: "expected image as a data URL" }, 400);
    }
    // ~10 MB of base64 — a rendered plan page is a few hundred KB.
    if (image.length > 14_000_000) {
      return json({ error: "image too large" }, 413);
    }
    const requested = typeof b.model === "string" ? b.model : "";
    const configured = env.VISION_MODEL ?? "";
    const model = ALLOWED_MODELS.has(requested)
      ? requested
      : ALLOWED_MODELS.has(configured)
        ? configured
        : DEFAULT_MODEL;

    let upstream: Response;
    try {
      upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
          "HTTP-Referer": "https://meetlayerone.com",
          "X-Title": "DesignOne System Designer",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                { type: "image_url", image_url: { url: image } },
                { type: "text", text: "List every label on this plan, and read the legend." },
              ],
            },
          ],
          response_format: { type: "json_object" },
          max_tokens: 4000,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(45_000),
      });
    } catch {
      return json({ error: "the vision request timed out — try again" }, 504);
    }
    if (!upstream.ok) {
      return json({ error: `the vision provider returned ${upstream.status}` }, 502);
    }
    let data: unknown;
    try {
      data = await upstream.json();
    } catch {
      return json({ error: "the vision provider returned an unreadable response" }, 502);
    }
    const content = (data as { choices?: { message?: { content?: unknown } }[] })
      ?.choices?.[0]?.message?.content;
    try {
      return json(parseVisionResponse(content, model), 200);
    } catch {
      return json({ error: "the model returned an unreadable result — try again" }, 502);
    }
  },
};
