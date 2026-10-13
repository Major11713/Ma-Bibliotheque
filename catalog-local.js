// Petit catalogue de secours pour les éditions françaises dont les
// catalogues publics ne fournissent qu'une notice bibliographique.
// Les textes sont reformulés et les données ne remplacent jamais une
// fiche plus récente enregistrée par la personne qui utilise l'app.
const BOOKS = {
  '9782755640427': {
    title: 'Glitter Girl — Black Riders, tome 1',
    authors: ['C. J. Ronnie'],
    description: "Hayley quitte New York pour la Californie avec Brandon, son meilleur ami. Tous deux espèrent tourner la page d’un passé dangereux. Alors qu’elle commence des études d’assistante sociale et découvre sa nouvelle vie, elle rencontre Jace, un motard aussi mystérieux qu’attirant. Cette relation l’entraîne dans l’univers des bikers, au risque de réveiller les secrets qu’elle cherchait à fuir.",
    categories: ['Romance'],
    cover: 'https://static.weezbe.com/magstoreandmore/Images/products/p_22590G_241208195507.jpg',
    publishedDate: '2019',
    pageCount: 588,
    publisher: 'Hugo Poche',
    language: 'fr',
    source: 'Catalogue local vérifié'
  }
};

export function lookupLocalCatalog(isbn) {
  const book = BOOKS[String(isbn || '')];
  return book ? { isbn: String(isbn), ...book } : null;
}

