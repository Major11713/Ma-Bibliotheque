const DB_NAME = 'ma-bibliotheque-db';
const DB_VERSION = 1;
const BOOKS = 'books';
const SETTINGS = 'settings';

let databasePromise;

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => { databasePromise = undefined; reject(request.error); };
    request.onblocked = () => { databasePromise = undefined; reject(new Error('Fermez les autres onglets de Ma Bibliothèque puis réessayez.')); };
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BOOKS)) {
        const store = db.createObjectStore(BOOKS, { keyPath: 'isbn' });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('addedAt', 'addedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(SETTINGS)) db.createObjectStore(SETTINGS, { keyPath: 'key' });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); databasePromise = undefined; };
      resolve(db);
    };
  });
  return databasePromise;
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAllBooks() {
  const db = await openDatabase();
  return requestToPromise(db.transaction(BOOKS, 'readonly').objectStore(BOOKS).getAll());
}

export async function getBook(isbn) {
  const db = await openDatabase();
  return requestToPromise(db.transaction(BOOKS, 'readonly').objectStore(BOOKS).get(isbn));
}

export async function saveBook(book, originalIsbn = '') {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BOOKS, 'readwrite');
    const store = tx.objectStore(BOOKS);
    let failure;
    const check = store.get(book.isbn);
    check.onsuccess = () => {
      if (check.result && book.isbn !== originalIsbn) {
        failure = new Error('Un livre avec cet ISBN existe déjà.');
        tx.abort();
        return;
      }
      try {
        if (originalIsbn && originalIsbn !== book.isbn) store.delete(originalIsbn);
        store.put(book);
      } catch (error) { failure = error; tx.abort(); }
    };
    tx.oncomplete = () => resolve(book);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(failure || tx.error || new Error('Sauvegarde annulée.'));
  });
}

export async function removeBook(isbn) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BOOKS, 'readwrite');
    tx.objectStore(BOOKS).delete(isbn);
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('Suppression annulée.'));
  });
}

export async function importBooks(books, { conflict = 'keep' } = {}) {
  if (!['keep', 'overwrite'].includes(conflict)) throw new Error('Choix d’import invalide.');
  if (new Set(books.map(book => book.isbn)).size !== books.length) throw new Error('La sauvegarde contient des ISBN en double.');
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BOOKS, 'readwrite');
    const store = tx.objectStore(BOOKS);
    const report = { added: 0, kept: 0, updated: 0 };
    let failure;
    for (const book of books) {
      const check = store.get(book.isbn);
      check.onsuccess = () => {
        if (check.result && conflict === 'keep') { report.kept++; return; }
        if (check.result) report.updated++; else report.added++;
        try { store.put(book); } catch (error) { failure = error; tx.abort(); }
      };
    }
    tx.oncomplete = () => resolve(report);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(failure || tx.error || new Error('Import annulé : aucune modification sauvegardée.'));
  });
}

export async function getSetting(key) {
  const db = await openDatabase();
  const record = await requestToPromise(db.transaction(SETTINGS, 'readonly').objectStore(SETTINGS).get(key));
  return record?.value ?? '';
}

export async function setSetting(key, value) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SETTINGS, 'readwrite');
    tx.objectStore(SETTINGS).put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('Réglage non sauvegardé.'));
  });
}

export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  try { return await navigator.storage.persist(); } catch { return false; }
}

export async function getStorageEstimate() {
  if (!navigator.storage?.estimate) return null;
  try { return await navigator.storage.estimate(); } catch { return null; }
}
