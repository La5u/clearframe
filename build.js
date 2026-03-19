#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadTerms } = require('./term-utils');

const ROOT = __dirname;
const COLOR_CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'type-colors.json'), 'utf8'));

const TYPES = {};
for (const [color, config] of Object.entries(COLOR_CONFIG.colors)) {
  for (const type of config.types) {
    TYPES[type] = color;
  }
}

function build() {
  const index = loadTerms(path.join(ROOT, 'data', 'terms'));
  const count = Object.keys(index.termsById).length;

  fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
  const files = ['manifest.json', 'manifest.firefox.json', 'background.js', 'popup.html', 'popup.js', 'content.css'];
  files.forEach(f => fs.copyFileSync(path.join(ROOT, f), path.join(ROOT, 'dist', f)));
  fs.copyFileSync(path.join(ROOT, 'icon.png'), path.join(ROOT, 'dist', 'icon.png'));

  const code = `globalThis.ClearFrame = { index: ${JSON.stringify(index)}, types: ${JSON.stringify(TYPES)}, colorConfig: ${JSON.stringify(COLOR_CONFIG)} };`;
  const content = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');
  fs.writeFileSync(path.join(ROOT, 'dist', 'content.js'), code + content);

  const popupCode = `globalThis.ClearFrame = { types: ${JSON.stringify(TYPES)}, colorConfig: ${JSON.stringify(COLOR_CONFIG)} };`;
  const popup = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');
  fs.writeFileSync(path.join(ROOT, 'dist', 'popup.js'), popupCode + popup);

  fs.mkdirSync(path.join(ROOT, 'dist-firefox'), { recursive: true });
  const ffFiles = ['manifest.firefox.json', 'background.js', 'popup.html', 'popup.js', 'content.css'];
  ffFiles.forEach(f => fs.copyFileSync(path.join(ROOT, f), path.join(ROOT, 'dist-firefox', f === 'manifest.firefox.json' ? 'manifest.json' : f)));
  fs.copyFileSync(path.join(ROOT, 'icon.png'), path.join(ROOT, 'dist-firefox', 'icon.png'));
  fs.writeFileSync(path.join(ROOT, 'dist-firefox', 'content.js'), code + content);
  fs.writeFileSync(path.join(ROOT, 'dist-firefox', 'popup.js'), popupCode + popup);

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
