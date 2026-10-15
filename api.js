
import { translateDescriptionToFrench, inferCategories } from './enrichment.js';
import { parseBnfRecord } from './bnf.js';
const TIMEOUT_MS = 11000;
const CACHE_PREFIX = 'mb-livres-v9-';
const GOOGLE_PAUSE_MS = 30 * 60 * 1000;

let googleBlockedUntil = 0;
let nextOpenLibraryRequest = 0;

// ===========================================
// OUTILS COMMUNS
// ===========================================

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
  return x === y ||
    (x.length === 10 && isbn10To13(x) === y) ||
    (y.length === 10 && isbn10To13(y) === x);
}

function plainText(value) {
  if (value && typeof value === 'object') {
    value = value.value || '';
  }

  if (typeof DOMParser === 'undefined') {
    return String(value || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/\s+/g, ' ').trim();
  }

  const doc = new DOMParser().parseFromString(
    String(value || ''), 'text/html'
  );
  return (doc.body.textContent || '')
    .replace(/\s+/g, ' ').trim();
}

function cleanTitle(value) {
  return plainText(value).trim();
}

function cleanAuthor(value) {
  let text = plainText(value);

  text = text.replace(
    /\.\s*(Auteur(?:e)? du texte|Autrice du texte|Traducteur|Traductrice|Illustrateur|Illustratrice).*$/i,
    ''
  ).trim();

  const match = text.match(/^([^,]+),\s*([^,]+)$/);

  if (match) {
    text = `${match[2].trim()} ${match[1].trim()}`;
  }

  return text;
}

function cleanDescription(value) {
  const text = plainText(value);

  if (!text) return '';

  // Ne pas considérer les informations techniques
  // d'une bibliothèque comme un résumé.
  if (/^(collection\s*:|bibliographie\s*:|code à barres commercial|ean\b|isbn\b|identifiant commercial|numéro commercial)/i.test(text)) {
    return '';
  }

  if (/^\d{10,13}$/.test(text)) return '';

  if (
    /no description available|description not available/i.test(text) ||
    /this book was (?:digitized|scanned)|digitized by google|search inside this book/i.test(text)
  ) return '';

  return text;
}

function emptyBook(isbn, source = '') {
  return {
    isbn,
    title: '',
    authors: [],
    description: '',
    categories: [],
    cover: '',
    publishedDate: '',
    pageCount: '',
    publisher: '',
    language: '',
    source
  };
}

