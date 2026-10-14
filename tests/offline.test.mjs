import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function worker(fetcher,quotaError=false) {
  const handlers={};const saved=new Map();
  const context=vm.createContext({
    self:{location:{origin:'https://app.test'},addEventListener:(name,fn)=>handlers[name]=fn},
    caches:{match:async request=>saved.get(request.url),open:async()=>({put:async(request,response)=>{
      if(quotaError)throw new Error('QuotaExceededError');
      saved.set(request.url,response);
    }})},
    fetch:fetcher,Response,URL
  });
  vm.runInContext(fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8'),context);
  return {async get(request){let result;handlers.fetch({request,respondWith:p=>result=p});return result;},saved};
}
test('une image distante opaque reste disponible quand le réseau disparaît',async()=>{
  let online=true;
  const opaque={ok:false,type:'opaque',clone(){return this}};
  const sw=worker(async()=>{if(!online)throw new Error('Offline');return opaque;});
  const request={method:'GET',url:'https://cover.test/book.jpg',destination:'image'};
  assert.equal(await sw.get(request),opaque);assert.equal(sw.saved.size,1);
  online=false;assert.equal(await sw.get(request),opaque);
});
test('un stockage plein ne masque pas une réponse réseau correcte',async()=>{
  const response=new Response('image disponible');
  const sw=worker(async()=>response,true);
  assert.equal(await sw.get({method:'GET',url:'https://app.test/app.js',destination:'script'}),response);
});
