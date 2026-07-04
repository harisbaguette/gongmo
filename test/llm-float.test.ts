import { describe, expect, it } from 'vitest';
import { parseFloatFromContent } from '../src/scraper/llm-float.js';

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
