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

## 인증 (DB 계정 기반)

이메일/비밀번호를 Supabase Auth가 아니라 **앱 전용 계정 테이블(`pms_accounts`)에 직접 저장**하고,
RPC 함수로 가입·로그인을 처리합니다. **이메일 인증(Confirm email)·인증 메일이 전혀 필요 없습니다.**

1. Supabase SQL Editor에서 **`supabase/migrations/20260531200000_pms_db_auth.sql`** 을 한 번 실행합니다.
   - `pgcrypto` 확장 + `pms_accounts` 테이블 생성(비밀번호는 bcrypt 해시로 저장)
   - `pms_register()` / `pms_authenticate()` RPC 함수 생성(SECURITY DEFINER, 직접 테이블 접근은 RLS로 차단)
   - `pms_projects` 정책을 anon 포함으로 복원(Supabase Auth 세션을 쓰지 않으므로)
2. 그게 끝입니다. 앱에서 **가입 → 즉시 로그인**됩니다. 대시보드 토글이나 메일 확인 단계 없음.

- 가입 시 본인 역할을 선택합니다(요청자 제외, 영업·마케팅 포함). 모든 역할이 새 요청을 등록할 수 있습니다.
- 역할은 계정에 고정되며, 변경은 `pms_accounts.role`을 직접 수정합니다.
- 비밀번호 정책: 영문·숫자·특수문자 혼용 8자 이상.
- 세션 타임아웃 60분 고정(로그인 60분 경과 시 자동 로그아웃).

> 참고: 자체 계정 인증이므로 `pms_projects`는 anon 키로 접근 가능합니다(공개 번들의 anon 키로 데이터
> 접근 가능). 더 강한 보호가 필요하면 Supabase Auth로 다시 전환하세요.
> 이전 `20260531190000_add_pms_auth_rls.sql`(Supabase Auth 방식)은 이 방식과 함께 쓰지 않습니다.

## 주요 화면

- 역할별 처리 대기 큐
- 서비스명, 개선 영역, 현재 문제, 원하는 결과, 성공 기준을 받는 새 요청서
- Jira식 프로젝트 이슈/티켓: 유형, 담당자, 보고자, 우선순위, 공수, 상태, 산출물, 인수 조건
- 전체/내 대기/위험 필터
- 10단계 프로젝트 워크플로우
- 현재 액션 및 권한 안내
- 산출물, 활동 로그 패널
