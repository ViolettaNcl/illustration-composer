// Builds public/library/manifest.json from the extraction report plus
// hand-written semantic metadata (titles, keywords, metaphors).
// Usage: node tools/build-manifest.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const report = JSON.parse(readFileSync(join(root, 'tools/extract-report.json'), 'utf8'));

// Semantic layer. Keywords are Russian word stems + English words; they feed the
// offline metaphor matcher and are also sent to the LLM as the catalogue description.
const OBJECTS = {
  book: {
    title: 'Книга', titleEn: 'Open book',
    keywords: ['книг', 'чтени', 'читат', 'учеб', 'учит', 'обучени', 'образован', 'знани', 'истори', 'сказк', 'литератур', 'библиотек', 'дневник', 'запис', 'курс', 'школ', 'универ', 'студент', 'теори', 'инструкц', 'гайд', 'руководств', 'правил', 'book', 'read', 'learn', 'study', 'knowledge', 'education', 'guide'],
    meaning: 'знания, обучение, чтение, история, руководство',
    weight: 1.0,
  },
  phone: {
    title: 'Смартфон', titleEn: 'Smartphone',
    keywords: ['телефон', 'смартфон', 'мобил', 'приложени', 'звон', 'связ', 'сообщен', 'чат', 'уведомл', 'онлайн', 'интернет', 'цифр', 'соцсет', 'смс', 'push', 'app', 'phone', 'mobile', 'online', 'digital', 'message', 'call'],
    meaning: 'мобильное приложение, связь, онлайн, уведомления, цифровой сервис',
    weight: 0.9,
  },
  puzzle: {
    title: 'Пазл', titleEn: 'Puzzle pieces',
    keywords: ['пазл', 'головолом', 'решени', 'задач', 'команд', 'сотруднич', 'партн', 'интеграц', 'совмест', 'соедин', 'объедин', 'связк', 'стратег', 'логик', 'элемент', 'част', 'недостающ', 'match', 'puzzle', 'solution', 'team', 'partner', 'integration', 'fit'],
    meaning: 'решение задачи, командная работа, партнёрство, интеграция, недостающий элемент',
    weight: 0.7,
  },
  coin: {
    title: 'Монета', titleEn: 'Coin',
    keywords: ['монет', 'деньг', 'денеж', 'оплат', 'плат', 'цен', 'стоимост', 'кэшбэк', 'кешбэк', 'бонус', 'балл', 'скидк', 'выгод', 'инвест', 'доход', 'прибыл', 'накоп', 'сбереж', 'копил', 'финанс', 'безопасн', 'защит', 'замок', 'надёжн', 'надежн', 'coin', 'money', 'pay', 'price', 'cashback', 'bonus', 'saving', 'secure'],
    meaning: 'деньги, оплата, бонусы, накопления, защищённые средства (на монете замок)',
    weight: 0.45,
  },
  headphones: {
    title: 'Наушники', titleEn: 'Headphones',
    keywords: ['наушник', 'музык', 'звук', 'слуша', 'аудио', 'подкаст', 'плейлист', 'песн', 'мелоди', 'вебинар', 'лекци', 'созвон', 'поддержк', 'колл-центр', 'оператор', 'отдых', 'концентрац', 'фокус', 'тишин', 'music', 'audio', 'listen', 'podcast', 'sound', 'support', 'focus'],
    meaning: 'музыка, подкасты, аудио, поддержка, концентрация',
    weight: 0.85,
  },
  lamp: {
    title: 'Настольная лампа', titleEn: 'Desk lamp',
    keywords: ['ламп', 'свет', 'освещ', 'иде', 'озарен', 'вдохновен', 'ночь', 'ночн', 'вечер', 'рабоч', 'стол', 'офис', 'кабинет', 'фокус', 'внимани', 'подсказк', 'совет', 'креатив', 'lamp', 'light', 'idea', 'night', 'workplace', 'desk', 'insight', 'tip'],
    meaning: 'идея, озарение, рабочее место, вечерняя работа, фокус внимания',
    weight: 0.95,
  },
  flowers: {
    title: 'Тюльпаны в вазе', titleEn: 'Tulips in a vase',
    keywords: ['цвет', 'тюльпан', 'ваз', 'букет', 'праздник', 'подар', 'поздрав', 'весн', '8 март', 'март', 'красот', 'забот', 'уют', 'дом', 'благодар', 'спасибо', 'любов', 'настроени', 'рост', 'расцвет', 'жизн', 'flower', 'tulip', 'gift', 'holiday', 'spring', 'care', 'thanks', 'growth', 'cozy'],
    meaning: 'праздник, подарок, забота, благодарность, весна, уют, рост',
    weight: 0.75,
  },
  wallet: {
    title: 'Кошелёк', titleEn: 'Wallet',
    keywords: ['кошел', 'бумажник', 'деньг', 'финанс', 'бюджет', 'расход', 'трат', 'покупк', 'карт', 'банк', 'счёт', 'счет', 'оплат', 'плат', 'перевод', 'кэшбэк', 'кешбэк', 'сбереж', 'накоп', 'зарплат', 'кредит', 'wallet', 'money', 'budget', 'bank', 'card', 'payment', 'finance', 'spend'],
    meaning: 'личные финансы, бюджет, банк, оплата, покупки',
    weight: 0.7,
  },
  folder: {
    title: 'Папка с документами', titleEn: 'Document folder',
    keywords: ['папк', 'документ', 'файл', 'архив', 'бумаг', 'договор', 'отчёт', 'отчет', 'оформлен', 'справк', 'заявк', 'анкет', 'хранени', 'данн', 'бухгалтер', 'налог', 'юрид', 'порядок', 'организац', 'бюрократ', 'folder', 'document', 'file', 'archive', 'report', 'paperwork', 'data', 'contract'],
    meaning: 'документы, договоры, отчётность, архив, оформление',
    weight: 0.9,
  },
  pen: {
    title: 'Ручка', titleEn: 'Pen',
    keywords: ['ручк', 'пис', 'подпис', 'заметк', 'запис', 'конспект', 'текст', 'автор', 'редакт', 'черновик', 'план', 'анкет', 'заполн', 'договор', 'тест', 'экзамен', 'домашн', 'pen', 'write', 'sign', 'note', 'draft', 'plan', 'form', 'exam'],
    meaning: 'письмо, подпись, заметки, заполнение форм, план',
    weight: 0.4,
  },
};

const objects = Object.entries(OBJECTS).map(([id, meta]) => {
  const variants = {};
  for (const r of report.filter((r) => r.object === id)) {
    variants[`${r.kind}_${r.size}`] = { file: r.file, w: r.w, h: r.h, paths: r.paths };
  }
  return { id, ...meta, variants };
});

const manifest = {
  version: 1,
  description: 'Component library extracted from the source Figma sheets (tools/source). Colours in the files are the canonical "violet" scheme; see palettes.json for role mapping.',
  // Visual size of S relative to L in source units (S sheet is drawn at ~1/2 scale).
  sizes: {
    L: { title: 'L — детальная', note: 'Крупные иллюстрации, полная детализация' },
    S: { title: 'S — упрощённая', note: 'Мелкие иллюстрации, меньше деталей' },
  },
  objects,
};
writeFileSync(join(root, 'public/library/manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`manifest: ${objects.length} objects, ${objects.reduce((n, o) => n + Object.keys(o.variants).length, 0)} variants`);
