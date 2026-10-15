# Vérification de la version 1.5.0

## Organisation et grandes collections

Vérification locale dans le navigateur : 2 500 fiches synthétiques enregistrées, 60 cartes initiales puis 120 après « Afficher plus », recherche du livre 2499 depuis le premier lot, tri par auteur (Hugo avant Zola), tri récent, filtre Romance (833 résultats) combiné au tri titre, et tri conservé après rechargement. Ce test sur ordinateur ne constitue pas une mesure de performance sur iPhone réel.

- Vérifier les quatre tris, accents/casse, ordre naturel des nombres, noms d'auteur fournis dans les deux sens et absence de métadonnées.
- Vérifier un filtre de genre secondaire et une recherche visant un livre au-delà du premier lot de 60 ; tous les livres doivent être recherchés, pas seulement les cartes déjà affichées.
- Vérifier « Afficher plus », retour à 60 cartes après changement de filtre/recherche/tri, et mémorisation du choix après rechargement.
- En local uniquement, ouvrir `tests/large-library-qa.html`, créer les 2 500 fiches synthétiques puis ouvrir la bibliothèque. Aucun jeu de test n'est installé sur le site public ou dans la collection de l'utilisateur.

## Nouveaux parcours à vérifier sur iPhone réel

Contrôles effectués sur ordinateur : 44 tests automatisés réussis ; lecture réelle du titre/auteur d'une image synthétique par le moteur OCR ; création d'une fiche sans ISBN puis rattachement explicite avec une seule fiche restante, résumé et statut « envie » conservés ; recherche locale et lien d'achat par ISBN vérifiés dans l'interface. La prise de photo matérielle, les sons et le scanner sur Safari iPhone ne sont pas validés par ces tests. Le réglage de dimensions du navigateur de test n'a pas effectivement réduit sa largeur : la validation visuelle iPhone reste donc à faire.

1. Photographier une couverture nette, vérifier/corriger les mots reconnus puis choisir le bon titre/auteur/tome. Aucune sauvegarde sans confirmation.
2. Photo illisible/refusée : « Scanner le code-barres à la place », sans saisie ISBN dans ce parcours.
3. Fiche manuelle sans ISBN puis scan du même livre : avertissement de ressemblance, rattachement explicite et sauvegarde. Une seule fiche reste, avec corrections et statut initial.
4. Tomes différents, homonymes d'auteurs différents et autre édition : aucune fusion silencieuse.
5. Achat : le lien ouvre une recherche externe, sans envoyer la collection et sans paiement dans l'application.
6. Fermer pendant OCR/recherche puis rouvrir : aucune réponse ancienne ne remplit le nouveau dialogue.

Le moteur utilise maintenant les notices BnF INTERMARC, notamment les résumés éditeur 330/830, le titre original 145 et les rôles 0070 (auteur) / 0680 (traducteur). La correspondance ISBN est vérifiée avant toute fusion.

Les recherches internationales complètent la notice. Les autres éditions sont recherchées avec le titre français et le titre original ; les tomes distincts sont exclus. Les résumés français passent avant la traduction automatique.

## Vérifications reproductibles

- `npm ci` puis `npm run check` : ISBN erroné, rôles, résumés, numéros de tome, catégories trompeuses, traduction indisponible et actualisation sans cache.
- `node scripts/check-live-catalogs.mjs` : vérification des notices BnF actuelles.
- Démarrer le serveur et ouvrir `tests/catalog-qa.html`, puis « Tester les six ISBN » : recherche complète avec les vraies API et les couvertures chargées par le navigateur. Aucune sauvegarde de livre.

Corpus : 9782387032379, 9782266336994, 9782755640427, 9782070584628, 9782266320481, 9780140328721.

Une recherche complète n'est pas garantie pour tous les ISBN : certaines notices n'ont aucun résumé public et les services peuvent être indisponibles. Dans ce cas les champs restent éditables, les informations manquantes sont indiquées et Actualiser retente vraiment les catalogues. Les genres déduits automatiquement restent modifiables.

La fiche spéciale précédemment utilisée pour 9782755640427 a été supprimée. Si aucun catalogue ne fournit son résumé, l'application laisse ce champ vide. Le corpus vérifie les résultats des vrais catalogues, sans exiger artificiellement que toutes les fiches soient complètes.

Les régressions ajoutées couvrent : import conservateur et remplacement explicite, collision de sauvegarde, rollback complet en cas d'erreur, annulation d'un formulaire pendant une recherche, annulation de caméra native et ZXing, couverture opaque disponible hors ligne et stockage plein. Les tests utilisent une base IndexedDB isolée, jamais la collection de l'utilisateur.
