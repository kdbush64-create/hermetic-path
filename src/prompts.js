// ∴ The Hermetic Path — Prompts + AI router ∴
//
// The Worker calls `generate(env, feature, params, settings, ctx)` and gets
// back { content, model, usage, provider }. This module decides which AI
// provider to use and shapes the prompt appropriately for that provider.
//
// Provider preference:
//   1. If env.ANTHROPIC_API_KEY is present → use Claude (premium).
//   2. Else → use Cloudflare Workers AI (free tier; Llama 3.3 70B).
//
// For the Daily Tutor feature, prompts are scaffolded by the 365-day
// curriculum spine in curriculum.json — the LLM is told the day's section,
// topic, focus, and prior-day references and asked to write the lesson.

import curriculum from "./curriculum.json";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const CLAUDE_MODEL = "claude-sonnet-4-20250514";
const CF_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export async function generate(env, feature, params = {}, settings = {}, ctx = {}) {
  const built = buildPrompt(feature, params, settings, ctx);
  if (!built) throw httpError(400, `Unknown feature: ${feature}`);

  if (env.ANTHROPIC_API_KEY) return callClaude(env, built);
  if (env.AI) return callWorkersAI(env, built);
  throw httpError(500, "No AI provider configured. Bind AI in wrangler.toml or set ANTHROPIC_API_KEY.");
}

export function getCurriculum() {
  return curriculum;
}

export function curriculumDay(day) {
  if (!Number.isFinite(day) || day < 1 || day > curriculum.total_days) return null;
  return curriculum.days[day - 1] || null;
}

// ---------------------------------------------------------------------------
// Base persona / house voice
// ---------------------------------------------------------------------------

