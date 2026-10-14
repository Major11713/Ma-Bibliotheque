import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { saveBook, getBook, getAllBooks, importBooks, removeBook, setSetting, getSetting } from '../db.js';
import { validateBackup } from '../backup.js';
import { normaliseIsbn } from '../isbn.js';

test('normalise les ISBN-10 et rejette les clés invalides', () => {
  assert.equal(normaliseIsbn('0-14-032872-6'), '9780140328721');
  assert.equal(normaliseIsbn('9782387032378'), '');
  assert.equal(normaliseIsbn('1234567890128'), '');
});

test('import conserve par défaut les corrections et le statut possédé', async () => {
  const original = {isbn:'9782387032379',title:'Titre corrigé',status:'owned'};
  await saveBook(original);
  const report = await importBooks([{...original,title:'Ancienne sauvegarde',status:'wishlist'},
    {isbn:'9780140328721',title:'Nouveau',status:'wishlist'}]);
  assert.deepEqual(report,{added:1,kept:1,updated:0});
  assert.deepEqual(await getBook(original.isbn),original);
  assert.equal((await getBook('9780140328721')).status,'wishlist');
});

test('remplacement explicite conserve les livres absents du fichier', async () => {
  const report = await importBooks([{isbn:'9782387032379',title:'Remplacement choisi',status:'wishlist'}],{conflict:'overwrite'});
  assert.deepEqual(report,{added:0,kept:0,updated:1});
  assert.equal((await getBook('9782387032379')).title,'Remplacement choisi');
  assert.ok(await getBook('9780140328721'));
});

test('changement vers un ISBN existant refuse et conserve les deux fiches', async () => {
  await assert.rejects(saveBook({isbn:'9780140328721',title:'Écrasement'},'9782387032379'), /existe déjà/);
  assert.equal((await getBook('9782387032379')).title,'Remplacement choisi');
  assert.equal((await getBook('9780140328721')).title,'Nouveau');
});

test('deux ajouts simultanés du même ISBN ne s’écrasent pas', async () => {
  const results = await Promise.allSettled([
    saveBook({isbn:'9782266336994',title:'Premier'}),
    saveBook({isbn:'9782266336994',title:'Second'})
  ]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await getBook('9782266336994')).title,'Premier');
});

test('une erreur de transaction annule entièrement l’import', async () => {
  const before=await getAllBooks();
  await assert.rejects(importBooks([
    {isbn:'9782266320481',title:'Ajout avant erreur'},
    {isbn:'bad',title:'Objet non stockable',invalid:()=>{}}
  ]));
  assert.deepEqual(await getAllBooks(),before);
});

test('sauvegarde JSON conserve les métadonnées et refuse les ISBN répétés', () => {
  const payload={app:'Ma Bibliothèque',version:1,books:[{
    isbn:'9780140328721',title:'Un livre',authors:['Auteur'],categories:['Jeunesse'],
    status:'owned',publisher:'Éditeur',language:'fr',pageCount:'1 vol. (120 p.)'
  }]};
  const [book]=validateBackup(payload);
  assert.equal(book.publisher,'Éditeur');assert.equal(book.language,'fr');
  assert.equal(book.pageCount,'1 vol. (120 p.)');
  assert.throws(()=>validateBackup({...payload,books:[...payload.books,...payload.books]}),/plusieurs fois/);
  assert.throws(()=>validateBackup({...payload,books:[{...payload.books[0],cover:'javascript:alert(1)'}]}),/couverture/);
  assert.throws(()=>validateBackup({...payload,version:99}),/version/);
});

test('réglages et suppression sont confirmés après validation de la transaction', async () => {
  await setSetting('test','valeur');
  assert.equal(await getSetting('test'),'valeur');
  await removeBook('9782266336994');
  assert.equal(await getBook('9782266336994'),undefined);
});
