// 상세 페이지(o=v) 파서
import * as cheerio from 'cheerio';
import type { DetailEntry } from '../types.js';
import { parseRate } from './parse-list.js';

// 공백 정규화: nbsp(\u00A0) 및 연속 공백 → 단일 공백
function normalizeSpaces(input: string): string {
  return input.replace(/\u00A0/g, ' ').replace(/[ \t]+/g, ' ');
}

/** "2026.07.06" → "2026-07-06" */
function toIso(raw: string | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

/**
 * 유통가능물량 섹션 텍스트 추출.
 * "4.공모후 유통가능 물량" ~ "5.요약재무제표" 사이 표를 텍스트로 평탄화.
 * (형식이 들쭉날쭉하므로 LLM 입력용 원천 텍스트로 넘긴다)
 */
export function extractFloatSection(html: string): string | null {
  const startKey = '유통가능 물량';
  const endKey = '요약재무제표';
  const startIdx = html.indexOf(startKey);
  if (startIdx < 0) return null;
  let endIdx = html.indexOf(endKey, startIdx);
  if (endIdx < 0) endIdx = Math.min(html.length, startIdx + 40000);
  const slice = html.slice(startIdx, endIdx);
  const $ = cheerio.load(slice);
  const text = normalizeSpaces($.root().text())
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
  if (!text) return null;
  // 토큰 절약: 지나치게 길면 뒷부분만 (합계 행은 대개 표 끝에 위치)
  return text.length > 9000 ? text.slice(-9000) : text;
}

/** 상세 HTML → DetailEntry */
export function parseDetailHtml(html: string): DetailEntry {
  const $ = cheerio.load(html);
  const bodyText = normalizeSpaces($('body').text());

  // 상장일 (신규상장일 아닌 '주요일정'의 상장일 우선)
  const listMatch = bodyText.match(/(?<!신규)상장일[\s\S]{0,40}?(\d{4}\.\d{1,2}\.\d{1,2})/);
  const listingDate = toIso(listMatch?.[1]);

  // 기관경쟁률(수요예측경쟁률): "기관경쟁률 1238.00:1"
  const instMatch = bodyText.match(/기관경쟁률[\s\S]{0,20}?([\d,]+(?:\.\d+)?\s*:\s*1)/);
  const institutionalRate = parseRate(instMatch?.[1]);

  // 의무보유확약: "의무보유확약 6.92%"
  const lockMatch = bodyText.match(/의무보유\s*확약[\s\S]{0,20}?([\d]+(?:\.\d+)?)\s*%/);
  const lockupRatio = lockMatch ? Number(lockMatch[1]) : null;

  const floatSectionText = extractFloatSection(html);

  return { listingDate, institutionalRate, lockupRatio, floatSectionText };
}
