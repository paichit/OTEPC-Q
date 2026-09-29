import { readFile, readdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const root = new URL('../dist/', import.meta.url);
const names = await readdir(new URL('assets/', root));
const files = await Promise.all(names.map(async name => ({
  name: `assets/${name}`, data: await readFile(new URL(`assets/${name}`, root)),
})));
let initial;
try {
  const manifest = JSON.parse(await readFile(new URL('.vite/manifest.json', root), 'utf8'));
  initial = new Set();
  const visited = new Set();
  function visit(key) {
    if (visited.has(key)) return;
    visited.add(key);
    const item = manifest[key];
    if (!item) throw new Error(`Missing manifest entry: ${key}`);
    initial.add(item.file);
    (item.imports || []).forEach(visit);
  }
  visit('index.html');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  // Baseline builds before manifest support contained one eager JavaScript entry.
  initial = new Set(files.filter(file => file.name.endsWith('.js')).map(file => file.name));
}
const js = files.filter(file => file.name.endsWith('.js'));
const css = files.filter(file => file.name.endsWith('.css'));
const sum = (items, compressed = false) => items.reduce((total, file) => total + (compressed ? gzipSync(file.data).length : file.data.length), 0);
console.log(JSON.stringify({
  initialJavaScriptBytes: sum(js.filter(file => initial.has(file.name))),
  initialJavaScriptGzipBytes: sum(js.filter(file => initial.has(file.name)), true),
  totalJavaScriptBytes: sum(js),
  cssBytes: sum(css),
  cssGzipBytes: sum(css, true),
  totalAssetsBytes: sum(files),
  note: 'gzip sizes are estimates for separate files; excludes remote Google Fonts and HTTP headers',
}, null, 2));
