#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadTerms } = require('./term-utils');

const ROOT = __dirname;
const COLOR_CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'type-colors.json'), 'utf8'));
const CHROME_FILES = ['manifest.json', 'background.js', 'popup.html', 'popup.js', 'content.css', 'icon-16.png', 'icon-32.png', 'icon-64.png', 'icon-128.png'];
const FIREFOX_FILES = ['manifest.firefox.json', 'background.js', 'popup.html', 'popup.js', 'content.css', 'icon-16.png', 'icon-32.png', 'icon-64.png', 'icon-128.png'];
const TYPES = {};
const CATEGORIES = {};

for (const [color, config] of Object.entries(COLOR_CONFIG.colors || {})) {
  const category = config.category || config.name || color;
  for (const type of config.types || []) {
    if (TYPES[type] && TYPES[type] !== color) {
      throw new Error(`Type "${type}" is assigned to multiple colors`);
    }
    TYPES[type] = color;
    CATEGORIES[type] = category;
  }
}

function build() {
  const index = loadTerms(path.join(ROOT, 'data', 'terms'));
  for (const term of Object.values(index.termsById)) {
    if (!TYPES[term.type]) {
      throw new Error(`Term type "${term.type}" is missing from data/type-colors.json`);
    }
  }
  const count = Object.keys(index.termsById).length;

  const distDir = path.join(ROOT, 'dist');
  const firefoxDir = path.join(ROOT, 'dist-firefox');
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.rmSync(firefoxDir, { recursive: true, force: true });

  fs.mkdirSync(distDir, { recursive: true });
  CHROME_FILES.forEach(file => fs.copyFileSync(path.join(ROOT, file), path.join(distDir, file)));
  fs.copyFileSync(path.join(ROOT, 'icon.png'), path.join(distDir, 'icon.png'));

  const code = `globalThis.ClearFrame = { index: ${JSON.stringify(index)}, types: ${JSON.stringify(TYPES)}, categories: ${JSON.stringify(CATEGORIES)}, colorConfig: ${JSON.stringify(COLOR_CONFIG)} };`;
  const content = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');
  fs.writeFileSync(path.join(distDir, 'content.js'), code + content);

  const popupCode = `globalThis.ClearFrame = { types: ${JSON.stringify(TYPES)}, categories: ${JSON.stringify(CATEGORIES)}, colorConfig: ${JSON.stringify(COLOR_CONFIG)} };`;
  const popup = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');
  fs.writeFileSync(path.join(distDir, 'popup.js'), popupCode + popup);

  fs.mkdirSync(firefoxDir, { recursive: true });
  FIREFOX_FILES.forEach(file => {
    const target = file === 'manifest.firefox.json' ? 'manifest.json' : file;
    fs.copyFileSync(path.join(ROOT, file), path.join(firefoxDir, target));
  });
  fs.copyFileSync(path.join(ROOT, 'icon.png'), path.join(firefoxDir, 'icon.png'));
  fs.writeFileSync(path.join(firefoxDir, 'content.js'), code + content);
  fs.writeFileSync(path.join(firefoxDir, 'popup.js'), popupCode + popup);

  function zipDir(dir, outName) {
    const cwd = path.join(ROOT, dir);
    const out = path.join(ROOT, outName);
    if (!fs.existsSync(cwd)) return;
    // Best-effort zip; ignore if zip is unavailable.
    const res = spawnSync('zip', ['-r', out, '.'], { cwd, stdio: 'ignore' });
    if (res.error) return;
  }

  zipDir('dist', 'dist.zip');
  zipDir('dist-firefox', 'dist-firefox.zip');

  console.log(`Built: ${count} terms`);
}

build();
