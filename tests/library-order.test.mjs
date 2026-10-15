import test from 'node:test';
import assert from 'node:assert/strict';
import { BOOK_BATCH_SIZE, orderBooks, bookGenre, collectionPage } from '../library-order.js';
const books = [
  {isbn:'a',title:'Été 10',authors:['Émile Zola'],categories:['Romance','Histoire'],status:'owned',addedAt:'2026-01-01'},
  {isbn:'b',title:'ete 2',authors:['Victor Hugo'],categories:['Fantasy'],status:'owned',addedAt:'2026-03-01'},
  {isbn:'c',title:'Alpha',authors:[],categories:[],status:'owned',addedAt:'2026-02-01'},
  {isbn:'d',title:'Autre histoire',authors:['Zola, Émile'],categories:['Histoire'],status:'wishlist',addedAt:'2026-02-02'}
];
test('titre : alphabet français, accents et nombres naturels',()=>{
  assert.deepEqual(orderBooks(books,'title').map(b=>b.isbn),['c','d','b','a']);
});
test('auteur : nom du premier auteur, puis titre ; inconnus à la fin',()=>{
  assert.deepEqual(orderBooks(books,'author').map(b=>b.isbn),['b','d','a','c']);
});
test('genre : premier genre alphabétique puis titre ; non classés à la fin',()=>{
  assert.deepEqual(orderBooks(books,'genre').map(b=>b.isbn),['b','d','a','c']);
  assert.equal(bookGenre(books[0]),'Histoire');
  assert.equal(bookGenre(books[0],'Romance'),'Romance');
  assert.deepEqual(books[0].categories,['Romance','Histoire']);
});
test('derniers ajouts : dates décroissantes et titre pour départager',()=>{
  assert.deepEqual(orderBooks(books,'recent').map(b=>b.isbn),['b','d','c','a']);
});
test('filtre sur un genre secondaire, recherche sans accents et tri se combinent',()=>{
  const result=collectionPage(books,{category:'Romance',query:'ete',sort:'author'});
  assert.equal(result.total,1);assert.equal(result.items[0].isbn,'a');
});
test('envies et livres possédés restent séparés',()=>{
  assert.equal(collectionPage(books,{status:'wishlist'}).total,1);
  assert.equal(collectionPage(books).total,3);
});
test('2500 livres : affichage par lots sans tronquer la recherche ni le stockage',()=>{
  const large=Array.from({length:2500},(_,i)=>({isbn:`manuel-${i}`,title:`Livre ${i}`,authors:['Auteur'],categories:['Roman'],status:'owned'}));
  const page=collectionPage(large);
  assert.equal(page.total,2500);assert.equal(page.items.length,BOOK_BATCH_SIZE);assert.equal(page.remaining,2440);
  assert.equal(collectionPage(large,{limit:120}).items.length,120);
  assert.equal(collectionPage(large,{query:'Livre 2499'}).items[0].isbn,'manuel-2499');
  assert.equal(collectionPage(large,{limit:3000}).items.length,2500);
  assert.equal(large.length,2500);
});
test('trier ne modifie jamais les fiches ni leur ordre dans la base',()=>{
  const before=JSON.stringify(books);for(const sort of ['title','author','genre','recent'])orderBooks(books,sort);
  assert.equal(JSON.stringify(books),before);
});
