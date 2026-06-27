// Run once: node generate-icons.js
// Generates simple PNG icons for the PWA manifest.
// Requires the 'canvas' package: npm install canvas --save-dev
// If canvas won't build on your Pi, replace these PNGs with any 192x192
// and 512x512 images you prefer.

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

function makeIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#1a1d27';
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, size * 0.15);
  ctx.fill();

  // House emoji as text
  ctx.font = `${size * 0.55}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🏠', size / 2, size / 2);

  return canvas.toBuffer('image/png');
}

const iconsDir = path.join(__dirname, 'public', 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

for (const size of [192, 512]) {
  fs.writeFileSync(path.join(iconsDir, `icon-${size}.png`), makeIcon(size));
  console.log(`Generated icon-${size}.png`);
}
