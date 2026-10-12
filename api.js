
const TIMEOUT_MS = 9000;
const CACHE_DAYS = 7;
const CACHE_PREFIX = 'mb-metadata-v2-';
const GOOGLE_COOLDOWN = 30 * 60 * 1000;

let googleBlockedUntil = 0;
let nextOpenLibraryRequest = 0;

// ---------- Outils communs ----------

function cleanIsbn(value) {
  return String(value || '').toUpperCase()
    .replace(/[^0-9X]/g, '');
}

function isbn10To13(value) {
  if (!/^\d{9}[\dX]$/.test(value)) return '';
  const base = '978' + value.slice(0, 9);
  const sum = [...base].reduce(
    (s, n, i) => s + Number(n) * (i % 2 ? 3 : 1), 0
  );
  return base + ((10 - sum % 10) % 10);
}

function sameIsbn(a, b) {
  const x = cleanIsbn(a);
  const y = cleanIsbn(b);
  return x === y || (x.length === 10 && isbn10To13(x) === y)
    || (y.length === 10 && isbn10To13(y) === x);
}

function asText(value) {
  if (typeof value === 'object' && value !== null) {
    value = value.value || '';
  }
  const doc = new DOMParser().parseFromString(
    String(value || ''), 'text/html'
  );
  return (doc.body.textContent || '')
    .replace(/\s+/g, ' ').trim();
}

function emptyBook(isbn, source = '') {
  return {
    isbn, title: '', authors: [], description: '',
    categories: [], cover: '', publishedDate: '',
    pageCount: '', publisher: '', language: '', source
  };
}

function coverFromId(id) {
  return Number(id) > 0
    ? `https://covers.openlibrary.org/b/id/${id}-L.jpg`
    : '';
}

function errorMessage(error) {
  if (error.name === 'AbortError') {
    return 'Délai dépassé';
  }
  if (error instanceof TypeError) {
    return 'Connexion refusée, réseau ou restriction CORS';
  }
  return error.message || 'Erreur inconnue';
}

async function request(url, format = 'json') {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(), TIMEOUT_MS
  );

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store'
    });

    if (!response.ok) {
      const error = new Error(
        response.status === 404
          ? 'Notice non trouvée (404)'
          : response.status === 429
            ? 'Trop de requêtes (429)'
            : `Erreur HTTP ${response.status}`
      );
      error.status = response.status;
      throw error;
    }

    if (format === 'xml') {
      const content = await response.text();
      const xml = new DOMParser().parseFromString(
        content, 'application/xml'
      );
      if (xml.querySelector('parsererror')) {
        throw new Error('Réponse XML invalide');
      }
      return xml;
    }

    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Délai de réponse dépassé');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// Limite les appels Open Library à environ 1 par seconde
async function openLibraryRequest(url) {
  const wait = Math.max(
    0, nextOpenLibraryRequest - Date.now()
  );
  nextOpenLibraryRequest =
    Date.now() + wait + 1100;

  if (wait) {
    await new Promise(resolve => setTimeout(resolve, wait));
  }

  return request(url);
}

function xmlValues(node, localName) {
  return [...node.getElementsByTagNameNS('*', localName)]
    .map(item => item.textContent.trim())
    .filter(Boolean);
}

function firstXml(node, localName) {
  return xmlValues(node, localName)[0] || '';
}

function mergeBooks(primary, fallback) {
  if (!primary?.title) return fallback || primary;
  if (!fallback?.title) return primary;

  const result = { ...primary };

  for (const key of [
    'title', 'description', 'cover', 'publishedDate',
    'pageCount', 'publisher', 'language'
  ]) {
    if (!result[key]) result[key] = fallback[key] || '';
  }

  if (!result.authors?.length) {
    result.authors = fallback.authors || [];
  }

  result.categories = [...new Set([
    ...(primary.categories || []),
    ...(fallback.categories || [])
  ])].slice(0, 5);

  if (!result.source.includes(fallback.source)) {
    result.source += ' + ' + fallback.source;
  }

  return result;
}

function isComplete(book) {
  return Boolean(
    book?.title &&
    book.authors?.length &&
    book.description &&
    book.cover &&
    book.categories?.length
  );
}

// ---------- Source 1 : Open Library ----------

