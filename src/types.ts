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
  | 'srs'
  | 'sds'
  | 'schedule'
  | 'development'
  | 'qc_security'
  | 'uat'
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
  requiresUat: boolean
}

export type ApprovalState = {
  requiredRoles: Role[]
  approvedRoles: Role[]
}

export type SecurityReview = {
  dataClassification: string
  accessScope: string
  externalExposure: string
  storagePolicy: string
  securityNotes: string
}

export type ReviewDocs = {
  srs: string
  sds: string
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
}
