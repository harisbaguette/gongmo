import { afterAll, describe, expect, it } from 'vitest';
import { db, getIpo, upsertFromList } from '../src/db.js';
import type { ListEntry } from '../src/types.js';

// 실제 파일 DB 를 사용하므로 충돌 없는 합성 ID 로 테스트 후 정리한다.
const TEST_ID = 990001;

function entry(over: Partial<ListEntry>): ListEntry {
  return {
    id: TEST_ID,
    name: '테스트종목',
    isSpac: false,
    subscribeStart: '2026-08-11',
    subscribeEnd: '2026-08-12',
    confirmedPrice: null,
    bandLow: null,
    bandHigh: null,
    subscriptionRate: null,
    underwriter: null,
    detailUrl: 'https://www.38.co.kr/html/fund/?o=v&no=990001',
    ...over,
  };
}

afterAll(() => {
  db.prepare('DELETE FROM ipos WHERE id = ?').run(TEST_ID);
});

describe('upsertFromList 확정값 보존 (회귀)', () => {
  it('확정가 발표 후 목록이 "-"(null)로 와도 기존 확정값을 보존한다', () => {
    // 1) 확정가·경쟁률·밴드가 채워진 상태로 저장
    upsertFromList(
      entry({
        confirmedPrice: 10000,
        bandLow: 7500,
        bandHigh: 10000,
        subscriptionRate: 1510.57,
        underwriter: 'KB증권',
      }),
    );

    // 2) 다음 수집에서 해당 셀들이 일시적으로 null 로 파싱됨(목록에 "-" 표기)
    upsertFromList(
      entry({
        name: '테스트종목(정정)',
        confirmedPrice: null,
        bandLow: null,
        bandHigh: null,
        subscriptionRate: null,
        underwriter: null,
      }),
    );

    const row = getIpo(TEST_ID);
    expect(row).not.toBeNull();
    // 확정 계열 값은 보존
    expect(row!.confirmedPrice).toBe(10000);
    expect(row!.bandLow).toBe(7500);
    expect(row!.bandHigh).toBe(10000);
    expect(row!.subscriptionRate).toBe(1510.57);
    expect(row!.underwriter).toBe('KB증권');
    // 종목명 같은 갱신 필드는 최신 값으로 반영
    expect(row!.name).toBe('테스트종목(정정)');
  });

  it('신규 삽입은 true, 기존 갱신은 false 를 반환한다', () => {
    db.prepare('DELETE FROM ipos WHERE id = ?').run(TEST_ID);
    expect(upsertFromList(entry({ confirmedPrice: 5000 }))).toBe(true);
    expect(upsertFromList(entry({ confirmedPrice: 5000 }))).toBe(false);
  });
});