async function lookupOpenLibrary(isbn) {
  let edition = null;
  let search = null;

  try {
    edition = await openLibraryRequest(
      `https://openlibrary.org/isbn/${isbn}.json`
    );
  } catch (error) {
    if (error.status === 429) throw error;
  }

  const params = new URLSearchParams({
    isbn,
    limit: '3',
    fields: 'key,title,author_name,first_publish_year,cover_i,subject,isbn'
  });

  try {
    const data = await openLibraryRequest(
      `https://openlibrary.org/search.json?${params}`
    );
    search = (data.docs || []).find(
      item => (item.isbn || []).some(id => sameIsbn(id, isbn))
    ) || null;
  } catch (error) {
    if (!edition?.title) throw error;
  }

  let work = null;
  const workKey = edition?.works?.[0]?.key || search?.key;

  if (workKey && /^\/works\/OL\d+W$/.test(workKey)) {
    try {
      work = await openLibraryRequest(
        `https://openlibrary.org${workKey}.json`
      );
    } catch {
      // La fiche d'édition reste utilisable
    }
  }

  const book = emptyBook(isbn, 'Open Library');

  book.title =
    edition?.title || search?.title || work?.title || '';
  book.authors = search?.author_name || [];
  book.description =
    asText(edition?.description) ||
    asText(work?.description);
  book.categories = normaliseCategories([
    ...(edition?.subjects || []),
    ...(search?.subject || []),
    ...(work?.subjects || [])
  ]);
  book.cover = coverFromId(
    edition?.covers?.find(id => id > 0) ||
    search?.cover_i ||
    work?.covers?.find(id => id > 0)
  );
  book.publishedDate =
    edition?.publish_date ||
    work?.first_publish_date ||
    String(search?.first_publish_year || '');
  book.pageCount =
    edition?.number_of_pages || edition?.pagination || '';
  book.publisher = edition?.publishers?.[0] || '';
  book.language =
    edition?.languages?.[0]?.key?.split('/').pop() || '';

  if (!book.title) {
    throw new Error('ISBN non répertorié');
  }

  return book;
}

// ---------- Source 2 : Inventaire ----------

function translatedLabel(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  const item = value.fr || value.en ||
    Object.values(value).find(Boolean);
  return typeof item === 'string' ? item : '';
}

async function lookupInventaire(isbn) {
  const uri = `isbn:${isbn}`;
  const params = new URLSearchParams({
    action: 'by-uris',
    uris: uri
  });

  const data = await request(
    `https://inventaire.io/api/entities?${params}`
  );

  const entity = data.entities?.[uri];

  if (!entity) {
    throw new Error('Aucune entité ISBN');
  }

  const claims = entity.claims || {};
  const rawTitle = claims['wdt:P1476']?.[0];

  const title =
    (typeof rawTitle === 'string' ? rawTitle : '') ||
    translatedLabel(entity.labels) ||
    entity.label || '';

  if (!title) {
    throw new Error('Notice sans titre');
  }

  const book = emptyBook(isbn, 'Inventaire');
  book.title = title;

  const date = claims['wdt:P577']?.[0];
  if (typeof date === 'string') {
    book.publishedDate = date;
  }

  // Les références Wikidata des auteurs ne sont
  // pas utilisées comme des noms d'auteurs.
  return book;
}

// ---------- Source 3 : Bibliothèque nationale de France ----------

async function lookupBnF(isbn) {
  const params = new URLSearchParams({
    version: '1.2',
    operation: 'searchRetrieve',
    query: `bib.isbn all "${isbn}"`,
    recordSchema: 'dc',
    maximumRecords: '3'
  });

  const xml = await request(
    `https://catalogue.bnf.fr/api/SRU?${params}`,
    'xml'
  );

  const records = [
    ...xml.getElementsByTagNameNS('*', 'recordData')
  ];

  if (!records.length) {
    throw new Error('Aucune notice BnF');
  }

  const record = records[0];
  const book = emptyBook(isbn, 'BnF');

  book.title = firstXml(record, 'title');
  book.authors = xmlValues(record, 'creator');
  book.description = firstXml(record, 'description');
  book.categories = normaliseCategories(
    xmlValues(record, 'subject')
  );
  book.publishedDate = firstXml(record, 'date');
  book.publisher = firstXml(record, 'publisher');
  book.language = firstXml(record, 'language');

  if (!book.title) {
    throw new Error('Notice BnF sans titre');
  }

  return book;
}

// ---------- Source 4 : Google Books ----------

