// Scenario 1 with an LLM: Claude reads the metaphor and picks objects from the
// catalogue. The model never generates graphics — it only returns ids that exist in
// the library (enforced by an enum in the JSON schema and re-validated here).
//
// The key is entered by the user in the UI and kept in localStorage of their browser;
// requests go straight from the browser to api.anthropic.com.


const KEY_STORE = 'ic.anthropicKey';
export const MODEL = 'claude-opus-5-5';

export function getKey() {
  try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; }
}
export function setKey(k) {
  try { k ? localStorage.setItem(KEY_STORE, k.trim()) : localStorage.removeItem(KEY_STORE); } catch { /* ignore */ }
}

export async function aiFromMetaphor(text, library, { background = 'auto' } = {}) {
  const apiKey = getKey();
  if (!apiKey) throw new Error('no-key');
  // loaded on demand: the SDK is only needed when a key is configured
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const catalogue = library.objects
    .filter((o) => !o.custom)
    .map((o) => `- ${o.id}: ${o.title} — ${o.meaning}`)
    .join('\n');
  const ids = library.objects.filter((o) => !o.custom).map((o) => o.id);

  const bgRule = {
    none: 'Do not use background objects (background = []).',
    yes: 'Use 1–2 background objects.',
    auto: 'Use 0–2 background objects only if they support the meaning or balance the scene.',
  }[background];

  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: {
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['main', 'background', 'reasoning'],
          properties: {
            main: { type: 'array', items: { type: 'string', enum: ids } },
            background: { type: 'array', items: { type: 'string', enum: ids } },
            reasoning: { type: 'string' },
          },
        },
      },
    },
    system:
      'You are an art director composing an isometric spot illustration from a FIXED library of objects. ' +
      'You never invent objects: you only choose ids from the catalogue. ' +
      'Pick 2–4 "main" objects (full colour) that best express the metaphor or headline, the most important first. ' +
      `${bgRule} Background objects are monochrome versions placed behind the main group; ` +
      'they must not repeat a main object. Reply in JSON; "reasoning" is one short sentence in Russian.\n\nCatalogue:\n' +
      catalogue,
    messages: [{ role: 'user', content: `Metaphor / headline: «${text}»` }],
  });

  if (response.stop_reason === 'refusal') throw new Error('Модель отказалась отвечать на этот запрос');
  const block = response.content.find((b) => b.type === 'text');
  if (!block) throw new Error('Пустой ответ модели');
  const data = JSON.parse(block.text);
  const main = [...new Set(data.main.filter((id) => library.get(id)))].slice(0, 4);
  const bg = [...new Set(data.background.filter((id) => library.get(id) && !main.includes(id)))].slice(0, 2);
  if (!main.length) throw new Error('Модель не выбрала объекты');
  return {
    items: [...main.map((object) => ({ object, kind: 'main' })), ...bg.map((object) => ({ object, kind: 'bg' }))],
    explanation: `ИИ (${response.model}): ${data.reasoning}`,
    source: 'ai',
  };
}
