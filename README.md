# 27년 성수기 매출예측 — 월별 협의 보드

슬로우베드 26.10 ~ 27.4월 매출예측을 유관부서 팀장들이 월별 카드 위에서 함께 보고,
근거와 함께 "최종 협의 성장률"을 합의·기록하는 내부용 웹 툴입니다. 이전의 보수/기본/공격
3-시나리오 구조는 폐기되었고, 월 1개 트랙(로직 근거 성장률 → 팀장 협의로 확정)으로 단순화했습니다.

- 백엔드: Node.js + Express, DB는 Postgres(`pg`) — 사내 Supabase(Self-hosted) 인스턴스에 연결
- 프론트: 순수 HTML/CSS/JS (빌드 툴 없음), Chart.js·`@supabase/supabase-js` 모두 CDN
- 여러 명이 동시에 값을 바꾸면 Supabase Realtime으로 즉시 다른 화면에 반영됩니다(웹소켓 끊김
  대비 60초 주기 폴백 폴링 병행)
- 마지막 저장자가 덮어쓰는 last-write-wins 방식 — 편집자별로 값을 나누지 않습니다
- **편집자 이름 게이트/변경 이력 없음**: 실시간 협업 툴이라 누가 바꿨는지 기록할 필요가
  없다는 결론으로, "내 이름" 입력·`changed_by`·변경 이력 추적 기능을 모두 제거했습니다.
  값이 바뀌면 즉시 저장되고, 저장 성공/실패 토스트만 뜹니다.

## 로컬 실행

```bash
cp .env.example .env   # DATABASE_URL 등 채워넣기
npm install
npm start
# http://localhost:4747 접속
```

`.env`가 없어도 서버는 뜨지만(개발 편의를 위해 `dotenv`가 조용히 no-op), `DATABASE_URL`이
실제 Postgres를 가리키지 않으면 API가 실패합니다. `SUPABASE_URL`/`SUPABASE_ANON_KEY`가
비어있으면 프론트는 Realtime 없이 60초 폴링만으로 동작합니다.

## IT팀 인수인계 (Coolify 연결 담당자용)

개발 쪽에서는 **로컬 환경에서 정상 동작하는 것까지만** 확인했습니다. Coolify 대시보드 연결과
실제 배포는 IT팀에서 코드를 받아 직접 진행합니다. 아래 내용이면 별도 문의 없이 연결·배포가
가능할 겁니다 — 막히면 이 레포 관리자에게 문의해주세요.

### 이 앱이 필요로 하는 것

- **Node.js 22+** 런타임 (레포에 포함된 `Dockerfile`이 `node:22-alpine`을 쓰므로, Docker로
  빌드하면 Node를 별도로 설치할 필요 없음)
- **Postgres 연결 1개** (사내 Supabase Self-hosted 인스턴스) — 이 앱이 배포되는 서버/컨테이너에서
  해당 Postgres로 네트워크 접근이 가능해야 함 (같은 사내망/VPC 안에 있어야 함)
- **포트 1개** (기본 `4747`, `PORT` 환경변수로 변경 가능)
- **상시 실행 프로세스** — 서버리스/단발성 함수가 아니라 Express 서버가 계속 떠 있어야 하는
  구조 (DB 커넥션 풀을 프로세스 시작 시 한 번 맺고 계속 재사용)

### 필요한 환경변수 (`.env.example` 참고, 값은 Coolify 환경변수 화면에만 입력)

| 변수 | 필수 | 설명 |
| --- | --- | --- |
| `DATABASE_URL` | 필수 | 서버 전용 Postgres 연결 문자열 (`pg.Pool`), 브라우저에 노출 안 됨 |
| `SUPABASE_URL` | 필수 | `GET /api/config`를 통해 브라우저에 그대로 노출됨 (Realtime 구독용) |
| `SUPABASE_ANON_KEY` | 필수 | 위와 동일 경로로 노출 — anon key만 사용, **service_role 키 절대 금지** |
| `PORT` | 선택 | 미지정 시 `4747` 기본값 (`server.js`, `Dockerfile` 둘 다 동일) |

### Supabase 쪽에서 실행해야 하는 SQL

