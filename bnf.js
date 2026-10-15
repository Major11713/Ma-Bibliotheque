
/*
 * Ma Bibliothèque
 * Analyse des notices BnF au format INTERMARC.
 */

export function parseBnfRecord(xml, isbn) {
  const expectedIsbn = String(isbn || '')
    .replace(/[^0-9X]/gi, '');

  const records = [
    ...xml.getElementsByTagNameNS('*', 'record')
  ];

  for (const record of records) {
    const fields = [
      ...record.getElementsByTagNameNS('*', 'datafield')
    ];

    if (!fields.length) continue;

    // Lire les sous-zones INTERMARC.
    const values = (tag, code) =>
      fields
        .filter(field =>
          field.getAttribute('tag') === tag
        )
        .flatMap(field =>
          [
            ...field.getElementsByTagNameNS('*', 'subfield')
          ]
            .filter(sub =>
              sub.getAttribute('code') === code
            )
            .map(sub => sub.textContent.trim())
        )
        .filter(Boolean);

    const cleanIdentifier = value =>
      String(value || '')
        .replace(/[^0-9X]/gi, '')
        .toUpperCase();

    // 020 = ISBN ; 038 = code-barres commercial.
    const identifiers = [
      ...values('020', 'a'),
      ...values('038', 'a')
    ];

    if (!identifiers.some(value =>
      cleanIdentifier(value) === expectedIsbn
    )) {
      continue;
    }

    // Auteurs.
    const authors = fields
      .filter(field =>
        ['100', '700', '710'].includes(
          field.getAttribute('tag')
        )
      )
      .filter(field =>
        [
          ...field.getElementsByTagNameNS('*', 'subfield')
        ].some(sub =>
          sub.getAttribute('code') === '4' &&
          ['0070', '070'].includes(
            sub.textContent.trim()
          )
        )
      )
      .map(field => {
        const sub = code =>
          [
            ...field.getElementsByTagNameNS('*', 'subfield')
          ].find(item =>
            item.getAttribute('code') === code
          )?.textContent.trim() || '';

        return [
          sub('m'),
          sub('a')
        ].filter(Boolean).join(' ');
      })
      .filter(Boolean);

    // Résumés authentiques.
    const summaries = [
      ...values('330', 'a'),
      ...values('830', 'a')
    ].filter(value =>
      value.length >= 60 &&
      !/^(collection|bibliographie|isbn|ean|code à barres)/i.test(value)
    );

    // 608 : genres et formes.
    const genres = [
      ...values('608', 'a'),
      ...values('608', 'b'),
      ...values('608', 'x')
    ];

    // 606 : sujets communs et subdivisions.
    const subjects = [
      ...values('606', 'a'),
      ...values('606', 'x'),
      ...values('615', 'a'),
      ...values('619', 'a')
    ];

    // Certaines collections ont un nom indiquant
    // explicitement le genre (ex. New Romance).
    // Ce sont des indices, pas des classifications sûres.
    const collectionGenres = [
      ...values('295', 'a'),
      ...values('295', 'e')
    ].filter(value =>
      /romance|littérature sentimentale|romans? d['’ ]amour|fantasy|thriller|manga/i.test(value)
    );

    const allSubjects = [
      ...new Set([
        ...genres,
        ...subjects,
        ...collectionGenres
      ])
    ];

    // Informations d'édition.
    const pageMatch = values('280', 'a')
      .join(' ')
      .match(/\b(\d{2,5})\s*p(?:ages?)?\b/i);

    const publicationDate = values('260', 'd')[0]
      ?.match(/\b\d{4}\b/)?.[0] || '';

    return {
      isbn,
      title: values('245', 'a')[0] || '',
      authors,
      originalTitle: values('142', 'a')[0] || '',
      description: summaries
        .sort((a, b) => b.length - a.length)[0] || '',
      subjects: allSubjects,
      publisher: values('260', 'c')[0] || '',
      publishedDate: publicationDate,
      pageCount: pageMatch
        ? Number(pageMatch[1])
        : '',
      language: values('041', 'a')[0] || 'fr',
      source: 'BnF',
      cover: ''
    };
  }

  throw new Error(
    'Aucune notice correspondant exactement à cet ISBN'
  );
}
