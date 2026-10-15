import { normaliseIsbn } from './isbn.js';
import { identityText } from './identity.js';

export function coverTextQuery(text) {
  return String(text).split(/\r?\n/).map(line => line.trim())
    .filter(line => /[a-zÀ-ÿ]{2}/i.test(line) && !/^(www\.|https?:|isbn\b|\d)/i.test(line))
    .slice(0, 8).join(' ').slice(0, 180);
}

export function discoveryResultMessage(count, unavailable = false) {
  if (!count) return unavailable
    ? 'Catalogues indisponibles et aucune fiche locale correspondante. Réessayez plus tard ou scannez le code-barres.'
    : 'Aucun livre identifié pour ce texte. Si la recherche vient d’une photo, corrigez les mots mal lus et gardez seulement le titre et l’auteur, ou scannez le code-barres.';
  return `${count} ${count > 1 ? 'livres proposés' : 'livre proposé'}. ${unavailable ? 'Seules vos fiches locales sont disponibles. ' : ''}Vérifiez le titre, l’auteur et le tome avant de choisir.`;
}

async function json(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Catalogue indisponible (${response.status})`);
  return response.json();
}

async function searchBnf(text, signal) {
  const params = new URLSearchParams({ version: '1.2', operation: 'searchRetrieve',
    query: `bib.anywhere all "${text.replace(/["\\]/g, ' ')}"`, recordSchema: 'dc', maximumRecords: '10' });
  const response = await fetch('https://catalogue.bnf.fr/api/SRU?' + params, { signal });
  if (!response.ok) throw new Error('BnF indisponible');
  const doc = new DOMParser().parseFromString(await response.text(), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Réponse BnF invalide');
  const records = [...doc.getElementsByTagNameNS('*', 'recordData')];
  return records.flatMap(record => {
    const values = name => [...record.getElementsByTagNameNS('*', name)].map(node => node.textContent.trim());
    const title = values('title')[0];
    if (!title) return [];
    return [{ title: title.split(/\s+\/\s+/)[0], authors: values('creator').filter(author => !/traduct|illustrat|chant|groupe vocal/i.test(author)).map(author => author.replace(/\([^)]*\)/g, '').replace(/\.\s*(Auteur|Autrice).*$/i, '').trim()).map(author => {
      const match = author.match(/^([^,]+),\s*([^,]+)$/);return match ? `${match[2]} ${match[1]}` : author;
    }), isbn: values('identifier').map(normaliseIsbn).find(Boolean) || '', source: 'BnF · proposition à confirmer' }];
  });
}

