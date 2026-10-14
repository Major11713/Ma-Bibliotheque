import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { parseBnfRecord } from '../bnf.js';
import { inferCategories } from '../enrichment.js';

const corpus = ['9782387032379', '9782266336994', '9782755640427', '9782070584628', '9782266320481'];
const rows = await Promise.all(corpus.map(async isbn => {
  const params = new URLSearchParams({
    version: '1.2', operation: 'searchRetrieve', query: 'bib.isbn all "' + isbn + '"',
    recordSchema: 'intermarcxchange', maximumRecords: '3'
  });
  const response = await fetch('https://catalogue.bnf.fr/api/SRU?' + params, {signal: AbortSignal.timeout(15000)});
  if (!response.ok) throw new Error('BnF HTTP ' + response.status);
  const book = parseBnfRecord(new DOMParser().parseFromString(await response.text(), 'application/xml'), isbn);
  const categories = inferCategories(book.subjects, book.title, book.description);
  if (isbn === '9782387032379') {
    assert.deepEqual(book.authors, ['Elise Kova']);
    assert.ok(book.description.length > 200);
    assert.ok(categories.includes('Romance') && categories.includes('Fantasy'));
    assert.equal(book.pageCount, 604);
  }
  return {isbn, title: book.title, authors: book.authors.join(', '), summary: book.description.length, categories: categories.join(', '), pages: book.pageCount, originalTitle: book.originalTitle};
}));
console.table(rows);
