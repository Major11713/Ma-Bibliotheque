export function normaliseIsbn(value) {
  const cleaned = String(value || '').toUpperCase().replace(/[^0-9X]/g, '');
  if (cleaned.length === 10 && isValidIsbn10(cleaned)) return isbn10To13(cleaned);
  if (cleaned.length === 13 && isValidIsbn13(cleaned) && /^(978|979)/.test(cleaned)) return cleaned;
  return '';
}

function isValidIsbn10(value) {
  if (!/^\d{9}[\dX]$/.test(value)) return false;
  const sum = [...value].reduce((total, char, index) => total + (char === 'X' ? 10 : Number(char)) * (10 - index), 0);
  return sum % 11 === 0;
}

function isValidIsbn13(value) {
  if (!/^\d{13}$/.test(value)) return false;
  const sum = [...value.slice(0, 12)].reduce((total, char, index) => total + Number(char) * (index % 2 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === Number(value[12]);
}

function isbn10To13(value) {
  const base = `978${value.slice(0, 9)}`;
  const sum = [...base].reduce((total, char, index) => total + Number(char) * (index % 2 ? 3 : 1), 0);
  return `${base}${(10 - (sum % 10)) % 10}`;
}
