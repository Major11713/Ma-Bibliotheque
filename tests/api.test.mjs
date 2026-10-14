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

test('ne fournit aucune fiche spéciale lorsque les catalogues ne répondent pas', async () => {
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
    assert.equal(result.title, '');
    assert.equal(result.description, '');
    assert.equal(result.cover, '');
    assert.equal(result.source, 'Saisie manuelle');
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.localStorage = originalLocalStorage;
  }
});

test('une nouvelle clé Google contourne la pause et le cache de la recherche sans clé', async () => {
  const previous = {fetch:globalThis.fetch,localStorage:globalThis.localStorage};
  const memory=new Map();
  globalThis.localStorage={getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,String(value)),removeItem:key=>memory.delete(key)};
  let calls=0;
  globalThis.fetch=async input=>{
    const url=String(input);
    if(url.includes('googleapis.com')) {
      calls++;
      if(!url.includes('key=cle-test')) return new Response('{}',{status:429});
      return new Response(JSON.stringify({items:[{volumeInfo:{
        title:'Publication trouvée',authors:['Auteur'],language:'fr',categories:['Romance'],
        description:'Un roman sentimental qui raconte les retrouvailles de deux amis après plusieurs années loin de leur village.',
        industryIdentifiers:[{identifier:'9780306406157'}]
      }}]}));
    }
    return new Response('{}',{status:404});
  };
  try {
    await lookupBook('9780306406157');
    const result=await lookupBook('9780306406157','cle-test');
    assert.equal(calls,2);
    assert.equal(result.title,'Publication trouvée');
  } finally { Object.assign(globalThis,previous); }
});
