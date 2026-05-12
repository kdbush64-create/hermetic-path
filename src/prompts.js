// ∴ The Hermetic Path — Claude prompt builder ∴
//
// Builds the system + user prompts that the Worker sends to Anthropic.
// Adjust prompt copy here — no client redeploy required.

const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-20250514";

function baseSystem({ tradition, depth }) {
  const today = new Date().toISOString().slice(0, 10);
  return `You are the inner voice of "The Hermetic Path," a private esoteric study companion.
You write with the gravity, precision, and warmth of a master of the mysteries addressing a sincere initiate.
You draw from: the Seven Hermetic Principles (Kybalion), the Corpus Hermeticum, Kabbalistic tradition (Tree of Life, Sefirot, PaRDeS, gematria, Zohar, Sefer Yetzirah), Masonic symbolism, Christian mysticism (Gospel of John, Origen, the Church Fathers), first-century Jewish mysticism (Merkabah, Hekhalot, the Dead Sea Scrolls — especially 11Q13), Neoplatonism (Plotinus, Iamblichus, Porphyry), Sufi mysticism (Ibn Arabi, Rumi, fana, tajalliyat), alchemical symbolism, and sacred geometry.
Tradition emphasis for this session: ${tradition}. Depth: ${depth}. Today: ${today}.
House style: Reverent, lucid, never saccharine. Avoid New Age clichés. Cross-reference traditions naturally. When relevant, integrate Hebrew/Greek terms with transliteration and gematria. Format using clean Markdown (## headings, *italics for sacred terms*, > blockquotes for invocations). Never moralize. Never claim certainty about contested matters — present them as the tradition presents them.`;
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function buildPrompt(feature, params = {}, settings = {}) {
  const tradition = (settings.tradition || "Blended").trim();
  const depth = (settings.depth || "Intermediate Initiate").trim();
  const system = baseSystem({ tradition, depth });

  switch (feature) {
    case "tutor": {
      const principle = params.principle || "the day's principle of your choosing from the Seven Hermetic Principles";
      return {
        system,
        max_tokens: 1800,
        user: `Compose today's deep-dive lesson on **${principle}**.

Include in this order:
1. A brief invocation framing the day.
2. **The Principle** — its statement, its source, what it actually means.
3. **As Above, So Below** — cross-references across Hermetic / Kabbalistic / Masonic / Christian mystical / Sufi / Neoplatonic traditions.
4. **First-Century Context** — how this principle was understood in Alexandria, in the mystery schools, in the world of Jesus and the Hekhalot mystics.
5. **A Gematria Insight** (where relevant) — one Hebrew or Greek word/number that opens the principle further.
6. **Contemplation Question** — a single question to sit with through the day.
7. A one-line closing invocation.

Avoid being formulaic from day to day — every lesson should feel newly written.`,
      };
    }

    case "affirmation": {
      const count = clampInt(params.count, 1, 5, 3);
      return {
        system,
        max_tokens: 600,
        user: `Generate ${count} affirmation(s) rooted in actual esoteric principles (not generic positivity).
Each should be 1–2 sentences, first-person, and reference a real Hermetic, Kabbalistic, or mystical concept (gematria, a Sefirah, a principle, a sacred name).
Return them as a Markdown numbered list. No preamble.`,
      };
    }

    case "guided_meditation": {
      const minutes = clampInt(params.minutes, 5, 30, 10);
      const theme = params.theme || "today's Hermetic principle";
      return {
        system,
        max_tokens: 1800,
        user: `Compose a guided text meditation of approximately ${minutes} minutes, built around **${theme}**.
Structure:
1. **Opening breath work** — a specific pattern (e.g., 4-7-8, square breath).
2. **Symbolic visualization** — enter a sacred space or hold a specific symbol in the mind's eye.
3. **Contemplation of the principle at depth** — paragraphs the practitioner reads slowly.
4. **Closing and grounding** — return to the body, the room, the breath.

Pace it so that read aloud at a steady cadence it lasts the requested time. Use *italic stage directions* sparingly.`,
      };
    }

    case "symbol_meditation": {
      const symbol = params.symbol || "the All-Seeing Eye";
      return {
        system,
        max_tokens: 1200,
        user: `Compose a seed-thought meditation on **${symbol}** in the classical Hermetic tradition.
The goal: hold the symbol in mind and let its meaning unfold — not analyze it intellectually.
Layer its meaning: visual description, historical lineage across traditions, numerical/letter associations, what it points toward beyond itself.
End with a single seed-phrase to carry through the day.`,
      };
    }

    case "gematria_meditation": {
      const seed = params.seed || "Echad (אחד)";
      return {
        system,
        max_tokens: 1100,
        user: `Compose a gematria contemplation on **${seed}**.
Include: its numerical value, three or more related words/phrases of equal value (with their transliterations and meanings), the esoteric significance of the number itself, and a contemplative meditation transforming the calculation into an experiential practice.`,
      };
    }

    case "scripture_pardes": {
      const passage = params.passage || "John 1:1";
      return {
        system,
        max_tokens: 2200,
        user: `Provide a four-layer PaRDeS interpretation of **${passage}**.

Use these four headings exactly:
## פ Peshat — The Literal
## ר Remez — The Allegorical
## ד Derash — The Moral / Practical
## ס Sod — The Hidden / Mystical

After the four layers, include a **Cross-References** section with: parallel Hermetic concepts, Kabbalistic Sefirot connections, Masonic symbolism (where relevant), first-century Jewish mystical context (Merkabah, Dead Sea Scrolls if relevant), and gematria of key Hebrew/Greek terms in the passage.`,
      };
    }

    case "symbol_library": {
      const symbol = params.symbol || "The Square and Compass";
      return {
        system,
        max_tokens: 1400,
        user: `Write a symbol library entry for **${symbol}**.
Include: name and etymology, visual description, historical usage across traditions, numerical/gematria significance (where applicable), cross-tradition appearances, and a contemplation prompt.
Format as Markdown with bolded subheadings on a single line each.`,
      };
    }

    case "gematria_calc": {
      const word = (params.word || "").trim();
      if (!word) {
        return {
          system,
          max_tokens: 80,
          user: "Reply only with: Please provide a Hebrew or Greek word or phrase to calculate.",
        };
      }
      return {
        system,
        max_tokens: 1100,
        user: `For the word/phrase **${word}**, provide:
1. Its standard gematria value (Hebrew Mispar Hechrachi or Greek isopsephy as appropriate).
2. A list of other notable words and phrases of equal value, each briefly translated.
3. The esoteric significance of the number itself.
4. Cross-tradition appearances of the number (Scripture, Kabbalah, Hermetic texts).
5. A 3–4 sentence meditation on the word's numerical identity.

If the input cannot be parsed, offer the most likely interpretation and proceed.`,
      };
    }

    case "notification": {
      const kind = params.kind || "mixed";
      const length = params.length || "short";
      return {
        system,
        max_tokens: 250,
        user: `Generate a single ${length === "short" ? "one-line" : "2–3 sentence"} daily transmission of type **${kind}** (principle / affirmation / gematria insight / symbol meaning / scripture / mixed). No preamble, no surrounding quotation marks — return only the transmission text itself.`,
      };
    }

    case "lockscreen_quote": {
      return {
        system,
        max_tokens: 220,
        user: `Generate today's lock-screen transmission: a single luminous line (max ~22 words) from the Hermetic / Kabbalistic / mystical tradition. Original phrasing in the spirit of the source — not a verbatim copyrighted quote. Return only the line. No quotation marks, no attribution.`,
      };
    }

    default:
      return null;
  }
}

/**
 * Call Anthropic and return { content, model, usage }.
 */
export async function callClaude(env, prompt) {
  const body = {
    model: DEFAULT_MODEL,
    max_tokens: prompt.max_tokens ?? 1400,
    system: prompt.system,
    messages: [{ role: "user", content: prompt.user }],
  };

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const err = new Error(`Anthropic API error (${res.status})`);
    err.status = res.status;
    err.detail = detail;
    throw err;
  }

  const data = await res.json();
  const text = Array.isArray(data?.content)
    ? data.content.filter((b) => b?.type === "text").map((b) => b.text).join("\n\n")
    : "";
  return { content: text, model: data?.model ?? DEFAULT_MODEL, usage: data?.usage ?? null };
}
