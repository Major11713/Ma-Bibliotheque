import test from 'node:test';
import assert from 'node:assert/strict';
import {DOMParser as XmlParser} from '@xmldom/xmldom';
import {lookupBook} from '../api.js';

test('Actualiser contourne le cache et relit réellement les catalogues', async () => {
  const previous = {fetch:globalThis.fetch, DOMParser:globalThis.DOMParser, localStorage:globalThis.localStorage};
  const memory=new Map();
  globalThis.localStorage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
  globalThis.DOMParser=class {
    parseFromString(text, mime) {
      return mime === 'text/html' ? {body:{textContent:text}} : new XmlParser().parseFromString(text,mime);
    }
  };
  let calls=0;
  let title='Titre initial';
  globalThis.fetch=async url => {
    if(String(url).includes('catalogue.bnf.fr')) {
      calls++;
      return new Response('<record xmlns="info:lc/xmlns/marcxchange-v2">' +
        '<datafield tag="020"><subfield code="a">9782387032379</subfield></datafield>' +
        '<datafield tag="245"><subfield code="a">' + title + '</subfield></datafield>' +
        '<datafield tag="100"><subfield code="a">Kova</subfield><subfield code="m">Elise</subfield><subfield code="4">0070</subfield></datafield>' +
        '<datafield tag="830"><subfield code="a">Une romance fantasy dans laquelle une héroïne doit sauver sa famille et honorer un pacte dangereux.</subfield></datafield>' +
        '</record>',{status:200});
    }
    return new Response('{}',{status:404});
  };
  try {
    assert.equal((await lookupBook('9782387032379')).title,'Titre initial');
    title='Titre actualisé';
    assert.equal((await lookupBook('9782387032379')).title,'Titre initial');
    assert.equal(calls,1);
    assert.equal((await lookupBook('9782387032379','',{refresh:true})).title,'Titre actualisé');
    assert.equal(calls,2);
  } finally {Object.assign(globalThis, previous);}
});
