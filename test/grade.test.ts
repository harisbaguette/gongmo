import { describe, expect, it } from 'vitest';
import {
  computeGrade,
  decideVerdict,
  gradeFloat,
  gradeInstitutional,
  gradeLockup,
  gradePrice,
  gradeSubscription,
} from '../src/grade.js';
import type { IpoRow } from '../src/types.js';

describe('기관경쟁률 등급', () => {
  it('1100 초과는 상', () => expect(gradeInstitutional(1238)).toBe('상'));
  it('경계 1100 은 중', () => expect(gradeInstitutional(1100)).toBe('중'));
  it('600~1100 은 중', () => expect(gradeInstitutional(700)).toBe('중'));
  it('경계 600 은 중', () => expect(gradeInstitutional(600)).toBe('중'));
  it('600 미만은 하', () => expect(gradeInstitutional(599.9)).toBe('하'));
  it('null 은 null', () => expect(gradeInstitutional(null)).toBeNull());
});

describe('청약경쟁률 등급', () => {
  it('900 초과는 상', () => expect(gradeSubscription(1510.57)).toBe('상'));
  it('경계 286.4 는 중', () => expect(gradeSubscription(286.4)).toBe('중'));
  it('286.4 미만은 하', () => expect(gradeSubscription(200)).toBe('하'));
});

describe('의무보유확약 등급', () => {
  it('15 초과는 상', () => expect(gradeLockup(20)).toBe('상'));
  it('경계 15 는 중', () => expect(gradeLockup(15)).toBe('중'));
  it('7.5~15 는 중', () => expect(gradeLockup(10)).toBe('중'));
  it('6.92 는 하', () => expect(gradeLockup(6.92)).toBe('하'));
});

describe('유통가능물량 등급 (낮을수록 좋음)', () => {
  it('31 미만은 상', () => expect(gradeFloat(30.9)).toBe('상'));
  it('경계 31 은 중', () => expect(gradeFloat(31)).toBe('중'));
  it('33.19 는 중', () => expect(gradeFloat(33.19)).toBe('중'));
  it('경계 43.85 는 중', () => expect(gradeFloat(43.85)).toBe('중'));
  it('43.85 초과는 하', () => expect(gradeFloat(50)).toBe('하'));
});

describe('확정공모가 등급', () => {
  it('상단 이상은 상', () => expect(gradePrice(10000, 7500, 10000)).toBe('상'));
  it('하단 이하는 하', () => expect(gradePrice(7500, 7500, 10000)).toBe('하'));
  it('밴드 사이는 중', () => expect(gradePrice(9000, 7500, 10000)).toBe('중'));
  it('미발표는 미정', () => expect(gradePrice(null, 7500, 10000)).toBe('미정'));
});

describe('진입 판정', () => {
  it('확정가 미정이면 판정 대기', () =>
    expect(decideVerdict({ institutional: '상', lockup: '상', float: '상', price: '미정' })).toBe(
      '판정 대기',
    ));
  it('데이터 누락이면 판정 대기', () =>
    expect(decideVerdict({ institutional: null, lockup: '상', float: '상', price: '상' })).toBe(
      '판정 대기',
    ));
  it('확정가 상이 아니면 진입 X', () =>
    expect(decideVerdict({ institutional: '상', lockup: '상', float: '상', price: '중' })).toBe(
      '진입 X',
    ));
  it('모두 상 + 확정가 상이면 퍼펙트', () =>
    expect(decideVerdict({ institutional: '상', lockup: '상', float: '상', price: '상' })).toBe(
      '퍼펙트',
    ));
  it('기관 상 + 의무/유통 중이면 청약 고려', () =>
    expect(decideVerdict({ institutional: '상', lockup: '중', float: '중', price: '상' })).toBe(
      '청약 고려',
    ));
  it('기관 중이면 진입 X', () =>
    expect(decideVerdict({ institutional: '중', lockup: '상', float: '상', price: '상' })).toBe(
      '진입 X',
    ));
  it('유통물량 하이면 진입 X', () =>
    expect(decideVerdict({ institutional: '상', lockup: '상', float: '하', price: '상' })).toBe(
      '진입 X',
    ));
});

describe('computeGrade (레몬헬스케어 실측값)', () => {
  const lemon: IpoRow = {
    id: 2293,
    name: '레몬헬스케어',
    isSpac: 0,
    subscribeStart: '2026-06-24',
    subscribeEnd: '2026-06-25',
    listingDate: '2026-07-06',
    bandLow: 7500,
    bandHigh: 10000,
    confirmedPrice: 10000,
    subscriptionRate: 1510.57,
    institutionalRate: 1238,
    lockupRatio: 6.92,
    floatRatio: 33.19,
    underwriter: 'KB증권',
    detailUrl: 'https://www.38.co.kr/html/fund/?o=v&no=2293',
    createdAt: '',
    updatedAt: '',
  };
  it('확정가 상, 기관 상, 의무 하 → 진입 X', () => {
    const g = computeGrade(lemon);
    expect(g.price).toBe('상');
    expect(g.institutional).toBe('상');
    expect(g.subscription).toBe('상');
    expect(g.lockup).toBe('하');
    expect(g.float).toBe('중');
    expect(g.verdict).toBe('진입 X');
  });
});
