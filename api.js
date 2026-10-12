
const TIMEOUT_MS = 10000;
const CACHE_PREFIX = 'mb-metadata-v3-';
const CACHE_TTL = 7 * 86400000;
const GOOGLE_PAUSE = 30 * 60000;

let googleBlockedUntil = 0;
let nextOpenLibraryRequest = 0;

// ---------- NETTOYAGE ----------

function cleanIsbn(value) {
  return String(value || '').toUpperCase()
    .replace(/[^0-9X]/g, '');
}

function isbn10To13(value) {
  if (!/^\d{9}[\dX]$/.test(value)) return '';
  const base = '978' + value.slice(0, 9);
  const sum = [...base].reduce(
    (total, digit, i) =>
      total + Number(digit) * (i % 2 ? 3 : 1), 0
  );
  return base + ((10 - sum % 10) % 10);
}

function sameIsbn(a, b) {
  const x = cleanIsbn(a);
  const y = cleanIsbn(b);
  return x === y ||
    (x.length === 10 && isbn10To13(x) === y) ||
    (y.length === 10 && isbn10To13(y) === x);
}

function plainText(value) {
  if (value && typeof value === 'object') {
    value = value.value || '';
  }
  const doc = new DOMParser().parseFromString(
    String(value || ''), 'text/html'
  );
  return (doc.body.textContent || '')
    .replace(/\s+/g, ' ').trim();
}

function cleanTitle(value) {
  const text = plainText(value);
  // Les notices BnF ajoutent parfois auteur et traducteur
  // après une barre oblique entourée d'espaces.
  return text.split(/\s+\/\s+/)[0].trim();
}

function cleanAuthor(value) {
  let text = plainText(value);
  text = text.replace(
    /\.\s*(Auteur(?:e)? du texte|Autrice du texte|Traducteur|Traductrice|Illustrateur|Illustratrice).*$/i,
    ''
  ).trim();

  // "Stewart, Kate" devient "Kate Stewart".
  const match = text.match(/^([^,]+),\s*([^,]+)$/);
  if (match) {
    text = `${match[2].trim()} ${match[1].trim()}`;
  }
  return text;
}

function cleanDescription(value) {
  const text = plainText(value);
  if (!text) return '';

  // Exclure les notes techniques des catalogues.
  if (/^(code à barres commercial|ean\b|isbn\b|identifiant commercial|numéro commercial)/i.test(text)) {
    return '';
  }
  if (/^\d{10,13}$/.test(text)) return '';

  return text;
}

function emptyBook(isbn, source = '') {
  return {
    isbn, title: '', authors: [], description: '',
    categories: [], cover: '', publishedDate: '',
    pageCount: '', publisher: '', language: '', source
  };
}

function errorMessage(error) {
  if (error.name === 'AbortError') {
    return 'Délai dépassé';
  }
  return error.message || 'Erreur inconnue';
}

// ---------- REQUÊTES ----------

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
        `HTTP ${response.status}`
      );
      error.status = response.status;
      throw error;
    }

    if (format === 'xml') {
      const xml = new DOMParser().parseFromString(
        await response.text(), 'application/xml'
      );
      if (xml.querySelector('parsererror')) {
        throw new Error('XML invalide');
      }
      return xml;
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function openLibraryRequest(url) {
  const wait = Math.max(
    0, nextOpenLibraryRequest - Date.now()
  );
  nextOpenLibraryRequest = Date.now() + wait + 1100;

  if (wait) {
    await new Promise(resolve => setTimeout(resolve, wait));
  }
  return request(url);
}

function xmlValues(node, name) {
  return [...node.getElementsByTagNameNS('*', name)]
    .map(item => item.textContent.trim())
    .filter(Boolean);
}

function firstXml(node, name) {
  return xmlValues(node, name)[0] || '';
}

// ---------- COUVERTURES ----------

function coverFromId(id) {
  return Number(id) > 0
    ? `https://covers.openlibrary.org/b/id/${id}-L.jpg?default=false`
    : '';
}

function imageExists(url) {
  return new Promise(resolve => {
    if (!url) return resolve(false);

    const img = new Image();
    let finished = false;

    const finish = ok => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      resolve(ok);
    };

    const timer = setTimeout(() => finish(false), 4500);

    img.onload = () => finish(
      img.naturalWidth >= 40 && img.naturalHeight >= 50
    );
    img.onerror = () => finish(false);
    img.src = url;
  });
}

