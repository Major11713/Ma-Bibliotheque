export const BOOK_BATCH_SIZE = 60;
export const SORT_MODES = ['title', 'author', 'genre', 'recent'];
const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });
const compare = (a, b) => collator.compare(String(a || ''), String(b || ''));

export function bookGenre(book, selected = 'Toutes') {
  const categories = (book.categories || []).filter(value => String(value).trim()).slice().sort(compare);
  return selected !== 'Toutes' && categories.includes(selected) ? selected : categories[0] || 'Non classé';
}

export function authorSortKey(book) {
  const name = String(book.authors?.[0] || '').trim();
  if (!name) return '';
  if (name.includes(',')) return name.replace(/,\s*/g, ' ');
  // Les catalogues fournissent généralement « prénom nom », pas de nom structuré.
  // Le dernier mot sert de nom de classement ; les noms composés restent éditables.
  const parts = name.split(/\s+/);
  return [parts.pop(), ...parts].join(' ');
}

export function orderBooks(books, mode = 'title', selectedGenre = 'Toutes') {
  const title = (a, b) => compare(a.title, b.title) || compare(a.isbn, b.isbn);
  return books.slice().sort((a, b) => {
    if (mode === 'recent') {
      const date = book => Number.isFinite(Date.parse(book.addedAt)) ? Date.parse(book.addedAt) : 0;
      return date(b) - date(a) || title(a, b);
    }
    if (mode === 'author') {
      const x = authorSortKey(a), y = authorSortKey(b);
      return (x ? y ? compare(x, y) : -1 : y ? 1 : 0) || title(a, b);
    }
    if (mode === 'genre') {
      const x = bookGenre(a, selectedGenre), y = bookGenre(b, selectedGenre);
      return (x === 'Non classé' ? y === 'Non classé' ? 0 : 1 : y === 'Non classé' ? -1 : compare(x, y)) || title(a, b);
    }
    return title(a, b);
  });
}

export function collectionPage(books, { status = 'owned', query = '', category = 'Toutes', sort = 'title', limit = BOOK_BATCH_SIZE } = {}) {
  const normal = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const search = normal(query);
  const filtered = books.filter(book => book.status === status &&
    (category === 'Toutes' || book.categories?.includes(category)) &&
    (!search || normal([book.title, ...(book.authors || []), book.isbn, ...(book.categories || [])].join(' ')).includes(search)));
  const ordered = orderBooks(filtered, sort, category);
  return { total: ordered.length, items: ordered.slice(0, limit), remaining: Math.max(0, ordered.length - limit) };
}
