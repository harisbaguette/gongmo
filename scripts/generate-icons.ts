// SVG → PNG 아이콘 생성 (192/512 + maskable + favicon)
import sharp from 'sharp';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICON_DIR = resolve(__dirname, '../public/icons');
mkdirSync(ICON_DIR, { recursive: true });

/** 앱 아이콘 SVG (파란 배경 + 상승 차트 + "공") */
function svg(size: number, maskable: boolean): string {
  const pad = maskable ? Math.round(size * 0.1) : 0; // maskable 안전영역
  const s = size - pad * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#0b63f6"/>
  <g transform="translate(${pad},${pad})">
    <polyline points="${s * 0.15},${s * 0.72} ${s * 0.38},${s * 0.5} ${s * 0.55},${s * 0.6} ${s * 0.85},${s * 0.24}"
      fill="none" stroke="#ffffff" stroke-width="${s * 0.06}" stroke-linecap="round" stroke-linejoin="round"/>
    <polygon points="${s * 0.85},${s * 0.24} ${s * 0.86},${s * 0.42} ${s * 0.68},${s * 0.26}" fill="#ffffff"/>
    <text x="50%" y="${s * 0.9}" text-anchor="middle" font-family="sans-serif" font-weight="bold"
      font-size="${s * 0.16}" fill="#ffffff">공모주</text>
  </g>
</svg>`;
}

async function render(name: string, size: number, maskable = false): Promise<void> {
  const out = resolve(ICON_DIR, name);
  await sharp(Buffer.from(svg(size, maskable))).png().toFile(out);
  console.log(`생성: ${out}`);
}

async function main(): Promise<void> {
  await render('icon-192.png', 192);
  await render('icon-512.png', 512);
  await render('icon-192-maskable.png', 192, true);
  await render('icon-512-maskable.png', 512, true);
  await render('favicon.png', 64);
  console.log('아이콘 생성 완료');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