- **테이블 생성은 수동 작업 불필요**: 앱 최초 기동 시 `db.js`의 `initDb()`가
  `historical_sales`/`month_assumptions` 테이블 생성과 기본 시드값 삽입을 자동 수행함
  (이미 있으면 `ON CONFLICT DO NOTHING`으로 건너뜀. 구 버전 `assumptions`/`history` 테이블,
  `oem_addback`/`updated_by` 컬럼은 자동으로 DROP됨)
- **`sql/enable_realtime.sql` — 수동 실행 필요**: `month_assumptions` 테이블을 Realtime
  퍼블리케이션에 등록 + RLS 활성화 + anon SELECT 정책 부여. **앱의 `DATABASE_URL` 크리덴셜이
  아닌 관리자 권한**으로 Supabase SQL Editor 등에서 1회 실행 (매 배포마다 재실행 불필요)

### 로컬에서 이 앱을 테스트하는 방법

```bash
cp .env.example .env   # DATABASE_URL 등 채워넣기
npm install
npm start
# http://localhost:4747
```

또는 Docker로:

```bash
docker build -t forecast-collab-tool .
docker run -p 4747:4747 --env-file .env forecast-collab-tool
```

(2026-07-03: 실제 Supabase 인스턴스 접근 권한이 아직 없는 상태에서, `pg` 드라이버를 인메모리
Postgres 호환 엔진(`pg-mem`)으로 임시 치환해 `db.js`/`server.js`/`forecast.js`를 그대로
로컬 실행 — 테이블 자동 생성/시드, 예측 계산, `PUT /api/month/:ym` 저장·미확정 복귀, 잘못된
월 파라미터 거부, 정적 파일 서빙까지 모두 정상 동작 확인함. 이 테스트용 코드/의존성은 실제
레포에는 포함되어 있지 않음)

### Coolify에서 레포 연결 시 설정값

- **빌드팩**: Dockerfile (레포 루트에 `Dockerfile` 존재 — Coolify가 자동 인식, Nixpacks 아님)
- **시작 명령**: 별도 지정 불필요 — `Dockerfile`의 `CMD ["node", "server.js"]`가 그대로 사용됨
  (`package.json`의 `scripts.start`와 동일 커맨드)
- **포트**: `4747` (Dockerfile `EXPOSE 4747` / `server.js` 기본값과 일치 — Coolify 포트 매핑에서
  이 포트로 프록시하도록 설정)

### 확인이 필요한 미확정 사항

- `DATABASE_URL` 크리덴셜의 권한 레벨 — `sql/enable_realtime.sql`(퍼블리케이션/RLS 관리)까지
  이 크리덴셜로 실행 가능한지, 아니면 별도 관리자 계정이 필요한지
- Postgres 접속 시 SSL 필요 여부 (사내망 직접 연결인지 TLS 종단 프록시 경유인지에 따라
  `DATABASE_URL`에 `?sslmode=require` 추가가 필요할 수 있음)

## UI 구조

헤더 아래는 좌우 2컬럼(`.layout-grid`, 42% : 58%):

- **왼쪽 컬럼 (sticky, 화면에 고정)**:
  1. **25.1~27.4월 매출 추이 차트** — 매출은 막대(왼쪽 축, 백만원, 실적/예상/확정예측은 진한
     색·잠정예측은 옅은 색), YoY 성장률은 꺾은선(오른쪽 보조 축, %, 26.1월부터만 표시,
     26.10월부터 점선)의 콤보 차트. 툴팁에 매출값·성장률이 같이 표시됨. "금액은 공장도가
     기준입니다" 캡션 있음
  2. **대외변수 참고** — `EXT_VARS` 5개 지표(소비심리지수/기준금리/입주물량/매트리스 시장규모/
     가구업계 실적)를 세로로 쌓은 공통 섹션(왼쪽 컬럼 폭이 좁아 가로 나열 안 함). 모든 월에
     동일하게 적용되는 정성적 참고자료라 카드마다 반복 노출하지 않고 여기 한 곳에만 표시
