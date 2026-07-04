import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import iconv from 'iconv-lite';
import { describe, expect, it } from 'vitest';
import {
  parseBand,
  parseListHtml,
  parseNumber,
  parseRate,
  parseScheduleRange,
} from '../src/scraper/parse-list.js';
import { extractFloatSection, parseDetailHtml } from '../src/scraper/parse-detail.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): string {
  const buf = readFileSync(resolve(__dirname, 'fixtures', name));
  return iconv.decode(buf, 'euc-kr');
}

describe('숫자/밴드/경쟁률 파서', () => {
  it('parseNumber 콤마 제거', () => expect(parseNumber('24,800')).toBe(24800));
  it('parseNumber 대시는 null', () => expect(parseNumber('-')).toBeNull());
  it('parseBand 범위 분리', () => expect(parseBand('7,500~10,000')).toEqual({ low: 7500, high: 10000 }));
  it('parseRate 비례 무시', () => expect(parseRate('1510.57:1 (비례 3021:1)')).toBe(1510.57));
  it('parseRate 없음', () => expect(parseRate(' ')).toBeNull());
});

describe('일정 파서', () => {
  it('동일월 범위', () =>
    expect(parseScheduleRange('2026.08.11~08.12')).toEqual({
      start: '2026-08-11',
      end: '2026-08-12',
    }));
  it('연말→연초 연도 증가', () =>
    expect(parseScheduleRange('2026.12.30~01.02')).toEqual({
      start: '2026-12-30',
      end: '2027-01-02',
    }));
});

describe('목록 페이지 파싱 (실제 fixture)', () => {
  const html = loadFixture('list.euckr.html');
  const entries = parseListHtml(html);

  it('여러 종목이 파싱된다', () => {
    expect(entries.length).toBeGreaterThan(10);
  });

  it('기도산업(2305) 이 올바르게 파싱된다', () => {
    const kido = entries.find((e) => e.id === 2305);
    expect(kido).toBeDefined();
    expect(kido!.name).toBe('기도산업');
    expect(kido!.subscribeStart).toBe('2026-08-11');
    expect(kido!.subscribeEnd).toBe('2026-08-12');
    expect(kido!.bandLow).toBe(24800);
    expect(kido!.bandHigh).toBe(28400);
    expect(kido!.confirmedPrice).toBeNull();
    expect(kido!.detailUrl).toContain('no=2305');
  });

  it('레몬헬스케어(2293) 확정가·경쟁률 파싱', () => {
    const lemon = entries.find((e) => e.id === 2293);
    expect(lemon).toBeDefined();
    expect(lemon!.confirmedPrice).toBe(10000);
    expect(lemon!.subscriptionRate).toBe(1510.57);
    expect(lemon!.underwriter).toContain('KB증권');
  });

  it('스팩주 플래그가 종목명 기준으로 설정된다', () => {
    for (const e of entries) {
      expect(e.isSpac).toBe(e.name.includes('스팩'));
    }
  });
});

describe('상세 페이지 파싱 (레몬헬스케어 fixture)', () => {
  const html = loadFixture('detail.euckr.html');
  const detail = parseDetailHtml(html);

  it('상장일 추출', () => expect(detail.listingDate).toBe('2026-07-06'));
  it('기관경쟁률 추출', () => expect(detail.institutionalRate).toBe(1238));
  it('의무보유확약 추출', () => expect(detail.lockupRatio).toBe(6.92));

  it('유통가능물량 섹션 텍스트가 추출되고 합계 지분율(33.19%)을 포함', () => {
    const section = extractFloatSection(html);
    expect(section).toBeTruthy();
    expect(section!).toContain('33.19');
    expect(section!).toContain('유통가능물량');
  });
});
