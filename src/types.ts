export type Role = 'requester' | 'sales' | 'marketing' | 'pm' | 'cem' | 'developer' | 'qa' | 'security' | 'infra' | 'patent' | 'admin'

export type Priority = 'low' | 'normal' | 'high' | 'urgent'

export type ProjectRequestType =
  | 'improvement'
  | 'new_service'
  | 'new_feature'
  | 'bug_fix'
  | 'policy_change'
  | 'data_report'
  | 'integration_api'
  | 'security_permission'
  | 'infra_performance'

export type ProjectStatus =
  | 'request'
  | 'dept_review'
  | 'planning'
  | 'development'
  | 'qc_security'
  | 'deployment'
  | 'completion'
  | 'rejected'

export type TaskStatus = 'todo' | 'doing' | 'blocked' | 'done'

export type IssueType = 'epic' | 'story' | 'task' | 'bug' | 'change' | 'vulnerability'

export type TaskAttachment = {
  id: string
  name: string
  size: number
  type: string
  dataUrl?: string
  // Cloudflare R2 객체 키 (R2 사용 시). 미리보기/다운로드는 presigned GET URL로 해소.
  key?: string
  uploadedAt: string
}

export type WorkflowConfig = {
  requiresQcSecurity: boolean
  requiresPlanning?: boolean
  skipReason?: string
}

export type ApprovalState = {
  requiredRoles: Role[]
  approvedRoles: Role[]
  // 각 역할이 확인하면서 남긴 메모(이유·조건·코멘트). 없을 수도 있음.
  memos?: Partial<Record<Role, { at: string; actor: string; message: string }>>
}

// QC/보안/PM 단계의 역할별 검토 내용
export type QcReviewEntry = {
  note?: string
  actor?: string
  at?: string
}

// 검토 단계의 역할별 완료 상태 (합의 게이트)
//
// 테스트 순서: 개발자 단위테스트 → QA 통합테스트 (단위테스트 완료 전 통합테스트 불가).
// 보안 테스트는 코드·설정·의존성을 보는 것이라 테스트 결과에 종속되지 않으므로 병행 가능.
// PM은 SRS 대조 검토로 언제든 가능.
export type QcSignoffState = {
  /** 개발자 단위테스트 — QA 통합테스트의 선행 조건 */
  developer: boolean
  /** QA 통합테스트 — developer 완료 후에만 가능 */
  qa: boolean
  security: boolean
  pm: boolean
  // 역할별 검토 내용(분리 기록)
  reviews?: {
    developer?: QcReviewEntry
    qa?: QcReviewEntry
    security?: QcReviewEntry
    pm?: QcReviewEntry
  }
}

/** 검토 단계 사인오프 역할 (순서·라벨을 한 곳에서 관리) */
export type QcSignoffRole = 'developer' | 'qa' | 'security' | 'pm'

// 단계별 문의/논의 댓글
export type ProjectComment = {
  id: string
  at: string
  actor: string
  role: Role
  stage: ProjectStatus
  message: string
  resolved?: boolean
  parentId?: string
}

export type SecurityReview = {
  dataClassification: string
  accessScope: string
  externalExposure: string
  storagePolicy: string
  securityNotes: string
}

export type ReviewDocAttachment = {
  id: string
  name: string
  size: number
  type: string
  dataUrl?: string
  key?: string
  uploadedAt: string
}

export type ReviewDocs = {
  srs: string
  sds: string
  srsAttachments?: ReviewDocAttachment[]
  sdsAttachments?: ReviewDocAttachment[]
}

// 일정 조율: 팀이 확정하는 실제 일정 (요청자 희망 완료일과 별개)
export type ScheduleInfo = {
  plannedStart: string
  plannedEnd: string
  milestones: string
  note: string
  /**
   * 일정 확정 여부. 개발 단계에서 일정 조율을 확정하면 true가 되고,
   * 그 시점의 plannedEnd가 프로젝트 마감일(dueDate)로 반영된다.
   * (마감일 확정 주체·시점 = 개발 단계 일정 조율)
   */
  confirmed?: boolean
  /** 일정 확정 시각 */
  confirmedAt?: string
  /** 일정을 확정한 담당자 */
  confirmedBy?: string
}

export type TaskComment = {
  id: string
  at: string
  actor: string
  message: string
}

export type ProjectTask = {
  id: string
  key?: string
  type?: IssueType
  title: string
  owner: string
  reporter?: string
  priority?: Priority
  stage?: ProjectStatus
  output?: string
  acceptanceCriteria?: string
  estimate?: number
  dueDate: string
  status: TaskStatus
  statusNote?: string
  statusChangedAt?: string
  attachments?: TaskAttachment[]
  comments?: TaskComment[]
}

export type ActivityLog = {
  id: string
  at: string
  actor: string
  message: string
  meta?: {
    requestType?: ProjectRequestType
    workflowConfig?: WorkflowConfig
    approvalState?: ApprovalState
    securityReview?: SecurityReview
    reviewDocs?: ReviewDocs
    schedule?: ScheduleInfo
    comments?: ProjectComment[]
    qcSignoff?: QcSignoffState
    requesterConfirmed?: boolean
    docsLocked?: boolean
    rejectedReason?: string
    rejectedFromStatus?: ProjectStatus
    deployment?: DeploymentState
  }
}

/**
 * 배포 단계 상태.
 * 검토(staging 검증) 통과 → 인프라가 운영 반영 → smoke test 확인 → 완료 보고.
 * 실패 시 개발 단계로 되돌린다(검토 반려와 동일 경로).
 */
export type DeploymentState = {
  /** 운영 반영 완료 */
  released: boolean
  /** 배포 후 운영 smoke test 통과 */
  smokeTested: boolean
  releasedAt?: string
  releasedBy?: string
  /** 배포 방식·버전·롤백 계획 메모 */
  note?: string
}

export type Project = {
  id: string
  code: string
  requestType: ProjectRequestType
  title: string
  serviceName: string
  serviceArea: string
  requester: string
  ownerTeam: string
  priority: Priority
  status: ProjectStatus
  summary: string
  currentProblem: string
  desiredOutcome: string
  successMetric: string
  affectedUsers: string
  dueDate: string
  createdAt: string
  updatedAt: string
  risk: string
  progress: number
  nextAction: string
  assigneeRole: Role
  workflowConfig: WorkflowConfig
  approvalState: ApprovalState
  securityReview: SecurityReview
  reviewDocs?: ReviewDocs
  schedule?: ScheduleInfo
  tasks: ProjectTask[]
  logs: ActivityLog[]
  comments?: ProjectComment[]
  qcSignoff?: QcSignoffState
  docsLocked?: boolean
  requesterConfirmed?: boolean
  onHold?: boolean
  holdReason?: string
  /** 배포 단계 상태 — 인프라가 운영 반영 후 확인, smoke test까지 통과해야 완료로 진행 */
  deployment?: DeploymentState
  rejectedReason?: string
  rejectedFromStatus?: ProjectStatus
  published?: boolean
}
