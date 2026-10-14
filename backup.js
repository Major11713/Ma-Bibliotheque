import { normaliseIsbn } from './isbn.js';

export function validateBackup(payload) {
  if (payload?.app !== 'Ma Bibliothèque' || !Array.isArray(payload.books) || ![undefined, 1].includes(payload.version)) {
    throw new Error('Format ou version de sauvegarde non reconnu.');
  }
  if (payload.books.length > 10000) throw new Error('La sauvegarde dépasse 10 000 livres.');
  const seen = new Set();
  const text = (book, key) => {
    if (book[key] === undefined || book[key] === null) return '';
    if (!['string', 'number'].includes(typeof book[key])) throw new Error('Champ invalide : ' + key);
    return String(book[key]).trim();
  };
  return payload.books.map((book, index) => {
    if (!book || typeof book.title !== 'string' || !book.title.trim()) throw new Error('Titre invalide au livre ' + (index + 1));
    const raw = text(book, 'isbn');
    const isbn = /^manuel-[a-z0-9-]{1,100}$/i.test(raw) ? raw : normaliseIsbn(raw);
    if (!isbn) throw new Error('ISBN invalide pour « ' + book.title + ' ».');
    if (seen.has(isbn)) throw new Error('ISBN présent plusieurs fois dans la sauvegarde : ' + isbn);
    seen.add(isbn);
    const strings = key => {
      if (book[key] === undefined) return [];
      if (!Array.isArray(book[key]) || book[key].some(item => typeof item !== 'string')) throw new Error('Liste invalide : ' + key);
      return [...new Set(book[key].map(item => item.trim()).filter(Boolean))];
    };
    const cover = text(book, 'cover');
    if (cover && !/^https?:\/\//i.test(cover)) throw new Error('Adresse de couverture invalide pour « ' + book.title + ' ».');
    const pageCount = text(book, 'pageCount');
    if (pageCount.length > 200) throw new Error('Pagination trop longue pour « ' + book.title + ' ».');
    if (book.status && !['owned', 'wishlist'].includes(book.status)) throw new Error('Emplacement invalide.');
    const addedAt = text(book, 'addedAt');
    if (addedAt && !Number.isFinite(Date.parse(addedAt))) throw new Error('Date de sauvegarde invalide.');
    return {
      isbn, title: book.title.trim(), authors: strings('authors'), categories: strings('categories'),
      description: text(book, 'description'), publishedDate: text(book, 'publishedDate'), pageCount, cover,
      publisher: text(book, 'publisher'), language: text(book, 'language'),
      status: book.status || 'owned', source: text(book, 'source') || 'Import JSON',
      descriptionTranslated: book.descriptionTranslated === true,
      addedAt: addedAt || new Date().toISOString(), updatedAt: new Date().toISOString()
    };
  });
}
