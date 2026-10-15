import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { normaliseIsbn } from '../isbn.js';
import { findBookMatches, attachIsbnProposal } from '../identity.js';

function appContext(lookupBook, getBook=async()=>null) {
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id)) elements.set(id,{value:'',textContent:'',hidden:false,open:false,disabled:false,
      reset(){},querySelector(){return {checked:false}},querySelectorAll(){return []},
      showModal(){this.open=true},close(){this.open=false},focus(){},append(){}});
    return elements.get(id);
  };
  const context=vm.createContext({document:{getElementById:element,querySelectorAll:()=>[],body:{append(){}},createElement:()=>({remove(){}})},navigator:{onLine:true},getBook,getSetting:async()=>'',stopScanner:()=>{},
    lookupBook,normaliseIsbn,findBookMatches,attachIsbnProposal,getAllBooks:async()=>[],setTimeout:()=>0,console});
  const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8')
    .replace(/^import .*;\r?\n/gm,'').replaceAll('export ','').replace(/\binit\(\);\s*$/,'');
  vm.runInContext(source,context);
  return {context,element};
}

test('une recherche ancienne ne remplit plus un nouvel ajout manuel',async()=>{
  let finish;
  const {context,element}=appContext(()=>new Promise(resolve=>finish=resolve));
  const pending=context.beginAddByIsbn('9782387032379');
  while(!finish) await Promise.resolve();
  context.closeDialog(element('bookFormDialog'));
  await context.openManualForm();
  element('formBookTitle').value='Mon nouveau livre';
  finish({title:'Ancien résultat',authors:['Auteur'],categories:['Romance'],description:'Résumé',cover:'https://example.test/img'});
  await pending;
  assert.equal(element('formBookTitle').value,'Mon nouveau livre');
});

test('fermer avant la première lecture du stockage empêche le dialogue tardif',async()=>{
  let finish;
  const {context,element}=appContext(()=>{},()=>new Promise(resolve=>finish=resolve));
  element('scannerDialog').open=true;
  const pending=context.beginAddByIsbn('9782387032379');
  await context.closeScanner();
  finish(null);await pending;
  assert.equal(element('bookFormDialog').open,false);
});

test('Actualiser retire les anciennes catégories erronées de la proposition',async()=>{
  const {context,element}=appContext(async()=>({
    title:'Titre vérifié',authors:['Auteur'],categories:['Romance'],
    description:'Résumé',cover:'https://example.test/cover'
  }));
  vm.runInContext("state.books = [{isbn:'9782387032379',title:'Titre',categories:['Mauvais genre'],status:'owned'}]; state.selectedIsbn='9782387032379';",context);
  element('bookDetailDialog').open=true;
  await context.refreshSelectedBook();
  assert.equal(element('formCategories').value,'Romance');
  assert.equal(element('bookFormDialog').open,true);
});

function scannerContext(native, acquire, reader) {
  let loops=0;
  const context=vm.createContext({
    window:native ? {BarcodeDetector:true} : {ZXingBrowser:{BrowserMultiFormatReader:reader}},
    BarcodeDetector:class{static async getSupportedFormats(){return ['ean_13']} async detect(){return []}},
    navigator:{mediaDevices:{getUserMedia:acquire}},requestAnimationFrame:()=>++loops,cancelAnimationFrame:()=>{},console
  });
  vm.runInContext(fs.readFileSync(new URL('../scanner.js',import.meta.url),'utf8').replaceAll('export ',''),context);
  return {context,loops:()=>loops};
}

test('le scan vérifie les fiches manuelles avant de déclarer un nouveau livre',async()=>{
  const fresh={isbn:'9782755640427',title:'Glitter Girl',authors:['CJ Ronnie']};
  const manual={isbn:'manuel-qa',title:'Glitter Girl',authors:['C. J. Ronnie'],status:'owned'};
  const {context,element}=appContext(async()=>fresh);
  context.getAllBooks=async()=>[manual];
  context.playFeedback=async()=>{};
  let prompted=false,seen='';
  context.askDuplicate=async()=>{prompted=true;return {action:'existing',book:manual}};
  context.openBookDetail=isbn=>{seen=isbn};
  vm.runInContext("state.books=[{isbn:'manuel-qa'}]; state.scanMode='check';",context);
  element('scannerDialog').open=true;
  await context.processScan(fresh.isbn);
  assert.equal(prompted,true);assert.equal(seen,'manuel-qa');
  assert.equal(element('scannerDialog').open,false);
});

test('fermer la recherche annule toute réponse future et ferme le rapprochement sans fusion',()=>{
  const {context,element}=appContext(async()=>({}));
  let cancelled=false,choice;
  context.cancelCoverRecognition=()=>{cancelled=true};
  vm.runInContext('state.discoveryToken=3;',context);
  context.closeDialog(element('coverSearchDialog'));
  assert.equal(vm.runInContext('state.discoveryToken',context),4);assert.equal(cancelled,true);
  context.askDuplicate({title:'Titre'},[]).then(result=>choice=result);
  context.closeDialog(element('duplicateDialog'));
  return Promise.resolve().then(()=>assert.equal(choice.action,'cancel'));
});

test('fermer pendant la permission caméra arrête le flux qui arrive ensuite',async()=>{
  let deliver;let stopped=false;
  const track={stop:()=>stopped=true,getCapabilities:()=>({})};
  const {context,loops}=scannerContext(true,()=>new Promise(resolve=>deliver=resolve));
  const pending=context.startScanner({play:async()=>{}},()=>{});
  while(!deliver) await Promise.resolve();
  context.stopScanner();
  deliver({getTracks:()=>[track],getVideoTracks:()=>[track]});
  assert.equal(await pending,false);assert.equal(stopped,true);assert.equal(loops(),0);
});

test('fermer pendant le démarrage ZXing arrête ses contrôles tardifs',async()=>{
  let ready;let stopped=false;let trackStopped=false;
  const track={stop:()=>trackStopped=true,getCapabilities:()=>({})};
  const stream={getTracks:()=>[track],getVideoTracks:()=>[track]};
  const {context}=scannerContext(false,async()=>stream,class{
    decodeFromStream(){return new Promise(resolve=>ready=resolve)}
  });
  const pending=context.startScanner({play:async()=>{}},()=>{});
  while(!ready) await Promise.resolve();
  context.stopScanner();
  ready({stop:()=>stopped=true});
  assert.equal(await pending,false);assert.equal(stopped,true);assert.equal(trackStopped,true);
});
