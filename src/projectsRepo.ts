// Firestore 기반 pms_projects 저장소.
// 문서 1건 = 프로젝트 1건. 문서 데이터는 기존 Supabase 행과 동일한 snake_case 스키마를 유지해
// mapProjectRow 로직을 그대로 재사용한다(상태 메타는 logs[].meta 스냅샷에서 복원).
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import { db, hasFirebaseConfig } from './firebase'
import type { Project, ReviewDocs, ScheduleInfo } from './types'

const COLLECTION = 'pms_projects'

const defaultWorkflowConfig: Project['workflowConfig'] = {
  requiresQcSecurity: true,
}

const defaultSecurityReview: Project['securityReview'] = {
  dataClassification: '',
  accessScope: '',
  externalExposure: '',
  storagePolicy: '',
  securityNotes: '',
}

const defaultReviewDocs: ReviewDocs = { srs: '', sds: '' }

const defaultSchedule: ScheduleInfo = {
  plannedStart: '',
  plannedEnd: '',
  milestones: '',
  note: '',
}

const fullApprovalRoles: Project['approvalState']['requiredRoles'] = ['cem', 'developer', 'security', 'infra', 'qa', 'patent']

const approvalRolesByRequestType: Record<Project['requestType'], Project['approvalState']['requiredRoles']> = {
  improvement: fullApprovalRoles,
  new_service: fullApprovalRoles,
  new_feature: fullApprovalRoles,
  bug_fix: fullApprovalRoles,
  policy_change: fullApprovalRoles,
  data_report: fullApprovalRoles,
  integration_api: fullApprovalRoles,
  security_permission: fullApprovalRoles,
  infra_performance: fullApprovalRoles,
}

const planningRequiredByType: Record<Project['requestType'], boolean> = {
  improvement: true,
  new_service: true,
  new_feature: true,
  integration_api: true,
  security_permission: true,
  bug_fix: false,
  policy_change: false,
  data_report: false,
  infra_performance: false,
}

function inferRequestType(row: Pick<ProjectRow, 'title' | 'summary' | 'service_area'>): Project['requestType'] {
  const text = `${row.title} ${row.summary} ${row.service_area}`.toLowerCase()
  if (/(버그|오류|실패|깨짐|멈춤|장애)/.test(text)) return 'bug_fix'
  if (/(권한|보안|감사|개인정보|접근)/.test(text)) return 'security_permission'
  if (/(api|연동|webhook|웹훅|pg|파트너|oauth)/.test(text)) return 'integration_api'
  if (/(리포트|대시보드|정산|집계|지표|데이터)/.test(text)) return 'data_report'
  if (/(정책|수수료|운영 기준|승인 기준|약관|공지)/.test(text)) return 'policy_change'
  if (/(속도|성능|캐시|인프라|배포|서버|쿼리)/.test(text)) return 'infra_performance'
  if (/(신규 서비스|서비스 신규|서비스 출시|런칭|론칭)/.test(text)) return 'new_service'
  if (/(신규|추가|구축|도입|포털|기능)/.test(text)) return 'new_feature'
  return 'improvement'
}

export type ProjectRow = {
  id: string
  code: string
  title: string
  service_name: string
  service_area: string
  requester: string
  owner_team: string
  priority: Project['priority']
  status: Project['status']
  summary: string
  current_problem: string
  desired_outcome: string
  success_metric: string
  affected_users: string
  due_date: string
  created_at: string
  updated_at: string
  risk: string
  progress: number
  next_action: string
  // 영속 값은 레거시 매핑 문자열('reviewer' 등)을 포함하므로 넓게 string으로 둔다
  assignee_role: string
  tasks: Project['tasks']
  logs: Project['logs']
  on_hold?: boolean
  hold_reason?: string
  review_docs?: { srs: string; sds: string }
  schedule?: Project['schedule']
  // 승인 필요 역할/워크플로 설정은 로그 메타뿐 아니라 전용 컬럼으로도 저장해 확실히 영속화
  approval_state?: Project['approvalState']
  workflow_config?: Project['workflowConfig']
  published?: boolean
}

