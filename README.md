# Ma Bibliothèque

Une PWA mobile en français pour enregistrer et vérifier une collection personnelle de livres sur iPhone. Elle fonctionne sans compte, sans serveur applicatif et sans abonnement : la collection reste dans `IndexedDB`, sur l’appareil.

## Ce qui est inclus

- Deux modes de scan ISBN par caméra : **Vérifier** et **Enregistrer**.
- Retour sonore grave si le livre est déjà possédé, deux notes montantes sinon.
- Recherche des métadonnées dans **Open Library**, puis complément par **Google Books** si nécessaire.
- Confirmation et modification du titre, des auteurs, catégories, résumé, couverture, date et pagination avant sauvegarde.
- Bibliothèque locale disponible hors ligne, recherche, filtres par catégorie et prévention des ISBN en double.
- Liste d’envies avec passage en un geste vers la bibliothèque.
- Ajout manuel, modification, suppression, export et import JSON.
- Manifest, service worker, icônes iOS et Android, raccourcis PWA et cache des couvertures déjà consultées.

## Tester sur Windows

Ne double-cliquez pas sur `index.html` : la caméra et le service worker exigent un site servi en HTTP(S).

1. Ouvrez PowerShell dans ce dossier.
2. Lancez un serveur local :

   ```powershell
   py -m http.server 4173
   ```

3. Ouvrez `http://localhost:4173` dans Edge ou Chrome.
4. Autorisez la caméra, puis testez les deux modes avec un code-barres ISBN réel.

`localhost` est considéré comme un contexte sécurisé pour les tests sur le PC. Pour tester la caméra de l’iPhone, déployez d’abord sur GitHub Pages : une adresse locale du PC en `http://` ne suffit pas sur l’iPhone.

### Vérifications conseillées

1. **Enregistrer** : scannez un ISBN, attendez les informations, corrigez-les puis sauvegardez.
2. **Doublon** : scannez le même ISBN en mode Enregistrer ; l’app doit refuser une deuxième fiche.
3. **Vérifier** : rescanner l’ISBN doit produire le son grave et « Vous l’avez déjà ».
4. **Nouveau livre** : un autre ISBN doit produire deux notes montantes.
5. **Hors ligne** : après une première visite, coupez le réseau et rechargez ; la bibliothèque, les recherches et les couvertures déjà mises en cache doivent rester accessibles. La récupération d’un nouveau résumé nécessite Internet.
6. **Sauvegarde** : exportez le JSON, supprimez un livre, puis réimportez le fichier. L’import fusionne les livres par ISBN.
7. **Liste d’envies** : ajoutez un livre dans les envies puis utilisez « Je possède ce livre ».

Un ISBN connu pour un essai manuel : `9782070360024`.

## Déployer gratuitement avec GitHub Pages

Le dépôt doit être **public** pour utiliser GitHub Pages gratuitement avec un compte GitHub Free. Le code sera public, mais votre collection ne le sera pas : les livres sont enregistrés uniquement dans le navigateur de votre iPhone et ne sont jamais envoyés au dépôt.

1. Créez un nouveau dépôt GitHub public, par exemple `ma-bibliotheque`.
2. Placez tout le contenu de ce dossier à la racine du dépôt, y compris `.github`, `.nojekyll`, `vendor` et `icons`.
3. Envoyez les fichiers sur la branche `main`.
4. Sur GitHub, ouvrez **Settings → Pages**.
5. Dans **Build and deployment**, choisissez **GitHub Actions** comme source.
6. L’action « Déployer Ma Bibliothèque » se lance automatiquement. Son adresse apparaît dans l’onglet **Actions** puis dans **Settings → Pages**. Elle ressemble à `https://votre-nom.github.io/ma-bibliotheque/`.

Le fichier `.github/workflows/deploy-pages.yml` fourni réalise le déploiement. Les chemins sont relatifs, donc l’application fonctionne aussi bien à la racine d’un domaine que dans le sous-dossier d’un dépôt GitHub Pages.

### Mise à jour

Remplacez les fichiers, augmentez le nom de cache dans `sw.js` (par exemple `v1.0.1`) ainsi que le suffixe `?v=` des ressources dans `index.html` et `sw.js`, puis envoyez le nouveau commit. Ouvrez une fois l’app avec Internet pour récupérer la mise à jour.

