# Ma Bibliothèque

## Version 1.5.0 : organiser une grande collection

Le menu « Trier mes livres » propose Titre A → Z (par défaut), Auteur A → Z, Genre A → Z puis titre, et Derniers ajouts. Le choix est mémorisé localement et s'applique aussi aux envies. Les tris respectent l'alphabet français, ignorent la différence de casse/accents et placent les nombres dans leur ordre naturel (tome 2 avant tome 10).

Le tri auteur utilise le premier auteur : « Nom, Prénom » est conservé dans cet ordre ; pour « Prénom Nom », le dernier mot sert de nom de classement. Les noms composés peuvent nécessiter une saisie sous la forme « Nom composé, Prénom ». Les auteurs absents et livres sans genre sont placés à la fin.

En tri genre, chaque livre apparaît une seule fois sous son premier genre alphabétique, puis par titre. Le filtre retrouve un livre dans chacun de ses genres, même secondaire. Recherche et filtres se combinent à tous les tris.

La vue affiche 60 livres à la fois avec « Afficher plus ». Cela ne limite ni les livres sauvegardés ni la recherche, qui porte sur toute la collection. Un jeu synthétique de 2 500 livres est fourni pour vérification locale dans `tests/large-library-qa.html` ; il est exclu du déploiement. Les performances réelles et la capacité de stockage restent dépendantes de l'appareil et de Safari : conserver des exports JSON réguliers, surtout avant une saisie massive.

## Version 1.4.0 : photo, rapprochement et achat

« Photographier une couverture » prend une photo sur iPhone ; « Choisir une photo » accepte une image existante. Tesseract lit le texte français sur l'appareil sans transmettre ni conserver la photo. Seuls les mots recherchés sont envoyés à Google Books, Open Library et la BnF. Polices fantaisie, reflets et texte déformé peuvent faire échouer la lecture : le scan du code-barres reste le secours. Pas de saisie ISBN dans le scanner ; l'ISBN reste éditable dans les fiches.

Les résultats sont des propositions à confirmer, jamais des ajouts automatiques. Le rapprochement compare titre, auteur et tome, malgré accents/casse/ponctuation. Les auteurs contradictoires et tomes explicitement différents sont exclus. Auteur absent ou sous-titre différent : avertissement prudent, aucune fusion automatique.

Un ISBN peut être rattaché explicitement à une fiche sans ISBN. La sauvegarde atomique conserve ses corrections, date d'ajout et statut. Une fiche ayant déjà un ISBN n'est pas fusionnée ; l'utilisateur peut confirmer qu'il s'agit d'une autre édition.

« Trouver où l'acheter » ouvre Google Shopping avec l'ISBN, ou le titre/auteur. Aucun paiement, affiliation, prix ou stock garanti dans l'application. L'utilisateur termine l'achat chez le vendeur.

La collection et sa recherche restent hors ligne. Le moteur photo peut fonctionner après un premier chargement tant que Safari conserve ses ressources ; catalogues et achat nécessitent Internet. Sans titre fourni par les catalogues, un ISBN ne peut pas être comparé à une fiche manuelle : le résultat rappelle cette limite.

Après changement des dépendances : `npm ci`, `npm run vendor`, `npm run check`, puis `node scripts/package-site.mjs`. Les dépendances OCR sont gratuites et embarquées.

Une PWA mobile en français pour enregistrer et vérifier une collection personnelle de livres sur iPhone. Elle fonctionne sans compte, sans serveur applicatif et sans abonnement : la collection reste dans `IndexedDB`, sur l’appareil.

## Ce qui est inclus

- Deux modes de scan ISBN par caméra : **Vérifier** et **Enregistrer**.
- Retour sonore grave si le livre est déjà possédé, deux notes montantes sinon.
- Recherche ISBN dans les notices complètes **BnF**, **Open Library**, **Google Books** et **Inventaire**, avec recherche secondaire dans Crossref et la bibliothèque nationale du Japon.
- Résumé éditeur français et rôles des contributeurs lus dans les notices BnF. Les traducteurs ne sont pas présentés comme auteurs.
- Enrichissement par titre complet et auteur, sans confondre des sous-titres ou des numéros de tome différents. Aucun catalogue de livres codés en dur.
- Traduction automatique en français du résumé avec **MyMemory** lorsqu’une version française n’est pas disponible.
- Catégories enrichies (romance, dark romance, fantasy, thriller, manga, etc.) à partir des sujets, du titre et du résumé.
- Confirmation et modification du titre, des auteurs, catégories, résumé, couverture, date et pagination avant sauvegarde.
- Actualisation d’une fiche existante avec prévisualisation avant remplacement des informations.
- Bibliothèque locale disponible hors ligne, recherche, filtres par catégorie et prévention des ISBN en double.
- Liste d’envies avec passage en un geste vers la bibliothèque.
- Ajout manuel, modification, suppression et export JSON. L’import affiche une prévisualisation et conserve par défaut les fiches actuelles ; le remplacement nécessite un choix explicite.
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
6. **Sauvegarde** : exportez le JSON puis réimportez le fichier. Vérifiez la prévisualisation : les ISBN existants doivent être conservés par défaut. Testez aussi le choix explicite de remplacement avec une collection de test.
7. **Liste d’envies** : ajoutez un livre dans les envies puis utilisez « Je possède ce livre ».
8. **Actualisation** : ouvrez une fiche, touchez « Actualiser les informations », vérifiez la proposition puis sauvegardez.
9. **ISBN inconnu** : saisissez un ISBN valide mais absent des catalogues ; l’app doit laisser les champs vides plutôt que proposer un autre livre.

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

Remplacez les fichiers, augmentez le nom de cache dans `sw.js` (par exemple `v1.1.1`) ainsi que le suffixe `?v=` des ressources dans `index.html` et `sw.js`, puis envoyez le nouveau commit. Ouvrez une fois l’app avec Internet pour récupérer la mise à jour.

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
- **Catalogues** : tous les ISBN ne sont pas présents et les catégories peuvent être imprécises. L’app n’accepte que les résultats dont l’ISBN correspond exactement, compare Open Library, Google Books et Inventaire, puis vous laisse tout vérifier. Une clé Google Books gratuite personnelle peut être saisie si les requêtes sans clé sont limitées ; dans une application web, cette clé n’est jamais secrète.
- **Traduction** : MyMemory est utilisé uniquement lorsqu’un résumé fiable est disponible dans une langue reconnue autre que le français. Un quota, une erreur réseau ou un texte trop long peut laisser le résumé dans sa langue d’origine ; la correction manuelle reste possible.
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
├── api.js                    Open Library, Google Books et Inventaire
├── enrichment.js             Nettoyage, catégories et traduction française
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
- [Inventaire API](https://api.inventaire.io/)
- [MyMemory Translation API](https://mymemory.translated.net/doc/spec.php)
- [Documentation WebKit sur les apps d’écran d’accueil](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/) et [la politique de stockage](https://webkit.org/blog/14403/updates-to-storage-policy/)

Projet personnel sans compte ni publicité. Les données bibliographiques restent soumises aux conditions des catalogues interrogés. Les catalogues reçoivent les ISBN ou les recherches titre/auteur ; MyMemory reçoit le résumé à traduire. La bibliothèque sauvegardée n’est pas envoyée à ces services.

Les tests automatisés couvrent également les annulations de recherche/caméra, les imports atomiques, les collisions d’ISBN et les images opaques hors ligne. GitHub exécute ces tests avant de publier. Les tests physiques sur Safari iPhone (caméra, son, reprise depuis l’arrière-plan et stockage après fermeture) restent nécessaires.