function normalizeAssigneeRole(role: string): Project['assigneeRole'] {
  if (role === 'reviewer') return 'pm'
  if (role === 'qa') return 'qa'
  if (role === 'developer') return 'developer'
  if (role === 'admin') return 'admin'
  if (role === 'requester') return 'requester'
  if (role === 'pm' || role === 'cem' || role === 'security' || role === 'infra' || role === 'patent') {
    return role
  }
  return 'requester'
}

export function mapProjectRow(row: ProjectRow): Project {
  const reviewDocsFromField = row.review_docs && (row.review_docs.srs || row.review_docs.sds) ? row.review_docs : null
  const scheduleFromField = row.schedule && (row.schedule.plannedStart || row.schedule.plannedEnd || row.schedule.milestones || row.schedule.note) ? row.schedule : null
  const requestType =
    row.logs?.find((log) => log.meta?.requestType)?.meta?.requestType ?? inferRequestType(row)
  const workflowConfig =
    row.workflow_config ?? row.logs?.find((log) => log.meta?.workflowConfig)?.meta?.workflowConfig ?? defaultWorkflowConfig
  const savedApprovalState =
    (row.approval_state && Array.isArray(row.approval_state.requiredRoles) ? row.approval_state : null)
    ?? row.logs?.find((log) => log.meta?.approvalState)?.meta?.approvalState
  const securityReview =
    row.logs?.find((log) => log.meta?.securityReview)?.meta?.securityReview ?? defaultSecurityReview
  const reviewDocs =
    reviewDocsFromField ?? row.logs?.find((log) => log.meta?.reviewDocs)?.meta?.reviewDocs ?? defaultReviewDocs
  const schedule =
    scheduleFromField ?? row.logs?.find((log) => log.meta?.schedule)?.meta?.schedule ?? defaultSchedule
  const comments = row.logs?.find((log) => log.meta?.comments)?.meta?.comments ?? []
  const qcSignoff = row.logs?.find((log) => log.meta?.qcSignoff)?.meta?.qcSignoff ?? { qa: false, security: false, pm: false }
  const requesterConfirmed = row.logs?.find((log) => log.meta?.requesterConfirmed !== undefined)?.meta?.requesterConfirmed ?? false
  const docsLocked = row.logs?.find((log) => log.meta?.docsLocked !== undefined)?.meta?.docsLocked ?? false
  const rejectedMeta = row.logs?.find((log) => log.meta?.rejectedReason)?.meta
  const baselineRoles = approvalRolesByRequestType[requestType]
  // 요청 시 사용자가 고른 승인 대상(savedApprovalState.requiredRoles)을 우선 사용한다.
  // 저장된 선택이 없을 때만 요청유형 기준 전체 역할로 폴백.
  const savedRequired = (savedApprovalState?.requiredRoles ?? []).filter((item) => baselineRoles.includes(item))
  const requiredRoles = savedRequired.length > 0 ? savedRequired : baselineRoles
  const approvalState = {
    requiredRoles,
    approvedRoles: (savedApprovalState?.approvedRoles ?? []).filter((item) => requiredRoles.includes(item)),
    memos: savedApprovalState?.memos,
  }
  const hasSrs = reviewDocs.srs.trim().length > 0
  const hasSds = reviewDocs.sds.trim().length > 0
  const hasReviewDocs = hasSrs && hasSds
  const legacyRaw = row.status as string
  const legacyMappedStatus: Project['status'] = (legacyRaw === 'uat'
    ? 'qc_security'
    : legacyRaw === 'srs' || legacyRaw === 'sds'
      ? 'planning'
      : legacyRaw === 'schedule'
        ? 'development'
        : legacyRaw === 'published'
          ? 'completion'
          : (legacyRaw as Project['status']))
  const docsGatedStatuses: Project['status'][] = ['dept_review', 'development', 'qc_security', 'completion']
  let normalizedStatus: Project['status'] = legacyMappedStatus
  if (planningRequiredByType[requestType] && docsGatedStatuses.includes(legacyMappedStatus) && !hasReviewDocs) {
    normalizedStatus = 'planning'
  }
  if (!planningRequiredByType[requestType] && normalizedStatus === 'planning') {
    normalizedStatus = 'dept_review'
  }

  return {
    id: row.id,
    code: row.code,
    requestType,
    title: row.title,
    serviceName: row.service_name,
    serviceArea: row.service_area,
    requester: row.requester,
    ownerTeam: row.owner_team,
    priority: row.priority,
    status: normalizedStatus,
    summary: row.summary,
    currentProblem: row.current_problem,
    desiredOutcome: row.desired_outcome,
    successMetric: row.success_metric,
    affectedUsers: row.affected_users,
    dueDate: row.due_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    risk: row.risk,
    progress: row.progress,
    nextAction: normalizedStatus !== legacyMappedStatus
      ? 'PM이 기획 문서(SRS+SDS)를 등록해야 다음 단계로 진행할 수 있습니다.'
      : row.next_action,
    assigneeRole: normalizedStatus !== legacyMappedStatus ? 'pm' : normalizeAssigneeRole(row.assignee_role),
    workflowConfig,
    approvalState,
    securityReview,
    reviewDocs,
    schedule,
    tasks: row.tasks ?? [],
    logs: row.logs ?? [],
    comments,
    qcSignoff,
    requesterConfirmed,
    docsLocked,
    rejectedReason: rejectedMeta?.rejectedReason,
    rejectedFromStatus: rejectedMeta?.rejectedFromStatus,
    onHold: row.on_hold ?? false,
    holdReason: row.hold_reason,
    published: row.published ?? false,
  }
}

