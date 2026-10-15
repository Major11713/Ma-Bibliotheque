import { copyFile, mkdir, cp } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'node_modules/@zxing/browser/umd/zxing-browser.min.js');
const destination = resolve(root, 'vendor/zxing-browser.min.js');
await mkdir(dirname(destination), { recursive: true });
await copyFile(source, destination);
console.log('ZXing copié dans vendor/.');
const ocr = resolve(root, 'vendor/ocr');
await mkdir(resolve(ocr, 'core'), { recursive: true });
await mkdir(resolve(ocr, 'lang'), { recursive: true });
for (const file of ['tesseract.min.js', 'worker.min.js']) await copyFile(resolve(root, 'node_modules/tesseract.js/dist', file), resolve(ocr, file));
for (const stem of ['tesseract-core-lstm', 'tesseract-core-simd-lstm']) {
  for (const suffix of ['.wasm.js', '.wasm']) await copyFile(resolve(root, 'node_modules/tesseract.js-core', stem + suffix), resolve(ocr, 'core', stem + suffix));
}
await copyFile(resolve(root, 'node_modules/@tesseract.js-data/fra/4.0.0/fra.traineddata.gz'), resolve(ocr, 'lang/fra.traineddata.gz'));
await cp(resolve(root, 'node_modules/tesseract.js/LICENSE.md'), resolve(root, 'licenses/tesseract-LICENSE.txt'));
await cp(resolve(root, 'node_modules/tesseract.js-core/LICENSE'), resolve(root, 'licenses/tesseract-core-LICENSE.txt'));
console.log('Lecture française de couverture copiée : aucun service payant, aucune photo envoyée.');
