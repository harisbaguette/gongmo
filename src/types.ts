// 공통 타입 정의

/** 개별 지표 등급 */
export type Tier = '상' | '중' | '하';
/** 확정공모가 등급 (미발표 포함) */
export type PriceTier = Tier | '미정';
/** 최종 진입 판정 */
export type Verdict = '퍼펙트' | '청약 고려' | '진입 X' | '판정 대기';

/** DB 에 저장되는 공모주 1건 (원천 수집 필드) */
export interface IpoRow {
  /** 38.co.kr 상세 URL 의 no= 값 (고유 ID) */
  id: number;
  name: string;
  isSpac: 0 | 1;
  /** 청약 시작일 YYYY-MM-DD */
  subscribeStart: string | null;
  /** 청약 마감일 YYYY-MM-DD */
  subscribeEnd: string | null;
  /** 상장일 YYYY-MM-DD */
  listingDate: string | null;
  /** 희망공모가 하단 */
  bandLow: number | null;
  /** 희망공모가 상단 */
  bandHigh: number | null;
  /** 확정공모가 (미발표 null) */
  confirmedPrice: number | null;
  /** 청약경쟁률 (예: 1510.57) */
  subscriptionRate: number | null;
  /** 기관경쟁률(수요예측경쟁률) */
  institutionalRate: number | null;
  /** 의무보유확약 비율 % */
  lockupRatio: number | null;
  /** 상장직후 유통가능물량 비율 % (LLM 추출, 실패 시 null) */
  floatRatio: number | null;
  /** 주간사 */
  underwriter: string | null;
  detailUrl: string;
  createdAt: string;
  updatedAt: string;
}

/** 리스트 페이지에서 추출한 부분 데이터 */
export interface ListEntry {
  id: number;
  name: string;
  isSpac: boolean;
  subscribeStart: string | null;
  subscribeEnd: string | null;
  confirmedPrice: number | null;
  bandLow: number | null;
  bandHigh: number | null;
  subscriptionRate: number | null;
  underwriter: string | null;
  detailUrl: string;
}

/** 상세 페이지에서 추출한 부분 데이터 */
export interface DetailEntry {
  listingDate: string | null;
  institutionalRate: number | null;
  lockupRatio: number | null;
  /** 유통가능물량 원천 텍스트 (LLM 입력용) */
  floatSectionText: string | null;
}

/** 등급 + 판정 결과 (계산값, 응답에 합쳐 전달) */
export interface GradeResult {
  institutional: Tier | null;
  subscription: Tier | null;
  lockup: Tier | null;
  float: Tier | null;
  price: PriceTier;
  verdict: Verdict;
}

/** API 응답용: 원천 + 등급 병합 */
export type IpoWithGrade = IpoRow & { grade: GradeResult };