function requireDb() {
  if (!db) throw new Error('Firebase가 설정되지 않았습니다. .env의 VITE_FIREBASE_* 값을 확인하세요.')
  return db
}

// 전체 프로젝트 조회(최근 수정순)
export async function fetchProjects(): Promise<Project[]> {
  const database = requireDb()
  const snap = await getDocs(query(collection(database, COLLECTION), orderBy('updated_at', 'desc')))
  return snap.docs.map((d) => mapProjectRow({ ...(d.data() as ProjectRow), id: d.id }))
}

// 신규 프로젝트 저장(문서 id = row.id). 저장 후 매핑된 Project 반환
export async function insertProject(row: ProjectRow): Promise<Project> {
  const database = requireDb()
  await setDoc(doc(database, COLLECTION, row.id), row)
  return mapProjectRow(row)
}

// 부분 업데이트(updated_at 자동 갱신)
export async function updateProject(id: string, patch: Partial<ProjectRow>): Promise<void> {
  const database = requireDb()
  await updateDoc(doc(database, COLLECTION, id), { ...patch, updated_at: new Date().toISOString() })
}

export async function deleteProject(id: string): Promise<void> {
  const database = requireDb()
  await deleteDoc(doc(database, COLLECTION, id))
}

export async function deleteProjects(ids: string[]): Promise<void> {
  const database = requireDb()
  const batch = writeBatch(database)
  ids.forEach((id) => batch.delete(doc(database, COLLECTION, id)))
  await batch.commit()
}

export { hasFirebaseConfig }

// ─── 감사 로그 (접근·프로젝트 변경) ───────────────────────────────────────────
const ACCESS_LOG_COLLECTION = 'pms_access_logs'

export type AccessLogEntry = {
  id?: string
  at: string
  actor: string        // 사용자명 또는 '데모'
  role: string         // 접근 당시 역할
  action: 'login' | 'role_switch' | 'page_view' | 'logout'
  detail?: string      // 추가 설명
  userAgent?: string
}

export async function writeAccessLog(entry: Omit<AccessLogEntry, 'id'>): Promise<void> {
  if (!db) return
  await addDoc(collection(db, ACCESS_LOG_COLLECTION), entry)
}

export async function fetchAccessLogs(maxEntries = 200): Promise<AccessLogEntry[]> {
  if (!db) return []
  const snap = await getDocs(
    query(collection(db, ACCESS_LOG_COLLECTION), orderBy('at', 'desc'), limit(maxEntries))
  )
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AccessLogEntry, 'id'>) }))
}
