const DB_NAME = 'ma-bibliotheque-db';
const DB_VERSION = 1;
const BOOKS = 'books';
const SETTINGS = 'settings';

let databasePromise;

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BOOKS)) {
        const store = db.createObjectStore(BOOKS, { keyPath: 'isbn' });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('addedAt', 'addedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(SETTINGS)) db.createObjectStore(SETTINGS, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
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
    if (originalIsbn && originalIsbn !== book.isbn) store.delete(originalIsbn);
    store.put(book);
    tx.oncomplete = () => resolve(book);
    tx.onerror = () => reject(tx.error);
  });
}

export async function removeBook(isbn) {
  const db = await openDatabase();
  return requestToPromise(db.transaction(BOOKS, 'readwrite').objectStore(BOOKS).delete(isbn));
}

export async function importBooks(books, { replace = false } = {}) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BOOKS, 'readwrite');
    const store = tx.objectStore(BOOKS);
    if (replace) store.clear();
    for (const book of books) store.put(book);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getSetting(key) {
  const db = await openDatabase();
  const record = await requestToPromise(db.transaction(SETTINGS, 'readonly').objectStore(SETTINGS).get(key));
  return record?.value ?? '';
}

export async function setSetting(key, value) {
  const db = await openDatabase();
  return requestToPromise(db.transaction(SETTINGS, 'readwrite').objectStore(SETTINGS).put({ key, value }));
}

export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  try { return await navigator.storage.persist(); } catch { return false; }
}

export async function getStorageEstimate() {
  if (!navigator.storage?.estimate) return null;
  try { return await navigator.storage.estimate(); } catch { return null; }
}
