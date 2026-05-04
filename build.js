#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { loadTerms } from './src/core/term-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const COLOR_CONFIG = readJson('data/type-colors.json');
const STATIC_FILES = [
  ['src/background.js', 'background.js'],
  ['src/ui/popup.html', 'popup.html'],
  ['src/ui/content.css', 'content.css']
];
const MEDIA_FILES = ['icon.png', 'icon-16.png', 'icon-32.png', 'icon-64.png', 'icon-128.png'];
const TARGETS = [
  { dir: 'dist', archive: 'dist.zip', manifest: 'manifest.json' },
  { dir: 'dist-firefox', archive: 'dist-firefox.zip', manifest: 'manifest.firefox.json', manifestOut: 'manifest.json' }
];
const { types: TYPES, categories: CATEGORIES } = buildTypeMaps(COLOR_CONFIG);

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
}

function buildTypeMaps(colorConfig) {
  const types = {};
  const categories = {};

  for (const [color, config] of Object.entries(colorConfig.colors || {})) {
    const category = config.category || config.name || color;
    for (const type of config.types || []) {
      if (types[type] && types[type] !== color) {
        throw new Error(`Type "${type}" is assigned to multiple colors`);
      }
      types[type] = color;
      categories[type] = category;
    }
  }

  return { types, categories };
}

function resolveImportPath(fromFile, importPath) {
  const dir = path.dirname(fromFile);
  const resolved = path.resolve(dir, importPath);
  return fs.existsSync(resolved) ? resolved : `${resolved}.js`;
}

function inlineESImports(content, filePath, processed) {
  const importPattern = /import\s+(?:(\w+)\s*,\s*)?\{?([^}]+)\}?\s*from\s*['"]([^'"]+)['"];?/g;
  let match;
  const imports = [];
  while ((match = importPattern.exec(content)) !== null) {
    imports.push({ fullMatch: match[0], importPath: match[3] });
  }
  for (const imp of imports) {
    const resolvedPath = resolveImportPath(filePath, imp.importPath);
    if (processed.has(resolvedPath)) {
      content = content.replace(imp.fullMatch, '');
      continue;
    }
    processed.add(resolvedPath);
    let importedContent = fs.readFileSync(resolvedPath, 'utf8');
    importedContent = inlineESImports(importedContent, resolvedPath, processed);
    importedContent = importedContent.replace(/^export\s+default\s+(\w+)/gm, '').replace(/^export\s+/gm, '').replace(/export\s*\{[^}]+\}\s*from\s*['"][^'"]+['"];?/g, '');
    content = content.replace(imp.fullMatch, importedContent);
  }
  return content;
}

function bundleRuntime(globals, file) {
  const filePath = path.join(SRC, file);
  let source = fs.readFileSync(filePath, 'utf8');
  const processed = new Set();
  source = inlineESImports(source, filePath, processed);
  return `globalThis.ClearFrame = ${JSON.stringify(globals)};\n${source}`;
}

function resetDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(from, to) {
  fs.copyFileSync(path.join(ROOT, from), path.join(ROOT, to));
}

function zipDir(dir, outName) {
  const cwd = path.join(ROOT, dir);
  if (!fs.existsSync(cwd)) return;
  const out = path.join(ROOT, outName);
  const res = spawnSync('zip', ['-r', out, '.'], { cwd, stdio: 'ignore' });
  if (res.error) return;
}

function build() {
  const index = loadTerms(path.join(ROOT, 'data', 'terms'));
  for (const term of Object.values(index.termsById)) {
    if (!TYPES[term.type]) {
      throw new Error(`Term type "${term.type}" is missing from data/type-colors.json`);
    }
  }
  const count = Object.keys(index.termsById).length;
  const contentBundle = bundleRuntime({
    index,
    types: TYPES,
    categories: CATEGORIES,
    colorConfig: COLOR_CONFIG
  }, 'content.js');
  const popupBundle = bundleRuntime({
    types: TYPES,
    categories: CATEGORIES,
    colorConfig: COLOR_CONFIG
  }, 'popup.js');

  for (const target of TARGETS) {
    resetDir(path.join(ROOT, target.dir));
    copyFile(target.manifest, `${target.dir}/${target.manifestOut || 'manifest.json'}`);
    for (const [from, to] of STATIC_FILES) {
      copyFile(from, `${target.dir}/${to}`);
    }
    fs.mkdirSync(path.join(ROOT, target.dir, 'media'), { recursive: true });
    for (const file of MEDIA_FILES) {
      copyFile(`media/${file}`, `${target.dir}/media/${file}`);
    }
    fs.writeFileSync(path.join(ROOT, target.dir, 'content.js'), contentBundle);
    fs.writeFileSync(path.join(ROOT, target.dir, 'popup.js'), popupBundle);
    zipDir(target.dir, target.archive);
  }

  console.log(`Built: ${count} terms`);
}

build();
