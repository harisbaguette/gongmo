// OpenRouter LLM 으로 "공모후 유통가능물량 비율(%)" 추출
import { config, isLlmConfigured } from '../config.js';

// 프롬프트 주의: 예시 지분율 숫자를 넣지 말 것.
// 실측(2026-07-25, 실제 공시 16건)에서 저가 모델이 예시 숫자(33.19%)를 그대로 베껴
// 오답을 냈고, 합계 행의 "매각제한물량" 지분율과 혼동하는 사례도 나왔다.
// 아래처럼 열 순서를 알려주고 "지시문 숫자 베끼기 금지"를 명시하자
// deepseek-v4-flash 는 13/16 → 16/16 으로 올라갔다.
const SYSTEM_PROMPT = [
  '너는 한국 IPO 공시의 "공모후 유통가능 물량" 표에서 숫자를 정확히 뽑아내는 추출기다.',
  '표의 마지막 "합계"(또는 "합 계"·"공모후 합계") 행에서 "유통가능물량"의 지분율(%)을 찾아라.',
  '합계 행은 보통 [주식수 지분율(공모전)] [주식수 지분율(공모후)] [매각제한물량 주식수 지분율] [유통가능물량 주식수 지분율] 순서다.',
  '따라서 합계 행에 나오는 지분율 중 맨 마지막 것이 답이며, 그 바로 앞의 매각제한물량 지분율과 헷갈리지 마라. 둘은 더하면 100%가 된다.',
  '표 안의 실제 숫자만 답하라. 이 지시문에 적힌 숫자를 그대로 베끼지 마라.',
  '반드시 아래 JSON 형식으로만 답하라. 다른 설명 금지.',
  '{"floatRatio": <숫자 또는 null>}',
  '값을 확신할 수 없으면 floatRatio 를 null 로 둔다.',
].join('\n');

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
    const v = obj.floatRatio;
    if (v == null) return null;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[%\s]/g, ''));
    if (!Number.isFinite(n)) return null;
    // 지분율 범위 검증: 0~100% 밖이면 이상값으로 간주해 폐기
    if (n < 0 || n > 100) return null;
    return n;
  } catch {
    return null;
  }
}

async function callOnce(sectionText: string): Promise<number | null> {
  const res = await fetch(config.openRouter.baseUrl, {
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
  });
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
 * 유통가능물량 비율(%) 추출. 실패(파싱/네트워크) 시 1회 재시도, 그래도 실패하면 null.
 */
export async function extractFloatRatio(sectionText: string | null): Promise<number | null> {
  if (!sectionText) return null;
  if (!isLlmConfigured()) {
    console.warn('[llm] OPENROUTER_API_KEY 미설정 — 유통가능물량 추출 건너뜀');
    return null;
  }
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const v = await callOnce(sectionText);
      if (v != null) return v;
      if (attempt === 1) continue; // null 이면 1회 재시도
    } catch (err) {
      console.warn(`[llm] 추출 실패 (시도 ${attempt}): ${(err as Error).message}`);
      if (attempt === 2) return null;
    }
  }
  return null;
}
