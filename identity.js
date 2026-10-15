// Une ressemblance n'est jamais une autorisation de fusionner deux éditions.
export function identityText(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function authorKey(value) {
  return identityText(value).split(' ').filter(Boolean).sort().join('');
}

function volume(title) {
  const value = identityText(title).match(/\b(?:tome|vol(?:ume)?|t)\s+(\d+|[ivxlcdm]+)\b/)?.[1] || '';
  if (!value || /^\d+$/.test(value)) return value ? String(Number(value)) : '';
  const roman = { i:1, v:5, x:10, l:50, c:100, d:500, m:1000 };
  return String([...value].reduce((sum, char, index) => sum + (roman[char] < (roman[value[index + 1]] || 0) ? -roman[char] : roman[char]), 0));
}

export function findBookMatches(proposal, books, excludeIsbn = '') {
  const title = identityText(proposal.title);
  if (!title) return [];
  const authors = (proposal.authors || []).map(authorKey).filter(Boolean);
  return books.flatMap(book => {
    if (book.isbn === excludeIsbn || book.isbn === proposal.isbn) return [];
    const other = identityText(book.title);
    const a = volume(proposal.title), b = volume(book.title);
    if (a && b && a !== b) return [];
    // Compare aussi un sous-titre, mais seulement pour proposer une vérification.
    const overlap = title.length >= 5 && other.length >= 5 &&
      (` ${title} `.includes(` ${other} `) || ` ${other} `.includes(` ${title} `));
    if (title !== other && !overlap) return [];
    const otherAuthors = (book.authors || []).map(authorKey).filter(Boolean);
    if (authors.length && otherAuthors.length && !authors.some(key => otherAuthors.includes(key))) return [];
    return [{ book, certain: title === other && Boolean(authors.length && otherAuthors.length),
      reason: title === other ? (authors.length && otherAuthors.length ? 'Même titre et auteur' : 'Même titre · auteur à vérifier') : 'Titre proche · tome et édition à vérifier' }];
  });
}

export function attachIsbnProposal(existing, fresh) {
  if (!existing.isbn.startsWith('manuel-')) throw new Error('Cette fiche a déjà un ISBN.');
  return { ...fresh, ...existing, isbn: fresh.isbn,
    authors: existing.authors?.length ? existing.authors : (fresh.authors || []),
    categories: existing.categories?.length ? existing.categories : (fresh.categories || []),
    ...Object.fromEntries(['title','description','cover','publisher','language','publishedDate','pageCount']
      .map(key => [key, existing[key] || fresh[key] || ''])),
    descriptionTranslated: existing.description ? Boolean(existing.descriptionTranslated) : Boolean(fresh.descriptionTranslated),
    source: existing.source || 'Saisie manuelle', updatedAt: new Date().toISOString() };
}
