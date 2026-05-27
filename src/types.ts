export type Role = 'requester' | 'pm' | 'cem' | 'developer' | 'qa' | 'security' | 'infra' | 'patent' | 'admin'

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
  | 'schedule'
  | 'development'
  | 'qc_security'
  | 'completion'
  | 'published'
  | 'rejected'

export type TaskStatus = 'todo' | 'doing' | 'blocked' | 'done'

export type IssueType = 'epic' | 'story' | 'task' | 'bug' | 'change'

export type TaskAttachment = {
  id: string
  name: string
  size: number
  type: string
  dataUrl?: string
  uploadedAt: string
}

export type WorkflowConfig = {
  requiresQcSecurity: boolean
  requiresPlanning?: boolean
}

export type ApprovalState = {
  requiredRoles: Role[]
  approvedRoles: Role[]
}

// QC/보안/PM 단계의 역할별 검토 완료 상태 (3자 합의 게이트)
export type QcSignoffState = {
  qa: boolean
  security: boolean
  pm: boolean
}

// 단계별 문의/논의 댓글
export type ProjectComment = {
  id: string
  at: string
  actor: string
  role: Role
  stage: ProjectStatus
  message: string
  resolved?: boolean
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
  uploadedAt: string
}

export type ReviewDocs = {
  srs: string
  sds: string
  srsAttachments?: ReviewDocAttachment[]
  sdsAttachments?: ReviewDocAttachment[]
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
    comments?: ProjectComment[]
    qcSignoff?: QcSignoffState
    requesterConfirmed?: boolean
    docsLocked?: boolean
    rejectedReason?: string
    rejectedFromStatus?: ProjectStatus
  }
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
  tasks: ProjectTask[]
  logs: ActivityLog[]
  comments?: ProjectComment[]
  qcSignoff?: QcSignoffState
  docsLocked?: boolean
  requesterConfirmed?: boolean
  onHold?: boolean
  holdReason?: string
  rejectedReason?: string
  rejectedFromStatus?: ProjectStatus
}
