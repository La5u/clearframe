#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadTerms } = require('./term-utils');

const ROOT = __dirname;
const COLOR_CONFIG = readJson('data/type-colors.json');
const SHARED_FILES = ['background.js', 'popup.html', 'popup.js', 'content.css', 'icon-16.png', 'icon-32.png', 'icon-64.png', 'icon-128.png'];
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

function inlineRequires(content, filePath) {
  const requirePattern = /const\s+\{[^}]+\}\s*=\s*require\(['"](\.\/[^'"]+)['"]\);?/;
  const seen = new Set();
  let result = content;

  while (true) {
    const match = result.match(requirePattern);
    if (!match) return result;

    const fullPath = resolveRequire(filePath, match[1]);
    if (seen.has(fullPath)) {
      result = result.replace(match[0], '');
      continue;
    }

    seen.add(fullPath);
    result = result.replace(match[0], moduleToInline(fullPath));
  }
}

function resolveRequire(fromFile, request) {
  const base = path.resolve(path.dirname(fromFile), request);
  return fs.existsSync(base) || base.endsWith('.js') ? base : `${base}.js`;
}

function moduleToInline(file) {
  const source = fs.readFileSync(file, 'utf8');
  const cleaned = source
    .replace(/^const\s+\{[^}]+\}\s*=\s*require\(['"]\.\/[^'"]+['"]\);?\n?/gm, '')
    .replace(/^'use strict';?\n?/g, '')
    .replace(/^module\.exports\s*=\s*\{[\s\S]*?\};?\n?/gm, '')
    .trim();
  const exportsMatch = source.match(/module\.exports\s*=\s*\{([\s\S]*?)\};?/);
  if (!exportsMatch) return `${cleaned}\n`;

  const names = exportsMatch[1]
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);

  return `const { ${names.join(', ')} } = (() => {\n${cleaned}\nreturn { ${names.join(', ')} };\n})();\n`;
}

function resetDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(from, to) {
  fs.copyFileSync(path.join(ROOT, from), path.join(ROOT, to));
}

function bundleRuntime(globals, file) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const bundled = file === 'content.js' ? inlineRequires(source, path.join(ROOT, file)) : source;
  return `globalThis.ClearFrame = ${JSON.stringify(globals)};\n${bundled}`;
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
    for (const file of SHARED_FILES) {
      copyFile(file, `${target.dir}/${file}`);
    }
    copyFile('icon.png', `${target.dir}/icon.png`);
    fs.writeFileSync(path.join(ROOT, target.dir, 'content.js'), contentBundle);
    fs.writeFileSync(path.join(ROOT, target.dir, 'popup.js'), popupBundle);
    zipDir(target.dir, target.archive);
  }

  console.log(`Built: ${count} terms`);
}

build();