async function lookupGoogleBooks(isbn, apiKey = '') {
  if (Date.now() < googleBlockedUntil) {
    throw new Error('Quota Google temporairement épuisé');
  }

  const params = new URLSearchParams({
    q: `isbn:${isbn}`,
    maxResults: '5',
    printType: 'books'
  });

  if (apiKey) params.set('key', apiKey);

  let data;

  try {
    data = await request(
      `https://www.googleapis.com/books/v1/volumes?${params}`
    );
  } catch (error) {
    if (error.status === 429) {
      googleBlockedUntil =
        Date.now() + GOOGLE_COOLDOWN;
    }
    throw error;
  }

  const item = (data.items || []).find(candidate =>
    (candidate.volumeInfo?.industryIdentifiers || [])
      .some(id => sameIsbn(id.identifier, isbn))
  );

  if (!item) {
    throw new Error('Aucune édition avec cet ISBN');
  }

  const info = item.volumeInfo || {};
  const book = emptyBook(isbn, 'Google Books');

  book.title = info.title || '';
  book.authors = info.authors || [];
  book.description = asText(info.description);
  book.categories = normaliseCategories(
    info.categories || []
  );
  book.cover = (
    info.imageLinks?.thumbnail ||
    info.imageLinks?.smallThumbnail ||
    ''
  ).replace(/^http:/, 'https:');
  book.publishedDate = info.publishedDate || '';
  book.pageCount = info.pageCount || '';
  book.publisher = info.publisher || '';
  book.language = info.language || '';

  if (!book.title) {
    throw new Error('Notice Google Books incomplète');
  }

  return book;
}

// ---------- Source 5 : Crossref ----------

async function lookupCrossref(isbn) {
  const params = new URLSearchParams({
    filter: `isbn:${isbn}`,
    rows: '5'
  });

  const data = await request(
    `https://api.crossref.org/works?${params}`
  );

  const item = (data.message?.items || []).find(work =>
    (work.ISBN || []).some(id => sameIsbn(id, isbn))
  );

  if (!item) {
    throw new Error('Aucune publication avec cet ISBN');
  }

  const book = emptyBook(isbn, 'Crossref');

  book.title = item.title?.[0] || '';
  book.authors = (item.author || []).map(a =>
    [a.given, a.family].filter(Boolean).join(' ')
  ).filter(Boolean);
  book.description = asText(item.abstract);
  book.categories = normaliseCategories(
    item.subject || []
  );
  book.publisher = item.publisher || '';
  book.publishedDate = (
    item.published?.['date-parts']?.[0] || []
  ).join('-');
  book.language = item.language || '';

  if (!book.title) {
    throw new Error('Publication sans titre');
  }

  return book;
}

// ---------- Source 6 : Bibliothèque du Japon ----------

async function lookupJapan(isbn) {
  const params = new URLSearchParams({
    operation: 'searchRetrieve',
    query: `isbn="${isbn}"`,
    maximumRecords: '3'
  });

  const xml = await request(
    `https://ndlsearch.ndl.go.jp/api/sru?${params}`,
    'xml'
  );

  const records = [
    ...xml.getElementsByTagNameNS('*', 'recordData')
  ];

  if (!records.length) {
    throw new Error('Aucune notice japonaise');
  }

  const record = records[0];
  const book = emptyBook(isbn, 'NDL Japon');

  book.title = firstXml(record, 'title');
  book.authors = xmlValues(record, 'creator');
  book.description = firstXml(record, 'description');
  book.categories = normaliseCategories(
    xmlValues(record, 'subject')
  );
  book.publishedDate = firstXml(record, 'date');
  book.publisher = firstXml(record, 'publisher');
  book.language = firstXml(record, 'language');

  if (!book.title) {
    throw new Error('Notice NDL sans titre');
  }

  return book;
}

// ---------- Classement automatique ----------

