// 목록 페이지(o=k) 파서
import * as cheerio from 'cheerio';
import { config } from '../config.js';
import type { ListEntry } from '../types.js';

/** "24,800" → 24800, "-"/"" → null */
export function parseNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[,\s원]/g, '');
  if (cleaned === '' || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** "7,500~10,000" → { low, high }. 단일값이면 둘 다 동일 */
export function parseBand(raw: string | undefined): { low: number | null; high: number | null } {
  if (!raw) return { low: null, high: null };
  const parts = raw.split('~').map((s) => parseNumber(s));
  if (parts.length >= 2) return { low: parts[0], high: parts[1] };
  return { low: parts[0] ?? null, high: parts[0] ?? null };
}

/** "1510.57:1 (비례 3021:1)" → 1510.57 */
export function parseRate(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = raw.match(/([\d,]+(?:\.\d+)?)\s*:\s*1/);
  if (!m) return null;
  return parseNumber(m[1]);
}

/**
 * "2026.08.11~08.12" → { start: '2026-08-11', end: '2026-08-12' }
 * 시작은 YYYY.MM.DD, 끝은 MM.DD (연말~연초는 연도 +1 처리)
 */
export function parseScheduleRange(raw: string | undefined): {
  start: string | null;
  end: string | null;
} {
  if (!raw) return { start: null, end: null };
  const text = raw.trim();
  const startM = text.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  if (!startM) return { start: null, end: null };
  const year = Number(startM[1]);
  const sMonth = Number(startM[2]);
  const sDay = Number(startM[3]);
  const start = iso(year, sMonth, sDay);

  const endPart = text.split('~')[1]?.trim();
  if (!endPart) return { start, end: null };
  // 끝: "MM.DD" 또는 "YYYY.MM.DD"
  const full = endPart.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  if (full) {
    return { start, end: iso(Number(full[1]), Number(full[2]), Number(full[3])) };
  }
  const md = endPart.match(/(\d{1,2})\.(\d{1,2})/);
  if (md) {
    const eMonth = Number(md[1]);
    const eDay = Number(md[2]);
    const eYear = eMonth < sMonth ? year + 1 : year; // 연말→연초
    return { start, end: iso(eYear, eMonth, eDay) };
  }
  return { start, end: null };
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** href 에서 no= 값 추출 */
export function parseIdFromHref(href: string | undefined): number | null {
  if (!href) return null;
  const m = href.match(/no=(\d+)/);
  return m ? Number(m[1]) : null;
}

/** 목록 HTML → ListEntry[] */
export function parseListHtml(html: string): ListEntry[] {
  const $ = cheerio.load(html);
  const table = $('table[summary="공모주 청약일정"]');
  const entries: ListEntry[] = [];

  table
    .find('tbody > tr')
    .each((_, tr) => {
      const cells = $(tr).find('> td');
      if (cells.length < 6) return; // 구분선/헤더 행 스킵

      const link = $(cells[0]).find('a[href*="o=v"]').first();
      const id = parseIdFromHref(link.attr('href'));
      const name = link.text().trim();
      if (!id || !name) return;

      const schedule = parseScheduleRange($(cells[1]).text());
      const confirmedPrice = parseNumber($(cells[2]).text());
      const band = parseBand($(cells[3]).text());
      const subscriptionRate = parseRate($(cells[4]).text());
      const underwriter = $(cells[5]).text().trim() || null;

      entries.push({
        id,
        name,
        isSpac: name.includes('스팩'),
        subscribeStart: schedule.start,
        subscribeEnd: schedule.end,
        confirmedPrice,
        bandLow: band.low,
        bandHigh: band.high,
        subscriptionRate,
        underwriter,
        detailUrl: `${config.scrape.detailBase}${id}`,
      });
    });

  return entries;
}
