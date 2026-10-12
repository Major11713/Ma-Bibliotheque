import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'node_modules/@zxing/browser/umd/zxing-browser.min.js');
const destination = resolve(root, 'vendor/zxing-browser.min.js');
await mkdir(dirname(destination), { recursive: true });
await copyFile(source, destination);
console.log('ZXing copié dans vendor/.');