async function findCover(isbn, existingCover = '') {
  const code13 = isbn.length === 10
    ? isbn10To13(isbn) : isbn;

  const candidates = [];

  // 1. Nouvelle API Couvertures de la BnF.
  if (/^\d{13}$/.test(code13)) {
    candidates.push(
      `https://openapi.bnf.fr/couverture/image/image/recupererImage?EAN=${code13}&couverture=1`
    );
  }

  // 2. Couverture exacte par ISBN chez Open Library.
  candidates.push(
    `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`
  );

  // 3. Couverture déjà obtenue d'un autre catalogue.
  if (existingCover) {
    candidates.push(existingCover);
  }

  const results = await Promise.all(
    candidates.map(url => imageExists(url))
  );

  const index = results.findIndex(Boolean);
  return index >= 0 ? candidates[index] : '';
}

// ---------- OPEN LIBRARY ----------

async function lookupOpenLibrary(isbn) {
  let edition = null;
  let search = null;

  try {
    edition = await openLibraryRequest(
      `https://openlibrary.org/isbn/${isbn}.json`
    );
  } catch {
    // L'édition n'est pas forcément présente.
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
    search = (data.docs || []).find(item =>
      (item.isbn || []).some(id => sameIsbn(id, isbn))
    ) || null;
  } catch {
    // On conserve la fiche d'édition si disponible.
  }

  let work = null;
  const key = edition?.works?.[0]?.key || search?.key;

  if (key && /^\/works\/OL\d+W$/.test(key)) {
    try {
      work = await openLibraryRequest(
        `https://openlibrary.org${key}.json`
      );
    } catch {}
  }

  const book = emptyBook(isbn, 'Open Library');
  book.title = cleanTitle(
    edition?.title || search?.title || work?.title
  );
  book.authors = (search?.author_name || [])
    .map(cleanAuthor).filter(Boolean);
  book.description = cleanDescription(
    edition?.description || work?.description
  );
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

  if (!book.title) throw new Error('Livre non trouvé');
  return book;
}

// ---------- INVENTAIRE ----------

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
  if (!entity) throw new Error('Aucune notice');

  const labels = entity.labels || {};
  const book = emptyBook(isbn, 'Inventaire');

  book.title = cleanTitle(
    labels.fr || labels.en ||
    Object.values(labels)[0] || ''
  );

  const date = entity.claims?.['wdt:P577']?.[0];
  if (typeof date === 'string') {
    book.publishedDate = date;
  }

  if (!book.title) throw new Error('Titre absent');
  return book;
}

// ---------- BNF ----------

