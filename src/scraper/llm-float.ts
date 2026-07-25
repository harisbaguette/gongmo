// OpenRouter LLM 으로 "공모후 유통가능물량 비율(%)" 추출
import { config, isLlmConfigured } from '../config.js';

// 프롬프트 주의: 예시 지분율 숫자를 넣지 말 것.
// 실측(2026-07-25, 실제 공시 16건)에서 저가 모델이 예시 숫자(33.19%)를 그대로 베껴
// 오답을 냈고, 합계 행의 "매각제한물량" 지분율과 혼동하는 사례도 나왔다.
// 아래처럼 열 순서를 알려주고 "지시문 숫자 베끼기 금지"를 명시하자
// deepseek-v4-flash 는 13/16 → 16/16 으로 올라갔다.
const SYSTEM_PROMPT = [
  '너는 한국 IPO 공시의 "공모후 유통가능 물량" 표에서 숫자를 정확히 뽑아내는 추출기다.',
  '표의 마지막 합계 행("합계"·"합 계"·"총계"·"공모후 합계" 등으로 적힌다)에서 "유통가능물량"의 지분율(%)을 찾아라.',
  '합계 행 끝에는 매각제한물량 지분율과 유통가능물량 지분율이 이 순서로 있고 둘을 더하면 100%다. 뒤쪽(유통가능) 값이 답이다.',
  '표 안의 실제 숫자만 답하라. 이 지시문에 적힌 숫자를 그대로 베끼지 마라.',
  '반드시 아래 JSON 형식으로만 답하라. 다른 설명 금지.',
  '{"floatRatio": <숫자 또는 null>}',
  '값을 확신할 수 없으면 floatRatio 를 null 로 둔다.',
].join('\n');

/** 0~100% 범위의 지분율만 통과시킨다(소수점 누락·음수 같은 이상값 폐기) */
function toRatio(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[%\s,]/g, ''));
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return n;
}

/**
 * 응답 문자열에서 JSON 추출 → floatRatio.
 * 유통가능물량 지분율은 0~100% 범위여야 한다. LLM 이 소수점 누락(예: 3319)·음수·
 * 100 초과 같은 이상값을 뱉으면 등급을 오염시키므로 폐기(null)한다.
 */
export function parseFloatFromContent(content: string): number | null {
  // 코드펜스/잡텍스트 제거 후 첫 JSON 객체 파싱
  const jsonMatch = content.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) return null;
  try {
    const obj = JSON.parse(jsonMatch[0]) as { floatRatio?: unknown };
    return toRatio(obj.floatRatio);
  } catch {
    return null;
  }
}

/**
 * 규칙(코드)만으로 유통가능물량 지분율 뽑기 — **LLM 보다 먼저 시도한다.**
 *
 * 근거: 합계 행 끝에는 언제나 [매각제한 지분율][유통가능 지분율]이 나란히 있고 둘의 합이 100%다.
 * 그래서 "붙어 있으면서 합이 100%가 되는 마지막 지분율 쌍"의 **뒤쪽 값**이 곧 답이다.
 * 실측(2026-07-25, 실제 공시 23건)에서 이 규칙만으로 23/23 정답이었고,
 * 같은 표에서 모델은 가끔 앞쪽(매각제한) 값을 집었다(2301: 33.04 대신 66.96).
 * 사실로 계산할 수 있는 값을 모델 판단에 맡기지 않는 것이 근본 해법이다.
 */
export function extractFloatByRule(sectionText: string): number | null {
  const flat = sectionText.replace(/\s+/g, ' ');
  const pcts = [...flat.matchAll(/(\d{1,3}(?:\.\d+)?)\s*%/g)].map((m) => ({
    v: Number(m[1]),
    i: m.index ?? -1,
  }));

  // 짝 후보: 붙어 있고(같은 행) 합이 100%인 지분율 쌍
  const pairs: { value: number; at: number }[] = [];
  for (let k = 1; k < pcts.length; k++) {
    const a = pcts[k - 1];
    const b = pcts[k];
    if (a.v === 100 || b.v === 100) continue; // 100% 는 합계 자체(주식수 열)라 짝이 아니다
    if (Math.abs(a.v + b.v - 100) > 0.02) continue; // 두 값의 합이 100%
    if (b.i - a.i > 60) continue; // 같은 행 안에 붙어 있어야 한다
    pairs.push({ value: b.v, at: a.i }); // 뒤쪽(b) = 유통가능물량
  }
  if (pairs.length === 0) return null;

  // 합계 행 뒤에 "…유통물량은 48.97%에서 38.39%로 감소" 같은 설명문이 붙는 공시가 있다.
  // 그래서 마지막 합계 표기를 기준점으로 잡고, 그 **직후** 짝을 답으로 쓴다.
  const totalKey = [...flat.matchAll(/합\s*계|총\s*계/g)].map((m) => m.index ?? -1).pop() ?? -1;
  const afterTotal = totalKey >= 0 ? pairs.find((p) => p.at > totalKey) : undefined;
  const answer = (afterTotal ?? pairs[pairs.length - 1]).value;
  return answer >= 0 && answer <= 100 ? answer : null;
}