- **오른쪽 컬럼 (자체 스크롤)**:
  3. **월별 협의 보드** — 월(26.10 ~ 27.4, 7개월) 카드를 CSS grid(`auto-fit`, 최소폭 240px)로
     배치한 반응형 보드. 화면이 넓으면 한 줄에 더 많이, 좁으면 자동으로 줄바꿈됨(가로 스크롤
     아님). 각 카드는 위에서 아래로:
     1. 월 헤더 + 전년동월 실적 (읽기전용)
     2. 로직 근거 성장률 (읽기전용) — 산출 근거 한 줄과 함께 표시. 최종 협의값이 없으면 "(잠정)"으로 흐리게 표시
     3. 매장(유통) 변동 (자유서술 textarea 2줄, blur 시 저장)
     4. 신제품 출시 (자유서술 textarea 2줄, blur 시 저장)
     5. 최종 협의 성장률 (숫자 입력, %) — 비어있으면 "미확정" 배지 표시
     6. 예상 매출 (계산값) = 전년동월실적 × (1 + 최종협의성장률 or 로직근거성장률)

     카드 목록 오른쪽에 합계 요약 카드가 있습니다. (OEM/ODM 가산 입력줄은 2026-07-02부로
     제거됨 — 조건 미확정이라 혼란만 준다는 판단, 아래 참고)

900px 이하 좁은 화면에서는 2컬럼이 접혀서 기존처럼 세로 1컬럼(차트 → 대외변수 → 카드)으로
자동 전환됩니다.

## 데이터 구조

- Postgres 테이블 (사내 Supabase, 스키마는 `public`)
  - `historical_sales`: 25.1월~26.9월 실적/예상 원본 (Excel 1번 시트와 동일, 변경 없음)
  - `month_assumptions`: 월 1행 × 7행. `reference_growth`/`reference_rationale`(로직 근거,
    읽기전용 시드값), `store_change`(매장/유통 변동 자유서술), `new_product`(신제품 출시
    자유서술), `final_growth`(최종 협의 성장률, `NULL`이면 미확정), `updated_at`
    (예전 `business_context` 단일 컬럼은 2026-07-02에 이 두 컬럼으로 분리됨)
- `forecast.js`: 전년동월 실적 × (1 + 최종협의성장률 또는 로직근거성장률) — 시나리오/특이요인/OEM
  로직은 모두 제거됨. `store_change`/`new_product`는 계산에 사용하지 않는 참고 정보로 그대로 통과됨
- `server.js`: REST API
  - `GET /api/config` — `{ supabaseUrl, supabaseAnonKey }` (브라우저가 Realtime 구독에 사용, 미설정 시 `null`)
  - `GET /api/state` — `month_assumptions` 7행 + 실적데이터 + 계산된 예측
  - `PUT /api/month/:ym` — `{ changes: { store_change?, new_product?, final_growth? } }` 로 해당
    월 한 행만 부분 수정 (트랜잭션 + 행 잠금으로 동시 수정 시에도 마지막 저장이 안전하게 반영됨).
    `changed_by`는 받지 않음. `final_growth`를 빈 문자열로 보내면 "미확정" 상태로 되돌릴 수 있음

## 가정값 초기화하고 싶을 때

Postgres에서 `month_assumptions`/`historical_sales` 테이블을 비우고(`TRUNCATE`) 서버를
재시작하면 기본값으로 다시 시드됩니다. (실수로 값이 꼬였을 때 사용 — 운영 DB에서는 신중히)

## 대외변수 섹션

정성적 참고자료라 DB에 저장하지 않고 `public/app.js`의 `EXT_VARS`에 하드코딩되어 있습니다.
새 지표가 나오면 그 배열만 수정해서 재배포하면 됩니다. 모든 월에 동일한 목록을 공통 섹션
하나에만 노출하며, 월별로 다르게 태깅하는 기능은 아직 없습니다.

## OEM/ODM 가산 (제외됨)

아파트멘터리 OEM/ODM 관련 조건이 아직 미확정이라 2026-07-02부로 이 라인 자체를 모델에서
제외했습니다 (DB 컬럼, 계산 로직, UI 전부 제거). 조건이 확정되면 별도로 다시 반영을 검토합니다.
