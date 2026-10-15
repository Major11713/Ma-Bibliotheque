import test from 'node:test';
import assert from 'node:assert/strict';
import { findBookMatches, attachIsbnProposal } from '../identity.js';
import { coverTextQuery, searchCoverBooks, readCoverPhoto, cancelCoverRecognition } from '../cover-search.js';
import { DOMParser } from '@xmldom/xmldom';
const manual = { isbn:'manuel-test', title:'Glitter Girl', authors:['C. J. Ronnie'], status:'wishlist', description:'Ma correction', cover:'https://example.test/ma-photo.jpg', addedAt:'2020-01-01' };
const fresh = { isbn:'9782755640427', title:'GLITTER GIRL', authors:['CJ Ronnie'], status:'owned', description:'Résumé catalogue' };

test('titre et auteur identifient une fiche manuelle malgré ponctuation et casse', () => {
  assert.equal(findBookMatches(fresh,[manual])[0].certain,true);
});
test('homonymes de deux auteurs différents ne sont pas confondus', () => {
  assert.equal(findBookMatches({...fresh,authors:['Autre personne']},[manual]).length,0);
});
test('auteur absent reste une proposition à vérifier, jamais une fusion automatique', () => {
  assert.equal(findBookMatches({...fresh,authors:[]},[manual])[0].certain,false);
});
test('tomes différents exclus même si la série et l’auteur sont identiques', () => {
  assert.equal(findBookMatches({...fresh,title:'Série tome 2'},[{...manual,title:'Série tome 1'}]).length,0);
});
test('sous-titre ou série ajoutée propose une vérification prudente', () => {
  assert.equal(findBookMatches({...fresh,title:'Black riders tome 1 : Glitter Girl'},[manual])[0].certain,false);
});
test('une autre édition ISBN est signalée mais ne peut pas être rattachée silencieusement', () => {
  const edition = {...manual,isbn:'9782387032379'};
  assert.equal(findBookMatches(fresh,[edition]).length,1);
  assert.throws(()=>attachIsbnProposal(edition,fresh));
});
test('rattacher conserve les corrections, la date et les envies', () => {
  const proposal = attachIsbnProposal(manual,fresh);
  assert.equal(proposal.isbn,fresh.isbn);
  assert.equal(proposal.description,manual.description);
  assert.equal(proposal.cover,manual.cover);
  assert.equal(proposal.status,'wishlist');
  assert.equal(proposal.addedAt,manual.addedAt);
  assert.equal(manual.isbn,'manuel-test');
});
test('la propre fiche modifiée et son ISBN sont exclus des doublons', () => {
  assert.equal(findBookMatches(fresh,[manual],manual.isbn).length,0);
  assert.equal(findBookMatches(fresh,[fresh]).length,0);
});
test('texte OCR nettoyé sans inventer ni attribuer un auteur', () => {
  assert.equal(coverTextQuery('GLITTER GIRL\nC. J. RONNIE\n9782755640427\nhttps://site.test'),'GLITTER GIRL C. J. RONNIE');
});
test('recherche garde une édition Google et ne pioche pas un ISBN Open Library au hasard', async () => {
  const previous=global.fetch;
  global.fetch=async url=>({ok:true,json:async()=>String(url).includes('googleapis')?{
    items:[{volumeInfo:{title:'Titre français',authors:['Auteur'],industryIdentifiers:[{identifier:'9782387032379'}]}}]
  }:{docs:[{title:'Une œuvre',author_name:['Auteur'],isbn:['9782755640427']}]}});
  try {
  const result=await searchCoverBooks('Auteur');
    assert.equal(result.books[0].isbn,'9782387032379');
    assert.equal(result.books[1].isbn,'');
  } finally {global.fetch=previous;}
});
test('échec des catalogues explicite sans résultat inventé', async()=>{
  const previous=global.fetch;global.fetch=async()=>{throw new Error('offline')};
  try {const result=await searchCoverBooks('Titre');assert.equal(result.unavailable,true);assert.deepEqual(result.books,[]);}
  finally {global.fetch=previous;}
});

test('recherche BnF garde un livre, son ISBN exact et exclut les rôles de traduction',async()=>{
  const oldFetch=global.fetch,oldParser=global.DOMParser;
  global.DOMParser=DOMParser;
  global.fetch=async url=>{
    if (!String(url).includes('bnf.fr')) throw new Error('indisponible');
    return {ok:true,text:async()=>'<searchRetrieveResponse xmlns="http://www.loc.gov/zing/srw/"><records><record><recordData><dc:record xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Glitter girl / C. J. Ronnie</dc:title><dc:creator>Ronnie, C. J.. Auteur du texte</dc:creator><dc:creator>Autre, Personne. Traductrice</dc:creator><dc:identifier>ISBN 978-2-7556-4042-7</dc:identifier></dc:record></recordData></record></records></searchRetrieveResponse>'};
  };
  try{const result=await searchCoverBooks('Glitter Girl');assert.equal(result.books[0].isbn,'9782755640427');assert.deepEqual(result.books[0].authors,['C. J. Ronnie']);}
  finally{global.fetch=oldFetch;global.DOMParser=oldParser;}
});

test('annuler pendant le chargement OCR termine le moteur tardif et libère l’attente',async()=>{
  const previous={Image:global.Image,document:global.document,window:global.window};
  let deliver,terminated=false;
  global.Image=class {naturalWidth=700;naturalHeight=1000;async decode(){}};
  global.document={createElement:()=>({getContext:()=>({fillRect(){},drawImage(){}})})};
  global.window={Tesseract:{createWorker:()=>new Promise(resolve=>deliver=resolve)}};
  try{
    const pending=readCoverPhoto(new Blob(['test'],{type:'image/png'}));
    while(!deliver) await Promise.resolve();
    cancelCoverRecognition();assert.equal(await pending,null);
    deliver({terminate:async()=>{terminated=true}});
    await Promise.resolve();assert.equal(terminated,true);
  }finally{Object.assign(global,previous);cancelCoverRecognition();}
});
