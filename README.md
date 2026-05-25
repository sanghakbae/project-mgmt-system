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

## 주요 화면

- 역할별 처리 대기 큐
- 서비스명, 개선 영역, 현재 문제, 원하는 결과, 성공 기준을 받는 새 요청서
- Jira식 프로젝트 이슈/티켓: 유형, 담당자, 보고자, 우선순위, 공수, 상태, 산출물, 인수 조건
- 전체/내 대기/위험 필터
- 10단계 프로젝트 워크플로우
- 현재 액션 및 권한 안내
- 산출물, 활동 로그 패널
