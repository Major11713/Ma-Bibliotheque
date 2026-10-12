
const TIMEOUT_MS = 12000;

// Récupération des données depuis les catalogues
async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`Erreur HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Le catalogue met trop longtemps à répondre');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// Nettoyage du texte et des résumés
function stripHtml(value) {
  const doc = new DOMParser().parseFromString(
    String(value || ''),
    'text/html'
  );

  return (doc.body.textContent || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function valueOfDescription(value) {
  if (!value) return '';
  if (typeof value === 'string') return stripHtml(value);
  return stripHtml(value.value || '');
}

// Couvertures
function coverFromId(id) {
  if (!Number.isInteger(id) || id <= 0) return '';

  return `https://covers.openlibrary.org/b/id/${id}-L.jpg?default=false`;
}

// Première méthode : fiche ISBN Open Library
async function lookupOpenLibraryEdition(isbn) {
  const edition = await fetchJson(
    `https://openlibrary.org/isbn/${encodeURIComponent(isbn)}.json`
  );

  const workRef = edition.works?.[0]?.key;

  let work = null;

  if (workRef && workRef.startsWith('/works/')) {
    try {
      work = await fetchJson(
        `https://openlibrary.org${workRef}.json`
      );
    } catch {
      work = null;
    }
  }

  const authorRefs = (
    edition.authors?.length
      ? edition.authors
      : work?.authors || []
  ).slice(0, 5);

  const authors = await Promise.all(
    authorRefs.map(async (entry) => {
      const key = entry.key || entry.author?.key;

      if (!key || !key.startsWith('/authors/')) return '';

      try {
        const author = await fetchJson(
          `https://openlibrary.org${key}.json`
        );
        return author.name || '';
      } catch {
        return '';
      }
    })
  );

  const subjects = [
    ...(Array.isArray(edition.subjects) ? edition.subjects : []),
    ...(Array.isArray(work?.subjects) ? work.subjects : [])
  ];

  const coverId =
    edition.covers?.find(id => Number.isInteger(id) && id > 0) ||
    work?.covers?.find(id => Number.isInteger(id) && id > 0);

  const book = {
    isbn,
    title: edition.title || work?.title || '',
    authors: authors.filter(Boolean),
    description:
      valueOfDescription(edition.description) ||
      valueOfDescription(work?.description),
    categories: normaliseCategories(subjects),
    cover: coverFromId(coverId),
    publishedDate:
      edition.publish_date || work?.first_publish_date || '',
    pageCount:
      edition.number_of_pages || edition.pagination || '',
    publisher: edition.publishers?.[0] || '',
    language:
      edition.languages?.[0]?.key?.split('/').pop() || '',
    source: 'Open Library'
  };

  if (!book.title) {
    throw new Error('Titre absent de la fiche ISBN');
  }

  return book;
}

// Deuxième méthode : API Books Open Library
async function lookupOpenLibraryBooks(isbn) {
  const params = new URLSearchParams({
    bibkeys: `ISBN:${isbn}`,
    jscmd: 'data',
    format: 'json'
  });

  const payload = await fetchJson(
    `https://openlibrary.org/api/books.json?${params}`
  );

  const data = payload[`ISBN:${isbn}`];

  if (!data?.title) {
    throw new Error('Aucun livre trouvé dans la recherche secondaire');
  }

  return {
    isbn,
    title: data.title,
    authors: (data.authors || [])
      .map(author => author.name || '')
      .filter(Boolean),
    description: valueOfDescription(data.description),
    categories: normaliseCategories(data.subjects || []),
    cover:
      data.cover?.large ||
      data.cover?.medium ||
      data.cover?.small ||
      data.thumbnail_url ||
      '',
    publishedDate: data.publish_date || '',
    pageCount: data.number_of_pages || data.pagination || '',
    publisher: data.publishers?.[0]?.name || '',
    language: '',
    source: 'Open Library'
  };
}

// Recherche Open Library avec méthode de secours
async function lookupOpenLibrary(isbn) {
  try {
    return await lookupOpenLibraryEdition(isbn);
  } catch (primaryError) {
    try {
      return await lookupOpenLibraryBooks(isbn);
    } catch (secondaryError) {
      throw new Error(
        `ISBN : ${primaryError.message} ; ` +
        `API Books : ${secondaryError.message}`
      );
    }
  }
}