export async function searchCoverBooks(query, apiKey = '', { signal } = {}) {
  const text = String(query).trim().slice(0, 180);
  if (text.length < 2) return { books: [], unavailable: false };
  const google = new URL('https://www.googleapis.com/books/v1/volumes');
  google.search = new URLSearchParams({ q: text, maxResults: '12', printType: 'books', langRestrict: 'fr', ...(apiKey ? { key: apiKey } : {}) });
  const open = new URL('https://openlibrary.org/search.json');
  open.search = new URLSearchParams({ q: text + ' language:fre', lang: 'fr', limit: '10', fields: 'key,title,author_name,first_publish_year,editions,editions.key,editions.title,editions.language,editions.isbn' });
  const results = await Promise.allSettled([json(google, signal), json(open, signal), searchBnf(text, signal)]);
  const books = [];
  if (results[0].status === 'fulfilled') for (const item of results[0].value.items || []) {
    const v = item.volumeInfo || {};
    if (!v.title) continue;
    books.push({ title: [v.title, v.subtitle].filter(Boolean).join(' : '), authors: v.authors || [],
      isbn: (v.industryIdentifiers || []).map(id => normaliseIsbn(id.identifier)).find(Boolean) || '',
      publishedDate: v.publishedDate || '', publisher: v.publisher || '', source: 'Google Books · proposition à confirmer' });
  }
  if (results[1].status === 'fulfilled') for (const doc of results[1].value.docs || []) {
    const edition = doc.editions?.docs?.find(item => item.language?.includes('fre'));
    // Ne jamais choisir un ISBN au hasard dans la liste des éditions d'une œuvre.
    books.push({ title: edition?.title || doc.title, authors: doc.author_name || [],
      isbn: (edition?.isbn || []).map(normaliseIsbn).find(Boolean) || '',
      publishedDate: String(doc.first_publish_year || ''), source: 'Open Library · proposition à confirmer' });
  }
  if (results[2].status === 'fulfilled') books.push(...results[2].value);
  const seen = new Set();
  const words = [...new Set(identityText(text).split(' ').filter(word => word.length > 1 && !['le','la','les','de','du','des','un','une','et','the'].includes(word)))];
  const score = book => {
    const content = ' ' + identityText([book.title, ...(book.authors || [])].join(' ')) + ' ';
    return words.length ? words.filter(word => content.includes(' ' + word + ' ')).length / words.length : 1;
  };
  return { unavailable: results.every(result => result.status === 'rejected'), books: books.filter(book => {
    if (!book.title) return false;
    if (score(book) < 0.6) return false;
    const key = book.isbn || identityText(book.title) + ':' + identityText(book.authors.join(' '));
    if (seen.has(key)) return false; seen.add(key); return true;
  }).sort((a, b) => score(b) - score(a)).slice(0, 18) };
}

let generation = 0;
let worker;
let stopWaiting;
export function cancelCoverRecognition() {
  generation++;
  const stop = stopWaiting; stopWaiting = null;
  if (stop) stop();
  const current = worker; worker = null;
  if (current) current.terminate().catch(() => {});
}

export async function readCoverPhoto(file, progress = () => {}) {
  cancelCoverRecognition();
  const ticket = generation;
  if (!file || !file.type.startsWith('image/')) throw new Error('Choisissez une photo de couverture.');
  if (file.size > 20 * 1024 * 1024) throw new Error('La photo dépasse 20 Mo.');
  const image = new Image();
  const url = URL.createObjectURL(file);
  let activeWorker;
  let stopped;
  const cancellation = new Promise(resolve => { stopped = () => resolve(null); });
  stopWaiting = stopped;
  const timer = setTimeout(() => { stopped(); if (worker) worker.terminate().catch(() => {}); }, 60000);
  try {
    image.src = url;
    const decoded = await Promise.race([image.decode().then(() => true), cancellation]);
    if (!decoded) return null;
    if (ticket !== generation) return null;
    const ratio = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const creation = window.Tesseract.createWorker('fra', 1, {
      workerPath: new URL('./vendor/ocr/worker.min.js', import.meta.url).href,
      corePath: new URL('./vendor/ocr/core/', import.meta.url).href,
      langPath: new URL('./vendor/ocr/lang/', import.meta.url).href,
      logger: message => { if (ticket === generation) progress(message); },
    }).then(created => {
      if (ticket !== generation || stopWaiting !== stopped) { created.terminate().catch(() => {}); return null; }
      return created;
    });
    activeWorker = await Promise.race([creation, cancellation]);
    if (!activeWorker) return null;
    if (ticket !== generation) { await activeWorker.terminate(); return null; }
    worker = activeWorker;
    const configured = await Promise.race([activeWorker.setParameters({ tessedit_pageseg_mode: '11' }).then(() => true), cancellation]);
    if (!configured) return null;
    const result = await Promise.race([activeWorker.recognize(canvas), cancellation]);
    if (!result) return null;
    if (ticket !== generation) return null;
    return { text: result.data.text.trim(), confidence: Number(result.data.confidence) || 0 };
  } finally {
    clearTimeout(timer);
    if (stopWaiting === stopped) stopWaiting = null;
    URL.revokeObjectURL(url);
    if (activeWorker && worker === activeWorker) { worker = null; await activeWorker.terminate().catch(() => {}); }
  }
}
