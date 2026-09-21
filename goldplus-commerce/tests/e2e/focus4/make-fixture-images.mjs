// Focus 4 evidence — generates clearly labelled TEST FRAME renditions into the
// web app's public dir so the storefront can serve them locally. Uses the API
// workspace's sharp (same library that makes production renditions). Delete
// the output after capturing evidence; it is not product photography.
//   node tests/e2e/focus4/make-fixture-images.mjs <public-dir>
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('../../../apps/api/node_modules/sharp');
const out = process.argv[2];
if (!out) { console.error('usage: make-fixture-images.mjs <public-dir>'); process.exit(2); }

const colours = ['#93D500', '#0A0A0A', '#456B00', '#6B6B6B'];
const labels = ['COVER', 'ALTERNATE', 'DETAIL', 'CONTEXT'];
const SIZES = [['pdp', 1024], ['card', 480], ['thumb', 160]];

for (let n = 1; n <= 4; n++) {
  const dir = join(out, 'uploads', 'assets', `f${n}`, `fixture${n}fixture`);
  mkdirSync(dir, { recursive: true });
  const bg = colours[n - 1];
  const fg = n === 1 || n === 3 ? '#0A0A0A' : '#FFFFFF';
  for (const [purpose, size] of SIZES) {
    const fontBig = Math.round(size * 0.11);
    const fontSmall = Math.round(size * 0.06);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <rect width="100%" height="100%" fill="#FFFFFF"/>
      <rect x="${size * 0.12}" y="${size * 0.18}" width="${size * 0.76}" height="${size * 0.64}" rx="${size * 0.06}" fill="${bg}"/>
      <text x="50%" y="46%" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${fontBig}" font-weight="700" fill="${fg}">TEST FRAME ${n}</text>
      <text x="50%" y="58%" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${fontSmall}" fill="${fg}">${labels[n - 1]} · ${purpose} ${size}px · not a product photo</text>
    </svg>`;
    const file = join(dir, `${purpose}.webp`);
    writeFileSync(file, await sharp(Buffer.from(svg)).webp({ quality: 78 }).toBuffer());
  }
  console.log(`fixture ${n}: ${dir} (${existsSync(join(dir, 'pdp.webp')) ? 'ok' : 'missing'})`);
}
