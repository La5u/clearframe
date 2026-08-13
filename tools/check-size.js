#!/usr/bin/env node
import fs from 'fs';

const LIMIT = 50 * 1024 * 1024;
for (const file of ['dist.zip', 'dist-firefox.zip']) {
  const bytes = fs.statSync(file).size;
  console.log(`${file}: ${(bytes / 1024).toFixed(1)} KiB / 51200 KiB`);
  if (bytes >= LIMIT) throw new Error(`${file} exceeds the 50 MB store budget`);
}
