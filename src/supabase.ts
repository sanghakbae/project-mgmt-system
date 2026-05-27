import { createClient } from '@supabase/supabase-js'
import type { Project, ReviewDocs } from './types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey)

export const supabase = hasSupabaseConfig
  ? createClient(supabaseUrl!, supabaseAnonKey!)
  : null

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

const defaultReviewDocs: ReviewDocs = {
  srs: '',
  sds: '',
}

const fullApprovalRoles: Project['approvalState']['requiredRoles'] = ['pm', 'cem', 'security', 'infra', 'qa', 'patent', 'admin']

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

// App.tsx의 planningRequiredByType와 동기화 (가벼운 요청은 기획 단계 생략)
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

type ProjectRow = {
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
  assignee_role: Project['assigneeRole']
  tasks: Project['tasks']
  logs: Project['logs']
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
  const requestType =
    row.logs?.find((log) => log.meta?.requestType)?.meta?.requestType ?? inferRequestType(row)
  const workflowConfig =
    row.logs?.find((log) => log.meta?.workflowConfig)?.meta?.workflowConfig ?? defaultWorkflowConfig
  const savedApprovalState = row.logs?.find((log) => log.meta?.approvalState)?.meta?.approvalState
  const securityReview =
    row.logs?.find((log) => log.meta?.securityReview)?.meta?.securityReview ?? defaultSecurityReview
  const reviewDocs =
    row.logs?.find((log) => log.meta?.reviewDocs)?.meta?.reviewDocs ?? defaultReviewDocs
  // 신규 상태 필드: 가장 최근 로그 meta에서 복원
  const comments = row.logs?.find((log) => log.meta?.comments)?.meta?.comments ?? []
  const qcSignoff = row.logs?.find((log) => log.meta?.qcSignoff)?.meta?.qcSignoff ?? { qa: false, security: false, pm: false }
  const requesterConfirmed = row.logs?.find((log) => log.meta?.requesterConfirmed !== undefined)?.meta?.requesterConfirmed ?? false
  const docsLocked = row.logs?.find((log) => log.meta?.docsLocked !== undefined)?.meta?.docsLocked ?? false
  const rejectedMeta = row.logs?.find((log) => log.meta?.rejectedReason)?.meta
  const baselineRoles = approvalRolesByRequestType[requestType]
  const approvalState = {
    requiredRoles: baselineRoles,
    approvedRoles: (savedApprovalState?.approvedRoles ?? []).filter((item) => baselineRoles.includes(item)),
  }
  const hasSrs = reviewDocs.srs.trim().length > 0
  const hasSds = reviewDocs.sds.trim().length > 0
  const hasReviewDocs = hasSrs && hasSds
  const legacyRaw = row.status as string
  // 레거시 status 값을 새 워크플로우로 매핑: uat → qc_security, srs/sds → planning
  const legacyMappedStatus: Project['status'] = (legacyRaw === 'uat'
    ? 'qc_security'
    : legacyRaw === 'srs' || legacyRaw === 'sds'
      ? 'planning'
      : (legacyRaw as Project['status']))
  // 문서 작성 상태에 따라 단계 정규화: 기획 문서(SRS+SDS) 미완료 시 'planning' 단계로 강제
  // 단, 기획 단계를 생략하는 요청 분류는 강제하지 않음
  const docsGatedStatuses: Project['status'][] = ['dept_review', 'schedule', 'development', 'qc_security', 'completion', 'published']
  let normalizedStatus: Project['status'] = legacyMappedStatus
  if (planningRequiredByType[requestType] && docsGatedStatuses.includes(legacyMappedStatus) && !hasReviewDocs) {
    normalizedStatus = 'planning'
  }
  // 기획 생략 유형인데 legacy로 planning에 있으면 dept_review로 승격
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
    assigneeRole: normalizedStatus !== legacyMappedStatus
      ? 'pm'
      : normalizeAssigneeRole(row.assignee_role),
    workflowConfig,
    approvalState,
    securityReview,
    reviewDocs,
    tasks: row.tasks ?? [],
    logs: row.logs ?? [],
    comments,
    qcSignoff,
    requesterConfirmed,
    docsLocked,
    rejectedReason: rejectedMeta?.rejectedReason,
    rejectedFromStatus: rejectedMeta?.rejectedFromStatus,
  }
}
