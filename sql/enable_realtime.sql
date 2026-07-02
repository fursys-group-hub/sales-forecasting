-- 배포 후 DB 관리자가 1회 수동으로 실행할 것.
-- 앱이 사용하는 DATABASE_URL 크리덴셜로는 실행하지 말 것 —
-- 발행(publication)/정책(policy) 관리 권한이 필요한 관리자용 스크립트다.
-- server.js/db.js는 이 스크립트를 자동으로 실행하지 않는다.

-- 1) Realtime이 assumptions/history 테이블의 변경을 브로드캐스트하도록 등록
ALTER PUBLICATION supabase_realtime ADD TABLE public.assumptions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.history;

-- 2) Row Level Security 활성화 (anon key로 구독하려면 RLS 정책이 있어야
--    Realtime이 postgres_changes 이벤트를 브라우저로 내려보낸다)
ALTER TABLE public.assumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.history ENABLE ROW LEVEL SECURITY;

-- 3) anon 역할에 읽기(SELECT) 권한만 부여 — 쓰기는 여전히 서버(PUT /api/assumptions,
--    DATABASE_URL 크리덴셜)를 통해서만 가능. 이 정책은 Realtime 구독을 위한 것이지
--    브라우저가 직접 테이블을 읽는 용도가 아니다.
CREATE POLICY "anon can read assumptions for realtime"
  ON public.assumptions FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "anon can read history for realtime"
  ON public.history FOR SELECT
  TO anon
  USING (true);
