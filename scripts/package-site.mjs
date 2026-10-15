import { mkdir, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const destination = join(root, 'site');
await mkdir(destination, { recursive: true });
for (const file of ['index.html','styles.css','app.js','db.js','isbn.js','backup.js','api.js','bnf.js',
  'enrichment.js','scanner.js','identity.js','cover-search.js','sw.js','manifest.webmanifest','.nojekyll','icons','vendor','licenses','THIRD_PARTY_NOTICES.md']) {
  await cp(join(root,file),join(destination,file),{recursive:true});
}
console.log('Site prêt : uniquement les fichiers nécessaires à l’application.');