/** 잠깐 뒤 다시 하면 될 만한 실패(429 요청 과다·5xx 서버오류·타임아웃) */
class TransientError extends Error {}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function callOnce(sectionText: string): Promise<number | null> {
  let res: Response;
  try {
    res = await fetch(config.openRouter.baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.openRouter.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://ipo-calculator.local',
        'X-Title': 'ipo-calculator',
      },
      body: JSON.stringify({
        model: config.openRouter.model,
        temperature: 0,
        max_tokens: 200,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `다음은 "공모후 유통가능 물량" 표의 텍스트다. 유통가능물량 지분율(%)을 JSON 으로 추출하라.\n\n${sectionText}`,
          },
        ],
      }),
      // 응답이 영영 안 오면 서버리스 함수(최대 300초)를 통째로 잡아먹고
      // 나머지 종목 수집까지 날아간다 → 요청 단위로 반드시 끊는다.
      signal: AbortSignal.timeout(config.openRouter.timeoutMs),
    });
  } catch (err) {
    // 타임아웃·네트워크 끊김은 재시도 가치가 있다
    throw new TransientError(`요청 실패/시간초과: ${(err as Error).message}`);
  }
  if (res.status === 429 || res.status >= 500) {
    throw new TransientError(`OpenRouter HTTP ${res.status}`);
  }
  if (!res.ok) {
    throw new Error(`OpenRouter HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content ?? '';
  return parseFloatFromContent(content);
}

/**
 * 1표 얻기. 빈값·네트워크 실패 시 1회 재시도, 그래도 실패하면 null.
 * 429(요청 과다)·5xx·타임아웃은 곧바로 다시 때리면 또 막히므로 잠깐 쉬었다 재시도한다.
 */
async function extractOnce(sectionText: string): Promise<number | null> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const v = await callOnce(sectionText);
      if (v != null) return v;
      // 빈값이면 잠깐 쉬고 1회 재시도
      if (attempt === 1) await sleep(Math.min(400, config.openRouter.retryDelayMs));
    } catch (err) {
      console.warn(`[llm] 추출 실패 (시도 ${attempt}): ${(err as Error).message}`);
      if (attempt === 2) return null;
      await sleep(
        err instanceof TransientError
          ? config.openRouter.retryDelayMs
          : Math.min(400, config.openRouter.retryDelayMs),
      );
    }
  }
  return null;
}

/**
 * 유통가능물량 비율(%) 추출 — **규칙 먼저, 모델은 보조**.
 *
 * 1) 코드 규칙(`extractFloatByRule`)으로 뽑는다. 실측 23건 전부 성공했고 돈도 시간도 안 든다.
 * 2) 규칙이 못 찾는 낯선 서식일 때만 모델에 묻는다. 이때는 값이 흔들릴 수 있으므로
 *    두 번 물어 같을 때만 쓰고, 갈리면 세 번째로 2표 모인 값을 쓴다.
 * 3) 끝내 못 정하면 값을 비운다 — 틀린 값은 등급을 조용히 오염시키지만,
 *    빈 값은 화면에서 바로 눈에 띈다.
 */
export async function extractFloatRatio(sectionText: string | null): Promise<number | null> {
  if (!sectionText) return null;

  const byRule = extractFloatByRule(sectionText);
  if (byRule != null) return byRule;

  if (!isLlmConfigured()) {
    console.warn('[llm] OPENROUTER_API_KEY 미설정 — 유통가능물량 추출 건너뜀');
    return null;
  }
  console.warn('[llm] 규칙으로 못 찾음 — 모델에 확인 요청');

  const first = await extractOnce(sectionText);
  const second = await extractOnce(sectionText);
  if (first != null && first === second) return first;

  const third = await extractOnce(sectionText);
  const votes = [first, second, third].filter((v): v is number => v != null);
  for (const v of votes) {
    if (votes.filter((o) => o === v).length >= 2) return v;
  }
  console.warn(`[llm] 답이 매번 달라 값을 비움 (${votes.join(', ') || '전부 실패'})`);
  return null;
}
