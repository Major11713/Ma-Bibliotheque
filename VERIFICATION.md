# Vérification de la version 1.3.0

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
