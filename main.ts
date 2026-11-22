// News-image entry for 21 November 2026 (Node 22, standard library only).
// The image is entry.png beside this file: a front page rendered in-session
// from tools/scene.html (headless Chrome, no network). This program copies
// it to /output/entry.png, byte for byte, every run.
//
// Run it outside the grader's container with:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
const bytes = readFileSync(join(here, 'entry.png'));
// The file must be a whole PNG: check its 8-byte signature before copying.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
  throw new Error('entry.png is not a PNG file');
}
writeFileSync(join(outDir, 'entry.png'), bytes);
console.log(`wrote ${bytes.length} bytes to ${join(outDir, 'entry.png')}`);