function baseSystem({ tradition, depth }) {
  const today = new Date().toISOString().slice(0, 10);
  return [
    `You are the inner voice of "The Hermetic Path," a private esoteric study companion.`,
    `Write with the gravity, precision, and warmth of a master of the mysteries addressing a sincere initiate.`,
    `Draw from: the Seven Hermetic Principles (Kybalion), the Corpus Hermeticum, Kabbalistic tradition (Tree of Life, Sefirot, PaRDeS, gematria, Zohar, Sefer Yetzirah), Masonic symbolism, Christian mysticism (Gospel of John, Origen, the Church Fathers), first-century Jewish mysticism (Merkabah, Hekhalot, the Dead Sea Scrolls — especially 11Q13), Neoplatonism (Plotinus, Iamblichus, Porphyry), Sufi mysticism (Ibn Arabi, Rumi, fana, tajalliyat), alchemical symbolism, and sacred geometry.`,
    `Tradition emphasis for this session: ${tradition}. Depth: ${depth}. Today: ${today}.`,
    `House style: Reverent, lucid, never saccharine. Avoid New Age clichés. Cross-reference traditions naturally. When relevant, integrate Hebrew/Greek terms with transliteration and gematria. Format using clean Markdown (## headings, *italics for sacred terms*, > blockquotes for invocations). Never moralize. Never claim certainty about contested matters — present them as the tradition presents them.`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Prompt builder per feature
// ---------------------------------------------------------------------------

export function buildPrompt(feature, params, settings, ctx = {}) {
  const tradition = (settings.tradition || "Blended").trim();
  const depth = (settings.depth || "Intermediate Initiate").trim();
  const system = baseSystem({ tradition, depth });

  switch (feature) {
    case "tutor": {
      const day = Number(params.day || ctx.currentDay || 0);
      const entry = day ? curriculumDay(day) : null;

      if (entry) {
        const priorRefs = entry.prior_refs && entry.prior_refs.length
          ? entry.prior_refs.slice(-6).map(d => {
              const r = curriculumDay(d);
              return r ? `Day ${d}: ${r.topic}` : null;
            }).filter(Boolean)
          : [];

        const user = [
          `Today is **Day ${entry.day}** of the year-long curriculum.`,
          ``,
          `**Section:** ${entry.section}`,
          `**Week topic:** ${entry.weekTopic}`,
          entry.principleMotto ? `**Principle motto:** ${entry.principleMotto}` : null,
          `**Today's topic:** ${entry.topic}`,
          `**Today's focus:** ${entry.focus}`,
          ``,
          priorRefs.length ? `**Prior lessons to weave in if natural:**\n- ${priorRefs.join("\n- ")}` : null,
          ``,
          `**Contemplation seed (to close with):** ${entry.seed}`,
          ``,
          `Compose the lesson for today. Include in this order:`,
          `1. A brief invocation framing the day (1–2 sentences).`,
          `2. **The Heart of Today** — the central teaching, written so a sincere novice can grasp it but an adept will hear deeper layers.`,
          `3. **As Above, So Below** — cross-references to related traditions where natural.`,
          `4. **Gematria or Word Study** when relevant — one Hebrew or Greek term, with transliteration and meaning.`,
          `5. **Contemplation Question** — the seed above, expanded into a question to carry through the day.`,
          `6. **Closing Invocation** — one line.`,
          ``,
          `Avoid being formulaic from day to day; let the texture of the topic dictate the texture of the prose. Aim for 400–700 words.`,
        ].filter(Boolean).join("\n");

        return { system, user, max_tokens: 1800 };
      }

      const principle = params.principle || "the day's principle of your choosing from the Seven Hermetic Principles";
      return {
        system,
        max_tokens: 1600,
        user: `Compose today's deep-dive lesson on **${principle}**.\n\nInclude an invocation, the principle, cross-tradition references, a gematria insight when relevant, a contemplation question, and a one-line closing invocation. 400–700 words.`,
      };
    }

    case "affirmation": {
      const count = clampInt(params.count, 1, 5, 3);
      return {
        system,
        max_tokens: 500,
        user: `Generate ${count} affirmation(s) rooted in actual esoteric principles (not generic positivity). Each is 1–2 sentences, first-person, and references a real Hermetic, Kabbalistic, or mystical concept (gematria, a Sefirah, a principle, a sacred name). Return them as a Markdown numbered list. No preamble.`,
      };
    }

    case "guided_meditation": {
      const minutes = clampInt(params.minutes, 5, 30, 10);
      const theme = params.theme || "today's Hermetic principle";
      return {
        system,
        max_tokens: 1500,
        user: `Compose a guided text meditation of approximately ${minutes} minutes, built around **${theme}**.\nStructure:\n1. **Opening breath work** — a specific pattern (e.g., 4-7-8, square breath).\n2. **Symbolic visualization** — enter a sacred space or hold a specific symbol in the mind's eye.\n3. **Contemplation of the principle at depth** — paragraphs the practitioner reads slowly.\n4. **Closing and grounding** — return to the body, the room, the breath.\n\nPace so that read aloud at a steady cadence it lasts the requested time. Use *italic stage directions* sparingly.`,
      };
    }

    case "symbol_meditation": {
      const symbol = params.symbol || "the All-Seeing Eye";
      return {
        system,
        max_tokens: 1100,
        user: `Compose a seed-thought meditation on **${symbol}** in the classical Hermetic tradition. The goal: hold the symbol in mind and let its meaning unfold — not analyze it intellectually. Layer its meaning: visual description, historical lineage across traditions, numerical/letter associations, what it points toward beyond itself. End with a single seed-phrase to carry through the day.`,
      };
    }

    case "gematria_meditation": {
      const seed = params.seed || "Echad (אחד)";
      return {
        system,
        max_tokens: 1000,
        user: `Compose a gematria contemplation on **${seed}**. Include: its numerical value, three or more related words/phrases of equal value (with their transliterations and meanings), the esoteric significance of the number itself, and a contemplative meditation transforming the calculation into an experiential practice.`,
      };
    }

    case "scripture_pardes": {
      const passage = params.passage || "John 1:1";
      return {
        system,
        max_tokens: 1900,
        user: `Provide a four-layer PaRDeS interpretation of **${passage}**.\n\nUse these four headings exactly:\n## פ Peshat — The Literal\n## ר Remez — The Allegorical\n## ד Derash — The Moral / Practical\n## ס Sod — The Hidden / Mystical\n\nAfter the four layers, include a **Cross-References** section with: parallel Hermetic concepts, Kabbalistic Sefirot connections, Masonic symbolism (where relevant), first-century Jewish mystical context (Merkabah, Dead Sea Scrolls if relevant), and gematria of key Hebrew/Greek terms.`,
      };
    }

    case "symbol_library": {
      const symbol = params.symbol || "The Square and Compass";
      return {
        system,
        max_tokens: 1300,
        user: `Write a symbol library entry for **${symbol}**. Include: name and etymology, visual description, historical usage across traditions, numerical/gematria significance (where applicable), cross-tradition appearances, and a contemplation prompt. Format as Markdown with bolded subheadings on a single line each.`,
      };
    }

    case "gematria_calc": {
      const word = (params.word || "").trim();
      if (!word) return { system, max_tokens: 80, user: "Reply only with: Please provide a Hebrew or Greek word or phrase to calculate." };
      return {
        system,
        max_tokens: 1000,
        user: `For the word/phrase **${word}**, provide:\n1. Its standard gematria value (Hebrew Mispar Hechrachi or Greek isopsephy as appropriate).\n2. A list of other notable words and phrases of equal value, each briefly translated.\n3. The esoteric significance of the number itself.\n4. Cross-tradition appearances of the number (Scripture, Kabbalah, Hermetic texts).\n5. A 3–4 sentence meditation on the word's numerical identity.`,
      };
    }

    case "notification": {
      const kind = params.kind || "mixed";
      const length = params.length || "short";
      return {
        system,
        max_tokens: 220,
        user: `Generate a single ${length === "short" ? "one-line" : "2–3 sentence"} daily transmission of type **${kind}**. No preamble, no surrounding quotation marks — return only the transmission text itself.`,
      };
    }

    case "lockscreen_quote": {
      return {
        system,
        max_tokens: 200,
        user: `Generate today's lock-screen transmission: a single luminous line (max ~22 words) from the Hermetic / Kabbalistic / mystical tradition. Original phrasing in the spirit of the source — not a verbatim copyrighted quote. Return only the line. No quotation marks, no attribution.`,
      };
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

async function callClaude(env, prompt) {
  const body = {
    model: CLAUDE_MODEL,
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
    throw httpError(res.status, `Anthropic API error (${res.status})`, detail);
  }
  const data = await res.json();
  const text = Array.isArray(data?.content)
    ? data.content.filter((b) => b?.type === "text").map((b) => b.text).join("\n\n")
    : "";
  return { content: text, model: data?.model ?? CLAUDE_MODEL, usage: data?.usage ?? null, provider: "anthropic" };
}

async function callWorkersAI(env, prompt) {
  const messages = [
    { role: "system", content: prompt.system },
    { role: "user", content: prompt.user },
  ];
  let result;
  try {
    result = await env.AI.run(CF_AI_MODEL, { messages, max_tokens: prompt.max_tokens ?? 1400 });
  } catch (err) {
    throw httpError(502, `Workers AI error: ${err?.message || String(err)}`);
  }
  const text = (result?.response ?? result?.result?.response ?? "").trim();
  return { content: text, model: CF_AI_MODEL, usage: null, provider: "workers-ai" };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function httpError(status, message, detail = null) {
  const err = new Error(message);
  err.status = status;
  err.detail = detail;
  return err;
}
