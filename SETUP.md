# 셋업 가이드 — 인증·데이터(Firestore) · 첨부(Cloudflare R2)

이 앱은 두 가지 백엔드를 사용합니다. (Supabase는 더 이상 사용하지 않음)

| 영역 | 백엔드 | 비고 |
|------|--------|------|
| 인증(로그인/가입) | **Firebase Firestore** | `pms_users` 컬렉션, 비밀번호 PBKDF2 해시 |
| 프로젝트 데이터 | **Firebase Firestore** | `pms_projects` 컬렉션 |
| 첨부파일 | **Cloudflare R2** | Worker presigned URL |

`.env.example`를 복사해 `.env.local`을 만들고 아래 값을 채웁니다.

```bash
cp .env.example .env.local
```

> ⚠️ 키는 `.env.local`(git 무시)에만 넣고, 채팅·커밋에 붙여넣지 마세요.

---

## 1) 인증 — Firebase Firestore (별도 인증 서비스 없음)

계정 정보(이메일·이름·역할·비밀번호 해시)를 Firestore `pms_users` 컬렉션에 직접 저장합니다.
**Firebase Authentication 제품을 켤 필요가 없습니다.** 앱의 "가입" 탭에서 등록하면 바로 계정이 생성됩니다.

- 비밀번호는 PBKDF2(SHA-256, 10만 회) 해시 + salt로 저장(평문 저장 안 함).
- 가입 시 역할(요청자/PM/QA 등)을 선택하며, `pms_users/<email>` 문서에 기록됩니다.
- 문서 id = 이메일(소문자) → 이메일 중복 가입 방지.

> ⚠️ 보안: 현재 Firestore 규칙이 공개(2번 참고)라 `pms_users`의 password_hash가 읽힐 수 있습니다(해시라 평문은 아님).
> 운영 강화 시 규칙을 조이거나(쓰기/읽기 경로를 Worker 프록시로) Cloud Functions(Blaze)로 인증을 서버화하세요.

---

## 2) 프로젝트 데이터 — Firebase Firestore

1. [Firebase 콘솔](https://console.firebase.google.com)에서 프로젝트 생성.
2. **빌드 → Firestore Database → 데이터베이스 만들기** (프로덕션 모드 권장).
3. **프로젝트 설정 → 일반 → 내 앱 → 웹 앱 추가** 후 SDK 구성값을 `.env.local`에 입력:

   ```
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=<project>.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=<project-id>
   VITE_FIREBASE_STORAGE_BUCKET=<project>.appspot.com
   VITE_FIREBASE_MESSAGING_SENDER_ID=...
   VITE_FIREBASE_APP_ID=...
   ```

4. **Firestore 보안 규칙**: 이 앱은 Supabase로 인증하고 Firebase Auth 세션은 없으므로,
   Firestore에는 Firebase 인증 컨텍스트가 없습니다. 다음 중 하나를 선택하세요.
   - (간단) 개발/내부용으로 `pms_users`·`pms_projects` 읽기·쓰기 허용:
     ```
     rules_version = '2';
     service cloud.firestore {
       match /databases/{database}/documents {
         match /{document=**} {
           allow read, write: if true;
         }
       }
     }
     ```
     > anon 키와 동일한 수준의 공개 접근입니다. 강한 보호가 필요하면 Firebase Auth(익명/커스텀 토큰)
     > 도입 또는 쓰기 경로를 Cloudflare Worker로 프록시하는 방식을 고려하세요.

데이터 구조: 문서 1건 = 프로젝트 1건이며, 기존 Supabase 행과 동일한 snake_case 스키마를 그대로
저장합니다(상태 메타는 `logs[].meta` 스냅샷에서 복원). 별도 스키마 생성은 필요 없습니다.

### (선택) 기존 Supabase 데이터 이전
기존 `pms_projects` 행을 그대로 Firestore 문서로 넣으면 됩니다(컬럼명 동일, 문서 id = 행 id).
간단히는 Supabase에서 행을 JSON으로 export → 각 행을 `pms_projects/<id>` 문서로 `setDoc`.

---

## 3) 첨부파일 — Cloudflare R2 + Worker (presigned URL)

`worker/` 디렉터리에 presign Worker가 있습니다.

1. **R2 버킷 생성**: Cloudflare 대시보드 → R2 → 버킷 생성(예: `pms-attachments`).
2. **R2 API 토큰(S3) 발급**: R2 → "Manage R2 API Tokens" → Access Key ID / Secret Access Key.
3. `worker/wrangler.toml`의 `[vars]` 채우기: `R2_ACCOUNT_ID`, `R2_BUCKET`, `ALLOWED_ORIGIN`(앱 출처).
4. 시크릿 등록 + 배포:
   ```bash
   cd worker
   npm install
   npx wrangler secret put R2_ACCESS_KEY_ID
   npx wrangler secret put R2_SECRET_ACCESS_KEY
   npx wrangler deploy
   ```
5. **CORS**: R2 버킷 설정에서 앱 출처(localhost / 배포 도메인)에 대해 `PUT`, `GET` 허용.
6. 배포된 Worker URL을 앱 `.env.local`에 입력:
   ```
   VITE_R2_WORKER_URL=https://pms-r2-presign.<subdomain>.workers.dev
   ```

> `VITE_R2_WORKER_URL`을 비워두면 첨부는 기존처럼 base64 dataURL로 Firestore에 저장됩니다(소용량 테스트용).
> 운영에서는 문서 용량 한계(1MB/doc) 때문에 R2 사용을 권장합니다.

업로드 흐름: 브라우저 → Worker `/presign-put`(서명 URL) → R2 직접 PUT.
미리보기/다운로드: Worker `/presign-get`로 단기 서명 URL 발급.

---

## 실행

```bash
npm install
npm run dev
```

세 백엔드 값이 모두 채워지면 로그인(Supabase) → 프로젝트 목록(Firestore) → 첨부 업로드(R2)가 동작합니다.
