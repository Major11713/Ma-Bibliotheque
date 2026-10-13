import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanDescription, inferCategories, translateDescriptionToFrench } from '../enrichment.js';

test('rejette les faux résumés techniques', () => {
  assert.equal(cleanDescription('This book was digitized by Google. Search inside this book to learn more about this scanned edition.'), '');
});

test('classe les catégories spécifiques avant les catégories générales', () => {
  const categories = inferCategories(['Dark romance', 'Young adult fantasy']);
  assert.deepEqual(categories.slice(0, 4), ['Dark romance', 'Romance', 'Fantasy', 'Young adult']);
});

test('traduit un résumé anglais et conserve le texte original en cas de panne', async () => {
  const originalFetch = globalThis.fetch;
  const description = 'A young reader discovers a hidden library and begins a magical adventure with her closest friends.';
  globalThis.fetch = async () => new Response(JSON.stringify({
    responseStatus: 200,
    responseData: { translatedText: 'Une jeune lectrice découvre une bibliothèque cachée et commence une aventure magique avec ses amis les plus proches.' },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const translated = await translateDescriptionToFrench(description, 'eng');
    assert.equal(translated.translated, true);
    assert.match(translated.text, /bibliothèque cachée/);

    globalThis.fetch = async () => new Response('', { status: 429 });
    const fallback = await translateDescriptionToFrench(description, 'en');
    assert.deepEqual(fallback, { text: description, translated: false });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
