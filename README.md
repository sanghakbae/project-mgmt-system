# Project Management System

React + Vite + Supabase 기반의 워크플로우형 프로젝트 관리 시스템입니다. Jira식 이슈/티켓 관리 관점을 반영해 프로젝트, 요청서, 수행 티켓, 담당자, 우선순위, 상태, 산출물, 인수 조건을 함께 관리합니다.

## 실행

```bash
npm install
npm run dev
```

## Supabase 연결

Supabase 연결이 필요합니다. 목업 데이터 fallback은 사용하지 않습니다.

```bash
cp .env.example .env.local
```

`.env.local`에 Supabase URL과 anon key를 넣고, Supabase SQL editor에서 `supabase/schema.sql`을 실행하세요.

```bash
npm run dev
```

## 인증 + 권한(RLS)

로그인한 사용자만 데이터에 접근할 수 있습니다. 가입 시 선택한 역할이 계정에 고정됩니다.

1. Supabase SQL Editor에서 `supabase/migrations/20260531190000_add_pms_auth_rls.sql`을 실행합니다.
   - `pms_profiles`(사용자 역할) 테이블, 가입 트리거, `pms_current_role()` 헬퍼 생성
   - `pms_projects`의 익명(anon) 접근 제거 → 로그인 사용자만 조회/생성/수정, 삭제는 관리자만
2. **이메일 인증 사용**: **Authentication → Providers → Email**에서 "Confirm email"을 켜둡니다.
   가입 후 받은 메일의 인증 링크를 클릭해야 로그인할 수 있습니다(앱이 "메일 인증 후 로그인"
   안내를 표시합니다).
3. 가입 시 본인 역할을 선택합니다(영업·마케팅 포함). 영업·마케팅은 기본적으로 요청자 역할이며,
   모든 역할이 새 요청을 등록할 수 있습니다. 역할은 계정에 고정되며 변경은 관리자가
   `pms_profiles.role`을 직접 수정합니다.

> ⚠️ RLS 적용 후에는 anon 키만 쓰는 `scripts/seed.ts` 시드가 막힙니다.
> 시드는 RLS 적용 전에 끝내두거나, 이후에는 service_role 키로만 가능합니다.

## 주요 화면

- 역할별 처리 대기 큐
- 서비스명, 개선 영역, 현재 문제, 원하는 결과, 성공 기준을 받는 새 요청서
- Jira식 프로젝트 이슈/티켓: 유형, 담당자, 보고자, 우선순위, 공수, 상태, 산출물, 인수 조건
- 전체/내 대기/위험 필터
- 10단계 프로젝트 워크플로우
- 현재 액션 및 권한 안내
- 산출물, 활동 로그 패널
