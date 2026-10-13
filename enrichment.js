const LANGUAGE_ALIASES = {
  eng: 'en', en: 'en', fre: 'fr', fra: 'fr', fr: 'fr', spa: 'es', es: 'es',
  ger: 'de', deu: 'de', de: 'de', ita: 'it', it: 'it', por: 'pt', pt: 'pt',
  dut: 'nl', nld: 'nl', nl: 'nl', pol: 'pl', pl: 'pl', rus: 'ru', ru: 'ru',
};

const encoder = new TextEncoder();

export function cleanDescription(value = '') {
  const text = String(value)
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
  return isTrustworthyDescription(text) ? text : '';
}

export function isTrustworthyDescription(text = '') {
  const value = String(text).trim();
  if (value.length < 45) return false;
  return ![
    /no description available/i,
    /description (?:de l['’]éditeur|not available)/i,
    /this book was (?:digitized|scanned)/i,
    /digitized by google/i,
    /search inside this book/i,
    /^(?:unknown|sans description|résumé indisponible)[.!]?$/i,
  ].some((pattern) => pattern.test(value));
}

export function inferCategories(subjects = [], title = '', description = '') {
  const values = [...subjects, title, description]
    .map((value) => typeof value === 'string' ? value : value?.name || '')
    .filter(Boolean)
    .join(' · ');
  const rules = [
    ['Dark romance', /dark romance|romance sombre|mafia romance|romantic suspense|enemies[ -]to[ -]lovers/i],
    ['Romance', /romance|love stor(?:y|ies)|histoire d['’]amour|sentimental|romantic fiction/i],
    ['Fantasy', /fantasy|high fantasy|urban fantasy|romantasy|fantastique|sorcery|wizard|magic(?:al)?/i],
    ['Thriller', /thriller|psychological suspense|suspense psychologique/i],
    ['Policier', /mystery|detective|crime fiction|policier|roman noir|enquête/i],
    ['Manga', /manga|shōnen|shonen|shōjo|shojo|seinen|josei/i],
    ['BD & comics', /comic(?: book)?|graphic novel|bande dessinée/i],
    ['Science-fiction', /science fiction|sci[ -]?fi|dystopi|space opera|cyberpunk/i],
    ['Aventure & action', /adventure|action fiction|aventur/i],
    ['Young adult', /young adult|new adult|teen fiction|adolescent/i],
    ['Jeunesse', /juvenile|children(?:'s)?|jeunesse|enfant/i],
    ['Histoire', /history|historical fiction|histoire|world war|guerre mondiale/i],
    ['Biographie', /biograph|memoir|autobiograph|mémoires/i],
    ['Développement personnel', /self[ -]?help|personal development|développement personnel|bien-être/i],
    ['Cuisine', /cooking|cookbook|livre de recettes|cuisine|gastronom/i],
    ['Voyage', /travel|voyage|tourism/i],
    ['Poésie', /poetry|poésie/i],
    ['Essai', /essay|philosophy|politic|social science|essai/i],
  ];
  return rules.filter(([, pattern]) => pattern.test(values)).map(([label]) => label).slice(0, 6);
}

function sourceLanguage(language = '') {
  const code = String(language).toLowerCase().split(/[-_/]/)[0];
  return LANGUAGE_ALIASES[code] || '';
}

function limitTextByBytes(text, maxBytes = 4200) {
  if (encoder.encode(text).length <= maxBytes) return text;
  const words = String(text).split(/\s+/);
  let limited = '';
  for (const word of words) {
    const candidate = limited ? `${limited} ${word}` : word;
    if (encoder.encode(`${candidate} …`).length > maxBytes) break;
    limited = candidate;
  }
  return `${limited.trim()} …`;
}

function splitForTranslation(text, maxBytes = 450, maxChunks = 10) {
  const limitedText = limitTextByBytes(String(text));
  const sentences = limitedText.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) || [limitedText];
  const chunks = [];
  let current = '';
  const push = () => {
    if (current.trim() && chunks.length < maxChunks) chunks.push(current.trim());
    current = '';
  };

  for (const sentence of sentences) {
    const words = sentence.trim().split(/\s+/);
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (encoder.encode(candidate).length <= maxBytes) {
        current = candidate;
      } else {
        push();
        if (chunks.length >= maxChunks) return chunks;
        current = word;
      }
    }
    if (encoder.encode(current).length > maxBytes * 0.72) push();
    if (chunks.length >= maxChunks) return chunks;
  }
  push();
  return chunks;
}

async function translateChunk(chunk, language) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);
  try {
    const params = new URLSearchParams({ q: chunk, langpair: `${language}|fr` });
    const response = await fetch(`https://api.mymemory.translated.net/get?${params}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const translated = String(payload.responseData?.translatedText || '').trim();
    if (!translated || Number(payload.responseStatus || 200) >= 400 || /QUERY LENGTH LIMIT|MYMEMORY WARNING/i.test(translated)) {
      throw new Error('Traduction indisponible');
    }
    return translated;
  } finally {
    clearTimeout(timeout);
  }
}

export async function translateDescriptionToFrench(text, language) {
  const original = cleanDescription(text);
  const source = sourceLanguage(language);
  if (!original || !source || source === 'fr') return { text: original, translated: false };
  const chunks = splitForTranslation(original);
  if (!chunks.length) return { text: original, translated: false };
  try {
    const translated = await Promise.all(chunks.map((chunk) => translateChunk(chunk, source)));
    const textInFrench = cleanDescription(translated.join(' '));
    return textInFrench ? { text: textInFrench, translated: true } : { text: original, translated: false };
  } catch {
    return { text: original, translated: false };
  }
}
