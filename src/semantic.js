// Scenario 1 (offline): metaphor / headline → set of objects.
// Scenario 2: list of component names → set of objects.
//
// The offline matcher works on Russian word stems and English words from the manifest
// keywords. It is deterministic and needs no network; when an Anthropic API key is set,
// ai.js is tried first and this module is the fallback.

// Objects that "go together" — used to complete a composition when the headline names
// only one or two things, and to pick monochrome background objects.
const RELATED = {
  book: ['pen', 'lamp', 'folder', 'flowers'],
  phone: ['headphones', 'wallet', 'puzzle', 'coin'],
  puzzle: ['phone', 'book', 'folder'],
  coin: ['wallet', 'phone', 'folder'],
  headphones: ['phone', 'flowers', 'book'],
  lamp: ['book', 'pen', 'folder'],
  flowers: ['book', 'headphones', 'lamp'],
  wallet: ['coin', 'phone', 'folder'],
  folder: ['pen', 'lamp', 'wallet'],
  pen: ['book', 'folder', 'lamp'],
};

export function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/[^a-zа-я0-9-]+/i)
    .filter((w) => w.length >= 2);
}

function stemMatch(token, kw) {
  kw = kw.replace(/ё/g, 'е');
  if (kw.length <= 3) return token === kw || (token.startsWith(kw) && token.length <= kw.length + 3);
  return token.startsWith(kw);
}

export function scoreObjects(text, objects) {
  const toks = tokenize(text);
  const low = text.toLowerCase().replace(/ё/g, 'е');
  return objects
    .map((o) => {
      const hits = new Set();
      let score = 0;
      for (const kw of o.keywords || []) {
        if (kw.includes(' ')) {
          if (low.includes(kw)) { score += 1.5; hits.add(kw); }
          continue;
        }
        for (const t of toks) if (stemMatch(t, kw)) { score += 1; hits.add(t); }
      }
      // direct naming of the object weighs more than an association
      for (const t of toks) {
        const title = (o.title || '').toLowerCase().replace(/ё/g, 'е');
        if (title.split(/\s+/).some((w) => w.length > 3 && t.startsWith(w.slice(0, Math.max(4, w.length - 2))))) score += 1.5;
      }
      return { id: o.id, score, hits: [...hits] };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

/**
 * @returns {{items:{object,kind}[], explanation:string, source:'offline'}}
 */
export function fromMetaphor(text, library, { background = 'auto', maxMain = 3 } = {}) {
  const ranked = scoreObjects(text, library.objects.filter((o) => !o.custom || o.keywords?.length));
  const main = [];
  const why = [];
  for (const r of ranked) {
    if (main.length >= maxMain) break;
    main.push(r.id);
    why.push(`${library.get(r.id).title} ← «${r.hits.slice(0, 3).join(', ')}»`);
  }
  let fallback = false;
  if (!main.length) {
    fallback = true;
    main.push('book', 'lamp', 'pen');
  }
  // Complete to 3 main objects with associated ones: the reference compositions use
  // 2–4 main objects, and a pair of small objects (coin + pen) reads as an empty frame.
  for (const id of [...main]) {
    for (const rel of RELATED[id] || []) if (!main.includes(rel) && main.length < Math.min(3, maxMain)) main.push(rel);
  }
  const direct = new Set(ranked.slice(0, maxMain).map((r) => r.id));
  const assoc = main.filter((id) => !direct.has(id));
  const items = main.map((object) => ({ object, kind: 'main' }));

  if (background !== 'none') {
    const pool = [];
    for (const id of main) for (const rel of RELATED[id] || []) if (!main.includes(rel) && !pool.includes(rel)) pool.push(rel);
    // second-tier semantic matches become background objects first
    const secondTier = ranked.map((r) => r.id).filter((id) => !main.includes(id));
    const bgIds = [...secondTier, ...pool].filter((v, i, a) => a.indexOf(v) === i);
    const n = background === 'yes' ? 2 : main.length >= 3 ? 1 : 2;
    for (const id of bgIds.slice(0, n)) items.push({ object: id, kind: 'bg' });
  }

  return {
    items,
    source: 'offline',
    explanation: fallback
      ? 'Смысл не распознан словарём — собрана нейтральная сцена «рабочий стол». Попробуйте другие слова или подключите ИИ.'
      : `Подобрано по смыслу: ${why.join('; ')}.` + (assoc.length ? ` Дополнено по ассоциации: ${assoc.map((id) => library.get(id).title).join(', ')}.` : ''),
  };
}

// "книга, телефон, 2 монеты, фоновые наушники"
export function fromNames(text, library) {
  const parts = text.split(/[,;\n]+|\s+и\s+|\s*\+\s*/i).map((s) => s.trim()).filter(Boolean);
  const items = [];
  const unknown = [];
  for (const part of parts) {
    const toks = tokenize(part);
    const bg = toks.some((t) => t.startsWith('фон') || t === 'bg' || t === 'background' || t.startsWith('монохром'));
    const count = Math.min(5, parseInt(part.match(/\d+/)?.[0] || '1', 10) || 1);
    const rest = toks.filter((t) => !t.startsWith('фон') && !/^\d+$/.test(t) && t !== 'bg');
    const id = matchName(rest, library);
    if (!id) { unknown.push(part); continue; }
    for (let i = 0; i < count; i++) items.push({ object: id, kind: bg ? 'bg' : 'main' });
  }
  return { items, unknown };
}

const NAME_STEMS = {
  book: ['книг', 'книж', 'blok', 'book', 'блокнот', 'тетрад', 'ежедневник'],
  phone: ['телефон', 'смартфон', 'мобил', 'айфон', 'phone', 'smartphone'],
  puzzle: ['пазл', 'паз', 'головолом', 'puzzle'],
  coin: ['монет', 'coin', 'жетон'],
  headphones: ['наушник', 'headphone', 'гарнитур'],
  lamp: ['ламп', 'светильник', 'lamp'],
  flowers: ['цвет', 'тюльпан', 'ваз', 'букет', 'flower', 'tulip'],
  wallet: ['кошел', 'бумажник', 'wallet'],
  folder: ['папк', 'документ', 'folder'],
  pen: ['ручк', 'карандаш', 'pen'],
};

function matchName(toks, library) {
  for (const t of toks) {
    for (const [id, stems] of Object.entries(NAME_STEMS)) if (stems.some((s) => t.startsWith(s))) return id;
    for (const o of library.objects) if (o.id === t || (o.title || '').toLowerCase() === t) return o.id;
  }
  // last resort: semantic match
  const r = scoreObjects(toks.join(' '), library.objects);
  return r[0]?.id || null;
}
