// 일회용 마이그레이션: Supabase pms_projects → Firestore pms_projects
//
// 기존 데이터는 Supabase에 그대로 있으며(읽기 위치만 Firestore로 바뀜), 이 스크립트로 1회 복사한다.
// 행을 그대로(snake_case 컬럼 유지) 문서에 넣으므로 앱의 mapProjectRow가 동일하게 동작한다.
//
// 실행 전 환경변수 설정(셸):
//   export SUPABASE_URL=...                # https://xxx.supabase.co
//   export SUPABASE_KEY=...                # anon 또는 service_role 키 (읽기용)
//   export FIREBASE_API_KEY=...
//   export FIREBASE_PROJECT_ID=...
//   # (Firestore 규칙이 쓰기를 허용해야 함. SETUP.md 2번 참고)
//
// 실행:
//   node scripts/migrate-supabase-to-firestore.mjs
//   node scripts/migrate-supabase-to-firestore.mjs --dry   # 미리보기(쓰기 안 함)

import { createClient } from '@supabase/supabase-js'
import { initializeApp } from 'firebase/app'
import { getFirestore, doc, setDoc } from 'firebase/firestore'

const dryRun = process.argv.includes('--dry')

const { SUPABASE_URL, SUPABASE_KEY, FIREBASE_API_KEY, FIREBASE_PROJECT_ID } = process.env
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('SUPABASE_URL / SUPABASE_KEY 환경변수가 필요합니다.')
  process.exit(1)
}
if (!FIREBASE_API_KEY || !FIREBASE_PROJECT_ID) {
  console.error('FIREBASE_API_KEY / FIREBASE_PROJECT_ID 환경변수가 필요합니다.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
const app = initializeApp({ apiKey: FIREBASE_API_KEY, projectId: FIREBASE_PROJECT_ID })
const db = getFirestore(app)

console.log('Supabase에서 pms_projects 행을 불러오는 중…')
const { data, error } = await supabase.from('pms_projects').select('*')
if (error) {
  console.error('Supabase 조회 실패:', error.message)
  process.exit(1)
}
console.log(`행 ${data.length}건 발견.${dryRun ? ' (dry-run: 쓰기 생략)' : ''}`)

// Firestore 문서 한계 1MB. base64 첨부(dataUrl)가 박혀 초과하는 문서는 dataUrl만 떼어낸다(메타 유지).
const DOC_LIMIT = 1_000_000
function byteSize(obj) {
  return Buffer.byteLength(JSON.stringify(obj), 'utf8')
}
function stripDataUrls(row) {
  let stripped = 0
  const strip = (arr) => {
    if (!Array.isArray(arr)) return
    for (const a of arr) {
      if (a && typeof a === 'object' && a.dataUrl) {
        delete a.dataUrl
        a.migratedStripped = true // 원본 파일은 R2 설정 후 재업로드 필요
        stripped++
      }
    }
  }
  for (const t of row.tasks ?? []) strip(t.attachments)
  for (const log of row.logs ?? []) {
    const rd = log.meta?.reviewDocs
    if (rd) { strip(rd.srsAttachments); strip(rd.sdsAttachments) }
  }
  return stripped
}

let ok = 0
const strippedDocs = []
for (const row of data) {
  if (!row.id) {
    console.warn('id 없는 행 건너뜀:', row.code ?? '(코드 없음)')
    continue
  }
  // 용량 초과 시 base64 첨부 제거
  if (byteSize(row) > DOC_LIMIT) {
    const n = stripDataUrls(row)
    if (n > 0) strippedDocs.push(`${row.code ?? row.id}(첨부 ${n}개)`)
  }
  const size = byteSize(row)
  if (dryRun) {
    console.log(`  [dry] ${row.code ?? row.id} → pms_projects/${row.id} (${(size / 1024).toFixed(0)}KB)${size > DOC_LIMIT ? ' ⚠️여전히 초과' : ''}`)
    ok++
    continue
  }
  try {
    await setDoc(doc(db, 'pms_projects', row.id), row)
    ok++
    console.log(`  ✓ ${row.code ?? row.id} (${(size / 1024).toFixed(0)}KB)`)
  } catch (e) {
    console.error(`  ✗ ${row.code ?? row.id}:`, e.message)
  }
}
if (strippedDocs.length) {
  console.log(`\n⚠️ base64 첨부를 제거한 문서(메타데이터만 보존, R2 설정 후 재업로드 권장):\n   ${strippedDocs.join(', ')}`)
}

console.log(`완료: ${ok}/${data.length}건 ${dryRun ? '확인' : '이전'}.`)
process.exit(0)
