-- 순수 조회 쿼리 — 부작용 없음, 아무 때나 안전하게 실행 가능.
-- month_assumptions 7개 월의 현재 상태를 확인하기 위한 스크립트.
-- final_growth가 이미 채워진 월은 팀 협의가 끝난 값이므로,
-- sql/update_reference_growth_holtwinters.sql 실행 후에도 그대로 유지됨(건드리지 않음).

SELECT ym, reference_growth, final_growth, store_change, new_product
FROM month_assumptions
ORDER BY ym;