## Installer sur iPhone

1. Ouvrez l’adresse GitHub Pages dans **Safari**.
2. Touchez le bouton **Partager** (carré avec flèche vers le haut).
3. Choisissez **Sur l’écran d’accueil**.
4. Laissez **Ouvrir comme app web** activé si cette option est affichée, puis touchez **Ajouter**.
5. Lancez ensuite **Ma Bibliothèque** depuis son icône.
6. Au premier scan, acceptez l’accès à la caméra.

Après l’installation, ouvrez les réglages de l’app et réalisez un premier export JSON de contrôle.

## Limites importantes sur iPhone / PWA

- **Caméra** : elle ne fonctionne que sur une origine sécurisée (`https://`) ou sur `localhost`. Safari demande l’autorisation par site. En cas de refus, utilisez la saisie d’ISBN ou réactivez la caméra dans les réglages Safari du site.
- **Audio** : iOS autorise le son web après une action de l’utilisateur. Le bouton Scanner initialise l’audio ; en mode silencieux, avec un volume nul ou selon les réglages Safari, le retour visuel reste la référence.
- **Persistance** : `IndexedDB` est local à l’installation et au domaine. Supprimer l’app web, effacer les données Safari, manquer fortement d’espace ou changer d’adresse GitHub Pages peut supprimer ou isoler la collection. Faites des exports JSON réguliers. L’app demande le stockage persistant quand iOS le permet, sans pouvoir le garantir.
- **Hors ligne** : la collection et l’interface fonctionnent hors ligne après une première ouverture réussie. La lecture du code-barres se fait sur l’appareil. La recherche d’un nouveau titre, d’un résumé ou d’une couverture dans les catalogues nécessite Internet.
- **Catalogues** : tous les ISBN ne sont pas présents et les catégories peuvent être imprécises. L’écran de confirmation permet toujours de corriger ou saisir les informations. Open Library est prioritaire. Google Books sert de secours ; une clé API gratuite personnelle peut être saisie dans les réglages si les requêtes sans clé sont limitées. Une clé utilisée dans une application web n’est jamais secrète.
- **Couvertures** : les images viennent des catalogues et ne sont pas intégrées à l’export JSON. Celles déjà affichées peuvent être conservées par le cache, mais iOS reste libre de purger ce cache.
- **Pas de synchronisation** : il n’y a volontairement ni compte, ni cloud, ni synchronisation entre plusieurs appareils. Pour migrer, exportez sur l’ancien appareil et importez sur le nouveau.
- **Codes reconnus** : le scanner vise les ISBN-13 `978…`/`979…` et accepte aussi un ISBN-10 saisi manuellement. Un code de prix ou un code produit non ISBN est ignoré.

## Structure

```text
.
├── index.html                 Interface et dialogues
├── styles.css                Design mobile et responsive
├── app.js                    Navigation et logique de l’application
├── db.js                     Stockage IndexedDB
├── api.js                    Open Library et Google Books
├── scanner.js                Caméra, BarcodeDetector et secours ZXing
├── sw.js                     Cache hors ligne
├── manifest.webmanifest      Installation PWA
├── icons/                    Icônes de l’application
├── licenses/                 Licences des composants libres
├── vendor/                   Lecteur ZXing local, utilisable hors ligne
└── .github/workflows/        Déploiement GitHub Pages
```

## Développement du lecteur de codes-barres

La version prête à déployer contient déjà `vendor/zxing-browser.min.js`. Pour la recréer depuis les dépendances officielles :

```powershell
npm install
npm run vendor
npm run check
```

Le lecteur utilise d’abord l’API native `BarcodeDetector` lorsqu’elle prend en charge EAN, puis la bibliothèque libre ZXing en solution de secours. `@zxing/browser` est sous licence MIT et `@zxing/library` sous licence Apache-2.0.

## Services utilisés

- [Open Library Book APIs](https://openlibrary.org/dev/docs/api/books) et [Covers API](https://openlibrary.org/dev/docs/api/covers)
- [Google Books API](https://developers.google.com/books/docs/v1/using)
- [Documentation WebKit sur les apps d’écran d’accueil](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/) et [la politique de stockage](https://webkit.org/blog/14403/updates-to-storage-policy/)

Projet personnel sans compte ni publicité. Les données bibliographiques restent soumises aux conditions des catalogues interrogés.
