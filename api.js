const TIMEOUT_MS = 9000;

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function valueOfDescription(value) {
  if (!value) return '';
  if (typeof value === 'string') return stripHtml(value);
  return stripHtml(value.value || '');
}

function stripHtml(value) {
  const doc = new DOMParser().parseFromString(String(value), 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}

function coverFromId(id) {
  return id ? `https://covers.openlibrary.org/b/id/${id}-L.jpg?default=false` : '';
}

async function lookupOpenLibrary(isbn) {
  const edition = await fetchJson(`https://openlibrary.org/isbn/${encodeURIComponent(isbn)}.json`);
  const authorRefs = (edition.authors || []).slice(0, 5);
  const workRef = edition.works?.[0]?.key;
  const [authorResults, work] = await Promise.all([
    Promise.all(authorRefs.map(async (entry) => {
      try { return (await fetchJson(`https://openlibrary.org${entry.key}.json`)).name || ''; } catch { return ''; }
    })),
    workRef ? fetchJson(`https://openlibrary.org${workRef}.json`).catch(() => null) : null,
  ]);

  const subjects = [...(edition.subjects || []), ...(work?.subjects || [])];
  return {
    isbn,
    title: edition.title || work?.title || '',
    authors: authorResults.filter(Boolean),
    description: valueOfDescription(edition.description) || valueOfDescription(work?.description),
    categories: normaliseCategories(subjects),
    cover: coverFromId(edition.covers?.[0] || work?.covers?.[0]),
    publishedDate: edition.publish_date || work?.first_publish_date || '',
    pageCount: edition.number_of_pages || edition.pagination || '',
    publisher: edition.publishers?.[0] || '',
    language: edition.languages?.[0]?.key?.split('/').pop() || '',
    source: 'Open Library',
  };
}

async function lookupGoogleBooks(isbn, apiKey = '') {
  const params = new URLSearchParams({ q: `isbn:${isbn}`, maxResults: '5', printType: 'books' });
  if (apiKey) params.set('key', apiKey);
  const payload = await fetchJson(`https://www.googleapis.com/books/v1/volumes?${params}`);
  const item = (payload.items || []).find((candidate) => {
    const ids = candidate.volumeInfo?.industryIdentifiers || [];
    return ids.some((entry) => String(entry.identifier).replace(/[^0-9X]/gi, '') === isbn);
  }) || payload.items?.[0];
  if (!item) throw new Error('Aucun résultat Google Books');
  const info = item.volumeInfo || {};
  return {
    isbn,
    title: info.title || '',
    authors: info.authors || [],
    description: stripHtml(info.description || ''),
    categories: normaliseCategories(info.categories || []),
    cover: (info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || '').replace(/^http:/, 'https:'),
    publishedDate: info.publishedDate || '',
    pageCount: info.pageCount || '',
    publisher: info.publisher || '',
    language: info.language || '',
    source: 'Google Books',
  };
}

function isUseful(book) {
  return Boolean(book?.title || book?.authors?.length || book?.description || book?.cover);
}

function mergeBook(primary, fallback) {
  if (!primary) return fallback;
  if (!fallback) return primary;
  const merged = { ...primary };
  for (const key of ['title', 'description', 'cover', 'publishedDate', 'pageCount', 'publisher', 'language']) {
    if (!merged[key]) merged[key] = fallback[key];
  }
  if (!merged.authors?.length) merged.authors = fallback.authors || [];
  merged.categories = [...new Set([...(primary.categories || []), ...(fallback.categories || [])])].slice(0, 5);
  merged.source = 'Open Library + Google Books';
  return merged;
}

export async function lookupBook(isbn, googleApiKey = '') {
  let openLibrary = null;
  let google = null;
  const warnings = [];

  try { openLibrary = await lookupOpenLibrary(isbn); } catch (error) { warnings.push(`Open Library : ${error.message}`); }
  const needsFallback = !isUseful(openLibrary) || !openLibrary.description || !openLibrary.authors?.length || !openLibrary.cover;
  if (needsFallback) {
    try { google = await lookupGoogleBooks(isbn, googleApiKey); } catch (error) { warnings.push(`Google Books : ${error.message}`); }
  }

  const result = mergeBook(openLibrary, google);
  if (!isUseful(result)) {
    return { isbn, title: '', authors: [], description: '', categories: [], cover: '', publishedDate: '', pageCount: '', publisher: '', language: '', source: 'Saisie manuelle', warnings };
  }
  return { ...result, warnings };
}

export function normaliseCategories(subjects) {
  const rules = [
    ['Romance', /romance|love stories|amour|sentimental/i],
    ['Policier & thriller', /thriller|mystery|detective|crime|policier|suspense|noir/i],
    ['Fantasy', /fantasy|fantastique|magic|wizard|sorcery/i],
    ['Science-fiction', /science fiction|sci-fi|dystopi|space opera/i],
    ['Aventure & action', /adventure|action|aventur/i],
    ['Histoire', /history|historical|histoire|warfare|world war/i],
    ['Biographie', /biograph|memoir|autobiograph|personnalités/i],
    ['Jeunesse', /juvenile|children|young adult|jeunesse|enfant/i],
    ['BD & manga', /comic|graphic novel|manga|bande dessinée/i],
    ['Développement personnel', /self-help|personal development|bien-être|psychology/i],
    ['Cuisine', /cooking|cookbook|food|cuisine|gastronom/i],
    ['Voyage', /travel|voyage|tourism/i],
    ['Poésie', /poetry|poésie/i],
    ['Essai', /essay|philosophy|politic|social science|essai/i],
  ];
  const matched = [];
  for (const raw of subjects) {
    const value = typeof raw === 'string' ? raw : raw?.name || '';
    for (const [label, regex] of rules) if (regex.test(value) && !matched.includes(label)) matched.push(label);
  }
  return matched.slice(0, 5);
}