function errorMessage(error) {
  if (error?.name === 'AbortError') {
    return 'Délai dépassé';
  }
  if (error instanceof TypeError) {
    return 'Connexion ou accès réseau refusé';
  }
  return error?.message || 'Erreur inconnue';
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
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }

    if (format === 'xml') {
      const xml = new DOMParser().parseFromString(
        await response.text(),
        'application/xml'
      );

      if (xml.getElementsByTagName('parsererror').length) {
        throw new Error('Réponse XML invalide');
      }

      return xml;
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

// Respecter un intervalle entre les requêtes
// envoyées à Open Library.
async function openLibraryRequest(url) {
  const now = Date.now();
  const wait = Math.max(
    0, nextOpenLibraryRequest - now
  );

  nextOpenLibraryRequest = now + wait + 1150;

  if (wait) {
    await new Promise(resolve => setTimeout(resolve, wait));
  }

  return request(url);
}

function xmlValues(node, name) {
  return [
    ...node.getElementsByTagNameNS('*', name)
  ].map(item => item.textContent.trim()).filter(Boolean);
}

function firstXml(node, name) {
  return xmlValues(node, name)[0] || '';
}

// ===========================================
// RECONNAISSANCE TITRE + AUTEUR
// ===========================================

function normalized(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCore(value) {
  return normalized(cleanTitle(value));
}

export function sameTitle(a, b) {
  const volume = value => normalized(value).match(/\b(?:tome|vol(?:ume)?|book|saison|part(?:ie)?)\s*0*(\d+)\b/)?.[1] || '';
  // Deux tomes différents ne partagent pas forcément leur résumé.
  if (volume(a) !== volume(b) && (volume(a) || volume(b))) return false;
  const x = titleCore(a);
  const y = titleCore(b);

  if (!x || !y) return false;
  return x === y;
}

function sameAuthor(a, b) {
  const x = normalized(cleanAuthor(a))
    .split(' ').filter(Boolean).sort();
  const y = normalized(cleanAuthor(b))
    .split(' ').filter(Boolean).sort();

  return x.length > 0 &&
    x.length === y.length &&
    x.every((word, i) => word === y[i]);
}

function matchesBook(title, authors, candidate) {
  if (!sameTitle(title, candidate.title)) {
    return false;
  }

  return (candidate.authors || []).some(a =>
    authors.some(b => sameAuthor(a, b))
  );
}

// ===========================================
// CATÉGORIES INTERNATIONALES
// ===========================================

export function normaliseCategories(subjects) {
  const rules = [
    ['Dark romance', /dark romance|romance sombre/i],
    ['Romance', /romance|romantic fiction|love stories|amour|sentimental|new adult/i],
    ['Policier & thriller', /\bthriller\b|detective fiction|crime fiction|policier|roman noir/i],
    ['Fantasy', /\bfantasy\b|wizard|sorcery|high fantasy|urban fantasy/i],
    ['Fantastique', /fantastique|supernatural|paranormal/i],
    ['Science-fiction', /science fiction|sci-fi|dystopi|space opera/i],
    ['Aventure & action', /adventure fiction|adventure stories|action fiction|roman d['’]aventures/i],
    ['Histoire', /historical fiction|world history|histoire|world war/i],
    ['Biographie', /biograph|memoir|autobiograph/i],
    ['Jeunesse', /juvenile|children|young adult|jeunesse|enfant/i],
    ['BD & manga', /comic|graphic novel|manga|manhwa|bande dessinée/i],
    ['Développement personnel', /self.help|personal development|bien-être/i],
    ['Psychologie', /psychology|psychologie/i],
    ['Cuisine', /cooking|cookbook|cuisine|gastronom/i],
    ['Voyage', /travel|voyage|tourism/i],
    ['Poésie', /poetry|poésie/i],
    ['Philosophie', /philosophy|philosophie/i],
    ['Science & technique', /engineering|technology|computer science|physics|chemistry|informatique/i],
    ['Médecine & santé', /medicine|medical|nursing|health|médecine/i],
    ['Horreur', /horror|épouvante|terreur/i],
    ['Humour', /humour|humor|comedy/i],
    ['Religion & spiritualité', /religion|spiritual|theology/i],
    ['Art & photographie', /art history|photography|photographie|painting/i],
    ['Économie & société', /economics|sociology|économie/i],
    ['Éducation', /education|teaching|pédagogie/i]
  ];

  const result = [];
  const counts = new Map();

  for (const subject of subjects || []) {
    const value = typeof subject === 'string'
      ? subject
      : subject?.name || '';

    for (const [name, regex] of rules) {
      if (regex.test(value)) {
        counts.set(name, (counts.get(name) || 0) + 1);
        if (!result.includes(name)) result.push(name);
      }
    }
  }

  // Certains catalogues associent une rubrique générale « science
  // fiction et fantasy » à tous les romans imaginaires. Retenir le
  // genre le plus étayé plutôt que ces deux étiquettes systématiques.
  const speculative = ['Fantasy', 'Science-fiction'].filter(name => counts.has(name));
  let excluded = '';
  if (speculative.length === 2 && counts.get('Fantasy') !== counts.get('Science-fiction')) {
    excluded = counts.get('Fantasy') > counts.get('Science-fiction') ? 'Science-fiction' : 'Fantasy';
  }
  return result.filter(name => name !== excluded).slice(0, 5);
}

// Classification complémentaire uniquement
// si une indication de genre explicite existe.
function categoriesFromDescription(description) {
  const text = String(description || '');

  const rules = [
    ['Dark romance', /\bdark romance\b/i],
    ['Romance', /\bromance\b|romantic novel|romantic fiction|histoire d'amour|triangle amoureux|littérature sentimentale/i],
    ['Fantasy', /\bhigh fantasy\b|\burban fantasy\b/i],
    ['Science-fiction', /\bscience.fiction\b|space opera/i],
    ['Policier & thriller', /\bthriller\b|police procedural/i],
    ['Horreur', /\bhorror novel\b|roman d'horreur/i],
    ['BD & manga', /\bmanga\b|\bmanhwa\b|graphic novel/i]
  ];

  const categories = rules
    .filter(([, regex]) => regex.test(text))
    .map(([name]) => name);

  // Plusieurs indices d'une intrigue romantique peuvent exister
  // même si le résumé ne contient pas le mot « romance ».
  const romanticSignals = [
    /\battirance\b/i,
    /\b(?:c[ée]der|succomber)\b.{0,60}\b(?:regard|charme|d[ée]sir|attirance)\b/i,
    /\b(?:se rapproch\w*|amour naissant|sentiments? amoureux|passion amoureuse)\b/i,
    /\b(?:alchimie|tension amoureuse|relation amoureuse)\b/i,
    /\b(?:s[ée]dui\w*|embrass\w*|tomb\w* amoureux)\b/i
  ];

  const romanticScore = romanticSignals.filter(signal => signal.test(text)).length;

  // Deux indices distincts minimum pour limiter les faux positifs.
  if (romanticScore >= 2 && !categories.includes('Romance')) {
    categories.push('Romance');
  }

  return categories;
}

// ===========================================
// COUVERTURES
// ===========================================

function coverFromId(id) {
  return Number(id) > 0
    ? `https://covers.openlibrary.org/b/id/${id}-L.jpg?default=false`
    : '';
}

function imageSize(url) {
  return new Promise(resolve => {
    if (!url) return resolve(false);

    const img = new Image();
    let done = false;

    const finish = value => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      resolve(value);
    };

    const timer = setTimeout(
      () => finish(false), 4500
    );

    img.onload = () => finish(img.naturalWidth >= 40 && img.naturalHeight >= 50
      ? img.naturalWidth * img.naturalHeight : 0);

    img.onerror = () => finish(false);
    img.src = url;
  });
}

async function findCover(isbn, existing = '') {
  const code = isbn.length === 10
    ? isbn10To13(isbn) : isbn;

  const urls = [];

  if (/^\d{13}$/.test(code)) {
    urls.push(
      `https://openapi.bnf.fr/couverture/image/image/recupererImage?EAN=${code}&couverture=1`
    );
  }

  urls.push(
    `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`
  );

  if (existing) urls.push(existing);

  const valid = await Promise.all(
    urls.map(imageSize)
  );

  const largest = Math.max(...valid);
  const index = largest > 0 ? valid.indexOf(largest) : -1;
  return index >= 0 ? urls[index] : '';
}

// ===========================================
// SOURCE 1 : OPEN LIBRARY PAR ISBN
// ===========================================

async function lookupOpenLibrary(isbn) {
  let edition = null;
  let search = null;

  try {
    edition = await openLibraryRequest(
      `https://openlibrary.org/isbn/${isbn}.json`
    );
  } catch {}

  const params = new URLSearchParams({
    isbn,
    limit: '3',
    fields: 'key,title,author_name,subject,cover_i,isbn'
  });

  try {
    const data = await openLibraryRequest(
      `https://openlibrary.org/search.json?${params}`
    );

    search = (data.docs || []).find(item =>
      (item.isbn || []).some(id =>
        sameIsbn(id, isbn)
      )
    ) || null;
  } catch {}

  let work = null;
  const key = edition?.works?.[0]?.key ||
    search?.key || '';

  const workPath = key.startsWith('/works/')
    ? key
    : `/works/${key}`;

  if (/^\/works\/OL\d+W$/.test(workPath)) {
    try {
      work = await openLibraryRequest(
        `https://openlibrary.org${workPath}.json`
      );
    } catch {}
  }

  const book = emptyBook(isbn, 'Open Library');

  book.title = cleanTitle(
    edition?.title || search?.title || work?.title
  );

  book.authors = (search?.author_name || [])
    .map(cleanAuthor).filter(Boolean);

  // Auteur de la fiche d'édition, si la recherche
  // n'a pas retourné son nom.
  if (!book.authors.length) {
    const refs = (
      edition?.authors?.length
        ? edition.authors
        : work?.authors || []
    ).slice(0, 3);

    for (const ref of refs) {
      const authorKey = ref.key || ref.author?.key;
      if (!/^\/authors\/OL\d+A$/.test(authorKey || '')) {
        continue;
      }
      try {
        const author = await openLibraryRequest(
          `https://openlibrary.org${authorKey}.json`
        );
        if (author.name) {
          book.authors.push(cleanAuthor(author.name));
        }
      } catch {}
    }
  }

  book.description = cleanDescription(
    edition?.description || work?.description
  );

  book.categories = normaliseCategories([
    ...(edition?.subjects || []),
    ...(search?.subject || []),
    ...(work?.subjects || [])
  ]);

  book.cover = coverFromId(
    edition?.covers?.find(id => id > 0)
  );

  book.publishedDate =
    edition?.publish_date ||
    work?.first_publish_date || '';

  book.pageCount =
    edition?.number_of_pages ||
    edition?.pagination || '';

  book.publisher = edition?.publishers?.[0] || '';
  book.language =
    edition?.languages?.[0]?.key?.split('/').pop() || '';

  if (!book.title) throw new Error('ISBN absent');

  return book;
}

// ===========================================
// SOURCE 2 : INVENTAIRE
// ===========================================

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
  if (!entity) throw new Error('Aucune entité');

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

// ===========================================
// SOURCE 3 : BIBLIOTHÈQUE DE FRANCE
// ===========================================

async function lookupBnF(isbn) {
  const params = new URLSearchParams({
    version: '1.2',
    operation: 'searchRetrieve',
    query: `bib.isbn all "${isbn}"`,
    recordSchema: 'intermarcxchange',
    maximumRecords: '3'
  });

  const xml = await request(
    `https://catalogue.bnf.fr/api/SRU?${params}`,
    'xml'
  );

  const book = parseBnfRecord(xml, isbn);
  book.title = cleanTitle(book.title);
  book.description = cleanDescription(book.description);
  book.categories = [...new Set([
    ...normaliseCategories(book.subjects),
    ...inferCategories(book.subjects, book.title, book.description)
  ])].slice(0, 6);

  if (!book.title) throw new Error('Titre absent');
  return book;
}

// ===========================================
// SOURCE 4 : GOOGLE BOOKS PAR ISBN
// ===========================================

async function googleRequest(params, apiKey = '') {
  const pauseKey = apiKey ? 'mb-google-pause-personal-' + keyFingerprint(apiKey) : 'mb-google-pause';
  const cooldown = Number(
    localStorage.getItem(pauseKey) || 0
  );

  googleBlockedUntil = cooldown;

  if (Date.now() < googleBlockedUntil) {
    throw new Error('Quota Google temporairement limité');
  }

  if (apiKey) params.set('key', apiKey);

  try {
    return await request(
      `https://www.googleapis.com/books/v1/volumes?${params}`
    );
  } catch (error) {
    if (error.status === 429) {
      googleBlockedUntil =
        Date.now() + GOOGLE_PAUSE_MS;

      try {
        localStorage.setItem(
          pauseKey,
          String(googleBlockedUntil)
        );
      } catch {}
    }
    throw error;
  }
}

function keyFingerprint(key) {
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16);
}

function googleBook(info, isbn, source = 'Google Books') {
  const book = emptyBook(isbn, source);

  book.title = cleanTitle(info.title);
  book.authors = (info.authors || [])
    .map(cleanAuthor).filter(Boolean);
  book.description = cleanDescription(info.description);
  book.categories = normaliseCategories(info.categories || []);

  book.cover = (
    info.imageLinks?.thumbnail ||
    info.imageLinks?.smallThumbnail ||
    ''
  ).replace(/^http:/, 'https:');

  book.publishedDate = info.publishedDate || '';
  book.pageCount = info.pageCount || '';
  book.publisher = info.publisher || '';
  book.language = info.language || '';

  return book;
}

async function lookupGoogleBooks(isbn, apiKey = '') {
  const params = new URLSearchParams({
    q: `isbn:${isbn}`,
    maxResults: '5',
    printType: 'books'
  });

  const data = await googleRequest(params, apiKey);

  const item = (data.items || []).find(candidate =>
    (candidate.volumeInfo?.industryIdentifiers || [])
      .some(id => sameIsbn(id.identifier, isbn))
  );

  if (!item) throw new Error('Édition absente');

  const book = googleBook(
    item.volumeInfo || {}, isbn
  );

  if (!book.title) throw new Error('Titre absent');
  return book;
}

// ===========================================
// SOURCE 5 : CROSSREF
// ===========================================

async function lookupCrossref(isbn) {
  const params = new URLSearchParams({
    filter: `isbn:${isbn}`,
    rows: '5'
  });

  const data = await request(
    `https://api.crossref.org/works?${params}`
  );

  const item = (data.message?.items || []).find(
    work => (work.ISBN || []).some(
      id => sameIsbn(id, isbn)
    )
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

// ===========================================
// SOURCE 6 : BIBLIOTHÈQUE DU JAPON
// ===========================================

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

// ===========================================
// NOUVEAU : RECHERCHE PAR TITRE + AUTEUR
// DANS LES AUTRES ÉDITIONS OPEN LIBRARY
// ===========================================

async function enrichFromOpenLibrary(title, authors) {
  if (!title || !authors?.length) return null;

  const params = new URLSearchParams({
    title: cleanTitle(title),
    author: authors[0],
    limit: '12',
    fields: 'key,title,author_name,subject,cover_i'
  });

  const data = await openLibraryRequest(
    `https://openlibrary.org/search.json?${params}`
  );

  const matches = (data.docs || []).filter(doc =>
    matchesBook(title, authors, {
      title: doc.title,
      authors: doc.author_name || []
    })
  ).slice(0, 3);

  if (!matches.length) {
    throw new Error('Aucune édition correspondante');
  }

  const extra = emptyBook('', 'Open Library (autres éditions)');
  extra.title = title;
  extra.authors = authors;

  for (const doc of matches) {
    extra.categories = [
      ...new Set([
        ...extra.categories,
        ...normaliseCategories(doc.subject || [])
      ])
    ].slice(0, 5);

    const key = doc.key || '';
    const workPath = key.startsWith('/works/')
      ? key : `/works/${key}`;

    if (!/^\/works\/OL\d+W$/.test(workPath)) {
      continue;
    }

    let work = null;

    try {
      work = await openLibraryRequest(
        `https://openlibrary.org${workPath}.json`
      );
    } catch {}

    if (work) {
      if (!extra.description) {
        extra.description = cleanDescription(work.description);
      }

      extra.categories = [
        ...new Set([
          ...extra.categories,
          ...normaliseCategories(work.subjects || [])
        ])
      ].slice(0, 5);
    }

    // Certaines fiches d'édition possèdent un résumé
    // alors que la fiche générale de l'ouvrage
    // n'en contient aucun.
    if (!extra.description || !extra.categories.length) {
      try {
        const editions = await openLibraryRequest(
          `https://openlibrary.org${workPath}/editions.json?limit=30`
        );

        const entries = editions.entries || [];

        for (const edition of entries) {
          const description = cleanDescription(
            edition.description
          );

          if (!extra.description && description.length >= 60) {
            extra.description = description;
          }

          extra.categories = [
            ...new Set([
              ...extra.categories,
              ...normaliseCategories([
                ...(edition.subjects || []),
                ...(edition.genres || [])
              ])
            ])
          ].slice(0, 5);

          if (extra.description && extra.categories.length) {
            break;
          }
        }
      } catch {}
    }

    if (extra.description && extra.categories.length) {
      break;
    }
  }

  if (!extra.description && !extra.categories.length) {
    throw new Error('Aucun résumé ou genre supplémentaire');
  }

  return extra;
}

// ===========================================
// NOUVEAU : GOOGLE BOOKS PAR TITRE + AUTEUR
// ===========================================

async function enrichFromGoogle(title, authors, apiKey = '') {
  if (!title || !authors?.length) return null;

  const q = `intitle:"${title.replace(/"/g, '')}" ` +
            `inauthor:"${authors[0].replace(/"/g, '')}"`;

  const params = new URLSearchParams({
    q,
    maxResults: '10',
    printType: 'books'
  });

  const data = await googleRequest(params, apiKey);

  const candidates = (data.items || [])
    .map(item => item.volumeInfo || {})
    .filter(info => matchesBook(title, authors, info))
    .sort((a, b) => {
      const score = item =>
        (item.description ? 4 : 0) +
        (item.categories?.length ? 2 : 0) +
        (item.language === 'fr' ? 1 : 0);

      return score(b) - score(a);
    });

  if (!candidates.length) {
    throw new Error('Aucun livre correspondant');
  }

  const book = googleBook(
    candidates[0], '', 'Google Books (autres éditions)'
  );

  // On retient uniquement les informations communes
  // à l'ouvrage : résumé et genres.
  return book;
}

// ===========================================
// FUSION DES FICHES EXACTES PAR ISBN
// ===========================================

function mergeBooks(primary, fallback) {
  if (!primary?.title) return fallback || primary;
  if (!fallback?.title) return primary;

  const result = { ...primary };

  for (const field of [
    'title', 'description', 'cover', 'originalTitle', 'publishedDate',
    'pageCount', 'publisher', 'language'
  ]) {
    if (!result[field]) {
      result[field] = fallback[field] || '';
    }
  }

  if (!result.authors?.length) {
    result.authors = fallback.authors || [];
  }

  result.categories = [
    ...new Set([
      ...(primary.categories || []),
      ...(fallback.categories || [])
    ])
  ].slice(0, 5);

  if (
    fallback.source &&
    !result.source.includes(fallback.source)
  ) {
    result.source += ' + ' + fallback.source;
  }

  return result;
}

// Fusion prudente d'informations venant d'une
// AUTRE édition du même ouvrage.
function mergeEnrichment(book, extra) {
  if (!extra) return book;

  const result = { ...book };

  if (!result.description && extra.description) {
    result.description = extra.description;
  }

  result.categories = [
    ...new Set([
      ...(result.categories || []),
      ...(extra.categories || [])
    ])
  ].slice(0, 5);

  // Conserver ISBN, couverture, pages,
  // éditeur et date de l'édition scannée.
  result.source += ' + ' + extra.source;

  return result;
}

async function enrichUsingTitles(book, lookup) {
  let result = book;
  let found = false;
  for (const title of [...new Set([book.title, book.originalTitle].filter(Boolean))]) {
    try {
      const extra = await lookup(title, book.authors);
      if (extra) {
        result = mergeEnrichment(result, extra);
        found = true;
      }
      if (result.description && result.categories?.length) break;
    } catch {}
  }
  if (!found) throw new Error('Aucune autre édition du même ouvrage ne fournit ces informations');
  return result;
}

function isComplete(book) {
  return Boolean(
    book?.title &&
    book.authors?.length &&
    book.description &&
    book.categories?.length &&
    book.cover
  );
}

// ===========================================
// CACHE MÉTADONNÉES
// ===========================================

function cachedBook(isbn, apiKey = '') {
  try {
    const raw = localStorage.getItem(
      CACHE_PREFIX + isbn + (apiKey ? '-' + keyFingerprint(apiKey) : '')
    );
    if (!raw) return null;

    const entry = JSON.parse(raw);

    // Une fiche incomplète sera retentée plus tôt.
    const duration = isComplete(entry.book) ? 7 * 86400000 : 2 * 60000;

    if (Date.now() - entry.savedAt > duration) {
      localStorage.removeItem(CACHE_PREFIX + isbn + (apiKey ? '-' + keyFingerprint(apiKey) : ''));
      return null;
    }

    return entry.book?.title ? entry.book : null;
  } catch {
    return null;
  }
}

function saveCache(isbn, book, apiKey = '') {
  if (!book?.title) return;

  try {
    localStorage.setItem(
      CACHE_PREFIX + isbn + (apiKey ? '-' + keyFingerprint(apiKey) : ''),
      JSON.stringify({
        savedAt: Date.now(),
        book
      })
    );
  } catch {}
}

// ===========================================
// MOTEUR PRINCIPAL
// ===========================================

export async function lookupBook(isbn, googleApiKey = '', { refresh = false } = {}) {
  const code = cleanIsbn(isbn);
  const cached = refresh ? null : cachedBook(code, googleApiKey);

  if (cached) {
    return { ...cached };
  }

  let result = null;
  const warnings = [];

  async function searchGroup(sources) {
    const findings = await Promise.all(
      sources.map(async ([name, lookup]) => {
        try {
          return await lookup();
        } catch (error) {
          warnings.push(
            `${name} : ${errorMessage(error)}`
          );
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

  // Les catalogues sont indépendants : les consulter en parallèle.
  // Pour une édition française, la BnF préserve le titre, les rôles et
  // le résumé éditeur français avant les métadonnées internationales.
  const international = [
    ['Open Library', () => lookupOpenLibrary(code)],
    ['Inventaire', () => lookupInventaire(code)],
    ['Google Books', () => lookupGoogleBooks(code, googleApiKey)]
  ];
  const french = ['BnF', () => lookupBnF(code)];
  await searchGroup(/^9782|^9791[01]/.test(code)
    ? [french, ...international] : [...international, french]);

  // 3. Dernier recours si aucun titre n'est trouvé.
  if (!result?.title) {
    await searchGroup([
      ['Crossref', () => lookupCrossref(code)],
      ['NDL Japon', () => lookupJapan(code)]
    ]);
  }

  // 4. Recherche intelligente du résumé
  // et des catégories dans d'autres éditions.
  if (
    result?.title &&
    result.authors?.length &&
    (!result.description || !result.categories?.length)
  ) {
    try {
      result = await enrichUsingTitles(result, enrichFromOpenLibrary);
    } catch (error) {
      warnings.push(
        'Recherche des autres éditions : ' +
        errorMessage(error)
      );
    }
  }

  // 5. Google Books par titre et auteur,
  // uniquement si des données manquent encore.
  if (
    result?.title &&
    result.authors?.length &&
    (!result.description || !result.categories?.length)
  ) {
    try {
      result = await enrichUsingTitles(result,
        (title, authors) => enrichFromGoogle(title, authors, googleApiKey));
    } catch (error) {
      warnings.push(
        'Google Books titre/auteur : ' +
        errorMessage(error)
      );
    }
  }

  if (result?.title) {
    // 6. Nettoyage final.
    result.title = cleanTitle(result.title);

    result.authors = [
      ...new Set(
        (result.authors || [])
          .map(cleanAuthor)
          .filter(Boolean)
      )
    ];

    result.description = cleanDescription(
      result.description
    );

    // Catégories complémentaires si le résumé
    // comporte une indication claire de genre.
    if (!result.categories?.length) {
      result.categories = categoriesFromDescription(
        result.description
      );
    }

    // Détecter la langue du résumé lorsqu'un catalogue
    // ne fournit pas un code de langue assez précis.
    const summary = result.description || '';
    const englishCount = (summary.match(
      /\b(the|and|she|he|her|his|with|from|when|that|their|but|will)\b/gi
    ) || []).length;
    const frenchCount = (summary.match(
      /\b(le|la|les|des|une|dans|avec|pour|elle|mais|qui|sur)\b/gi
    ) || []).length;

    const summaryLanguage =
      englishCount >= 3 && englishCount > frenchCount ? 'en' :
      frenchCount >= 3 && frenchCount > englishCount ? 'fr' :
      result.language || '';

    // Traduire avec MyMemory. En cas de quota ou d'erreur,
    // le texte original est conservé sans bloquer la fiche.
    const translation = await translateDescriptionToFrench(
      result.description,
      summaryLanguage
    );

    result.description = translation.text;
    result.descriptionTranslated = translation.translated;

    if (
      translation.translated &&
      !result.source.includes('MyMemory')
    ) {
      result.source += ' + MyMemory';
    }

    // Compléter automatiquement les catégories
    result.categories = [...new Set([
      ...(result.categories || []),
      ...inferCategories(
        result.categories || [],
        result.title || '',
        result.description || ''
      )
    ])].slice(0, 6);

    // 7. Couverture de l'édition scannée,
    // sans utiliser celle d'une édition étrangère.
    try {
      result.cover = await findCover(
        code, result.cover
      );
    } catch {}

    result.isbn = code;
    result.warnings = warnings;

    saveCache(code, result, googleApiKey);

    if (warnings.length) {
      console.info(
        'Catalogues partiellement indisponibles :',
        warnings
      );
    }

    return result;
  }

  console.warn(
    'ISBN introuvable :',
    code,
    warnings
  );

  return {
    ...emptyBook(code, 'Saisie manuelle'),
    warnings
  };
}
