import { getAllBooks, getBook, saveBook, removeBook, importBooks, getSetting, setSetting, requestPersistentStorage, getStorageEstimate } from './db.js';
import { normaliseIsbn } from './isbn.js';
import { validateBackup } from './backup.js';
import { lookupBook } from './api.js';
import { startScanner, stopScanner, toggleTorch } from './scanner.js';
import { findBookMatches, attachIsbnProposal } from './identity.js';
import { readCoverPhoto, cancelCoverRecognition, coverTextQuery, searchCoverBooks } from './cover-search.js';

const state = {
  books: [],
  category: 'Toutes',
  selectedIsbn: '',
  scanMode: 'check',
  scanBusy: false,
  lastScanned: '',
  lastScannedAt: 0,
  lookupToken: 0,
  cameraToken: 0,
  scanSession: 0,
  detailToken: 0,
  pendingImport: null,
  formPublisher: '',
  formLanguage: '',
  audio: null,
  formDataSource: 'Saisie manuelle',
  formDescriptionTranslated: false,
  duplicateResolve: null,
  discoveryToken: 0,
  discoveryController: null,
  discoveryBooks: [],
  formSaving: false,
};

const el = Object.fromEntries([
  'viewLibrary', 'viewWishes', 'ownedCount', 'wishCount', 'categoryCount', 'searchInput', 'clearSearch',
  'categoryFilters', 'resultsNote', 'bookGrid', 'emptyLibrary', 'wishSearchInput', 'wishList', 'emptyWishes',
  'scannerDialog', 'closeScanner', 'scannerVideo', 'cameraPlaceholder', 'scannerMessage', 'scannerHint',
  'manualIsbnForm', 'manualIsbn', 'scanResult', 'torchButton', 'bookFormDialog', 'bookForm',
  'formEyebrow', 'formTitle', 'metadataLoading', 'editingOriginalIsbn', 'formIsbn', 'formBookTitle',
  'formAuthors', 'formCategories', 'formDescription', 'formPublishedDate', 'formPageCount', 'formCover',
  'formCoverPreview', 'formCoverFallback', 'formSource', 'bookDetailDialog', 'bookDetailContent',
  'deleteBookButton', 'toggleBookStatus', 'editBookButton', 'refreshBookButton', 'settingsButton', 'settingsDialog',
  'exportButton', 'importButton', 'importFile', 'googleApiKey', 'saveApiKeyButton', 'storageStatus',
  'importPreviewDialog', 'importSummary', 'importConflicts', 'confirmImportButton',
  'openCoverSearch', 'openTitleSearch', 'coverSearchDialog', 'coverPhotoInput', 'coverGalleryInput',
  'coverProgress', 'coverOcrText', 'coverTextDetails', 'coverSearchForm', 'coverQuery', 'coverSearchSubmit',
  'coverScanFallback', 'coverResults', 'coverManualFallback', 'duplicateDialog', 'duplicateMessage',
  'duplicateCandidates', 'duplicateDifferent', 'buyBookLink',
  'toastRegion', 'networkBanner', 'manualAddButton', 'welcomeDate'
].map((id) => [id, document.getElementById(id)]));

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function initials(title = '') {
  return title.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase() || 'Aa';
}

function formatAuthors(book) {
  const authors = Array.isArray(book.authors) ? book.authors : [];
  return authors.length ? authors.join(', ') : 'Auteur inconnu';
}

function coverMarkup(book, className = '') {
  const fallback = `<span class="cover-fallback">${escapeHtml(initials(book.title))}</span>`;
  if (!book.cover) return `<div class="${className}">${fallback}</div>`;
  return `<div class="${className}"><img src="${escapeHtml(book.cover)}" alt="Couverture de ${escapeHtml(book.title)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="cover-fallback" hidden>${escapeHtml(initials(book.title))}</span></div>`;
}