async function lookupBnF(isbn) {
  const params = new URLSearchParams({
    version: '1.2',
    operation: 'searchRetrieve',
    query: `bib.isbn all "${isbn}"`,
    recordSchema: 'dublincore',
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

  book.title = cleanTitle(firstXml(record, 'title'));
  book.authors = xmlValues(record, 'creator')
    .map(cleanAuthor).filter(Boolean);

  // Ignorer les descriptions techniques, notamment l'EAN.
  book.description = xmlValues(record, 'description')
    .map(cleanDescription)
    .find(Boolean) || '';

  book.categories = normaliseCategories(
    xmlValues(record, 'subject')
  );

  book.publishedDate = firstXml(record, 'date');
  book.publisher = firstXml(record, 'publisher');
  book.language = firstXml(record, 'language');

  const formats = xmlValues(record, 'format').join(' ');
  const pages = formats.match(/\b(\d{2,5})\s*p(?:ages?)?\b/i);
  if (pages) book.pageCount = Number(pages[1]);

  if (!book.title) throw new Error('Titre absent');
  return book;
}

// ---------- GOOGLE BOOKS ----------

async function lookupGoogleBooks(isbn, apiKey = '') {
  if (Date.now() < googleBlockedUntil) {
    throw new Error('Google Books temporairement limité');
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
      googleBlockedUntil = Date.now() + GOOGLE_PAUSE;
    }
    throw error;
  }

  const item = (data.items || []).find(candidate =>
    (candidate.volumeInfo?.industryIdentifiers || [])
      .some(id => sameIsbn(id.identifier, isbn))
  );

  if (!item) throw new Error('Édition absente');

  const info = item.volumeInfo || {};
  const book = emptyBook(isbn, 'Google Books');

  book.title = cleanTitle(info.title);
  book.authors = (info.authors || [])
    .map(cleanAuthor).filter(Boolean);
  book.description = cleanDescription(info.description);
  book.categories = normaliseCategories(info.categories || []);
  book.cover = (
    info.imageLinks?.thumbnail ||
    info.imageLinks?.smallThumbnail || ''
  ).replace(/^http:/, 'https:');
  book.publishedDate = info.publishedDate || '';
  book.pageCount = info.pageCount || '';
  book.publisher = info.publisher || '';
  book.language = info.language || '';

  if (!book.title) throw new Error('Titre absent');
  return book;
}

// ---------- CROSSREF ----------

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

  if (!item) throw new Error('Publication absente');

  const book = emptyBook(isbn, 'Crossref');
  book.title = cleanTitle(item.title?.[0]);
  book.authors = (item.author || []).map(a =>
    [a.given, a.family].filter(Boolean).join(' ')
  ).filter(Boolean);
  book.description = cleanDescription(item.abstract);
  book.categories = normaliseCategories(item.subject || []);
  book.publisher = item.publisher || '';
  book.publishedDate = (
    item.published?.['date-parts']?.[0] || []
  ).join('-');
  book.language = item.language || '';

  if (!book.title) throw new Error('Titre absent');
  return book;
}

// ---------- BIBLIOTHÈQUE DU JAPON ----------

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

  if (!records.length) throw new Error('Notice absente');

  const record = records[0];
  const book = emptyBook(isbn, 'NDL Japon');

  book.title = cleanTitle(firstXml(record, 'title'));
  book.authors = xmlValues(record, 'creator')
    .map(cleanAuthor).filter(Boolean);
  book.description = xmlValues(record, 'description')
    .map(cleanDescription).find(Boolean) || '';
  book.categories = normaliseCategories(
    xmlValues(record, 'subject')
  );
  book.publishedDate = firstXml(record, 'date');
  book.publisher = firstXml(record, 'publisher');
  book.language = firstXml(record, 'language');

  if (!book.title) throw new Error('Titre absent');
  return book;
}

// ---------- CATÉGORIES ----------

export function normaliseCategories(subjects) {
  const rules = [
    ['Dark romance', /dark romance|romantic suspense/i],
    ['Romance', /romance|love stories|amour|sentimental|new adult/i],
    ['Policier & thriller', /thriller|mystery|detective|crime|policier|suspense/i],
    ['Fantasy', /fantasy|magic|wizard|sorcery/i],
    ['Fantastique', /fantastique|supernatural|paranormal/i],
    ['Science-fiction', /science fiction|sci-fi|dystopi|space opera/i],
    ['Aventure & action', /adventure|action|aventur/i],
    ['Histoire', /history|historical|histoire|world war/i],
    ['Biographie', /biograph|memoir|autobiograph/i],
    ['Jeunesse', /juvenile|children|young adult|jeunesse|enfant/i],
    ['BD & manga', /comic|graphic novel|manga|bande dessinée|manhwa/i],
    ['Développement personnel', /self-help|personal development|bien-être/i],
    ['Psychologie', /psychology|psychologie/i],
    ['Cuisine', /cooking|cookbook|food|cuisine|gastronom/i],
    ['Voyage', /travel|voyage|tourism/i],
    ['Poésie', /poetry|poésie/i],
    ['Philosophie', /philosophy|philosophie/i],
    ['Science & technique', /engineering|technology|computer science|physics|chemistry|informatique/i],
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

    for (const [name, regex] of rules) {
      if (regex.test(value) && !categories.includes(name)) {
        categories.push(name);
      }
    }
  }

  return categories.slice(0, 5);
}

