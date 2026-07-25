import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 추출 호출의 재시도·타임아웃·다수결 동작 회귀 테스트.
 * - 429(요청 과다)·5xx·응답 없음은 잠깐 쉬었다 1회 더 시도한다.
 * - 같은 질문을 두 번 물어 답이 같아야 채택하고, 갈리면 세 번째로 다수결한다.
 * - 끝까지 못 정하면 등급을 오염시키지 않도록 조용히 null 을 돌려준다.
 */

const jsonRes = (content: string): Response =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

const val = (n: number | null): Response => jsonRes(JSON.stringify({ floatRatio: n }));

async function loadModule() {
  vi.resetModules();
  vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-test-key');
  vi.stubEnv('OPENROUTER_TIMEOUT_MS', '50');
  vi.stubEnv('OPENROUTER_RETRY_MS', '10'); // 테스트는 기다리지 않는다
  return import('../src/scraper/llm-float.js');
}

// 규칙(합이 100%인 인접 쌍)으로는 풀 수 없는 서식 → 모델 경로를 타게 만든다
const SECTION = '공모후 유통가능 물량: 합계 행이 이미지로만 있어 지분율 숫자가 없음';

describe('LLM 호출 재시도·다수결', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('두 번 물어 답이 같으면 그 값을 쓴다(호출 2회)', async () => {
    const { extractFloatRatio } = await loadModule();
    const fetchMock = vi.fn().mockImplementation(() => val(40));
    vi.stubGlobal('fetch', fetchMock);

    await expect(extractFloatRatio(SECTION)).resolves.toBe(40);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('답이 갈리면 세 번째를 물어 2표 모인 값을 쓴다', async () => {
    const { extractFloatRatio } = await loadModule();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(val(66.96)) // 매각제한 지분율을 잘못 집은 경우
      .mockResolvedValueOnce(val(33.04))
      .mockResolvedValueOnce(val(33.04));
    vi.stubGlobal('fetch', fetchMock);

    await expect(extractFloatRatio(SECTION)).resolves.toBe(33.04);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('세 번 다 다르면 값을 비운다(잘못된 값으로 등급 오염 금지)', async () => {
    const { extractFloatRatio } = await loadModule();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(val(10))
      .mockResolvedValueOnce(val(20))
      .mockResolvedValueOnce(val(30));
    vi.stubGlobal('fetch', fetchMock);

    await expect(extractFloatRatio(SECTION)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('429(요청 과다)는 쉬었다 재시도하고, 회복되면 값을 쓴다', async () => {
    const { extractFloatRatio } = await loadModule();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockImplementation(() => val(40));
    vi.stubGlobal('fetch', fetchMock);

    await expect(extractFloatRatio(SECTION)).resolves.toBe(40);
    expect(fetchMock).toHaveBeenCalledTimes(3); // 429 → 재시도 성공 → 두 번째 표
  });

  it('계속 5xx면 null (호출 6회 = 표 3장 × 재시도 2회)', async () => {
    const { extractFloatRatio } = await loadModule();
    const fetchMock = vi.fn().mockImplementation(() => new Response('boom', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(extractFloatRatio(SECTION)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('응답이 안 오면(타임아웃) 재시도한다', async () => {
    const { extractFloatRatio } = await loadModule();
    let n = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      n += 1;
      if (n === 1) {
        return Promise.reject(
          Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' }),
        );
      }
      return val(33.5);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(extractFloatRatio(SECTION)).resolves.toBe(33.5);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('빈 응답이면 1회 재시도한다', async () => {
    const { extractFloatRatio } = await loadModule();
    const fetchMock = vi.fn().mockResolvedValueOnce(val(null)).mockImplementation(() => val(27.29));
    vi.stubGlobal('fetch', fetchMock);

    await expect(extractFloatRatio(SECTION)).resolves.toBe(27.29);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('원문이 없으면 호출조차 하지 않는다', async () => {
    const { extractFloatRatio } = await loadModule();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(extractFloatRatio(null)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('요청에 시간 제한(AbortSignal)이 붙어 있다', async () => {
    const { extractFloatRatio } = await loadModule();
    const fetchMock = vi.fn().mockImplementation(() => val(10));
    vi.stubGlobal('fetch', fetchMock);

    await extractFloatRatio(SECTION);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
