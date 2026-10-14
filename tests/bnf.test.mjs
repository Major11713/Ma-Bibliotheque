import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { parseBnfRecord } from '../bnf.js';
import { inferCategories } from '../enrichment.js';
import { sameTitle, normaliseCategories } from '../api.js';

const field = (tag, values) => '<m:datafield tag="' + tag + '">' +
  values.map(([code, text]) => '<m:subfield code="' + code + '">' + text + '</m:subfield>').join('') + '</m:datafield>';
const xml = (fields) => new DOMParser().parseFromString(
  '<m:record xmlns:m="info:lc/xmlns/marcxchange-v2">' + fields.join('') + '</m:record>', 'application/xml');

test('lit le résumé éditeur 830 et exclut la traductrice avec le rôle 0680', () => {
  const result = parseBnfRecord(xml([
    field('020', [['a', '978-2-38703-237-9']]),
    field('245', [['a', 'Un chant avec le duc des mers']]),
    field('145', [['a', 'A duet with the siren duke']]),
    field('100', [['a', 'Kova'], ['m', 'Elise'], ['4', '0070']]),
    field('700', [['a', 'Arnaud'], ['m', 'Hélène'], ['4', '0680']]),
    field('830', [['a', 'Une romance dans laquelle une capitaine doit honorer son pacte avec un triton au royaume des sirènes.']]),
    field('280', [['a', '1 volume 604 p']])
  ]), '9782387032379');
  assert.deepEqual(result.authors, ['Elise Kova']);
  assert.equal(result.originalTitle, 'A duet with the siren duke');
  assert.equal(result.pageCount, 604);
  assert.deepEqual(inferCategories([], result.title, result.description), ['Romance', 'Fantasy']);
});

test('accepte le résumé 330 et les co-auteurs, même avec un autre préfixe XML', () => {
  const result = parseBnfRecord(xml([
    field('038', [['a', '9782266336994']]),
    field('100', [['a', 'Stewart'], ['m', 'Kate'], ['4', '0070']]),
    field('700', [['a', 'Autrice'], ['m', 'Seconde'], ['4', '0070']]),
    field('330', [['a', 'Une étudiante arrive dans une petite ville et découvre des secrets qui bouleversent sa nouvelle vie.']]),
    field('280', [['a', '1 vol. (461 p.)']])
  ]), '9782266336994');
  assert.deepEqual(result.authors, ['Kate Stewart', 'Seconde Autrice']);
  assert.equal(result.pageCount, 461);
  assert.ok(result.description.startsWith('Une étudiante'));
});

test('refuse une notice renvoyée pour un autre ISBN', () => {
  assert.throws(() => parseBnfRecord(xml([field('020', [['a', '9782266336994']])]), '9782387032379'),
    /exactement/);
});

test('une histoire d’amour ou des enfants dans un roman adulte ne créent pas de faux genres', () => {
  assert.deepEqual(inferCategories([], '', 'Une histoire d’amour entre adultes qui viennent en aide aux enfants.'), ['Romance']);
  assert.deepEqual(inferCategories(['enemies to lovers']), []);
});

test('ne fusionne pas deux tomes distincts avec le même titre de série', () => {
  assert.equal(sameTitle('Black Riders : tome 1', 'Black Riders : tome 2'), false);
  assert.equal(sameTitle('Dune : tome 2', 'Dune'), false);
  assert.equal(sameTitle('Saga : tome I', 'Saga : tome II'), false);
  assert.equal(sameTitle('Dune : Le Messie', 'Dune : Les Enfants'), false);
  assert.equal(sameTitle('Un chant avec le duc des mers', 'Un chant avec le duc des mers'), true);
});

test('les thèmes mystery ou adventure ne suffisent pas à classer un roman en policier ou action', () => {
  assert.deepEqual(normaliseCategories(['Fantasy', 'Children', 'Mystery', 'Adventure']), ['Fantasy', 'Jeunesse']);
});