// Troisième méthode : Google Books
async function lookupGoogleBooks(isbn, apiKey = '') {
  const params = new URLSearchParams({
    q: `isbn:${isbn}`,
    maxResults: '5',
    printType: 'books'
  });

  if (apiKey) {
    params.set('key', apiKey);
  }

  const payload = await fetchJson(
    `https://www.googleapis.com/books/v1/volumes?${params}`
  );

  const items = payload.items || [];

  if (!items.length) {
    throw new Error('Aucun résultat Google Books');
  }

  const item = items.find(candidate => {
    const identifiers =
      candidate.volumeInfo?.industryIdentifiers || [];

    return identifiers.some(entry => {
      const id = String(entry.identifier || '')
        .replace(/[^0-9X]/gi, '')
        .toUpperCase();

      return id === isbn;
    });
  }) || items[0];

  const info = item.volumeInfo || {};

  if (!info.title) {
    throw new Error('Google Books ne fournit pas de titre');
  }

  return {
    isbn,
    title: info.title || '',
    authors: info.authors || [],
    description: stripHtml(info.description || ''),
    categories: normaliseCategories(info.categories || []),
    cover: (
      info.imageLinks?.thumbnail ||
      info.imageLinks?.smallThumbnail ||
      ''
    ).replace(/^http:/, 'https:'),
    publishedDate: info.publishedDate || '',
    pageCount: info.pageCount || '',
    publisher: info.publisher || '',
    language: info.language || '',
    source: 'Google Books'
  };
}

// Vérifie que la fiche est utilisable
function isUseful(book) {
  return Boolean(book?.title);
}

// Fusionne les informations des catalogues
function mergeBook(primary, fallback) {
  if (!primary) return fallback;
  if (!fallback) return primary;

  const merged = { ...primary };

  const fields = [
    'title',
    'description',
    'cover',
    'publishedDate',
    'pageCount',
    'publisher',
    'language'
  ];

  for (const key of fields) {
    if (!merged[key]) {
      merged[key] = fallback[key];
    }
  }

  if (!merged.authors?.length) {
    merged.authors = fallback.authors || [];
  }

  merged.categories = [
    ...new Set([
      ...(primary.categories || []),
      ...(fallback.categories || [])
    ])
  ].slice(0, 5);

  merged.source = 'Open Library + Google Books';

  return merged;
}

// Fonction principale appelée par l'application
export async function lookupBook(isbn, googleApiKey = '') {
  const code = String(isbn || '')
    .replace(/[^0-9X]/gi, '')
    .toUpperCase();

  const warnings = [];

  let openLibrary = null;
  let google = null;

  if (!navigator.onLine) {
    warnings.push('Connexion Internet indisponible');
  }

  // Recherche Open Library
  try {
    openLibrary = await lookupOpenLibrary(code);
  } catch (error) {
    warnings.push(`Open Library : ${error.message}`);
  }

  // Google Books complète les informations manquantes
  const needsGoogle =
    !isUseful(openLibrary) ||
    !openLibrary.description ||
    !openLibrary.authors?.length ||
    !openLibrary.cover ||
    !openLibrary.categories?.length;

  if (needsGoogle) {
    try {
      google = await lookupGoogleBooks(code, googleApiKey);
    } catch (error) {
      warnings.push(`Google Books : ${error.message}`);
    }
  }

  const result = mergeBook(openLibrary, google);

  // Si aucun catalogue ne trouve le livre,
  // laisser la possibilité de l'ajouter manuellement
  if (!isUseful(result)) {
    console.warn('Recherche ISBN échouée :', code, warnings);

    return {
      isbn: code,
      title: '',
      authors: [],
      description: '',
      categories: [],
      cover: '',
      publishedDate: '',
      pageCount: '',
      publisher: '',
      language: '',
      source: 'Saisie manuelle',
      warnings
    };
  }

  return { ...result, warnings };
}

// Classement automatique des livres
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
    ['Horreur', /horror|épouvante|supernatural|terreur/i],
    ['Humour', /humour|humor|comedy|comédie/i]
  ];

  const matched = [];

  for (const raw of subjects || []) {
    const value = typeof raw === 'string'
      ? raw
      : raw?.name || '';

    for (const [label, regex] of rules) {
      if (regex.test(value) && !matched.includes(label)) {
        matched.push(label);
      }
    }
  }

  return matched.slice(0, 5);
}
