import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupBook } from '../api.js';

test('n’accepte jamais le premier résultat Google si son ISBN est différent', async () => {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = globalThis.localStorage;
  const memory = new Map();
  globalThis.localStorage = {
    getItem: (key) => memory.get(key) || null,
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: (key) => memory.delete(key),
  };
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('googleapis.com')) {
      return new Response(JSON.stringify({ items: [{ volumeInfo: {
        title: 'Mauvais livre',
        industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780140328721' }],
      } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await lookupBook('9780306406157');
    assert.equal(result.title, '');
    assert.equal(result.source, 'Saisie manuelle');
    assert.ok(result.warnings.some((warning) => warning.includes('Google Books : Édition absente')));
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.localStorage = originalLocalStorage;
  }
});

test('complète une notice publique connue mais incomplète', async () => {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = globalThis.localStorage;
  const memory = new Map();
  globalThis.localStorage = {
    getItem: (key) => memory.get(key) || null,
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: (key) => memory.delete(key),
  };
  globalThis.fetch = async () => new Response('{}', {
    status: 404,
    headers: { 'content-type': 'application/json' }
  });

  try {
    const result = await lookupBook('9782755640427');
    assert.equal(result.title, 'Glitter Girl — Black Riders, tome 1');
    assert.deepEqual(result.authors, ['C. J. Ronnie']);
    assert.equal(result.pageCount, 588);
    assert.ok(result.description.includes('Hayley quitte New York'));
    assert.ok(result.cover.startsWith('https://'));
    assert.ok(result.source.includes('Catalogue local vérifié'));
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.localStorage = originalLocalStorage;
  }
});