export function normaliseCategories(subjects) {
  const rules = [
    ['Romance', /romance|love stories|amour|sentimental|new adult/i],
    ['Dark romance', /dark romance|romantic suspense/i],
    ['Policier & thriller', /thriller|mystery|detective|crime|policier|suspense/i],
    ['Fantasy', /fantasy|magic|wizard|sorcery|high fantasy/i],
    ['Fantastique', /fantastique|supernatural|paranormal/i],
    ['Science-fiction', /science fiction|sci.fi|dystopi|space opera/i],
    ['Aventure & action', /adventure|action|aventur/i],
    ['Histoire', /history|historical|histoire|world war/i],
    ['Biographie', /biograph|memoir|autobiograph/i],
    ['Jeunesse', /juvenile|children|young adult|jeunesse|enfant/i],
    ['BD & manga', /comic|graphic novel|manga|bande dessinée|manhwa/i],
    ['Développement personnel', /self.help|personal development|bien.être/i],
    ['Psychologie', /psychology|psychologie|psychoanalysis/i],
    ['Cuisine', /cooking|cookbook|food|cuisine|gastronom/i],
    ['Voyage', /travel|voyage|tourism/i],
    ['Poésie', /poetry|poésie/i],
    ['Philosophie', /philosophy|philosophie/i],
    ['Science & technique', /engineering|technology|computer science|physics|chemistry|science|informatique/i],
    ['Médecine & santé', /medicine|medical|nursing|health|médecine/i],
    ['Horreur', /horror|épouvante|terreur/i],
    ['Humour', /humour|humor|comedy/i],
    ['Religion & spiritualité', /religion|spiritual|theology/i],
    ['Art & photographie', /art history|photography|photographie|painting/i],
    ['Économie & société', /economics|sociology|politics|économie/i],
    ['Éducation', /education|teaching|pédagogie/i]
  ];

  const categories = [];

  for (const subject of subjects || []) {
    const value = typeof subject === 'string'
      ? subject : subject?.name || '';

    for (const [name, pattern] of rules) {
      if (
        pattern.test(value) &&
        !categories.includes(name)
      ) {
        categories.push(name);
      }
    }
  }

  return categories.slice(0, 5);
}

// ---------- Cache de recherche ----------

function cachedBook(isbn) {
  try {
    const raw = localStorage.getItem(
      CACHE_PREFIX + isbn
    );
    if (!raw) return null;

    const entry = JSON.parse(raw);

    if (
      Date.now() - entry.savedAt >
      CACHE_DAYS * 86400000
    ) {
      localStorage.removeItem(CACHE_PREFIX + isbn);
      return null;
    }

    return entry.book?.title ? entry.book : null;
  } catch {
    return null;
  }
}

function saveBookCache(isbn, book) {
  if (!book?.title) return;

  try {
    localStorage.setItem(
      CACHE_PREFIX + isbn,
      JSON.stringify({
        savedAt: Date.now(),
        book
      })
    );
  } catch {
    // Un stockage plein n'empêche pas la recherche.
  }
}

// ---------- Moteur principal ----------

export async function lookupBook(isbn, googleApiKey = '') {
  const code = cleanIsbn(isbn);
  const cached = cachedBook(code);

  if (cached) {
    return { ...cached, warnings: [] };
  }

  const errors = [];
  let result = null;

  async function searchGroup(sources) {
    const findings = await Promise.all(
      sources.map(async ([name, lookup]) => {
        try {
          return await lookup();
        } catch (error) {
          errors.push(`${name} : ${errorMessage(error)}`);
          return null;
        }
      })
    );

    for (const book of findings) {
      if (book?.title) {
        result = mergeBooks(result, book);
      }
    }
  }

  // Priorité aux catalogues internationaux.
  await searchGroup([
    ['Open Library', () => lookupOpenLibrary(code)],
    ['Inventaire', () => lookupInventaire(code)]
  ]);

  // Compléments et éditions françaises.
  if (!isComplete(result)) {
    await searchGroup([
      ['BnF', () => lookupBnF(code)],
      ['Google Books', () => lookupGoogleBooks(
        code, googleApiKey
      )]
    ]);
  }

  // Dernier recours : publications savantes et japonaises.
  if (!result?.title) {
    await searchGroup([
      ['Crossref', () => lookupCrossref(code)],
      ['NDL Japon', () => lookupJapan(code)]
    ]);
  }

  if (result?.title) {
    result.warnings = errors;
    saveBookCache(code, result);

    if (errors.length) {
      console.info(
        'Sources indisponibles ou sans résultat :',
        errors
      );
    }

    return result;
  }

  console.warn(
    `Aucun catalogue n'a identifié l'ISBN ${code}`,
    errors
  );

  return {
    ...emptyBook(
      code,
      'Saisie manuelle — aucun titre trouvé. ' +
      errors.join(' ; ').slice(0, 250)
    ),
    warnings: errors
  };
}
