import { describe, expect, it } from 'vitest';
import { extractFloatByRule, parseFloatFromContent } from '../src/scraper/llm-float.js';

describe('LLM 유통물량 응답 파싱', () => {
  it('평범한 JSON 값 추출', () =>
    expect(parseFloatFromContent('{"floatRatio": 33.19}')).toBe(33.19));

  it('마크다운 코드펜스로 감싼 응답', () =>
    expect(parseFloatFromContent('```json\n{"floatRatio": 40.5}\n```')).toBe(40.5));

  it('앞뒤 설명 텍스트가 붙은 응답', () =>
    expect(parseFloatFromContent('추출 결과: {"floatRatio": 25} 입니다.')).toBe(25));

  it('문자열 "%" 포함 값', () =>
    expect(parseFloatFromContent('{"floatRatio": "33.19%"}')).toBe(33.19));

  it('null 값은 null', () =>
    expect(parseFloatFromContent('{"floatRatio": null}')).toBeNull());

  it('JSON 이 없으면 null', () =>
    expect(parseFloatFromContent('숫자를 찾을 수 없습니다')).toBeNull());

  // 범위 검증 회귀: 지분율은 0~100% 밖이면 폐기해야 등급 오염을 막는다
  it('소수점 누락 이상값(3319)은 폐기', () =>
    expect(parseFloatFromContent('{"floatRatio": 3319}')).toBeNull());

  it('100 초과는 폐기', () =>
    expect(parseFloatFromContent('{"floatRatio": 150}')).toBeNull());

  it('음수는 폐기', () =>
    expect(parseFloatFromContent('{"floatRatio": -5}')).toBeNull());

  it('경계값 0 과 100 은 유효', () => {
    expect(parseFloatFromContent('{"floatRatio": 0}')).toBe(0);
    expect(parseFloatFromContent('{"floatRatio": 100}')).toBe(100);
  });
});

describe('규칙 기반 유통물량 추출 (모델 없이)', () => {
  it('합계 행에서 뒤쪽(유통가능) 지분율을 고른다', () => {
    const row =
      '합계 6,000,000 100.00% 7,764,054 100.00% 5,199,054 66.96% 2,565,000 33.04% - 5.';
    expect(extractFloatByRule(row)).toBe(33.04);
  });

  it('"총계" 표기도 처리한다', () => {
    const row =
      '총계 37,613,980 100.00% 47,695,280 100.00% 35,849,250 75.16% 11,846,030 24.84% - 5.';
    expect(extractFloatByRule(row)).toBe(24.84);
  });

  it('합계 행 뒤에 서술형 문장이 붙어도 표 값을 지킨다', () => {
    const text =
      '합계 46,165,213 100.00% 53,318,546 100.00% 27,242,974 51.09% 26,075,572 48.91% - ' +
      '한편 자발적 매각제한을 고려할 경우 상장일 유통물량은 기존 48.97%에서 38.39%로 감소합니다.';
    expect(extractFloatByRule(text)).toBe(48.91);
  });

  it('표가 여러 개면 마지막 합계 행을 쓴다', () => {
    const text =
      '소계 1,000 100.00% 2,000 100.00% 800 80.00% 200 20.00% ' +
      '합계 5,000 100.00% 6,000 100.00% 3,000 62.00% 2,000 38.00%';
    expect(extractFloatByRule(text)).toBe(38);
  });

  it('합이 100%인 짝이 없으면 null (모델에 넘긴다)', () => {
    expect(extractFloatByRule('유통가능물량 표가 그림으로만 있음')).toBeNull();
    expect(extractFloatByRule('보유주식 1,000 12.30% 매각제한 500 6.10%')).toBeNull();
  });

  it('멀리 떨어진 숫자는 짝으로 보지 않는다', () => {
    const text = `60.00% ${'가'.repeat(80)} 40.00%`;
    expect(extractFloatByRule(text)).toBeNull();
  });
});

describe('규칙: 합계 행 기준점', () => {
  it('합계 행 뒤 설명문에 합이 100%인 숫자쌍이 또 나와도 표 값을 지킨다', () => {
    const text =
      '합계 100,000 100.00% 120,000 100.00% 70,000 62.00% 50,000 38.00% - ' +
      '참고: 자발적 확약을 반영하면 유통물량은 45.00%에서 55.00%로 바뀝니다.';
    expect(extractFloatByRule(text)).toBe(38);
  });

  it('합계 표기가 없으면 마지막 짝을 쓴다', () => {
    const text = '보유 1,000 30.00% 700 70.00%';
    expect(extractFloatByRule(text)).toBe(70);
  });
});

// 실제 공시 30건 교차검증에서 드러난 서식들 (2026-07-25) — 회귀 방지
describe('규칙: 실제 공시에서 나온 까다로운 서식', () => {
  it('"총 계"(띄어쓰기) 표기 — 에스투더블유', () => {
    const t =
      '공모주주 및 주관사 인수분 소계 1,627,400 15.37% 80,400 0.76% 1,547,000 14.61% - ' +
      '총 계 8,960,556 100.00% 10,587,956 100.00% 7,297,872 68.93% 3,290,084 31.07% - 5.';
    expect(extractFloatByRule(t)).toBe(31.07);
  });

  it('합계 행이 99.99%/100.00% 두 줄로 갈린 공시는 100.00% 줄을 쓴다 — 그래피', () => {
    const t =
      '합계 9,030,277 99.99% 11,038,777 99.99% 6,872,343 62.25% 4,166,434 37.74% - ' +
      '570 0.01% 570 0.01% - 0.00% 570 0.01% - ' +
      '9,030,847 100.00% 11,039,347 100.00% 6,872,343 62.25% 4,167,004 37.75% - 5.';
    expect(extractFloatByRule(t)).toBe(37.75);
  });

  it('% 기호가 빠진 오타 공시는 기권한다(모델이 이어받음) — 제이피아이헬스케어', () => {
    const t = '합계 4,158,000 100.00% 5,105,400 100.00% 3,525,400 69.05 1,580,000 30.95% - 5.';
    expect(extractFloatByRule(t)).toBeNull();
  });

  it('매각제한/유통가능이 각각 소계로 갈린 서식도 기권한다 — 서울보증보험', () => {
    const t =
      '소계 - 59,943,178 85.85% - 유통가능물량 기존주주 보통주 4,292,692 6.15% - ' +
      '공모주주 보통주 5,585,728 8.00% - 소계 - 9,878,420 14.15% - 합계 보통주 69,821,598 100.00% - 5.';
    expect(extractFloatByRule(t)).toBeNull();
  });

  it('유통가능물량이 70%대로 큰 공시도 그대로 읽는다 — 한텍', () => {
    const t =
      '소계 - - - 3,309,000 29.74% 3,309,000 29.74% - - - 의무인수 대신증권 보통주 - - 99,270 0.89% - - 99,270 0.89% 3개월 ' +
      '합계 - - - 11,127,819 100.00% 3,309,000 29.74% 7,818,819 70.26% - 5.';
    expect(extractFloatByRule(t)).toBe(70.26);
  });
});