// ---------- FUSION DES DONNÉES ----------

function mergeBooks(primary, fallback) {
  if (!primary?.title) return fallback || primary;
  if (!fallback?.title) return primary;

  const result = { ...primary };

  for (const field of [
    'title', 'description', 'cover', 'publishedDate',
    'pageCount', 'publisher', 'language'
  ]) {
    if (!result[field]) result[field] = fallback[field] || '';
  }

  if (!result.authors?.length) {
    result.authors = fallback.authors || [];
  }

  result.categories = [...new Set([
    ...(primary.categories || []),
    ...(fallback.categories || [])
  ])].slice(0, 5);

  if (fallback.source && !result.source.includes(fallback.source)) {
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

// ---------- CACHE LOCAL ----------

function cachedBook(isbn) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + isbn);
    if (!raw) return null;

    const entry = JSON.parse(raw);
    if (Date.now() - entry.savedAt > CACHE_TTL) {
      localStorage.removeItem(CACHE_PREFIX + isbn);
      return null;
    }

    return entry.book?.title ? entry.book : null;
  } catch {
    return null;
  }
}

function saveCache(isbn, book) {
  if (!book?.title) return;

  try {
    localStorage.setItem(
      CACHE_PREFIX + isbn,
      JSON.stringify({
        savedAt: Date.now(),
        book
      })
    );
  } catch {}
}

// ---------- RECHERCHE PRINCIPALE ----------

export async function lookupBook(isbn, googleApiKey = '') {
  const code = cleanIsbn(isbn);
  const cached = cachedBook(code);

  if (cached) return { ...cached, warnings: [] };

  let result = null;
  const warnings = [];

  async function searchGroup(sources) {
    const findings = await Promise.all(
      sources.map(async ([name, lookup]) => {
        try {
          return await lookup();
        } catch (error) {
          warnings.push(`${name} : ${errorMessage(error)}`);
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

  // Sources internationales.
  await searchGroup([
    ['Open Library', () => lookupOpenLibrary(code)],
    ['Inventaire', () => lookupInventaire(code)]
  ]);

  // Sources françaises et complémentaires.
  if (!isComplete(result)) {
    await searchGroup([
      ['BnF', () => lookupBnF(code)],
      ['Google Books', () => lookupGoogleBooks(code, googleApiKey)]
    ]);
  }

  // Publications savantes et éditions japonaises.
  if (!result?.title) {
    await searchGroup([
      ['Crossref', () => lookupCrossref(code)],
      ['NDL Japon', () => lookupJapan(code)]
    ]);
  }

  if (result?.title) {
    // Nettoyage final, quelle que soit la source.
    result.title = cleanTitle(result.title);
    result.authors = (result.authors || [])
      .map(cleanAuthor).filter(Boolean);
    result.description = cleanDescription(result.description);

    // Recherche supplémentaire de couverture.
    try {
      result.cover = await findCover(code, result.cover);
    } catch {
      result.cover = result.cover || '';
    }

    result.warnings = warnings;
    saveCache(code, result);
    return result;
  }

  console.warn('Recherche ISBN échouée :', code, warnings);

  return {
    ...emptyBook(code, 'Saisie manuelle'),
    warnings
  };
}