function normaliseSearch(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function matchesSearch(book, query) {
  if (!query) return true;
  const haystack = [book.title, ...(book.authors || []), book.isbn, ...(book.categories || [])].join(' ');
  return normaliseSearch(haystack).includes(normaliseSearch(query));
}

function sortedBooks(books) {
  return [...books].sort((a, b) => String(b.addedAt || '').localeCompare(String(a.addedAt || '')) || a.title.localeCompare(b.title, 'fr'));
}

function render() {
  const owned = state.books.filter((book) => book.status === 'owned');
  const wishes = state.books.filter((book) => book.status === 'wishlist');
  const categories = [...new Set(owned.flatMap((book) => book.categories || []))].sort((a, b) => a.localeCompare(b, 'fr'));
  el.ownedCount.textContent = owned.length;
  el.wishCount.textContent = wishes.length;
  el.categoryCount.textContent = categories.length;

  if (state.category !== 'Toutes' && !categories.includes(state.category)) state.category = 'Toutes';
  el.categoryFilters.innerHTML = ['Toutes', ...categories].map((category) => (
    `<button type="button" class="filter-chip${state.category === category ? ' active' : ''}" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`
  )).join('');

  const query = el.searchInput.value;
  const visible = sortedBooks(owned).filter((book) => matchesSearch(book, query) && (state.category === 'Toutes' || book.categories?.includes(state.category)));
  el.bookGrid.innerHTML = visible.map((book) => `
    <button class="book-card" type="button" data-book-isbn="${escapeHtml(book.isbn)}" aria-label="Voir ${escapeHtml(book.title)}">
      ${coverMarkup(book, 'book-cover')}
      <h3>${escapeHtml(book.title || 'Sans titre')}</h3>
      <p>${escapeHtml(formatAuthors(book))}</p>
      <span class="book-category">${escapeHtml(book.categories?.[0] || 'Non classé')}</span>
    </button>`).join('');
  el.emptyLibrary.hidden = owned.length > 0 || Boolean(query) || state.category !== 'Toutes';
  el.bookGrid.hidden = visible.length === 0;
  if (owned.length === 0) el.resultsNote.textContent = '';
  else if (visible.length === owned.length && !query && state.category === 'Toutes') el.resultsNote.textContent = `${owned.length} livre${owned.length > 1 ? 's' : ''} dans votre bibliothèque`;
  else el.resultsNote.textContent = `${visible.length} résultat${visible.length > 1 ? 's' : ''}`;
  el.clearSearch.hidden = !query;

  const wishQuery = el.wishSearchInput.value;
  const visibleWishes = sortedBooks(wishes).filter((book) => matchesSearch(book, wishQuery));
  el.wishList.innerHTML = visibleWishes.map((book) => `
    <button class="list-card" type="button" data-book-isbn="${escapeHtml(book.isbn)}">
      ${coverMarkup(book, 'mini-cover')}
      <span><h3>${escapeHtml(book.title || 'Sans titre')}</h3><p>${escapeHtml(formatAuthors(book))}</p></span>
      <b aria-hidden="true">›</b>
    </button>`).join('');
  el.emptyWishes.hidden = wishes.length > 0 || Boolean(wishQuery);
  el.wishList.hidden = visibleWishes.length === 0;
}

async function refreshBooks() {
  state.books = await getAllBooks();
  render();
}

function setView(view) {
  const isLibrary = view === 'bibliotheque';
  el.viewLibrary.hidden = !isLibrary;
  el.viewWishes.hidden = isLibrary;
  document.querySelectorAll('[data-nav]').forEach((button) => {
    const active = button.dataset.nav === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  history.replaceState(null, '', `#${view}`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showDialog(dialog) {
  if (!dialog.open) dialog.showModal();
}

function closeDialog(dialog) {
  if (dialog === el.coverSearchDialog) cancelDiscovery();
  if (dialog === el.duplicateDialog) resolveDuplicate({ action: 'cancel' });
  if (dialog === el.bookFormDialog) { state.lookupToken++; setFormLoading(false); }
  if (dialog === el.bookDetailDialog) state.detailToken++;
  if (dialog === el.importPreviewDialog) state.pendingImport = null;
  if (dialog.open) dialog.close();
}

function toast(message, error = false) {
  const activeDialog = [...document.querySelectorAll('dialog[open]')].at(-1);
  const toastHost = activeDialog?.querySelector('.sheet, .scanner-shell') || document.body;
  toastHost.append(el.toastRegion);
  const item = document.createElement('div');
  item.className = `toast${error ? ' error' : ''}`;
  item.textContent = message;
  el.toastRegion.append(item);
  setTimeout(() => item.remove(), 3600);
}

function updateNetworkState() {
  el.networkBanner.hidden = navigator.onLine;
}



async function ensureAudio() {
  try {
    if (!state.audio) state.audio = new (window.AudioContext || window.webkitAudioContext)();
    if (state.audio.state === 'suspended') await state.audio.resume();
  } catch { /* Le retour visuel reste disponible. */ }
}

async function playFeedback(positive) {
  await ensureAudio();
  if (navigator.vibrate) navigator.vibrate(positive ? [70, 45, 70] : [170]);
  if (!state.audio || state.audio.state !== 'running') return;
  const now = state.audio.currentTime;
  const notes = positive ? [[660, 0], [880, .12]] : [[220, 0], [165, .16]];
  notes.forEach(([frequency, delay], index) => {
    const oscillator = state.audio.createOscillator();
    const gain = state.audio.createGain();
    oscillator.type = positive ? 'sine' : 'sawtooth';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(.0001, now + delay);
    gain.gain.exponentialRampToValueAtTime(.14, now + delay + .015);
    gain.gain.exponentialRampToValueAtTime(.0001, now + delay + (positive ? .11 : .16));
    oscillator.connect(gain).connect(state.audio.destination);
    oscillator.start(now + delay);
    oscillator.stop(now + delay + (index ? .18 : .15));
  });
}

function setScanMode(mode) {
  state.scanSession++;
  state.scanBusy = false;
  state.lastScanned = '';
  state.scanMode = mode === 'add' ? 'add' : 'check';
  document.querySelectorAll('[data-scan-mode]').forEach((button) => button.classList.toggle('active', button.dataset.scanMode === state.scanMode));
  el.scannerHint.textContent = state.scanMode === 'check'
    ? 'Un son grave signifie « déjà possédé », deux notes montantes « nouveau livre ».'
    : 'Les informations seront proposées avant toute sauvegarde.';
  el.scanResult.hidden = true;
}

async function openScanner(mode = 'check') {
  await ensureAudio();
  setScanMode(mode);
  el.manualIsbn.value = '';
  state.scanBusy = false;
  state.lastScanned = '';
  el.cameraPlaceholder.hidden = false;
  el.scannerMessage.textContent = 'Ouverture de la caméra…';
  showDialog(el.scannerDialog);
  await startCamera();
}

async function startCamera() {
  const token = ++state.cameraToken;
  state.scanBusy = false;
  el.scanResult.hidden = true;
  el.torchButton.hidden = true;
  el.cameraPlaceholder.hidden = false;
  el.scannerMessage.textContent = 'Autorisez la caméra si Safari le demande';
  try {
    await startScanner(el.scannerVideo, processScan, ({ torch }) => {
      if (token !== state.cameraToken || !el.scannerDialog.open) return;
      el.cameraPlaceholder.hidden = true;
      el.torchButton.hidden = !torch;
      el.scannerMessage.textContent = 'Placez le code-barres ISBN dans le cadre';
    });
  } catch (error) {
    if (token !== state.cameraToken || !el.scannerDialog.open) return;
    el.cameraPlaceholder.hidden = false;
    const denied = error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError';
    el.scannerMessage.textContent = denied ? 'Caméra refusée — saisissez l’ISBN ci-dessous' : 'Caméra indisponible — utilisez la saisie manuelle';
    toast(denied ? 'Autorisez la caméra dans les réglages Safari pour scanner.' : error.message, true);
  }
}

async function closeScanner() {
  state.cameraToken++;
  state.scanSession++;
  await stopScanner();
  el.scannerVideo.srcObject = null;
  closeDialog(el.scannerDialog);
}

async function processScan(rawValue) {
  const isbn = normaliseIsbn(rawValue);
  if (!isbn) { el.scannerMessage.textContent = 'Ce code ne semble pas être un ISBN valide'; return; }
  const now = Date.now();
  if (state.scanBusy || (state.lastScanned === isbn && now - state.lastScannedAt < 3500)) return;
  const session = state.scanSession;
  const active = () => session === state.scanSession && el.scannerDialog.open;
  state.scanBusy = true;
  state.lastScanned = isbn;
  state.lastScannedAt = now;
  try {
    stopScanner();
    el.scannerMessage.textContent = `ISBN ${isbn} détecté`;
    const existing = await getBook(isbn);
    if (!active()) return;
    // L'ISBN est absent, mais une fiche manuelle ou une autre édition peut exister.
    if (!existing && state.books.length && navigator.onLine) {
      el.scannerMessage.textContent = 'Vérification du titre et de l’auteur…';
      const fresh = await lookupBook(isbn, await getSetting('googleApiKey'));
      if (!active()) return;
      const matches = findBookMatches(fresh, await getAllBooks());
      if (!active()) return;
      if (matches.length) {
        await playFeedback(false);
        const choice = await askDuplicate(fresh, matches);
        if (!active()) return;
        if (choice.action === 'cancel') { await startCamera(); return; }
        if (choice.action === 'existing') {
          await closeScanner(); openBookDetail(choice.book.isbn); return;
        }
        if (choice.action === 'attach') {
          await closeScanner(); openAttachForm(choice.book, fresh); return;
        }
      }
    }
    if (state.scanMode === 'add') {
      await playFeedback(!existing);
      if (!active()) return;
      if (existing) {
        showScanResult(false, 'Déjà enregistré', existing.status === 'owned' ? 'Ce livre est déjà dans votre bibliothèque.' : 'Ce livre est déjà dans votre liste d’envies.',
          [['Voir le livre', 'details'], ['Scanner un autre', 'rescan']], isbn);
      } else await beginAddByIsbn(isbn, 'owned');
      return;
    }
    const owned = existing?.status === 'owned';
    await playFeedback(!owned);
    if (!active()) return;
    if (owned) {
      showScanResult(false, 'Vous l’avez déjà', `${existing.title || 'Ce livre'} est bien dans votre bibliothèque.`,
        [['Voir le livre', 'details'], ['Scanner un autre', 'rescan']], isbn);
    } else {
      showScanResult(true, 'ISBN non possédé', existing?.status === 'wishlist' ? 'Vous ne le possédez pas encore, mais il est dans vos envies.' : 'Cet ISBN n’est pas dans votre bibliothèque. Les fiches sans ISBN ne peuvent être comparées que si le catalogue fournit un titre et un auteur ; vérifiez-les en cas de doute.',
        existing ? [['Voir mon envie', 'details'], ['Je l’ai acheté', 'moveowned'], ['Scanner un autre', 'rescan']]
          : [['Enregistrer', 'add'], ['Liste d’envies', 'wishlist'], ['Scanner un autre', 'rescan']], isbn);
    }
  } catch (error) {
    if (active()) toast(`Vérification impossible : ${error.message}`, true);
  } finally {
    if (session === state.scanSession) state.scanBusy = false;
  }
}

function showScanResult(positive, title, message, actions, isbn) {
  el.scanResult.className = `scan-result${positive ? '' : ' negative'}`;
  el.scanResult.innerHTML = `<h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p><div class="button-row">${actions.map(([label, action], index) => `<button class="button ${index === 0 ? 'primary' : 'secondary'}" type="button" data-scan-action="${action}" data-isbn="${escapeHtml(isbn)}">${escapeHtml(label)}</button>`).join('')}</div>`;
  el.scanResult.hidden = false;
}

function clearBookForm() {
  state.lookupToken++;
  state.formPublisher = '';
  state.formLanguage = '';
  state.formDataSource = 'Saisie manuelle';
  state.formDescriptionTranslated = false;
  el.bookForm.reset();
  el.editingOriginalIsbn.value = '';
  el.formIsbn.value = '';
  el.formBookTitle.value = '';
  el.formAuthors.value = '';
  el.formCategories.value = '';
  el.formDescription.value = '';
  el.formPublishedDate.value = '';
  el.formPageCount.value = '';
  el.formCover.value = '';
  el.formSource.textContent = '';
  el.formCoverPreview.hidden = true;
  el.formCoverFallback.hidden = false;
  el.formCoverFallback.textContent = 'Aa';
  setFormLoading(false);
}

function setFormLoading(loading) {
  el.metadataLoading.hidden = !loading;
  el.bookForm.querySelectorAll('input:not([type="hidden"]), textarea, button[type="submit"]').forEach(input => { input.disabled = loading; });
}

function fillBookForm(book, { preserveIsbn = false } = {}) {
  state.formPublisher = book.publisher || '';
  state.formLanguage = book.language || '';
  state.formDataSource = book.source || 'Saisie manuelle';
  state.formDescriptionTranslated = Boolean(book.descriptionTranslated);
  if (!preserveIsbn) el.formIsbn.value = book.isbn?.startsWith('manuel-') ? '' : (book.isbn || '');
  el.formBookTitle.value = book.title || '';
  el.formAuthors.value = (book.authors || []).join(', ');
  el.formCategories.value = (book.categories || []).join(', ');
  el.formDescription.value = book.description || '';
  el.formPublishedDate.value = book.publishedDate || '';
  el.formPageCount.value = book.pageCount || '';
  el.formCover.value = book.cover || '';
  const statusInput = el.bookForm.querySelector(`input[name="status"][value="${book.status || 'owned'}"]`);
  if (statusInput) statusInput.checked = true;
  const translationNote = book.descriptionTranslated ? ' Le résumé a été traduit automatiquement en français.' : '';
  el.formSource.textContent = book.source ? `Informations proposées par ${book.source}.${translationNote} Vérifiez-les avant de sauvegarder.` : '';
  updateFormCover();
}

function updateFormCover() {
  const url = el.formCover.value.trim();
  el.formCoverFallback.textContent = initials(el.formBookTitle.value);
  if (!url) {
    el.formCoverPreview.hidden = true;
    el.formCoverFallback.hidden = false;
    return;
  }
  el.formCoverPreview.hidden = false;
  el.formCoverFallback.hidden = true;
  el.formCoverPreview.src = url;
}

async function openManualForm() {
  clearBookForm();
  el.formEyebrow.textContent = 'Ajout manuel';
  el.formTitle.textContent = 'Nouveau livre';
  el.bookForm.querySelector('input[name="status"][value="owned"]').checked = true;
  showDialog(el.bookFormDialog);
  setTimeout(() => el.formIsbn.focus(), 120);
}

async function beginAddByIsbn(isbn, status = 'owned', discovery = null) {
  const initialToken = state.lookupToken;
  const session = state.scanSession;
  const scannerWasOpen = el.scannerDialog.open;
  const existing = await getBook(isbn);
  if (initialToken !== state.lookupToken || (scannerWasOpen && (session !== state.scanSession || !el.scannerDialog.open))) return;
  if (existing) {
    toast('Ce livre est déjà enregistré.', true);
    await closeScanner();
    openBookDetail(isbn);
    return;
  }
  await closeScanner();
  clearBookForm();
  const token = state.lookupToken;
  el.formEyebrow.textContent = `ISBN ${isbn}`;
  el.formTitle.textContent = 'Confirmer les informations';
  el.formIsbn.value = isbn;
  el.bookForm.querySelector(`input[name="status"][value="${status}"]`).checked = true;
  setFormLoading(true);
  showDialog(el.bookFormDialog);
  try {
    const apiKey = await getSetting('googleApiKey');
    const result = await lookupBook(isbn, apiKey);
    const book = discovery ? { ...discovery, ...result, title: result.title || discovery.title, authors: result.authors?.length ? result.authors : discovery.authors } : result;
    if (token !== state.lookupToken || !el.bookFormDialog.open) return;
    fillBookForm({ ...book, status }, { preserveIsbn: true });
    if (!book.title) toast('Livre introuvable : complétez les informations à la main.', true);
    else {
      const missing = [!book.description && 'résumé', !book.categories?.length && 'catégories', !book.cover && 'couverture'].filter(Boolean);
      if (missing.length) toast(`Informations absentes des catalogues consultés : ${missing.join(', ')}.`, true);
    }
  } catch {
    if (token === state.lookupToken && el.bookFormDialog.open) toast('Catalogue indisponible. Vous pouvez tout de même saisir le livre à la main.', true);
  } finally {
    if (token === state.lookupToken) setFormLoading(false);
  }
}

async function submitBookForm(event) {
  event.preventDefault();
  if (state.formSaving) return;
  if (!el.metadataLoading.hidden) return;
  if (!el.formBookTitle.value.trim()) { toast('Indiquez un titre pour ce livre.', true); return; }
  if (el.formCover.value.trim() && !/^https?:\/\//i.test(el.formCover.value.trim())) {
    toast('La couverture doit utiliser une adresse http ou https.', true); return;
  }
  const originalIsbn = el.editingOriginalIsbn.value;
  const enteredIsbn = el.formIsbn.value.trim();
  const canonicalIsbn = enteredIsbn ? normaliseIsbn(enteredIsbn) : '';
  if (enteredIsbn && !canonicalIsbn) {
    toast('L’ISBN saisi n’est pas valide.', true);
    el.formIsbn.focus();
    return;
  }
  const isbn = canonicalIsbn || originalIsbn || `manuel-${crypto.randomUUID?.() || Date.now()}`;
  const collision = state.books.find((book) => book.isbn === isbn && book.isbn !== originalIsbn);
  if (collision) {
    toast('Un livre avec cet ISBN existe déjà.', true);
    return;
  }
  const existing = state.books.find((book) => book.isbn === originalIsbn);
  const book = {
    isbn,
    title: el.formBookTitle.value.trim(),
    authors: el.formAuthors.value.split(',').map((item) => item.trim()).filter(Boolean),
    categories: [...new Set(el.formCategories.value.split(',').map((item) => item.trim()).filter(Boolean))],
    description: el.formDescription.value.trim(),
    publishedDate: el.formPublishedDate.value.trim(),
    pageCount: el.formPageCount.value.trim(),
    cover: el.formCover.value.trim(),
    publisher: state.formPublisher,
    language: state.formLanguage,
    status: new FormData(el.bookForm).get('status') || 'owned',
    source: state.formDataSource || existing?.source || (canonicalIsbn ? 'Saisie vérifiée manuellement' : 'Saisie manuelle'),
    descriptionTranslated: state.formDescriptionTranslated,
    addedAt: existing?.addedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  try {
    state.formSaving = true;
    const token = state.lookupToken;
    const matches = findBookMatches(book, await getAllBooks(), originalIsbn);
    if (token !== state.lookupToken || !el.bookFormDialog.open) return;
    if (matches.length) {
      const choice = await askDuplicate(book, matches);
      if (token !== state.lookupToken || !el.bookFormDialog.open || choice.action === 'cancel') return;
      if (choice.action === 'existing') { closeDialog(el.bookFormDialog); openBookDetail(choice.book.isbn); return; }
      if (choice.action === 'attach') { openAttachForm(choice.book, book); return; }
    }
    await saveBook(book, originalIsbn);
    closeDialog(el.bookFormDialog);
    await refreshBooks();
    toast(book.status === 'owned' ? 'Livre ajouté à votre bibliothèque.' : 'Livre ajouté à vos envies.');
  } catch (error) {
    toast(`Impossible de sauvegarder : ${error.message}`, true);
  } finally { state.formSaving = false; }
}

function openBookDetail(isbn) {
  const book = state.books.find((item) => item.isbn === isbn);
  if (!book) return;
  state.selectedIsbn = isbn;
  state.detailToken++;
  const meta = [
    ...(book.categories || []),
    book.publishedDate ? `Paru en ${book.publishedDate}` : '',
    book.pageCount ? `${book.pageCount} pages` : '',
  ].filter(Boolean);
  el.bookDetailContent.innerHTML = `
    <div class="detail-hero">
      ${coverMarkup(book, 'detail-cover')}
      <div><p class="eyebrow">${book.status === 'owned' ? 'Dans ma bibliothèque' : 'Dans mes envies'}</p><h2>${escapeHtml(book.title || 'Sans titre')}</h2><p>${escapeHtml(formatAuthors(book))}</p></div>
    </div>
    <div class="detail-body">
      <div class="detail-meta">${meta.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div>
      <h3>À propos</h3>
      ${book.descriptionTranslated ? '<p class="translation-note">Résumé traduit automatiquement en français</p>' : ''}
      <p class="detail-description">${escapeHtml(book.description || 'Aucun résumé disponible. Vous pouvez en ajouter en modifiant le livre.')}</p>
      <p class="detail-isbn">${book.isbn.startsWith('manuel-') ? 'Ajout manuel sans ISBN' : `ISBN ${escapeHtml(book.isbn)}`}</p>
    </div>`;
  el.toggleBookStatus.textContent = book.status === 'owned' ? 'Mettre dans mes envies' : 'Je possède ce livre';
  el.buyBookLink.href = purchaseSearchUrl(book);
  showDialog(el.bookDetailDialog);
}

async function editSelectedBook() {
  const book = state.books.find((item) => item.isbn === state.selectedIsbn);
  if (!book) return;
  closeDialog(el.bookDetailDialog);
  clearBookForm();
  el.formEyebrow.textContent = 'Modification';
  el.formTitle.textContent = 'Modifier le livre';
  el.editingOriginalIsbn.value = book.isbn;
  fillBookForm(book);
  showDialog(el.bookFormDialog);
}

async function refreshSelectedBook() {
  const book = state.books.find((item) => item.isbn === state.selectedIsbn);
  if (!book) return;
  if (book.isbn.startsWith('manuel-')) {
    toast('Ajoutez d’abord un ISBN valide pour actualiser ce livre.', true);
    return;
  }
  if (!navigator.onLine) {
    toast('Connectez-vous à Internet pour actualiser les informations.', true);
    return;
  }

  const originalLabel = el.refreshBookButton.textContent;
  el.refreshBookButton.disabled = true;
  el.refreshBookButton.textContent = 'Recherche en cours…';
  const token = state.detailToken;
  try {
    const apiKey = await getSetting('googleApiKey');
    const fresh = await lookupBook(book.isbn, apiKey, { refresh: true });
    if (token !== state.detailToken || !el.bookDetailDialog.open) return;
    if (!fresh.title && !fresh.description && !fresh.cover) {
      toast('Aucune nouvelle information fiable n’a été trouvée.', true);
      return;
    }
    const proposal = {
      ...book,
      ...Object.fromEntries(['title', 'description', 'cover', 'publishedDate', 'pageCount', 'publisher', 'language']
        .map((key) => [key, fresh[key] || book[key] || ''])),
      authors: fresh.authors?.length ? fresh.authors : (book.authors || []),
      categories: fresh.categories?.length ? fresh.categories : (book.categories || []),
      source: fresh.source || book.source,
      descriptionTranslated: fresh.description ? Boolean(fresh.descriptionTranslated) : Boolean(book.descriptionTranslated),
      status: book.status,
    };
    closeDialog(el.bookDetailDialog);
    clearBookForm();
    el.formEyebrow.textContent = 'Actualisation';
    el.formTitle.textContent = 'Vérifier les nouvelles informations';
    el.editingOriginalIsbn.value = book.isbn;
    fillBookForm(proposal);
    showDialog(el.bookFormDialog);
    toast('Les nouvelles informations sont prêtes à être vérifiées.');
  } catch {
    if (token === state.detailToken && el.bookDetailDialog.open) toast('Les catalogues sont indisponibles pour le moment. Réessayez plus tard.', true);
  } finally {
    el.refreshBookButton.disabled = false;
    el.refreshBookButton.textContent = originalLabel;
  }
}

async function toggleSelectedStatus() {
  const book = state.books.find((item) => item.isbn === state.selectedIsbn);
  if (!book) return;
  const changed = { ...book, status: book.status === 'owned' ? 'wishlist' : 'owned', updatedAt: new Date().toISOString() };
  try {
    await saveBook(changed, book.isbn);
    closeDialog(el.bookDetailDialog);
    await refreshBooks();
    toast(changed.status === 'owned' ? 'Livre rangé dans votre bibliothèque.' : 'Livre déplacé dans vos envies.');
  } catch (error) { toast(`Déplacement impossible : ${error.message}`, true); }
}

async function deleteSelectedBook() {
  const book = state.books.find((item) => item.isbn === state.selectedIsbn);
  if (!book || !confirm(`Supprimer « ${book.title} » de Ma Bibliothèque ?`)) return;
  try {
    await removeBook(book.isbn);
    closeDialog(el.bookDetailDialog);
    await refreshBooks();
    toast('Livre supprimé.');
  } catch (error) { toast(`Suppression impossible : ${error.message}`, true); }
}

function exportLibrary() {
  const payload = {
    app: 'Ma Bibliothèque',
    version: 1,
    exportedAt: new Date().toISOString(),
    books: state.books,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `ma-bibliotheque-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Sauvegarde JSON créée.');
}

async function handleImport(file) {
  if (!file) return;
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error('La sauvegarde dépasse 10 Mo.');
    const valid = validateBackup(JSON.parse(await file.text()));
    const existing = await getAllBooks();
    const ids = new Set(existing.map(book => book.isbn));
    const conflicts = valid.filter(book => ids.has(book.isbn));
    state.pendingImport = valid;
    el.importSummary.textContent = `${valid.length} livre(s) dans le fichier : ${valid.length - conflicts.length} nouveau(x), ${conflicts.length} déjà enregistré(s).`;
    el.importConflicts.textContent = conflicts.length
      ? 'Déjà enregistrés : ' + conflicts.slice(0, 20).map(book => book.title).join(', ') + (conflicts.length > 20 ? '…' : '')
      : 'Aucune fiche existante ne sera remplacée.';
    el.importPreviewDialog.querySelector('input[value="keep"]').checked = true;
    showDialog(el.importPreviewDialog);
  } catch (error) {
    toast(`Import impossible : ${error.message}`, true);
  } finally {
    el.importFile.value = '';
  }
}

async function confirmImport() {
  if (!state.pendingImport || el.confirmImportButton.disabled) return;
  const books = state.pendingImport;
  const conflict = el.importPreviewDialog.querySelector('input[name="importConflict"]:checked')?.value || 'keep';
  el.confirmImportButton.disabled = true;
  try {
    const report = await importBooks(books, { conflict });
    closeDialog(el.importPreviewDialog);
    closeDialog(el.settingsDialog);
    await refreshBooks();
    toast(`${report.added} ajouté(s), ${report.kept} conservé(s), ${report.updated} remplacé(s).`);
  } catch (error) {
    toast(`Import impossible : ${error.message}`, true);
  } finally {
    el.confirmImportButton.disabled = false;
  }
}

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / 1024 ** 2).toFixed(1)} Mo`;
}

async function openSettings() {
  showDialog(el.settingsDialog);
  el.googleApiKey.value = await getSetting('googleApiKey');
  const persistent = await requestPersistentStorage();
  const estimate = await getStorageEstimate();
  const storageText = estimate ? `Espace utilisé par ce site : environ ${formatBytes(estimate.usage)} sur ${formatBytes(estimate.quota)} disponibles.` : 'Estimation du stockage indisponible.';
  el.storageStatus.textContent = `${storageText} ${persistent ? 'Safari indique que le stockage est persistant.' : 'iOS peut libérer les données si l’espace manque : conservez un export JSON.'}`;
}

async function moveWishlistToOwned(isbn) {
  const book = await getBook(isbn);
  if (!book) return;
  book.status = 'owned';
  book.updatedAt = new Date().toISOString();
  try {
    await saveBook(book, book.isbn);
    await closeScanner();
    await refreshBooks();
    await playFeedback(true);
    toast('Livre ajouté à votre bibliothèque.');
  } catch (error) { toast(`Déplacement impossible : ${error.message}`, true); }
}

function purchaseSearchUrl(book) {
  const query = book.isbn && !book.isbn.startsWith('manuel-') ? book.isbn : [book.title, ...(book.authors || []), 'livre'].join(' ');
  return 'https://www.google.com/search?' + new URLSearchParams({ q: query, tbm: 'shop' });
}

function resolveDuplicate(choice) {
  const resolve = state.duplicateResolve;
  state.duplicateResolve = null;
  if (el.duplicateDialog.open) el.duplicateDialog.close();
  if (resolve) resolve(choice);
}

function askDuplicate(proposal, matches) {
  resolveDuplicate({ action: 'cancel' });
  el.duplicateMessage.textContent = `« ${proposal.title} » ressemble à une ou plusieurs fiches déjà enregistrées.`;
  el.duplicateCandidates.innerHTML = matches.map(({ book, reason }, index) => {
    const attach = book.isbn.startsWith('manuel-') && proposal.isbn && !proposal.isbn.startsWith('manuel-');
    return `<article class="discovery-card"><h3>${escapeHtml(book.title)}</h3><p>${escapeHtml((book.authors || []).join(', ') || 'Auteur non renseigné')}<br>${escapeHtml(reason)}<br>${book.status === 'owned' ? 'Déjà possédé' : 'Dans vos envies'} · ${book.isbn.startsWith('manuel-') ? 'Fiche sans ISBN' : `ISBN ${escapeHtml(book.isbn)}`}</p><div class="button-row"><button class="button secondary" data-duplicate-index="${index}" data-duplicate-action="existing" type="button">C’est ce livre : voir ma fiche</button>${attach ? `<button class="button primary" data-duplicate-index="${index}" data-duplicate-action="attach" type="button">Rattacher l’ISBN à cette fiche</button>` : ''}</div></article>`;
  }).join('');
  state.duplicateMatches = matches;
  showDialog(el.duplicateDialog);
  return new Promise(resolve => { state.duplicateResolve = resolve; });
}

function openAttachForm(existing, fresh) {
  clearBookForm();
  el.editingOriginalIsbn.value = existing.isbn;
  el.formTitle.textContent = 'Rattacher l’ISBN sans doublon';
  el.formEyebrow.textContent = 'Votre fiche et vos corrections sont conservées';
  fillBookForm(attachIsbnProposal(existing, fresh));
  showDialog(el.bookFormDialog);
}

function cancelDiscovery() {
  state.discoveryToken++;
  state.discoveryController?.abort();
  state.discoveryController = null;
  cancelCoverRecognition();
  el.coverPhotoInput.disabled = false;
  el.coverGalleryInput.disabled = false;
  el.coverSearchSubmit.disabled = false;
}

function openDiscovery() {
  cancelDiscovery();
  state.discoveryBooks = [];
  el.coverResults.innerHTML = '';
  el.coverQuery.value = '';
  el.coverProgress.textContent = '';
  el.coverTextDetails.hidden = true;
  el.coverPhotoInput.value = '';
  el.coverGalleryInput.value = '';
  showDialog(el.coverSearchDialog);
}

async function handleCoverPhoto(file) {
  if (!file) return;
  cancelDiscovery();
  el.coverPhotoInput.value = '';
  el.coverGalleryInput.value = '';
  const token = state.discoveryToken;
  el.coverResults.innerHTML = '';
  el.coverTextDetails.hidden = true;
  el.coverPhotoInput.disabled = true;
  el.coverGalleryInput.disabled = true;
  el.coverSearchSubmit.disabled = true;
  el.coverProgress.textContent = 'Lecture de la couverture sur cet appareil… La première utilisation charge le moteur gratuit.';
  try {
    const text = await readCoverPhoto(file, message => {
      if (token === state.discoveryToken && message.status === 'recognizing text') el.coverProgress.textContent = `Lecture du texte : ${Math.round(message.progress * 100)} %`;
    });
    if (token !== state.discoveryToken || !el.coverSearchDialog.open) return;
    if (text === null) { el.coverProgress.textContent = 'Lecture interrompue ou trop longue. Utilisez le scan du code-barres.'; return; }
    el.coverOcrText.textContent = text;
    el.coverTextDetails.hidden = !text;
    el.coverQuery.value = coverTextQuery(text);
    el.coverProgress.textContent = text ? 'Texte proposé : corrigez le titre ou l’auteur si nécessaire, puis recherchez.' : 'Texte illisible. Utilisez le scan du code-barres.';
    if (el.coverQuery.value) await searchDiscovery();
  } catch {
    if (token === state.discoveryToken) el.coverProgress.textContent = 'Cette photo n’a pas pu être lue. Reprenez-la en bonne lumière ou scannez le code-barres.';
  } finally {
    if (token === state.discoveryToken) {
      el.coverPhotoInput.disabled = false; el.coverGalleryInput.disabled = false; el.coverSearchSubmit.disabled = false;
      el.coverPhotoInput.value = ''; el.coverGalleryInput.value = '';
    }
  }
}

async function searchDiscovery() {
  const query = el.coverQuery.value.trim();
  if (query.length < 2) return;
  state.discoveryController?.abort();
  const token = ++state.discoveryToken;
  const controller = new AbortController();
  state.discoveryController = controller;
  const timer = setTimeout(() => controller.abort(), 15000);
  el.coverSearchSubmit.disabled = true;
  el.coverResults.innerHTML = '';
  el.coverProgress.textContent = 'Recherche du titre et de l’auteur…';
  try {
    const normal = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const local = (await getAllBooks()).filter(book => normal(query).includes(normal(book.title)) || normal([book.title, ...(book.authors || [])].join(' ')).includes(normal(query)));
    const remote = navigator.onLine ? await searchCoverBooks(query, await getSetting('googleApiKey'), { signal: controller.signal }) : { books: [], unavailable: true };
    if (token !== state.discoveryToken || !el.coverSearchDialog.open) return;
    const localIds = new Set(local.map(book => book.isbn));
    state.discoveryBooks = [...local.map(book => ({ ...book, local: true })), ...remote.books.filter(book => !book.isbn || !localIds.has(book.isbn))];
    el.coverResults.innerHTML = state.discoveryBooks.map((book, index) => `<article class="discovery-card"><h3>${escapeHtml(book.title)}</h3><p>${escapeHtml((book.authors || []).join(', ') || 'Auteur non renseigné')}<br>${escapeHtml(book.publishedDate || '')}${book.local ? `<br>${book.status === 'owned' ? 'Déjà dans votre bibliothèque' : 'Déjà dans vos envies'}` : `<br>${escapeHtml(book.source)}${book.isbn ? `<br>ISBN ${escapeHtml(book.isbn)}` : '<br>Édition sans ISBN identifié'}`}</p><div class="button-row"><button class="button primary" type="button" data-cover-index="${index}">${book.local ? 'Voir ma fiche existante' : 'Choisir et vérifier ce livre'}</button><a class="button secondary" href="${escapeHtml(purchaseSearchUrl(book))}" target="_blank" rel="noopener noreferrer">Où l’acheter ↗</a></div></article>`).join('');
    el.coverProgress.textContent = `${state.discoveryBooks.length} proposition(s). ${remote.unavailable ? 'Catalogues indisponibles : seuls les résultats locaux sont affichés. Utilisez le scan du code-barres si nécessaire.' : 'Confirmez le bon titre, l’auteur et le tome ; sinon utilisez le scan du code-barres.'}`;
  } catch {
    if (token === state.discoveryToken) el.coverProgress.textContent = 'Recherche interrompue. Réessayez ou scannez le code-barres.';
  } finally {
    clearTimeout(timer);
    if (token === state.discoveryToken) { el.coverSearchSubmit.disabled = false; el.coverPhotoInput.disabled = false; el.coverGalleryInput.disabled = false; }
  }
}

async function chooseDiscoveredBook(index) {
  const book = state.discoveryBooks[index];
  if (!book) return;
  closeDialog(el.coverSearchDialog);
  if (book.local) { openBookDetail(book.isbn); return; }
  if (book.isbn) { await beginAddByIsbn(book.isbn, 'owned', book); return; }
  openManualForm();
  fillBookForm({ ...book, status: 'owned' });
  el.formSource.textContent = 'Proposition issue de la recherche : confirmez le titre, l’auteur et le tome. Sans ISBN, l’édition reste à vérifier.';
}

function bindEvents() {
  el.openCoverSearch.addEventListener('click', openDiscovery);
  el.openTitleSearch.addEventListener('click', openDiscovery);
  el.coverPhotoInput.addEventListener('change', () => handleCoverPhoto(el.coverPhotoInput.files?.[0]));
  el.coverGalleryInput.addEventListener('change', () => handleCoverPhoto(el.coverGalleryInput.files?.[0]));
  el.coverSearchForm.addEventListener('submit', event => { event.preventDefault(); searchDiscovery(); });
  el.coverScanFallback.addEventListener('click', () => { closeDialog(el.coverSearchDialog); openScanner('check'); });
  el.coverManualFallback.addEventListener('click', () => { closeDialog(el.coverSearchDialog); openManualForm(); });
  el.coverSearchDialog.addEventListener('cancel', cancelDiscovery);
  el.coverResults.addEventListener('click', event => {
    const button = event.target.closest('[data-cover-index]');
    if (button) chooseDiscoveredBook(Number(button.dataset.coverIndex)).catch(error => toast(error.message, true));
  });
  el.duplicateDialog.addEventListener('cancel', event => { event.preventDefault(); resolveDuplicate({ action: 'cancel' }); });
  el.duplicateDifferent.addEventListener('click', () => resolveDuplicate({ action: 'different' }));
  el.duplicateCandidates.addEventListener('click', event => {
    const button = event.target.closest('[data-duplicate-index]');
    if (!button) return;
    const book = state.duplicateMatches?.[Number(button.dataset.duplicateIndex)]?.book;
    if (book) resolveDuplicate({ action: button.dataset.duplicateAction, book });
  });
  document.querySelectorAll('[data-open-scan]').forEach((button) => button.addEventListener('click', () => openScanner(button.dataset.openScan)));
  document.querySelectorAll('[data-nav]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.nav)));
  document.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => closeDialog(document.getElementById(button.dataset.closeDialog))));
  document.querySelectorAll('[data-scan-mode]').forEach((button) => button.addEventListener('click', async () => {
    setScanMode(button.dataset.scanMode);
    await startCamera();
  }));
  el.closeScanner.addEventListener('click', closeScanner);
  el.scannerDialog.addEventListener('cancel', (event) => { event.preventDefault(); closeScanner(); });
  el.bookFormDialog.addEventListener('cancel', () => { state.lookupToken++; setFormLoading(false); });
  el.bookDetailDialog.addEventListener('cancel', () => { state.detailToken++; });
  el.importPreviewDialog.addEventListener('cancel', () => { state.pendingImport = null; });
  el.manualIsbnForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await ensureAudio();
    const isbn = normaliseIsbn(el.manualIsbn.value);
    if (!isbn) { toast('Saisissez un ISBN-10 ou ISBN-13 valide.', true); return; }
    processScan(isbn);
  });
  el.torchButton.addEventListener('click', async () => {
    try { el.torchButton.classList.toggle('active', await toggleTorch()); } catch { toast('La lampe n’est pas disponible.', true); }
  });
  el.scanResult.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-scan-action]');
    if (!button) return;
    const { scanAction: action, isbn } = button.dataset;
    if (action === 'rescan') await startCamera();
    if (action === 'add') await beginAddByIsbn(isbn, 'owned');
    if (action === 'wishlist') await beginAddByIsbn(isbn, 'wishlist');
    if (action === 'details') { await closeScanner(); openBookDetail(isbn); }
    if (action === 'moveowned') await moveWishlistToOwned(isbn);
  });
  el.manualAddButton.addEventListener('click', openManualForm);
  el.bookForm.addEventListener('submit', submitBookForm);
  el.formCover.addEventListener('input', updateFormCover);
  el.formBookTitle.addEventListener('input', () => { if (!el.formCover.value) updateFormCover(); });
  el.formCoverPreview.addEventListener('error', () => { el.formCoverPreview.hidden = true; el.formCoverFallback.hidden = false; });
  el.searchInput.addEventListener('input', render);
  el.wishSearchInput.addEventListener('input', render);
  el.clearSearch.addEventListener('click', () => { el.searchInput.value = ''; render(); el.searchInput.focus(); });
  el.categoryFilters.addEventListener('click', (event) => {
    const button = event.target.closest('[data-category]');
    if (!button) return;
    state.category = button.dataset.category;
    render();
  });
  [el.bookGrid, el.wishList].forEach((container) => container.addEventListener('click', (event) => {
    const card = event.target.closest('[data-book-isbn]');
    if (card) openBookDetail(card.dataset.bookIsbn);
  }));
  el.editBookButton.addEventListener('click', editSelectedBook);
  el.refreshBookButton.addEventListener('click', refreshSelectedBook);
  el.toggleBookStatus.addEventListener('click', toggleSelectedStatus);
  el.deleteBookButton.addEventListener('click', deleteSelectedBook);
  el.settingsButton.addEventListener('click', openSettings);
  el.exportButton.addEventListener('click', exportLibrary);
  el.importButton.addEventListener('click', () => el.importFile.click());
  el.importFile.addEventListener('change', () => handleImport(el.importFile.files?.[0]));
  el.confirmImportButton.addEventListener('click', confirmImport);
  el.saveApiKeyButton.addEventListener('click', async () => {
    try {
      await setSetting('googleApiKey', el.googleApiKey.value.trim());
      toast('Clé enregistrée uniquement sur cet appareil.');
    } catch (error) { toast(`Clé non sauvegardée : ${error.message}`, true); }
  });
  window.addEventListener('online', updateNetworkState);
  window.addEventListener('offline', updateNetworkState);
  document.addEventListener('visibilitychange', () => {
    if (!el.scannerDialog.open) return;
    if (document.hidden) {
      state.cameraToken++;
      stopScanner();
    } else if (el.scanResult.hidden && !state.scanBusy) startCamera();
  });
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try { await navigator.serviceWorker.register('./sw.js', { scope: './' }); } catch (error) { console.warn('Service worker non enregistré', error); }
}

async function init() {
  const action = new URLSearchParams(location.search).get('action');
  bindEvents();
  updateNetworkState();
  el.welcomeDate.textContent = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  try { await refreshBooks(); } catch (error) { toast(`Stockage local indisponible : ${error.message}`, true); }
  setView(location.hash === '#envies' ? 'envies' : 'bibliotheque');
  registerServiceWorker();
  if (action === 'check' || action === 'add') setTimeout(() => openScanner(action), 350);
}

init();
