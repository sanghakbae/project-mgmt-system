/**
 * 데모 더미 데이터를 Supabase(pms_projects)에 시드합니다.
 * - 단계별(요청/기획/승인/개발/검토/완료) × 서비스(카피킬러/몬스터/프리즘) 18건
 * - 확장 필드(requestType, approvalState, reviewDocs, schedule 등)는 logs[].meta에 저장
 * - 이미 동일 code가 있으면 건너뜀 (멱등)
 *
 * 실행: node scripts/seed.ts        (Node 22+ 타입 스트리핑)
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { demoProjects } from '../src/data.ts'

const here = dirname(fileURLToPath(import.meta.url))

function loadEnv() {
  const envPath = resolve(here, '../.env.local')
  const raw = readFileSync(envPath, 'utf8')
  const out: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
  return out
}

const env = loadEnv()
const url = env.VITE_SUPABASE_URL
const key = env.VITE_SUPABASE_ANON_KEY
if (!url || !key) {
  console.error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 를 .env.local 에서 찾지 못했습니다.')
  process.exit(1)
}

const supabase = createClient(url, key)

// App의 persistAssigneeRole와 동일: 앱 Role → DB enum(pms_project_role) 매핑
function persistAssigneeRole(role: string): string {
  const roleMap: Record<string, string> = {
    requester: 'requester',
    pm: 'reviewer',
    cem: 'reviewer',
    developer: 'developer',
    infra: 'developer',
    qa: 'qa',
    security: 'qa',
    patent: 'reviewer',
    admin: 'admin',
  }
  return roleMap[role] ?? 'requester'
}

// 앱 status → DB enum(pms_project_status) 레거시 토큰으로 역매핑
// mapProjectRow가 srs/sds→planning, schedule→development, uat→qc_security, published→completion 으로 복원함
function persistStatus(status: string): string {
  const statusMap: Record<string, string> = {
    request: 'request',
    planning: 'srs',
    dept_review: 'dept_review',
    development: 'schedule',
    qc_security: 'uat',
    completion: 'published',
    rejected: 'rejected',
  }
  return statusMap[status] ?? 'request'
}

function toRow(p: (typeof demoProjects)[number]) {
  // 확장 필드를 단일 meta 로그에 담아 mapProjectRow가 복원할 수 있게 함
  const metaLog = {
    id: `${p.id}-seed`,
    at: (p.updatedAt || '').replace('T', ' ').slice(0, 16) || p.createdAt + ' 09:00',
    actor: '시드',
    message: '데모 시드 데이터로 생성되었습니다.',
    meta: {
      requestType: p.requestType,
      workflowConfig: p.workflowConfig,
      approvalState: p.approvalState,
      securityReview: p.securityReview,
      reviewDocs: p.reviewDocs ?? { srs: '', sds: '' },
      schedule: p.schedule,
      comments: p.comments ?? [],
      qcSignoff: p.qcSignoff ?? { qa: false, security: false, pm: false },
      requesterConfirmed: p.requesterConfirmed ?? false,
      docsLocked: p.docsLocked ?? false,
    },
  }
  return {
    code: p.code,
    title: p.title,
    service_name: p.serviceName,
    service_area: p.serviceArea,
    requester: p.requester,
    owner_team: p.ownerTeam,
    priority: p.priority,
    status: persistStatus(p.status),
    summary: p.summary,
    current_problem: p.currentProblem,
    desired_outcome: p.desiredOutcome,
    success_metric: p.successMetric,
    affected_users: p.affectedUsers,
    due_date: p.dueDate,
    risk: p.risk,
    progress: p.progress,
    next_action: p.nextAction,
    assignee_role: persistAssigneeRole(p.assigneeRole),
    tasks: p.tasks ?? [],
    logs: [metaLog, ...(p.logs ?? [])],
  }
}

// 우리가 시드한 행인지 판별 — logs에 actor:'시드' 마커가 있으면 데모 시드 행
function isSeededRow(row: { id: string; code: string; logs?: Array<{ actor?: string }> }) {
  return (row.logs ?? []).some((l) => l?.actor === '시드')
}

async function main() {
  const { data: existing, error: readErr } = await supabase.from('pms_projects').select('id, code, logs')
  if (readErr) {
    console.error('기존 데이터 조회 실패:', readErr.message)
    process.exit(1)
  }
  const byCode = new Map<string, { id: string; code: string; logs?: Array<{ actor?: string }> }>()
  for (const r of (existing ?? []) as Array<{ id: string; code: string; logs?: Array<{ actor?: string }> }>) byCode.set(r.code, r)

  const toInsert: ReturnType<typeof toRow>[] = []
  const toUpdate: { id: string; row: ReturnType<typeof toRow> }[] = []
  const skipped: string[] = []

  for (const p of demoProjects) {
    const ex = byCode.get(p.code)
    if (!ex) {
      toInsert.push(toRow(p))
    } else if (isSeededRow(ex)) {
      toUpdate.push({ id: ex.id, row: toRow(p) }) // 우리가 만든 시드 행만 갱신 (tasks·comments 등)
    } else {
      skipped.push(p.code) // 사용자가 직접 만든 동일 code 행은 건드리지 않음
    }
  }

  if (toInsert.length) {
    const { data, error } = await supabase.from('pms_projects').insert(toInsert).select('code, status')
    if (error) {
      console.error('시드 삽입 실패:', error.message)
      process.exit(1)
    }
    console.log(`신규 ${data?.length ?? 0}건 삽입:`)
    for (const r of data ?? []) console.log(`  + ${r.code} (${r.status})`)
  }

  for (const { id, row } of toUpdate) {
    const { error } = await supabase.from('pms_projects').update(row).eq('id', id)
    if (error) {
      console.error(`갱신 실패 (${row.code}):`, error.message)
      process.exit(1)
    }
    console.log(`  ~ ${row.code} (${row.status}) 갱신 — 태스크 ${row.tasks.length}건`)
  }

  if (skipped.length) console.log(`사용자 보유 행이라 건너뜀: ${skipped.join(', ')}`)
  if (!toInsert.length && !toUpdate.length) console.log('변경 사항 없음.')
}

main()
