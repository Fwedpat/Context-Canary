import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { SVGIcons2SVGFontStream } from 'svgicons2svgfont';
import svg2ttf from 'svg2ttf';
import ttf2woff from 'ttf2woff';

const font = new SVGIcons2SVGFontStream({
  fontName: 'canary-icons',
  normalize: true,
  fontHeight: 1000,
  descent: 100
});
const svgPromise = new Promise((resolve, reject) => {
  let svg = '';
  font.on('data', chunk => { svg += chunk.toString(); });
  font.on('end', () => resolve(svg));
  font.on('error', reject);
});
for (const [name, codepoint] of [['canary-bird', 0xe000], ['canary-dying', 0xe001]]) {
  const glyph = createReadStream(new URL(`../media/glyphs/${name}.svg`, import.meta.url));
  glyph.metadata = { name, unicode: [String.fromCodePoint(codepoint)] };
  glyph.on('error', error => font.destroy(error));
  font.write(glyph);
}
font.end();
const svg = await svgPromise;
const ttf = svg2ttf(svg, { ts: 0 }).buffer;
const woff = ttf2woff(new Uint8Array(ttf)).buffer;
await writeFile(new URL('../media/canary-icons.woff', import.meta.url), new Uint8Array(woff));