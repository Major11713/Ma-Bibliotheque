// INTERMARC contient les résumés éditeur et les rôles que Dublin Core perd.
export function parseBnfRecord(xml, isbn) {
  const records = [...xml.getElementsByTagNameNS('*', 'record')];
  for (const record of records) {
    const fields = [...record.getElementsByTagNameNS('*', 'datafield')];
    const values = (tag, code) => fields.filter(f => f.getAttribute('tag') === tag)
      .flatMap(f => [...f.getElementsByTagNameNS('*', 'subfield')]
        .filter(s => s.getAttribute('code') === code).map(s => s.textContent.trim()));
    const clean = value => String(value).replace(/[^0-9X]/gi, '');
    if (![...values('020', 'a'), ...values('038', 'a')].some(v => clean(v) === isbn)) continue;
    const authors = fields.filter(f => ['100', '700', '710'].includes(f.getAttribute('tag')))
      .filter(f => [...f.getElementsByTagNameNS('*', 'subfield')]
        .some(s => s.getAttribute('code') === '4' && s.textContent.trim() === '0070'))
      .map(f => {
        const sub = code => [...f.getElementsByTagNameNS('*', 'subfield')]
          .find(s => s.getAttribute('code') === code)?.textContent.trim() || '';
        return [sub('m'), sub('a')].filter(Boolean).join(' ');
      }).filter(Boolean);
    const summaries = [...values('330', 'a'), ...values('830', 'a')]
      .filter(v => v.length >= 60 && !/^(collection|bibliographie|isbn|ean)\b/i.test(v));
    const pageMatch = values('280', 'a').join(' ').match(/\b(\d{2,5})\s*p(?:ages?)?\b/i);
    return {
      isbn, title: values('245', 'a')[0] || '', authors,
      originalTitle: values('145', 'a')[0] || '',
      description: summaries.sort((a, b) => b.length - a.length)[0] || '',
      subjects: [...values('606', 'a'), ...values('607', 'a'), ...values('610', 'a'),
        ...values('295', 'a'), ...values('295', 'e')],
      publisher: values('260', 'c')[0] || '',
      publishedDate: values('260', 'd')[0]?.match(/\b\d{4}\b/)?.[0] || '',
      pageCount: pageMatch ? Number(pageMatch[1]) : '',
      language: values('041', 'a')[0] || 'fr', source: 'BnF', cover: ''
    };
  }
  throw new Error('Aucune notice correspondant exactement à cet ISBN');
}
