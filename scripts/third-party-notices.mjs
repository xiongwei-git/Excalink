import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const inventory = [];
const licenses = [];
const missing = [];
for (const [path, entry] of Object.entries(lock.packages)) {
  if (!path || entry.dev || entry.link) continue;
  let metadata;
  try {
    metadata = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT' || !entry.optional) throw error;
  }
  const name = metadata?.name || path.split('node_modules/').at(-1);
  const id = `${name}@${entry.version}`;
  const license = entry.license || metadata?.license || 'UNDECLARED';
  const files = metadata ? (await readdir(path, { withFileTypes: true })).filter(file =>
    file.isFile() && /^(licen[cs]e|copying|copyright|notice)([._-].*)?$/i.test(file.name)).map(file => file.name).sort() : [];
  inventory.push({ name, version: entry.version, license, path, installed: Boolean(metadata), notices: files });
  if (metadata && !files.length) missing.push(`${id} (${license})`);
  for (const file of files) {
    licenses.push(`===== ${id} / ${file} (${path}) =====\n\n${(await readFile(join(path, file), 'utf8')).trim()}\n`);
  }
}
const fontRoot = 'node_modules/@excalidraw/excalidraw/dist/prod/fonts';
const fontDirectories = (await readdir(fontRoot, { withFileTypes: true })).filter(file => file.isDirectory());
const fonts = [];
for (const { name: family } of fontDirectories) {
  const files = (await readdir(join(fontRoot, family))).filter(file => file.endsWith('.woff2')).sort();
  for (const file of files) {
    const data = await readFile(join(fontRoot, family, file));
    fonts.push({ family, file, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
  }
}
await writeFile('notices/npm-inventory.json', JSON.stringify({
  scope: 'Non-dev npm lock entries, including platform-optional packages.',
  inventory, installedPackagesWithoutStandaloneNotice: missing, fonts,
}, null, 2) + '\n');
await writeFile('notices/npm-license-texts.txt', licenses.join('\n'));
console.log(`${inventory.length} lock entries, ${licenses.length} packaged license/notice files, ${missing.length} without standalone notice, ${fonts.length} fonts.`);
