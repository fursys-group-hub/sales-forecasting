-- 이 스크립트는 Supabase SQL Editor 또는 IT팀이 직접 실행합니다.
-- Claude Code 세션은 이 파일을 생성만 하고 실행하지 않습니다.
--
-- 목적: month_assumptions 테이블의 "로직 근거 성장률"(reference_growth,
-- reference_rationale) 산출 방식을 25.1~26.9월 단일 YoY 반복 방식에서
-- Holt-Winters 지수평활법(추세+계절성, 22.1~26.6월 판가매출 기준, AIC 최적화,
-- 2000회 몬테카를로 시뮬레이션 기반 90% 예측구간) 기준으로 교체.
--
-- 주의: reference_growth / reference_rationale 두 컬럼만 갱신함.
-- final_growth(팀 협의로 이미 확정된 값), store_change, new_product,
-- updated_at 등 다른 컬럼은 이 스크립트가 절대 건드리지 않음.
-- final_growth가 이미 채워진 월이 있다면 그 값은 팀이 협의 완료한 것이므로
-- 이 갱신과 무관하게 그대로 유지됨 — 실행 전 sql/check_final_growth.sql로
-- 먼저 확인할 것.

BEGIN;

-- ---- 갱신 전 상태 확인 ----
SELECT ym, reference_growth, final_growth
FROM month_assumptions
WHERE ym IN ('202610', '202611', '202612', '202701', '202702', '202703', '202704')
ORDER BY ym;

-- ---- 갱신 (reference_growth, reference_rationale 두 컬럼만) ----

UPDATE month_assumptions
SET reference_growth = 0.038,
    reference_rationale = 'Holt-Winters 지수평활법(추세+계절성, 22.1-26.6월 판가매출 기준) 예측 중심값 +3.8%, 90% 예측구간 -11.3%~+19.2% (백테스트 검증: 8개 분기별 시점, 56개 표본 MAPE 10.3%로 대안 방법군 중 최저)'
WHERE ym = '202610';

UPDATE month_assumptions
SET reference_growth = -0.031,
    reference_rationale = '동일 모델, 중심값 -3.1%, 90% 예측구간 -18.9%~+12.8%'
WHERE ym = '202611';

UPDATE month_assumptions
SET reference_growth = -0.058,
    reference_rationale = '동일 모델, 중심값 -5.8%, 90% 예측구간 -20.2%~+8.8%'
WHERE ym = '202612';

UPDATE month_assumptions
SET reference_growth = -0.023,
    reference_rationale = '동일 모델, 중심값 -2.3%, 90% 예측구간 -16.7%~+11.9%'
WHERE ym = '202701';

UPDATE month_assumptions
SET reference_growth = -0.094,
    reference_rationale = '동일 모델, 중심값 -9.4%, 90% 예측구간 -21.8%~+2.8%'
WHERE ym = '202702';

UPDATE month_assumptions
SET reference_growth = -0.043,
    reference_rationale = '동일 모델, 중심값 -4.3%, 90% 예측구간 -16.9%~+8.5%'
WHERE ym = '202703';

UPDATE month_assumptions
SET reference_growth = 0.039,
    reference_rationale = '동일 모델, 중심값 +3.9%, 90% 예측구간 -12.7%~+19.7%'
WHERE ym = '202704';

-- ---- 갱신 후 상태 확인 (위 "갱신 전" 결과와 비교) ----
SELECT ym, reference_growth, final_growth
FROM month_assumptions
WHERE ym IN ('202610', '202611', '202612', '202701', '202702', '202703', '202704')
ORDER BY ym;

-- 위 두 SELECT 결과에서 reference_growth만 바뀌고 final_growth는 동일한지
-- 확인한 뒤 COMMIT. 이상이 있으면 COMMIT 대신 ROLLBACK 실행할 것.
COMMIT;
