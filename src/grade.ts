// 등급 계산 + 진입 판정 (순수 함수 — 단위테스트 대상)
import type { GradeResult, IpoRow, PriceTier, Tier, Verdict } from './types.js';

/** 기관경쟁률: >1100 상 / 600~1100 중 / <600 하 */
export function gradeInstitutional(v: number | null): Tier | null {
  if (v == null) return null;
  if (v > 1100) return '상';
  if (v >= 600) return '중';
  return '하';
}

/** 청약경쟁률: >900 상 / 286.4~900 중 / <286.4 하 */
export function gradeSubscription(v: number | null): Tier | null {
  if (v == null) return null;
  if (v > 900) return '상';
  if (v >= 286.4) return '중';
  return '하';
}

/** 의무보유확약: >15% 상 / 7.5~15% 중 / <7.5% 하 */
export function gradeLockup(v: number | null): Tier | null {
  if (v == null) return null;
  if (v > 15) return '상';
  if (v >= 7.5) return '중';
  return '하';
}

/** 상장직후 유통가능물량: <31% 상 / 31~43.85% 중 / >43.85% 하 (낮을수록 좋음) */
export function gradeFloat(v: number | null): Tier | null {
  if (v == null) return null;
  if (v < 31) return '상';
  if (v <= 43.85) return '중';
  return '하';
}

/** 확정공모가 vs 희망밴드: 상단이상=상 / 하단이하=하 / 사이=중 / 미발표=미정 */
export function gradePrice(
  confirmed: number | null,
  bandLow: number | null,
  bandHigh: number | null,
): PriceTier {
  if (confirmed == null || bandLow == null || bandHigh == null) return '미정';
  if (confirmed >= bandHigh) return '상';
  if (confirmed <= bandLow) return '하';
  return '중';
}

const MID_OR_TOP = (t: Tier | null): boolean => t === '상' || t === '중';

/** 최종 진입 판정 */
export function decideVerdict(g: {
  institutional: Tier | null;
  lockup: Tier | null;
  float: Tier | null;
  price: PriceTier;
}): Verdict {
  // 판정에 필요한 핵심 데이터가 하나라도 미확정이면 판정 대기
  if (g.price === '미정' || g.institutional == null || g.lockup == null || g.float == null) {
    return '판정 대기';
  }
  // 확정공모가 등급이 '상'이 아니면 무조건 진입 X
  if (g.price !== '상') return '진입 X';
  // 퍼펙트: 기관=상 AND 의무보유=상 AND 유통물량=상
  if (g.institutional === '상' && g.lockup === '상' && g.float === '상') return '퍼펙트';
  // 청약 고려: 기관=상 AND 의무보유∈{상,중} AND 유통물량∈{상,중}
  if (g.institutional === '상' && MID_OR_TOP(g.lockup) && MID_OR_TOP(g.float)) return '청약 고려';
  return '진입 X';
}

/** IPO 원천 데이터로부터 전체 등급 + 판정 계산 */
export function computeGrade(r: IpoRow): GradeResult {
  const institutional = gradeInstitutional(r.institutionalRate);
  const subscription = gradeSubscription(r.subscriptionRate);
  const lockup = gradeLockup(r.lockupRatio);
  const float = gradeFloat(r.floatRatio);
  const price = gradePrice(r.confirmedPrice, r.bandLow, r.bandHigh);
  const verdict = decideVerdict({ institutional, lockup, float, price });
  return { institutional, subscription, lockup, float, price, verdict };
}
