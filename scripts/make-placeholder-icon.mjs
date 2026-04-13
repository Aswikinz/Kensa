#!/usr/bin/env node
// Generates a 256×256 PNG placeholder icon for the marketplace listing.
// Pure Node, no image libraries — PNG is simple enough to hand-assemble.
// Replace `media/icon.png` with your real artwork before you go public.
//
// Usage: node scripts/make-placeholder-icon.mjs

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', 'media', 'icon.png');

const W = 256;
const H = 256;

// Colors — matches the galleryBanner in package.json.
const BG = [0x1e, 0x1e, 0x2e];          // near-black indigo
const GRID = [0x34, 0x34, 0x48];        // subtle grid lines
const ACCENT = [0x4e, 0xc9, 0xb0];      // teal (matches --vscode-symbolIcon-functionForeground)
const HIGHLIGHT = [0x89, 0xd1, 0x85];   // green (matches diff-modified)

// One byte per scanline is the "filter type" (0 = none), followed by RGB
// for each pixel. 4 bytes per pixel would be RGBA, but we don't need
// transparency for an icon — the marketplace flattens it anyway.
const stride = 1 + W * 3;
const raw = Buffer.alloc(H * stride);

function setPixel(x, y, [r, g, b]) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const idx = y * stride + 1 + x * 3;
  raw[idx] = r;
  raw[idx + 1] = g;
  raw[idx + 2] = b;
}

// Fill background.
for (let y = 0; y < H; y++) {
  raw[y * stride] = 0; // filter: none
  for (let x = 0; x < W; x++) {
    setPixel(x, y, BG);
  }
}

// Rounded outer frame — 12px border with rounded corners.
const CORNER = 32;
function inRoundedRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  if (x < x0 + r && y < y0 + r) return Math.hypot(x - (x0 + r), y - (y0 + r)) <= r;
  if (x > x1 - r && y < y0 + r) return Math.hypot(x - (x1 - r), y - (y0 + r)) <= r;
  if (x < x0 + r && y > y1 - r) return Math.hypot(x - (x0 + r), y - (y1 - r)) <= r;
  if (x > x1 - r && y > y1 - r) return Math.hypot(x - (x1 - r), y - (y1 - r)) <= r;
  return true;
}

// Data grid motif: 4x4 table with a few highlighted cells.
const CELL = 44;
const TABLE_X = 40;
const TABLE_Y = 56;
const COLS = 4;
const ROWS = 4;

// Table background (slightly lighter than page bg).
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const inTable =
      x >= TABLE_X - 4 &&
      x < TABLE_X + COLS * CELL + 4 &&
      y >= TABLE_Y - 4 &&
      y < TABLE_Y + ROWS * CELL + 4;
    if (inTable && inRoundedRect(x, y, TABLE_X - 4, TABLE_Y - 4, TABLE_X + COLS * CELL + 4, TABLE_Y + ROWS * CELL + 4, 8)) {
      setPixel(x, y, [0x28, 0x28, 0x3a]);
    }
  }
}

// Grid lines (vertical + horizontal).
for (let c = 0; c <= COLS; c++) {
  const x = TABLE_X + c * CELL;
  for (let y = TABLE_Y; y <= TABLE_Y + ROWS * CELL; y++) {
    setPixel(x, y, GRID);
    setPixel(x + 1, y, GRID);
  }
}
for (let r = 0; r <= ROWS; r++) {
  const y = TABLE_Y + r * CELL;
  for (let x = TABLE_X; x <= TABLE_X + COLS * CELL; x++) {
    setPixel(x, y, GRID);
    setPixel(x, y + 1, GRID);
  }
}

// Header row tint — top row is the "column headers".
for (let x = TABLE_X + 2; x < TABLE_X + COLS * CELL; x++) {
  for (let y = TABLE_Y + 2; y < TABLE_Y + CELL - 1; y++) {
    setPixel(x, y, [0x33, 0x33, 0x4a]);
  }
}

// Highlight a couple of diff cells (teal + green) in the body.
const DIFF_CELLS = [
  [1, 1, ACCENT],
  [3, 2, HIGHLIGHT],
  [2, 3, ACCENT]
];
for (const [cx, cy, color] of DIFF_CELLS) {
  const x0 = TABLE_X + cx * CELL + 3;
  const y0 = TABLE_Y + cy * CELL + 3;
  const x1 = x0 + CELL - 5;
  const y1 = y0 + CELL - 5;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      // Slightly translucent — blend with bg.
      const blend = 0.35;
      setPixel(
        x,
        y,
        color.map((c, i) => Math.round(c * blend + 0x28 * (1 - blend) + i * 0))
      );
    }
  }
  // Mini bar chart inside the cell.
  for (let bx = 0; bx < CELL - 12; bx += 5) {
    const h = 4 + ((bx * 7) % 18);
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        setPixel(x0 + 3 + bx + dx, y1 - 3 - dy, color);
      }
    }
  }
}

// Draw the column-header "sort arrows" on the top row.
for (let c = 0; c < COLS; c++) {
  const cx = TABLE_X + c * CELL + CELL / 2;
  const cy = TABLE_Y + 12;
  for (let dy = 0; dy < 7; dy++) {
    for (let dx = -dy; dx <= dy; dx++) {
      setPixel(Math.round(cx + dx), Math.round(cy + dy), [0xaa, 0xaa, 0xc0]);
    }
  }
}

// ---- PNG assembly ---------------------------------------------------------

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// IHDR: 13 bytes — width, height, bit depth (8), color type (2 = RGB),
// compression, filter, interlace (all zero).
const ihdrData = Buffer.alloc(13);
ihdrData.writeUInt32BE(W, 0);
ihdrData.writeUInt32BE(H, 4);
ihdrData[8] = 8;
ihdrData[9] = 2;
ihdrData[10] = 0;
ihdrData[11] = 0;
ihdrData[12] = 0;

const idatData = deflateSync(raw);

const png = Buffer.concat([
  signature,
  chunk('IHDR', ihdrData),
  chunk('IDAT', idatData),
  chunk('IEND', Buffer.alloc(0))
]);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, png);
console.log(`[kensa] wrote placeholder icon to ${OUT} (${png.length} bytes)`);
