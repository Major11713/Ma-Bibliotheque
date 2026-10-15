import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { normaliseIsbn } from '../isbn.js';
import { findBookMatches, attachIsbnProposal } from '../identity.js';
import { BOOK_BATCH_SIZE, SORT_MODES, bookGenre, collectionPage } from '../library-order.js';

function appContext(lookupBook, getBook=async()=>null) {
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id)) elements.set(id,{value:'',textContent:'',hidden:false,open:false,disabled:false,
      reset(){},querySelector(){return {checked:false}},querySelectorAll(){return []},
      showModal(){this.open=true},close(){this.open=false},focus(){},append(){}});
    return elements.get(id);
  };
  const context=vm.createContext({document:{getElementById:element,querySelectorAll:()=>[],body:{append(){}},createElement:()=>({remove(){}})},navigator:{onLine:true},getBook,getSetting:async()=>'',stopScanner:()=>{},
    lookupBook,normaliseIsbn,findBookMatches,attachIsbnProposal,BOOK_BATCH_SIZE,SORT_MODES,bookGenre,collectionPage,getAllBooks:async()=>[],setTimeout:()=>0,clearTimeout:()=>{},console});
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

function fakeSoundContext() {
  return { state:'running',currentTime:0,destination:{}, starts:0,
    resume(){this.state='running';return Promise.resolve()},close(){this.state='closed';return Promise.resolve()},
    createOscillator(){const owner=this;return {frequency:{},connect(){return {connect(){}}},start(){owner.starts++},stop(){},disconnect(){}}},
    createGain(){return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){return {connect(){}}},disconnect(){}}}
  };
}

test('le son est rejoué après une interruption, pas seulement une suspension',async()=>{
  const {context}=appContext(async()=>({}));
  const audio=fakeSoundContext();audio.state='interrupted';context.audioFixture=audio;
  vm.runInContext('state.audio=audioFixture;',context);
  assert.equal(await context.playFeedback(false),true);
  audio.state='interrupted';
  assert.equal(await context.playFeedback(false),true);
  assert.equal(audio.starts,4);
});

test('un clic de réactivation remplace un contexte audio interrompu',async()=>{
  const {context}=appContext(async()=>({}));
  const previous=fakeSoundContext();previous.state='interrupted';
  const replacement=fakeSoundContext();
  context.window={AudioContext:class{constructor(){return replacement}}};context.audioFixture=previous;
  vm.runInContext('state.audio=audioFixture;',context);
  assert.equal(await context.playFeedback(false,true),true);
  assert.equal(previous.state,'closed');assert.equal(replacement.starts,2);
});

test('un moteur fermé est recréé pour le prochain signal',async()=>{
  const {context}=appContext(async()=>({}));
  const old=fakeSoundContext();old.state='closed';const replacement=fakeSoundContext();
  context.window={AudioContext:class{constructor(){return replacement}}};context.audioFixture=old;
  vm.runInContext('state.audio=audioFixture;',context);
  assert.equal(await context.playFeedback(false),true);assert.equal(replacement.starts,2);
});

test('la commande Réécouter recrée le moteur même si un ancien moteur paraît actif mais reste muet',async()=>{
  const {context}=appContext(async()=>({}));
  const old=fakeSoundContext(),replacement=fakeSoundContext();
  context.audioFixture=old;context.window={AudioContext:class{constructor(){return replacement}}};
  vm.runInContext('state.audio=audioFixture;',context);
  assert.equal(await context.replayFeedback(false),true);
  assert.equal(old.state,'closed');assert.equal(replacement.starts,2);
});

test('un son refusé ne masque pas le résultat visuel et propose une réactivation',async()=>{
  const {context,element}=appContext(async()=>({}));
  const audio=fakeSoundContext();audio.state='suspended';audio.resume=()=>Promise.reject(new Error('bloqué'));
  context.audioFixture=audio;vm.runInContext('state.audio=audioFixture;',context);
  assert.equal(await context.playFeedback(false),false);
  assert.match(element('scannerAudioStatus').textContent,/réactiver/);
});

test('relancer volontairement le scanner accepte immédiatement le même ISBN',async()=>{
  const {context,element}=appContext(async()=>({}),async()=>({title:'Livre possédé',status:'owned'}));
  let negative=0;context.playFeedback=async positive=>{if(!positive)negative++};context.startScanner=async()=>{};
  element('scannerDialog').open=true;
  await context.processScan('9782755640427');
  assert.match(element('scanResult').innerHTML,/Vous l’avez déjà/);
  await context.startCamera();
  await context.processScan('9782755640427');
  assert.equal(negative,2);
});

test('lecture photo peu fiable : proposer de corriger sans rechercher le texte déformé',async()=>{
  const {context,element}=appContext(async()=>({}));
  context.cancelCoverRecognition=()=>{};
  context.readCoverPhoto=async()=>({text:'Texte déformé',confidence:35});
  context.coverTextQuery=text=>text;
  let searched=false;context.searchDiscovery=async()=>{searched=true};
  element('coverSearchDialog').open=true;
  await context.handleCoverPhoto({});
  assert.equal(searched,false);
  assert.equal(element('coverQuery').value,'Texte déformé');
  assert.match(element('coverReadingNotice').textContent,/aucun livre n’est encore identifié/);
  assert.equal(element('coverSearchSubmit').disabled,false);
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
