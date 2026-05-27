import { useEffect, useMemo, useState, type Dispatch, type FormEvent, type ReactNode, type SetStateAction } from 'react'
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Database,
  FileText,
  LayoutDashboard,
  ListChecks,
  MessageSquareText,
  Paperclip,
  Plus,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from 'lucide-react'
import './App.css'
import { RichEditor, RichTextView } from './RichEditor'
import { notifyGoogleChat } from './notify'
import { roleLabels, workflow } from './data'
import { hasSupabaseConfig, mapProjectRow, supabase } from './supabase'
import type { ApprovalState, IssueType, Priority, Project, ProjectRequestType, ProjectStatus, ProjectTask, ReviewDocs, Role, SecurityReview, TaskStatus, WorkflowConfig } from './types'

const statusLabels: Record<ProjectStatus, string> = {
  request: '요청',
  dept_review: '승인',
  planning: '기획',
  schedule: '개발 준비/일정 확정',
  development: '개발',
  qc_security: 'QC/보안/PM',
  completion: '완료보고',
  published: '게시',
  rejected: '반려',
}

const statusOwnerRoles: Record<ProjectStatus, Role> = {
  request: 'requester',
  dept_review: 'pm',
  planning: 'pm',
  schedule: 'pm',
  development: 'developer',
  qc_security: 'qa',
  completion: 'admin',
  published: 'admin',
  rejected: 'requester',
}

const approvalStepLabels: Record<Role, string> = {
  requester: '요청자',
  pm: 'PM',
  cem: 'CEM',
  developer: '개발',
  qa: 'QA',
  security: '정보보호',
  infra: '인프라',
  patent: '특허',
  admin: '최종',
}

const approvalButtonLabels: Partial<Record<Role, string>> = {
  pm: '확인',
  cem: '승인',
  security: '승인',
  infra: '승인',
  qa: '승인',
  patent: '승인',
  admin: '승인',
}

const priorityLabels: Record<Priority, string> = {
  low: '낮음',
  normal: '보통',
  high: '높음',
  urgent: '긴급',
}

const taskLabels: Record<TaskStatus, string> = {
  todo: '대기',
  doing: '진행',
  blocked: '보류',
  done: '완료',
}

const defaultServiceOptions = ['카피킬러', '프리즘', '몬스터']
const serviceOptionsStorageKey = 'pms-service-options'
type ServiceFilter = 'all' | string

const issueTypeLabels: Record<IssueType, string> = {
  epic: '에픽',
  story: '스토리',
  task: '작업',
  bug: '버그',
  change: '변경',
}

const requestTypeOptions: Array<{
  type: ProjectRequestType
  label: string
  shortLabel: string
  title: string
  intro: string
  serviceLabel: string
  areaLabel: string
  summaryLabel: string
  summaryPlaceholder: string
  problemLabel: string
  problemPlaceholder: string
  outcomeLabel: string
  outcomePlaceholder: string
  metricLabel: string
  metricPlaceholder: string
  audienceLabel: string
  audiencePlaceholder: string
  riskLabel: string
  riskPlaceholder: string
  titlePlaceholder: string
  firstTaskTitle: string
  firstTaskOutput: string
  firstTaskAcceptance: string
  createdLog: string
}> = [
  {
    type: 'improvement',
    label: '서비스 개선',
    shortLabel: '개선',
    title: '서비스 개선 요청서',
    intro: '기존 서비스의 문제와 개선 목표를 정리해 기획과 개발이 같은 기준으로 움직이도록 만듭니다.',
    serviceLabel: '개선할 서비스',
    areaLabel: '개선 영역',
    summaryLabel: '개선 요약',
    summaryPlaceholder: '무엇을 왜 개선하는지 한두 문장으로 적어주세요.',
    problemLabel: '현재 문제',
    problemPlaceholder: '현재 어떤 불편, 비효율, 오류 가능성이 있는지 적어주세요.',
    outcomeLabel: '원하는 결과',
    outcomePlaceholder: '개선 후 사용자나 운영자가 무엇을 할 수 있어야 하는지 적어주세요.',
    metricLabel: '성공 기준',
    metricPlaceholder: '예: 처리 시간 50% 단축, 실패 문의 30% 감소',
    audienceLabel: '영향 사용자/부서',
    audiencePlaceholder: '예: 구매 고객, 운영팀, 파트너사',
    riskLabel: '리스크/검토 사항',
    riskPlaceholder: '정책, 보안, 외부 연동, 일정 리스크를 적어주세요.',
    titlePlaceholder: '예: 결제 실패 사유 안내 개선',
    firstTaskTitle: '개선 범위와 우선순위 정리',
    firstTaskOutput: '개선 범위 및 검토 의견',
    firstTaskAcceptance: '개선 대상, 범위, 제외 범위, 우선순위가 정리되어야 합니다.',
    createdLog: '서비스 개선 요청을 등록했습니다.',
  },
  {
    type: 'new_service',
    label: '신규 서비스',
    shortLabel: '신규 서비스',
    title: '신규 서비스 요청서',
    intro: '새로운 서비스나 제품을 출시할 때 대상 사용자, 핵심 기능, 운영 범위를 먼저 정리해 출시 기준을 맞춥니다.',
    serviceLabel: '출시할 서비스',
    areaLabel: '서비스 범위',
    summaryLabel: '서비스 개요',
    summaryPlaceholder: '어떤 서비스를 누구에게 제공하려는지 한두 문장으로 적어주세요.',
    problemLabel: '출시 배경',
    problemPlaceholder: '왜 지금 이 서비스를 새로 만들어야 하는지 사업/운영 배경을 적어주세요.',
    outcomeLabel: '기대 효과/핵심 시나리오',
    outcomePlaceholder: '출시 후 사용자가 무엇을 할 수 있어야 하는지, 핵심 시나리오를 적어주세요.',
    metricLabel: '출시 성공 기준',
    metricPlaceholder: '예: 첫 달 가입 3천 명, 핵심 시나리오 완료율 80% 이상',
    audienceLabel: '대상 사용자/부서',
    audiencePlaceholder: '예: 신규 고객, 제휴사, 내부 운영팀',
    riskLabel: '출시 리스크',
    riskPlaceholder: '운영 인력, 정책, 연동, 보안, 일정 리스크를 적어주세요.',
    titlePlaceholder: '예: 파트너 셀프 온보딩 서비스 신규 구축',
    firstTaskTitle: '서비스 범위와 출시 조건 정리',
    firstTaskOutput: '서비스 개요 및 출시 범위',
    firstTaskAcceptance: '대상 사용자, 핵심 기능, 출시 범위, 제외 범위가 정리되어야 합니다.',
    createdLog: '신규 서비스 요청을 등록했습니다.',
  },
  {
    type: 'new_feature',
    label: '신규 기능',
    shortLabel: '신규 기능',
    title: '신규 기능 요청서',
    intro: '새로 만들어야 할 기능의 목표와 최소 범위를 먼저 정리해 개발 범위를 흔들리지 않게 맞춥니다.',
    serviceLabel: '대상 서비스',
    areaLabel: '기능 영역',
    summaryLabel: '기능 요약',
    summaryPlaceholder: '새로 필요한 기능을 한두 문장으로 설명해주세요.',
    problemLabel: '도입 배경',
    problemPlaceholder: '왜 이 기능이 필요한지, 지금 어떤 공백이 있는지 적어주세요.',
    outcomeLabel: '필수 기능/사용 시나리오',
    outcomePlaceholder: '출시 시 반드시 가능해야 하는 사용자 행동과 핵심 시나리오를 적어주세요.',
    metricLabel: '출시 기준',
    metricPlaceholder: '예: 핵심 시나리오 100% 동작, 문의 20% 감소',
    audienceLabel: '대상 사용자',
    audiencePlaceholder: '예: 영업 담당자, 앱 사용자, 파트너 개발자',
    riskLabel: '선행 조건/제약',
    riskPlaceholder: '정책 확정, 디자인, API 준비 여부 등 선행 조건을 적어주세요.',
    titlePlaceholder: '예: 모바일 앱 푸시 알림 기능 추가',
    firstTaskTitle: '신규 기능 범위와 MVP 정의',
    firstTaskOutput: '기능 범위 및 MVP 합의안',
    firstTaskAcceptance: '핵심 사용자, 최소 출시 범위, 제외 범위가 정리되어야 합니다.',
    createdLog: '신규 기능 요청을 등록했습니다.',
  },
  {
    type: 'bug_fix',
    label: '버그 수정',
    shortLabel: '버그',
    title: '버그 수정 요청서',
    intro: '문제를 재현하고 기대 동작을 명확히 남겨서 수정 우선순위와 영향 범위를 빠르게 판단합니다.',
    serviceLabel: '문제 발생 서비스',
    areaLabel: '발생 영역',
    summaryLabel: '버그 요약',
    summaryPlaceholder: '어떤 문제가 발생하는지 한두 문장으로 적어주세요.',
    problemLabel: '재현 경로/실제 동작',
    problemPlaceholder: '재현 순서와 실제 발생 결과를 구체적으로 적어주세요.',
    outcomeLabel: '기대 동작',
    outcomePlaceholder: '정상이라면 어떻게 동작해야 하는지 적어주세요.',
    metricLabel: '수정 완료 기준',
    metricPlaceholder: '예: 동일 경로 재현 불가, 회귀 테스트 통과',
    audienceLabel: '영향 범위',
    audiencePlaceholder: '예: 전체 고객, 특정 OS 사용자, 운영팀',
    riskLabel: '장애 영향/우회 방법',
    riskPlaceholder: '현재 영향도, 임시 우회 방법, 긴급도 판단 근거를 적어주세요.',
    titlePlaceholder: '예: 정산 승인 버튼 클릭 시 화면 멈춤',
    firstTaskTitle: '버그 재현 및 영향 범위 확인',
    firstTaskOutput: '재현 결과 및 영향 범위',
    firstTaskAcceptance: '재현 경로, 기대 동작, 우선순위 판단 근거가 정리되어야 합니다.',
    createdLog: '버그 수정 요청을 등록했습니다.',
  },
  {
    type: 'policy_change',
    label: '운영 변경',
    shortLabel: '운영 변경',
    title: '운영/정책 변경 요청서',
    intro: '비즈니스 규칙이나 운영 정책이 바뀌는 요청은 적용 기준과 예외 조건이 분명해야 이후 혼선이 줄어듭니다.',
    serviceLabel: '적용 서비스',
    areaLabel: '정책 영역',
    summaryLabel: '변경 요약',
    summaryPlaceholder: '무엇을 어떤 방향으로 바꾸는지 적어주세요.',
    problemLabel: '변경 사유',
    problemPlaceholder: '왜 운영 정책이나 기준을 바꿔야 하는지 적어주세요.',
    outcomeLabel: '적용 규칙/예외 조건',
    outcomePlaceholder: '바뀐 정책이 어떤 조건에서 어떻게 적용되어야 하는지 적어주세요.',
    metricLabel: '적용 완료 기준',
    metricPlaceholder: '예: 적용일 이전 공지 완료, 예외 케이스 승인 완료',
    audienceLabel: '관련 부서/이해관계자',
    audiencePlaceholder: '예: 영업, 운영, 재무, 법무',
    riskLabel: '승인/공지 리스크',
    riskPlaceholder: '공지 일정, 예외 승인, 정책 충돌 가능성을 적어주세요.',
    titlePlaceholder: '예: 주문 취소 수수료 정책 변경',
    firstTaskTitle: '정책 변경안과 적용 기준 확정',
    firstTaskOutput: '정책 변경안 및 승인 의견',
    firstTaskAcceptance: '적용 조건, 예외 처리, 공지 대상이 정리되어야 합니다.',
    createdLog: '운영 변경 요청을 등록했습니다.',
  },
  {
    type: 'data_report',
    label: '데이터·리포트',
    shortLabel: '데이터',
    title: '데이터/리포트 요청서',
    intro: '데이터 요청은 무엇을 보고 싶고 어떤 의사결정에 쓰는지 명확해야 산출물이 흔들리지 않습니다.',
    serviceLabel: '대상 서비스',
    areaLabel: '데이터 영역',
    summaryLabel: '요청 요약',
    summaryPlaceholder: '어떤 데이터나 리포트가 필요한지 적어주세요.',
    problemLabel: '현재 확인이 안 되는 정보',
    problemPlaceholder: '지금 어떤 데이터를 볼 수 없어서 의사결정이 막히는지 적어주세요.',
    outcomeLabel: '필요한 지표/리포트 형태',
    outcomePlaceholder: '대시보드, 엑셀, 집계표 등 원하는 결과물을 적어주세요.',
    metricLabel: '완료 기준',
    metricPlaceholder: '예: 주간 자동 발송, 지표 오차 1% 이하',
    audienceLabel: '활용 사용자',
    audiencePlaceholder: '예: 경영진, 운영팀, 영업팀',
    riskLabel: '데이터 제약',
    riskPlaceholder: '원천 데이터 부족, 정의 불일치, 권한 문제를 적어주세요.',
    titlePlaceholder: '예: 주간 매출 리포트 자동 발송',
    firstTaskTitle: '지표 정의와 데이터 출처 정리',
    firstTaskOutput: '지표 정의서 및 데이터 출처',
    firstTaskAcceptance: '지표 정의, 집계 기준, 배포 방식이 정리되어야 합니다.',
    createdLog: '데이터/리포트 요청을 등록했습니다.',
  },
  {
    type: 'integration_api',
    label: '연동·API',
    shortLabel: '연동/API',
    title: '연동/API 요청서',
    intro: '외부 연동은 대상 시스템, 데이터 흐름, 인증 방식이 처음부터 명확해야 구현과 검증이 수월합니다.',
    serviceLabel: '연동 대상 서비스',
    areaLabel: '연동 영역',
    summaryLabel: '연동 요약',
    summaryPlaceholder: '어떤 시스템과 어떤 목적의 연동이 필요한지 적어주세요.',
    problemLabel: '현재 공백/수작업',
    problemPlaceholder: '지금 어떤 수작업이나 정보 단절이 있는지 적어주세요.',
    outcomeLabel: '필수 데이터 흐름',
    outcomePlaceholder: '어떤 데이터가 어느 방향으로 오가야 하는지 적어주세요.',
    metricLabel: '연동 완료 기준',
    metricPlaceholder: '예: API 성공률 99% 이상, 수작업 80% 감소',
    audienceLabel: '관련 사용자/파트너',
    audiencePlaceholder: '예: 파트너 개발자, 내부 운영자, 고객',
    riskLabel: '인증/계약/운영 리스크',
    riskPlaceholder: 'API 스펙 확정, 인증, 계약, 장애 대응 리스크를 적어주세요.',
    titlePlaceholder: '예: 파트너 주문 조회 API 연동',
    firstTaskTitle: '연동 범위와 인터페이스 정의',
    firstTaskOutput: '연동 범위 및 인터페이스 초안',
    firstTaskAcceptance: '대상 시스템, 인증 방식, 데이터 흐름이 정리되어야 합니다.',
    createdLog: '연동/API 요청을 등록했습니다.',
  },
  {
    type: 'security_permission',
    label: '보안·권한',
    shortLabel: '보안/권한',
    title: '보안/권한 요청서',
    intro: '보안과 권한 요청은 누가 어디까지 접근 가능한지, 로그를 어떻게 남길지가 핵심입니다.',
    serviceLabel: '대상 서비스',
    areaLabel: '보안/권한 영역',
    summaryLabel: '요청 요약',
    summaryPlaceholder: '추가하거나 바꿔야 할 권한/보안 요구를 적어주세요.',
    problemLabel: '현재 위험/문제',
    problemPlaceholder: '현재 어떤 권한 문제나 보안 리스크가 있는지 적어주세요.',
    outcomeLabel: '필요 권한/통제 방식',
    outcomePlaceholder: '누가 무엇까지 할 수 있어야 하는지, 어떤 통제가 필요한지 적어주세요.',
    metricLabel: '적용 완료 기준',
    metricPlaceholder: '예: 감사 로그 저장, 관리자 권한 오남용 차단',
    audienceLabel: '관련 사용자/조직',
    audiencePlaceholder: '예: 관리자, 보안팀, 운영팀',
    riskLabel: '감사/컴플라이언스 이슈',
    riskPlaceholder: '개인정보, 접근통제, 감사 로그 요구사항을 적어주세요.',
    titlePlaceholder: '예: 관리자 권한 감사 로그 강화',
    firstTaskTitle: '권한 정책과 감사 범위 정리',
    firstTaskOutput: '권한 정책 및 감사 로그 범위',
    firstTaskAcceptance: '권한 수준, 예외 권한, 감사 로그 범위가 정리되어야 합니다.',
    createdLog: '보안/권한 요청을 등록했습니다.',
  },
  {
    type: 'infra_performance',
    label: '인프라·성능',
    shortLabel: '인프라/성능',
    title: '인프라/성능 요청서',
    intro: '성능과 인프라 요청은 병목 구간과 목표 수치를 먼저 잡아야 개선 효과를 측정할 수 있습니다.',
    serviceLabel: '대상 서비스',
    areaLabel: '인프라/성능 영역',
    summaryLabel: '요청 요약',
    summaryPlaceholder: '어떤 성능 또는 인프라 개선이 필요한지 적어주세요.',
    problemLabel: '현재 병목/장애 요인',
    problemPlaceholder: '속도 저하, 장애, 배포 문제 등 현재 문제를 적어주세요.',
    outcomeLabel: '목표 상태',
    outcomePlaceholder: '개선 후 어떤 수준의 성능/안정성이 필요할지 적어주세요.',
    metricLabel: '목표 지표',
    metricPlaceholder: '예: 응답시간 40% 단축, 장애 감지 1분 이내',
    audienceLabel: '영향 사용자/시스템',
    audiencePlaceholder: '예: 전체 고객, 운영팀, 백오피스 사용자',
    riskLabel: '운영 리스크',
    riskPlaceholder: '배포 창구, 트래픽 영향, 롤백 조건을 적어주세요.',
    titlePlaceholder: '예: 관리자 대시보드 조회 속도 개선',
    firstTaskTitle: '병목 구간과 개선 범위 확인',
    firstTaskOutput: '병목 분석 및 개선 범위',
    firstTaskAcceptance: '병목 원인, 목표 지표, 우선순위가 정리되어야 합니다.',
    createdLog: '인프라/성능 요청을 등록했습니다.',
  },
]

const requestTypeLabels: Record<ProjectRequestType, string> = Object.fromEntries(
  requestTypeOptions.map((item) => [item.type, item.label]),
) as Record<ProjectRequestType, string>

const defaultWorkflowConfig: WorkflowConfig = {
  requiresQcSecurity: true,
}

const fullApprovalRoles: Role[] = ['pm', 'cem', 'security', 'infra', 'qa', 'patent', 'admin']

const requestFieldRules: Record<
  ProjectRequestType,
  { serviceFreeText?: boolean; dueDateOptional?: boolean; metricOptional?: boolean }
> = {
  improvement: {},
  new_service: { serviceFreeText: true },
  new_feature: { serviceFreeText: true },
  bug_fix: { dueDateOptional: true, metricOptional: true },
  policy_change: {},
  data_report: {},
  integration_api: {},
  security_permission: { dueDateOptional: true, metricOptional: true },
  infra_performance: { dueDateOptional: true },
}

const approvalRolesByRequestType: Record<ProjectRequestType, Role[]> = {
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

const activeRoles: Role[] = ['requester', 'pm', 'cem', 'developer', 'security', 'infra', 'qa', 'patent', 'admin']
const demoToday = new Date('2026-05-17T09:00:00+09:00')

type ViewMode = 'dashboard' | 'request' | 'pipeline' | 'settings'
type StatusFilter = ProjectStatus | 'all' | 'active' | 'dueSoon' | 'mine' | 'risk' | 'blocked'

type RequestFormState = {
  requestType: ProjectRequestType
  title: string
  serviceName: string
  serviceArea: string
  requester: string
  ownerTeam: string
  priority: Priority
  dueDate: string
  summary: string
  currentProblem: string
  desiredOutcome: string
  successMetric: string
  affectedUsers: string
  risk: string
  securityReview: SecurityReview
}

function roleOwnsStatus(status: ProjectStatus, role: Role) {
  if (status === 'dept_review') {
    return fullApprovalRoles.includes(role)
  }
  return statusOwnerRoles[status] === role || (status === 'qc_security' && (role === 'qa' || role === 'security' || role === 'pm'))
}

function isProjectAssignedToRole(project: Project, role: Role) {
  if (project.status === 'dept_review') {
    return role === 'admin' || project.approvalState.requiredRoles.includes(role)
  }
  return role === 'admin' || project.assigneeRole === role || (project.status === 'qc_security' && (role === 'qa' || role === 'security' || role === 'pm'))
}

function isProjectRelevantToRole(project: Project, role: Role) {
  if (role === 'admin') return true
  if (project.status === 'dept_review') return project.approvalState.requiredRoles.includes(role)
  return isProjectAssignedToRole(project, role)
}

function inferServiceOption(project: Pick<Project, 'serviceName' | 'serviceArea' | 'title' | 'summary'>, serviceOptions: string[]): string {
  if (serviceOptions.includes(project.serviceName)) {
    return project.serviceName
  }

  const text = `${project.serviceName} ${project.serviceArea} ${project.title} ${project.summary}`.toLowerCase()
  if (serviceOptions.some((item) => text.includes(item.toLowerCase()))) {
    return serviceOptions.find((item) => text.includes(item.toLowerCase())) ?? serviceOptions[0] ?? defaultServiceOptions[0]
  }
  if (/(카피|표절|문서|검사|작성)/.test(text)) return serviceOptions.find((item) => item.includes('카피')) ?? serviceOptions[0] ?? defaultServiceOptions[0]
  if (/(몬스터|채용|공고|이력서|지원자)/.test(text)) return serviceOptions.find((item) => item.includes('몬스터')) ?? serviceOptions[0] ?? defaultServiceOptions[0]
  return serviceOptions.find((item) => item.includes('프리즘')) ?? serviceOptions[0] ?? defaultServiceOptions[0]
}

function matchesServiceFilter(project: Pick<Project, 'serviceName' | 'serviceArea' | 'title' | 'summary'>, filter: ServiceFilter, serviceOptions: string[]) {
  return filter === 'all' || inferServiceOption(project, serviceOptions) === filter
}

function persistAssigneeRole(role: Role) {
  const roleMap: Partial<Record<Role, string>> = {
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

const emptyRequestForm: RequestFormState = {
  requestType: 'improvement',
  title: '',
  serviceName: defaultServiceOptions[0],
  serviceArea: '',
  requester: '이영업',
  ownerTeam: '영업',
  priority: 'normal',
  dueDate: '2026-05-31',
  summary: '',
  currentProblem: '',
  desiredOutcome: '',
  successMetric: '',
  affectedUsers: '',
  risk: '',
  securityReview: {
    dataClassification: '',
    accessScope: '',
    externalExposure: '',
    storagePolicy: '',
    securityNotes: '',
  },
}

const emptyReviewDocs: ReviewDocs = {
  srs: '',
  sds: '',
}

type SrsSectionKey =
  | 'introduction'
  | 'summary'
  | 'background'
  | 'goals'
  | 'nonGoals'
  | 'otherConsiderations'
  | 'requirements'
  | 'design'
  | 'i18nMobile'
  | 'devGuidelines'
  | 'risks'
  | 'references'

const srsSections: Array<{ key: SrsSectionKey; ko: string; en: string; placeholder: string }> = [
  { key: 'introduction', ko: '개요', en: 'Introduction', placeholder: '프로젝트 개요 설명. 생소한 프로젝트일 경우 개요와 취지를 설명한다.' },
  { key: 'summary', ko: '요약', en: 'Summary', placeholder: '세 줄 내외로 요약. 누가/무엇을/언제/어디서/왜를 간략하면서도 명확하게.' },
  { key: 'background', ko: '배경', en: 'Background', placeholder: '요청 고객사/사용자, 동기, 해결하려는 문제, 이전 시도 등 Context를 작성.' },
  { key: 'goals', ko: '목표', en: 'Goals', placeholder: '달성하고자 하는 목표들을 Bullet Point로 나열. 추후 성공 여부 평가 기준.' },
  { key: 'nonGoals', ko: '목표가 아닌 것', en: 'Non-Goals', placeholder: '의도적으로 다루지 않을 항목. 범위를 명확히 하기 위해 작성.' },
  { key: 'otherConsiderations', ko: '이외 고려 사항', en: 'Other Considerations', placeholder: '고려했으나 하지 않기로 결정한 사항. 논의 중복 방지용.' },
  { key: 'requirements', ko: '요구사항 상세 기술', en: 'Requirement Specifications', placeholder: '기능 요구사항, 주요/필수/선택 기능, 사용 데이터, 주의 사항.' },
  { key: 'design', ko: '설계에서 고려할 부분', en: 'Design Considerations', placeholder: '설계 고려사항 (~해야 한다 형식).' },
  { key: 'i18nMobile', ko: '다국어 및 모바일 환경', en: 'Multilingual and Mobile Environments', placeholder: '다국어 지원 수준 / 모바일 환경 지원 수준.' },
  { key: 'devGuidelines', ko: '개발 가이드라인', en: 'Development Guidelines', placeholder: '구현 지침, 개발 언어, DB, 운영 서버 등.' },
  { key: 'risks', ko: '예상되는 리스크', en: 'Expected Risks', placeholder: '위험요소 및 대응 방안.' },
  { key: 'references', ko: '참고자료', en: 'References', placeholder: '참고 문서, 일감 링크.' },
]

function parseSrsSections(text: string): Record<SrsSectionKey, string> {
  const result = Object.fromEntries(srsSections.map((s) => [s.key, ''])) as Record<SrsSectionKey, string>
  if (!text) return result
  const lines = text.split('\n')
  let current: SrsSectionKey | null = null
  const buffer = Object.fromEntries(srsSections.map((s) => [s.key, [] as string[]])) as Record<SrsSectionKey, string[]>
  for (const line of lines) {
    const headerMatch = line.match(/^#\s*(.+?)\s*\((.+?)\)\s*$/)
    if (headerMatch) {
      const enName = headerMatch[2].trim()
      const matched = srsSections.find((s) => s.en === enName)
      if (matched) {
        current = matched.key
        continue
      }
    }
    if (current) buffer[current].push(line)
  }
  for (const { key } of srsSections) {
    result[key] = buffer[key].join('\n').replace(/^\n+/, '').replace(/\n+$/, '')
  }
  return result
}

function serializeSrsSections(map: Record<SrsSectionKey, string>): string {
  const blocks: string[] = []
  for (const { key, ko, en } of srsSections) {
    const body = (map[key] ?? '').trim()
    if (!body) continue
    blocks.push(`# ${ko} (${en})\n${body}`)
  }
  return blocks.join('\n\n')
}


function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [role, setRole] = useState<Role>('requester')
  const [serviceOptions, setServiceOptions] = useState<string[]>(() => {
    if (typeof window === 'undefined') return defaultServiceOptions
    try {
      const saved = window.localStorage.getItem(serviceOptionsStorageKey)
      const parsed = saved ? JSON.parse(saved) : null
      return Array.isArray(parsed) && parsed.length > 0 ? parsed.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : defaultServiceOptions
    } catch {
      return defaultServiceOptions
    }
  })
  const [serviceFilter, setServiceFilter] = useState<ServiceFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [query, setQuery] = useState('')
  const [loadState, setLoadState] = useState<'loading' | 'live' | 'error'>(hasSupabaseConfig ? 'loading' : 'error')
  const [viewMode, setViewMode] = useState<ViewMode>('dashboard')
  const [requestForm, setRequestForm] = useState<RequestFormState>(emptyRequestForm)
  const [reviewDocsDrafts, setReviewDocsDrafts] = useState<Record<string, ReviewDocs>>({})
  const [previewAttachment, setPreviewAttachment] = useState<{ name: string; type: string; dataUrl?: string; size: number } | null>(null)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const requestTypeConfig = requestTypeOptions.find((item) => item.type === requestForm.requestType) ?? requestTypeOptions[0]

  useEffect(() => {
    if (!supabase) {
      return
    }

    supabase
      .from('pms_projects')
      .select('*')
      .order('updated_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          setLoadState('error')
          return
        }

        const liveProjects = (data ?? []).map((row) => mapProjectRow(row))
        setProjects(liveProjects)
        setSelectedId(liveProjects[0]?.id ?? '')
        setLoadState('live')
      })
  }, [])

  useEffect(() => {
    window.localStorage.setItem(serviceOptionsStorageKey, JSON.stringify(serviceOptions))
  }, [serviceOptions])

  function replaceServiceOptions(nextOptions: string[]) {
    const normalized = Array.from(new Set(nextOptions.map((item) => item.trim()).filter(Boolean)))
    const safeOptions = normalized.length > 0 ? normalized : [defaultServiceOptions[0]]
    setServiceOptions(safeOptions)

    if (!safeOptions.includes(requestForm.serviceName)) {
      setRequestForm((current) => ({ ...current, serviceName: safeOptions[0] }))
    }

    if (serviceFilter !== 'all' && !safeOptions.includes(serviceFilter)) {
      setServiceFilter('all')
    }
  }

  const selected = projects.find((project) => project.id === selectedId)
  const currentReviewDocsDraft = selected ? reviewDocsDrafts[selected.id] ?? selected.reviewDocs ?? emptyReviewDocs : emptyReviewDocs
  const serviceScopedProjects = useMemo(
    () => projects.filter((project) => matchesServiceFilter(project, serviceFilter, serviceOptions)),
    [projects, serviceFilter, serviceOptions],
  )
  const queueScopedProjects = useMemo(
    () => serviceScopedProjects.filter((project) => isProjectRelevantToRole(project, role)),
    [role, serviceScopedProjects],
  )
  useEffect(() => {
    const selectedProjectInScope = serviceScopedProjects.find((project) => project.id === selectedId)
    let timeoutId: number | undefined

    if (viewMode === 'pipeline' && queueScopedProjects.length > 0) {
      const selectedQueueProject = queueScopedProjects.find((project) => project.id === selectedId)
      if (!selectedQueueProject) {
        timeoutId = window.setTimeout(() => setSelectedId(queueScopedProjects[0].id), 0)
      }
      return () => {
        if (timeoutId) window.clearTimeout(timeoutId)
      }
    }

    if (!selectedProjectInScope && serviceScopedProjects.length > 0) {
      timeoutId = window.setTimeout(() => setSelectedId(serviceScopedProjects[0].id), 0)
    }

    return () => {
      if (timeoutId) window.clearTimeout(timeoutId)
    }
  }, [queueScopedProjects, selectedId, serviceScopedProjects, viewMode])
  const selectedApprovalState = selected?.approvalState ?? { requiredRoles: [], approvedRoles: [] }
  const selectedWorkflow = selected ? workflow.filter((item) => {
    if (item.status === 'qc_security') return selected.workflowConfig.requiresQcSecurity
    return true
  }) : workflow
  const metrics = useMemo(() => {
    const active = serviceScopedProjects.filter((project) => !['published', 'rejected'].includes(project.status))
    const dueSoon = serviceScopedProjects.filter((project) => daysUntil(project.dueDate, demoToday) <= 5 && project.status !== 'published')
    const blocked = serviceScopedProjects.reduce((count, project) => count + project.tasks.filter((task) => task.status === 'blocked').length, 0)
    const myQueue = serviceScopedProjects.filter((project) => isProjectAssignedToRole(project, role))
    const relevantProjects = serviceScopedProjects.filter((project) => isProjectRelevantToRole(project, role))
    const relevantActive = relevantProjects.filter((project) => !['published', 'rejected'].includes(project.status))
    const relevantDueSoon = relevantProjects.filter((project) => daysUntil(project.dueDate, demoToday) <= 5 && project.status !== 'published')
    const relevantBlocked = relevantProjects.reduce((count, project) => count + project.tasks.filter((task) => task.status === 'blocked').length, 0)

    return {
      total: serviceScopedProjects.length,
      active: active.length,
      dueSoon: dueSoon.length,
      blocked,
      myQueue: myQueue.length,
      relevantTotal: relevantProjects.length,
      relevantActive: relevantActive.length,
      relevantDueSoon: relevantDueSoon.length,
      relevantBlocked,
    }
  }, [role, serviceScopedProjects])

  const filteredProjects = useMemo(() => {
    return queueScopedProjects
      .filter((project) => {
        if (statusFilter === 'mine') return isProjectAssignedToRole(project, role)
        if (statusFilter === 'risk') return project.priority === 'urgent' || project.tasks.some((task) => task.status === 'blocked')
        if (statusFilter === 'blocked') return project.tasks.some((task) => task.status === 'blocked')
        if (statusFilter === 'active') return !['published', 'rejected'].includes(project.status)
        if (statusFilter === 'dueSoon') return daysUntil(project.dueDate, demoToday) <= 5 && project.status !== 'published'
        if (statusFilter === 'all') return true
        return project.status === statusFilter
      })
      .filter((project) => `${project.title} ${project.summary} ${project.code}`.toLowerCase().includes(query.toLowerCase()))
  }, [query, queueScopedProjects, role, statusFilter])

  const dashboardSummary = useMemo(() => {
    const taskStatus = serviceScopedProjects.reduce(
      (summary, project) => {
        project.tasks.forEach((task) => {
          summary[task.status] += 1
        })
        return summary
      },
      { todo: 0, doing: 0, blocked: 0, done: 0 } as Record<TaskStatus, number>,
    )
    const priority = serviceScopedProjects.reduce(
      (summary, project) => {
        summary[project.priority] += 1
        return summary
      },
      { low: 0, normal: 0, high: 0, urgent: 0 } as Record<Priority, number>,
    )
    const statusCounts = workflow.map((item) => ({
      ...item,
      count: serviceScopedProjects.filter((project) => project.status === item.status).length,
    }))
    const projectsByStatus = workflow.map((item) => ({
      ...item,
      projects: serviceScopedProjects
        .filter((project) => project.status === item.status)
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .slice(0, 6),
    }))
    const dueSoon = serviceScopedProjects
      .filter((project) => daysUntil(project.dueDate, demoToday) <= 10 && project.status !== 'published')
      .sort((a, b) => daysUntil(a.dueDate, demoToday) - daysUntil(b.dueDate, demoToday))
      .slice(0, 5)
    const recent = [...serviceScopedProjects].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 5)
    const assignedProjects = serviceScopedProjects.filter((project) => isProjectAssignedToRole(project, role))
    const myQueue = serviceScopedProjects.filter((project) => isProjectAssignedToRole(project, role)).slice(0, 5)

    return { taskStatus, priority, statusCounts, projectsByStatus, assignedProjects, dueSoon, recent, myQueue }
  }, [role, serviceScopedProjects])

  const currentStep = Math.max(
    0,
    selectedWorkflow.findIndex((item) => item.status === selected?.status),
  )
  const canAct = Boolean(
    selected && (
      role === 'admin' ||
      isProjectAssignedToRole(selected, role) ||
      (selected.status === 'dept_review' && selectedApprovalState.requiredRoles.includes(role))
    ),
  )
  const blockedTasks = selected?.tasks.filter((task) => task.status === 'blocked') ?? []
  const openTasks = selected?.tasks.filter((task) => task.status !== 'done') ?? []
  const hasSrsDraft = currentReviewDocsDraft.srs.trim().length > 0
  const hasSdsDraft = currentReviewDocsDraft.sds.trim().length > 0
  const hasRequiredReviewDocs = hasSrsDraft && hasSdsDraft
  const pendingApprovalRoles = selectedApprovalState.requiredRoles.filter((item) => !selectedApprovalState.approvedRoles.includes(item))
  // QC/보안/PM 3자 합의 게이트
  const qcSignoff = selected?.qcSignoff ?? { qa: false, security: false, pm: false }
  const qcAllSignedOff = qcSignoff.qa && qcSignoff.security && qcSignoff.pm
  const qcPendingRoles = (['qa', 'security', 'pm'] as const).filter((r) => !qcSignoff[r])
  const isStepAdvanceBlocked = Boolean(
    selected?.onHold ||
    (selected?.status === 'dept_review' && pendingApprovalRoles.length > 0) ||
    (selected?.status === 'planning' && !hasRequiredReviewDocs) ||
    (selected?.status === 'qc_security' && !qcAllSignedOff) ||
    (selected?.status === 'completion' && !selected?.requesterConfirmed),
  )
  const canApproveCurrentRole = Boolean(
    selected?.status === 'dept_review' &&
    selectedApprovalState.requiredRoles.includes(role) &&
    !selectedApprovalState.approvedRoles.includes(role),
  )
  // QC 사인오프 가능한 역할인지 (admin은 모든 역할 대행 가능)
  const myQcSignoffRole: ('qa' | 'security' | 'pm') | null =
    role === 'qa' ? 'qa' : role === 'security' ? 'security' : role === 'pm' ? 'pm' : null
  const canQcSignoff = Boolean(
    selected?.status === 'qc_security' && (myQcSignoffRole || role === 'admin'),
  )

  async function updateApprovalState(approvalState: ApprovalState, message: string) {
    if (!selected) return

    const allApproved = approvalState.requiredRoles.every((item) => approvalState.approvedRoles.includes(item))
    const shouldAdvance = allApproved && selected.status === 'dept_review' && !selected.onHold
    // 워크플로우 배열 순서 기반으로 다음 단계 계산 (하드코딩 제거)
    const deptIndex = selectedWorkflow.findIndex((item) => item.status === 'dept_review')
    const nextStatusAfterApproval = selectedWorkflow[deptIndex + 1]?.status ?? selected.status

    const advancedStatus: ProjectStatus = shouldAdvance ? nextStatusAfterApproval : selected.status
    const advancedAssigneeRole = shouldAdvance ? nextRoleFor(advancedStatus) : selected.assigneeRole
    const advancedProgress = shouldAdvance ? Math.min(100, selected.progress + 12) : selected.progress
    const nextAction = shouldAdvance
      ? nextActionFor(advancedStatus)
      : allApproved
        ? '필수 승인 완료, 다음 단계 진행 가능'
        : `승인 대기: ${approvalState.requiredRoles.filter((item) => !approvalState.approvedRoles.includes(item)).map((item) => approvalStepLabels[item]).join(', ')}`

    const baseLogEntry = {
      id: crypto.randomUUID(),
      at: '방금 전',
      actor: roleLabels[role],
      message,
      // 승인 완료로 진행되면 문서 잠금 스냅샷 포함 (#12)
      meta: { approvalState, ...(shouldAdvance ? { docsLocked: true } : {}) },
    }
    const advanceLogEntry = shouldAdvance
      ? {
          id: crypto.randomUUID(),
          at: '방금 전',
          actor: roleLabels[role],
          message: `모든 승인 완료 → ${statusLabels[advancedStatus]} 단계로 자동 진행했습니다.`,
        }
      : null

    const nextLogs = advanceLogEntry
      ? [advanceLogEntry, baseLogEntry, ...selected.logs]
      : [baseLogEntry, ...selected.logs]

    setProjects((current) =>
      current.map((project) =>
        project.id === selected.id
          ? {
              ...project,
              approvalState,
              status: advancedStatus,
              assigneeRole: advancedAssigneeRole,
              progress: advancedProgress,
              nextAction,
              docsLocked: shouldAdvance ? true : project.docsLocked,
              logs: nextLogs,
              updatedAt: new Date().toISOString(),
            }
          : project,
      ),
    )

    if (!supabase) return
    const { error } = await supabase
      .from('pms_projects')
      .update({
        status: advancedStatus,
        assignee_role: persistAssigneeRole(advancedAssigneeRole),
        progress: advancedProgress,
        next_action: nextAction,
        logs: nextLogs,
      })
      .eq('id', selected.id)

    if (error) setLoadState('error')
  }

  async function updateSelectedReviewDocs() {
    if (!selected) return

    const nextLogs = [
      {
        id: crypto.randomUUID(),
        at: '방금 전',
        actor: roleLabels[role],
        message: 'PM이 기획 문서(SRS+SDS)를 업데이트했습니다.',
        meta: { reviewDocs: currentReviewDocsDraft },
      },
      ...selected.logs,
    ]

    setProjects((current) =>
      current.map((project) =>
        project.id === selected.id
          ? {
              ...project,
              reviewDocs: currentReviewDocsDraft,
              logs: nextLogs,
              updatedAt: new Date().toISOString(),
            }
          : project,
      ),
    )
    setReviewDocsDrafts((current) => {
      const { [selected.id]: _removed, ...rest } = current
      void _removed
      return rest
    })
    window.alert('기획 문서를 저장했습니다.')

    void notifyGoogleChat('doc.update', `PM이 기획 문서를 업데이트했습니다.`, {
      프로젝트: selected.title,
      코드: selected.code,
    })

    if (!supabase) return
    const { error } = await supabase
      .from('pms_projects')
      .update({ logs: nextLogs })
      .eq('id', selected.id)

    if (error) setLoadState('error')
  }

  async function approveCurrentRole() {
    if (!selected || !canApproveCurrentRole) return

    const approvalState: ApprovalState = {
      ...selectedApprovalState,
      approvedRoles: [...selectedApprovalState.approvedRoles, role],
    }

    await updateApprovalState(approvalState, `${roleLabels[role]} 승인을 완료했습니다.`)
    const allApproved = approvalState.requiredRoles.every((item) => approvalState.approvedRoles.includes(item))
    void notifyGoogleChat('project.approve', `${roleLabels[role]}이(가) 승인했습니다.`, {
      프로젝트: selected.title,
      코드: selected.code,
      ...(allApproved ? { 상태: '모든 승인 완료 → 다음 단계 자동 진행' } : { 남은승인: approvalState.requiredRoles.filter((r) => !approvalState.approvedRoles.includes(r)).map((r) => approvalStepLabels[r]).join(', ') }),
    })
  }

  async function toggleHoldProject(projectId: string) {
    if (!['pm', 'admin'].includes(role)) return
    const target = projects.find((project) => project.id === projectId)
    if (!target) return
    if (['published', 'rejected'].includes(target.status)) return

    const willHold = !target.onHold
    let reason = ''
    if (willHold) {
      const input = window.prompt(`"${target.title}" 보류 사유를 입력하세요. (선택)`) ?? ''
      reason = input.trim()
    }
    const nextLogs = [
      {
        id: crypto.randomUUID(),
        at: '방금 전',
        actor: roleLabels[role],
        message: willHold
          ? `프로젝트를 보류 처리했습니다.${reason ? ` 사유: ${reason}` : ''}`
          : '프로젝트 보류를 해제했습니다.',
      },
      ...target.logs,
    ]

    setProjects((current) =>
      current.map((project) =>
        project.id === projectId
          ? {
              ...project,
              onHold: willHold,
              holdReason: willHold ? reason : undefined,
              updatedAt: new Date().toISOString(),
              logs: nextLogs,
            }
          : project,
      ),
    )

    void notifyGoogleChat(willHold ? 'project.hold' : 'project.unhold', willHold ? `프로젝트를 보류 처리했습니다.` : `프로젝트 보류를 해제했습니다.`, {
      프로젝트: target.title,
      코드: target.code,
      ...(willHold && reason ? { 사유: reason } : {}),
    })

    if (!supabase) return
    const { error } = await supabase
      .from('pms_projects')
      .update({ logs: nextLogs })
      .eq('id', projectId)
    if (error) setLoadState('error')
  }

  async function toggleHoldSelectedProject() {
    if (selected) void toggleHoldProject(selected.id)
  }

  async function advanceSelectedProject() {
    if (!selected || !canAct) return
    if (selected.onHold) { window.alert('보류 중인 프로젝트입니다. 보류를 해제한 뒤 진행하세요.'); return }
    if (selected.status === 'dept_review' && pendingApprovalRoles.length > 0) return
    if (selected.status === 'planning' && !hasRequiredReviewDocs) return
    if (selected.status === 'qc_security' && !qcAllSignedOff) { window.alert('QC·보안·PM 3자 검토가 모두 완료되어야 다음 단계로 진행할 수 있습니다.'); return }
    if (selected.status === 'completion' && !selected.requesterConfirmed) { window.alert('요청자 확인이 완료되어야 게시할 수 있습니다.'); return }
    // 개발 단계: 미완료 태스크가 있으면 확인
    if (selected.status === 'development' && openTasks.length > 0) {
      if (!window.confirm(`완료되지 않은 태스크가 ${openTasks.length}건 있습니다. 그래도 다음 단계로 진행할까요?`)) return
    }

    const nextIndex = currentStep + 1
    const nextItem = selectedWorkflow[nextIndex]
    const targetStatus = nextItem?.status ?? selected.status
    const nextLogs = [
      {
        id: crypto.randomUUID(),
        at: '방금 전',
        actor: roleLabels[role],
        message: `${statusLabels[targetStatus]} 단계로 이동했습니다.`,
        meta: selected.status === 'planning' ? { reviewDocs: currentReviewDocsDraft } : undefined,
      },
      ...selected.logs,
    ]
    const nextAssigneeRole = nextRoleFor(targetStatus)
    const nextAction = nextActionFor(targetStatus)
    const nextProgress = Math.min(100, selected.progress + 12)

    setProjects((current) =>
      current.map((project) =>
        project.id === selected.id
          ? {
              ...project,
              status: targetStatus,
              progress: nextProgress,
              assigneeRole: nextAssigneeRole,
              nextAction,
              reviewDocs: selected.status === 'planning' ? currentReviewDocsDraft : project.reviewDocs,
              updatedAt: new Date().toISOString(),
              logs: nextLogs,
            }
          : project,
      ),
    )

    if (!supabase) return

    const { error } = await supabase
      .from('pms_projects')
      .update({
        status: targetStatus,
        progress: nextProgress,
        assignee_role: persistAssigneeRole(nextAssigneeRole),
        next_action: nextAction,
        logs: nextLogs,
      })
      .eq('id', selected.id)

    if (error) setLoadState('error')

    void notifyGoogleChat('project.advance', `단계 진행: ${statusLabels[targetStatus]}`, {
      프로젝트: selected.title,
      코드: selected.code,
      다음담당: roleLabels[nextAssigneeRole],
      진행률: `${nextProgress}%`,
    })
  }

  // 공통: 선택 프로젝트 patch + 로그(상태 스냅샷 포함) + DB 동기화
  async function patchSelectedProject(patch: Partial<Project>, logMessage: string) {
    if (!selected) return
    const merged: Project = { ...selected, ...patch, updatedAt: new Date().toISOString() }
    // 컬럼이 없는 신규 필드는 로그 meta 스냅샷으로 보존
    const stateMeta = {
      approvalState: merged.approvalState,
      qcSignoff: merged.qcSignoff,
      requesterConfirmed: merged.requesterConfirmed,
      docsLocked: merged.docsLocked,
      rejectedReason: merged.rejectedReason,
      rejectedFromStatus: merged.rejectedFromStatus,
      comments: merged.comments,
    }
    const nextLogs = [
      { id: crypto.randomUUID(), at: '방금 전', actor: roleLabels[role], message: logMessage, meta: stateMeta },
      ...selected.logs,
    ]
    merged.logs = nextLogs
    setProjects((current) => current.map((project) => (project.id === selected.id ? merged : project)))
    if (!supabase) return
    const dbPatch: Record<string, unknown> = { logs: nextLogs }
    if (patch.status) dbPatch.status = patch.status
    if (patch.assigneeRole) dbPatch.assignee_role = persistAssigneeRole(patch.assigneeRole)
    if (patch.nextAction) dbPatch.next_action = patch.nextAction
    if (patch.progress !== undefined) dbPatch.progress = patch.progress
    const { error } = await supabase.from('pms_projects').update(dbPatch).eq('id', selected.id)
    if (error) setLoadState('error')
  }

  // #1 반려: 현재 단계에서 요청을 반려 처리
  async function rejectSelectedProject() {
    if (!selected || !canAct) return
    if (['published', 'rejected'].includes(selected.status)) return
    const reason = (window.prompt('반려 사유를 입력하세요.') ?? '').trim()
    if (!reason) return
    await patchSelectedProject(
      { status: 'rejected', rejectedReason: reason, rejectedFromStatus: selected.status, assigneeRole: 'requester', nextAction: '반려됨 · 요청자 보완 후 재요청 필요' },
      `${roleLabels[role]}이(가) 반려했습니다. 사유: ${reason}`,
    )
    void notifyGoogleChat('project.hold', `프로젝트가 반려되었습니다: ${selected.title}`, { 사유: reason, 처리: roleLabels[role] })
  }

  // #2 회송(되돌리기): 이전 단계로 되돌림 (PM/admin)
  async function revertSelectedProject() {
    if (!selected) return
    if (!['pm', 'admin'].includes(role)) { window.alert('PM 또는 관리자만 이전 단계로 되돌릴 수 있습니다.'); return }
    const idx = selectedWorkflow.findIndex((item) => item.status === selected.status)
    if (idx <= 0) { window.alert('첫 단계라 되돌릴 수 없습니다.'); return }
    const prevStatus = selectedWorkflow[idx - 1].status
    const reason = (window.prompt(`"${statusLabels[prevStatus]}" 단계로 되돌립니다. 사유를 입력하세요.`) ?? '').trim()
    if (!reason) return
    const patch: Partial<Project> = {
      status: prevStatus,
      assigneeRole: nextRoleFor(prevStatus),
      nextAction: `${statusLabels[prevStatus]} 단계 재작업 (회송 사유: ${reason})`,
      progress: Math.max(0, selected.progress - 12),
    }
    // 승인 단계로 되돌아가면 승인 초기화 + 문서 잠금 해제
    if (prevStatus === 'dept_review' || prevStatus === 'planning') {
      patch.approvalState = { requiredRoles: selected.approvalState.requiredRoles, approvedRoles: [] }
      patch.docsLocked = false
    }
    if (prevStatus !== 'qc_security') patch.qcSignoff = { qa: false, security: false, pm: false }
    await patchSelectedProject(patch, `${roleLabels[role]}이(가) ${statusLabels[prevStatus]} 단계로 회송했습니다. 사유: ${reason}`)
    void notifyGoogleChat('project.advance', `회송: ${statusLabels[prevStatus]} 단계로 되돌림`, { 프로젝트: selected.title, 사유: reason })
  }

  // #4 QC/보안/PM 3자 사인오프 토글
  async function toggleQcSignoff() {
    if (!selected || selected.status !== 'qc_security') return
    if (selected.onHold) { window.alert('보류 중에는 검토할 수 없습니다.'); return }
    const targetRole = myQcSignoffRole ?? (role === 'admin' ? null : null)
    if (!targetRole && role !== 'admin') return
    // admin이면 어떤 역할을 대행할지 선택
    let signRole = targetRole
    if (!signRole && role === 'admin') {
      const pick = (window.prompt('대행 사인오프할 역할 입력 (qa / security / pm)') ?? '').trim().toLowerCase()
      if (!['qa', 'security', 'pm'].includes(pick)) return
      signRole = pick as 'qa' | 'security' | 'pm'
    }
    if (!signRole) return
    const current = selected.qcSignoff ?? { qa: false, security: false, pm: false }
    const nextSignoff = { ...current, [signRole]: !current[signRole] }
    const label = { qa: 'QC', security: '보안', pm: 'PM' }[signRole]
    await patchSelectedProject(
      { qcSignoff: nextSignoff },
      `${label} 검토를 ${nextSignoff[signRole] ? '완료' : '취소'} 처리했습니다.`,
    )
    void notifyGoogleChat('task.status', `QC/보안/PM 검토 ${nextSignoff[signRole] ? '완료' : '취소'}: ${label}`, { 프로젝트: selected.title })
  }

  // #8 요청자 확인 (완료보고 단계)
  async function confirmByRequester() {
    if (!selected || selected.status !== 'completion') return
    const next = !selected.requesterConfirmed
    await patchSelectedProject(
      { requesterConfirmed: next, nextAction: next ? '요청자 확인 완료 · 게시 가능' : '요청자 확인 대기' },
      next ? '요청자가 결과물을 확인했습니다.' : '요청자 확인을 취소했습니다.',
    )
    void notifyGoogleChat('project.approve', `요청자 확인 ${next ? '완료' : '취소'}`, { 프로젝트: selected.title })
  }

  // 목표2: 단계별 문의 댓글 등록
  async function addProjectComment(message: string) {
    if (!selected) return
    const trimmed = message.trim()
    if (!trimmed) return
    const comment = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      actor: roleLabels[role],
      role,
      stage: selected.status,
      message: trimmed,
    }
    const nextComments = [...(selected.comments ?? []), comment]
    await patchSelectedProject({ comments: nextComments }, `[${statusLabels[selected.status]}] 문의/의견을 남겼습니다.`)
    void notifyGoogleChat('task.comment', `[${statusLabels[selected.status]}] 문의: ${selected.title}`, { 작성자: roleLabels[role], 내용: trimmed })
  }

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) {
      setLoadState('error')
      return
    }

    const now = new Date().toISOString()
    const projectCode = `PRJ-2505-${String(projects.length + 1).padStart(3, '0')}`
    const initialApprovalState: ApprovalState = {
      requiredRoles: approvalRolesByRequestType[requestForm.requestType],
      approvedRoles: [],
    }
    const newProject: Project = {
      id: crypto.randomUUID(),
      code: projectCode,
      requestType: requestForm.requestType,
      title: requestForm.title,
      serviceName: requestForm.serviceName,
      serviceArea: requestForm.serviceArea,
      requester: requestForm.requester,
      ownerTeam: requestForm.ownerTeam,
      priority: requestForm.priority,
      status: 'request',
      summary: requestForm.summary,
      currentProblem: requestForm.currentProblem,
      desiredOutcome: requestForm.desiredOutcome,
      successMetric: requestForm.successMetric,
      affectedUsers: requestForm.affectedUsers,
      dueDate: requestForm.dueDate,
      createdAt: now,
      updatedAt: now,
      risk: requestForm.risk || '검토 단계에서 위험 요소를 확인해야 합니다.',
      progress: 5,
      nextAction: '요청 내용 확인 후 SRS/SDS 문서를 등록해야 합니다.',
      assigneeRole: 'pm',
      workflowConfig: defaultWorkflowConfig,
      approvalState: initialApprovalState,
      securityReview: requestForm.securityReview,
      reviewDocs: emptyReviewDocs,
      tasks: [],
      logs: [
        {
          id: crypto.randomUUID(),
          at: '방금 전',
          actor: requestForm.requester,
          message: requestTypeConfig.createdLog,
          meta: {
            requestType: requestForm.requestType,
            workflowConfig: defaultWorkflowConfig,
            approvalState: initialApprovalState,
            securityReview: requestForm.securityReview,
            reviewDocs: emptyReviewDocs,
          },
        },
      ],
    }

    const { data, error } = await supabase
      .from('pms_projects')
      .insert({
        code: newProject.code,
        title: newProject.title,
        service_name: newProject.serviceName,
        service_area: newProject.serviceArea,
        requester: newProject.requester,
        owner_team: newProject.ownerTeam,
        priority: newProject.priority,
        status: newProject.status,
        summary: newProject.summary,
        current_problem: newProject.currentProblem,
        desired_outcome: newProject.desiredOutcome,
        success_metric: newProject.successMetric,
        affected_users: newProject.affectedUsers,
        due_date: newProject.dueDate,
        risk: newProject.risk,
        progress: newProject.progress,
        next_action: newProject.nextAction,
        assignee_role: persistAssigneeRole(newProject.assigneeRole),
        tasks: newProject.tasks,
        logs: newProject.logs,
      })
      .select('*')
      .single()

    if (error || !data) {
      setLoadState('error')
      return
    }

    const savedProject = mapProjectRow(data)
    setProjects((current) => [savedProject, ...current])
    setSelectedId(savedProject.id)

    setRequestForm(emptyRequestForm)
    setViewMode('dashboard')
    setStatusFilter('all')

    void notifyGoogleChat('project.create', `신규 요청이 등록되었습니다: ${savedProject.title}`, {
      코드: savedProject.code,
      분류: requestTypeLabels[savedProject.requestType],
      요청자: savedProject.requester,
      서비스: savedProject.serviceName,
      마감: savedProject.dueDate,
    })
  }

  async function updateSelectedProjectTasks(nextTasks: ProjectTask[], logMessage: string) {
    if (!selected || !supabase) {
      setLoadState('error')
      return
    }

    const nextLogs = [
      {
        id: crypto.randomUUID(),
        at: '방금 전',
        actor: roleLabels[role],
        message: logMessage,
      },
      ...selected.logs,
    ]

    setProjects((current) =>
      current.map((project) =>
        project.id === selected.id
          ? {
              ...project,
              tasks: nextTasks,
              logs: nextLogs,
              updatedAt: new Date().toISOString(),
            }
          : project,
      ),
    )

    const { error } = await supabase
      .from('pms_projects')
      .update({
        tasks: nextTasks,
        logs: nextLogs,
      })
      .eq('id', selected.id)

    if (error) setLoadState('error')
  }

  async function addTaskToProject(projectId: string, task: ProjectTask) {
    const target = projects.find((project) => project.id === projectId)
    if (!target) return
    const nextTasks = [task, ...target.tasks]
    const nextLogs = [
      {
        id: crypto.randomUUID(),
        at: '방금 전',
        actor: roleLabels[role],
        message: `새 일감을 등록했습니다: ${task.title}`,
      },
      ...target.logs,
    ]
    setProjects((current) =>
      current.map((project) =>
        project.id === projectId
          ? { ...project, tasks: nextTasks, logs: nextLogs, updatedAt: new Date().toISOString() }
          : project,
      ),
    )
    void notifyGoogleChat('task.create', `새 일감 등록: ${task.title}`, {
      프로젝트: target.title,
      유형: task.type ?? 'task',
      담당: task.owner,
      마감: task.dueDate,
    })

    if (!supabase) return
    const { error } = await supabase
      .from('pms_projects')
      .update({ tasks: nextTasks, logs: nextLogs })
      .eq('id', projectId)
    if (error) setLoadState('error')
  }

  async function purgeDemoTasksExceptKeys(keepKeys: string[]) {
    const keepSet = new Set(keepKeys.map((key) => key.trim()).filter(Boolean))
    const updates: Array<{ id: string; tasks: ProjectTask[] }> = []
    setProjects((current) =>
      current.map((project) => {
        const nextTasks = project.tasks.filter((task) => task.key && keepSet.has(task.key))
        if (nextTasks.length !== project.tasks.length) {
          updates.push({ id: project.id, tasks: nextTasks })
        }
        return { ...project, tasks: nextTasks }
      }),
    )
    if (!supabase) return
    for (const update of updates) {
      const { error } = await supabase
        .from('pms_projects')
        .update({ tasks: update.tasks })
        .eq('id', update.id)
      if (error) setLoadState('error')
    }
  }

  // 관리자: 프로젝트 삭제
  async function deleteProject(projectId: string) {
    setProjects((current) => current.filter((project) => project.id !== projectId))
    setSelectedId((current) => (current === projectId ? '' : current))
    if (!supabase) return
    const { error } = await supabase.from('pms_projects').delete().eq('id', projectId)
    if (error) setLoadState('error')
  }

  async function addTaskComment(taskId: string, message: string) {
    if (!selected) return
    const trimmed = message.trim()
    if (!trimmed) return
    const newComment = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      actor: roleLabels[role],
      message: trimmed,
    }
    const nextTasks = selected.tasks.map((task) =>
      task.id === taskId
        ? { ...task, comments: [...(task.comments ?? []), newComment] }
        : task,
    )
    await updateSelectedProjectTasks(nextTasks, `${roleLabels[role]}님이 태스크에 댓글을 남겼습니다.`)
    const targetTask = selected.tasks.find((task) => task.id === taskId)
    void notifyGoogleChat('task.comment', `태스크 댓글: ${targetTask?.title ?? ''}`, {
      프로젝트: selected.title,
      작성자: roleLabels[role],
      내용: trimmed,
    })
  }

  async function changeTaskStatus(taskId: string, status: TaskStatus, statusNote: string) {
    if (!selected) return
    const nextTasks = selected.tasks.map((task) =>
      task.id === taskId
        ? {
            ...task,
            status,
            statusNote,
            statusChangedAt: new Date().toISOString(),
          }
        : task,
    )
    const changedTask = nextTasks.find((task) => task.id === taskId)
    await updateSelectedProjectTasks(nextTasks, `${changedTask?.title ?? '태스크'} 상태를 ${taskLabels[status]}로 변경했습니다. 사유: ${statusNote}`)
    void notifyGoogleChat('task.status', `태스크 상태 변경: ${changedTask?.title ?? ''} → ${taskLabels[status]}`, {
      프로젝트: selected.title,
      사유: statusNote,
    })
  }

  return (
    <div className={`appShell ${isSidebarCollapsed ? 'sidebarCollapsed' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark">
            <ClipboardList size={20} />
          </div>
          <div className="brandText">
            <strong>프로젝트 관리 시스템</strong>
            <span>Workflow PMO</span>
          </div>
          <button
            className="sidebarToggle"
            type="button"
            onClick={() => setIsSidebarCollapsed((current) => !current)}
            aria-label={isSidebarCollapsed ? '사이드 메뉴 펼치기' : '사이드 메뉴 접기'}
            title={isSidebarCollapsed ? '사이드 메뉴 펼치기' : '사이드 메뉴 접기'}
          >
            {isSidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>

        <nav className="navGroup" aria-label="main">
          <button
            className={`navItem ${viewMode === 'dashboard' ? 'active' : ''}`}
            type="button"
            onClick={() => {
              setViewMode('dashboard')
              setStatusFilter('all')
            }}
            title="대시보드"
          >
            <LayoutDashboard size={17} />
            <span>대시보드</span>
          </button>
          <button
            className={`navItem ${viewMode === 'pipeline' ? 'active' : ''}`}
            type="button"
            onClick={() => {
              setViewMode('pipeline')
              setStatusFilter('all')
            }}
            title="프로젝트"
          >
            <ListChecks size={17} />
            <span>프로젝트</span>
          </button>
          <button
            className={`navItem ${viewMode === 'request' ? 'active' : ''}`}
            type="button"
            onClick={() => setViewMode('request')}
            title="새 요청"
          >
            <Plus size={17} />
            <span>새 요청</span>
          </button>
          {role === 'admin' && (
            <button className={`navItem ${viewMode === 'settings' ? 'active' : ''}`} type="button" title="설정" onClick={() => setViewMode('settings')}>
              <SlidersHorizontal size={17} />
              <span>설정</span>
            </button>
          )}
        </nav>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">2026. 5. 17. 운영 현황</p>
          </div>
          <div className="topbarActions">
            <label className="roleControl">
              <span>현재 역할</span>
              <select value={role} onChange={(event) => {
                const next = event.target.value as Role
                setRole(next)
                if (next !== 'admin' && viewMode === 'settings') {
                  setViewMode('dashboard')
                }
              }} aria-label="역할 선택">
                {activeRoles.map((item) => (
                  <option key={item} value={item}>
                    {roleLabels[item]}
                  </option>
                ))}
              </select>
            </label>
            <div className={`connection ${loadState}`}>
              <Database size={16} />
              {loadState === 'live' ? 'Supabase 연결됨' : loadState === 'loading' ? 'DB 불러오는 중' : 'Supabase 연결 필요'}
            </div>
          </div>
        </header>

        {viewMode === 'dashboard' && (
          <section className="metricGrid" aria-label="project metrics">
            {role === 'admin' ? (
              <>
                <Metric icon={<BarChart3 size={20} />} label="전체 프로젝트" value={metrics.total} tone="red" onClick={() => { setViewMode('pipeline'); setStatusFilter('all') }} />
                <Metric icon={<ListChecks size={20} />} label="진행 중" value={metrics.active} tone="amber" onClick={() => { setViewMode('pipeline'); setStatusFilter('active') }} />
                <Metric icon={<CalendarDays size={20} />} label="마감 임박" value={metrics.dueSoon} tone="green" onClick={() => { setViewMode('pipeline'); setStatusFilter('dueSoon') }} />
                <Metric icon={<AlertTriangle size={20} />} label="보류" value={metrics.blocked} tone="wine" onClick={() => { setViewMode('pipeline'); setStatusFilter('blocked') }} />
                <Metric icon={<Users size={20} />} label="내 처리 대기" value={metrics.myQueue} tone="blue" onClick={() => { setViewMode('pipeline'); setStatusFilter('mine') }} />
              </>
            ) : (
              <>
                <Metric icon={<Users size={20} />} label="확인 필요" value={metrics.myQueue} tone="red" onClick={() => { setViewMode('pipeline'); setStatusFilter('mine') }} />
                <Metric icon={<ListChecks size={20} />} label="관련 진행" value={metrics.relevantActive} tone="amber" onClick={() => { setViewMode('pipeline'); setStatusFilter('active') }} />
                <Metric icon={<CalendarDays size={20} />} label="마감 임박" value={metrics.relevantDueSoon} tone="green" onClick={() => { setViewMode('pipeline'); setStatusFilter('dueSoon') }} />
                <Metric icon={<AlertTriangle size={20} />} label="보류" value={metrics.relevantBlocked} tone="wine" onClick={() => { setViewMode('pipeline'); setStatusFilter('blocked') }} />
                <Metric icon={<BarChart3 size={20} />} label="관련 프로젝트" value={metrics.relevantTotal} tone="blue" onClick={() => { setViewMode('pipeline'); setStatusFilter('all') }} />
              </>
            )}
          </section>
        )}

        {viewMode === 'request' ? (
          <RequestIntakePanel form={requestForm} serviceOptions={serviceOptions} setForm={setRequestForm} onSubmit={submitRequest} />
        ) : viewMode === 'settings' && role === 'admin' ? (
          <SettingsPanel
            serviceOptions={serviceOptions}
            setServiceOptions={replaceServiceOptions}
            projects={projects}
            onToggleHold={toggleHoldProject}
            onPurgeDemoTasks={purgeDemoTasksExceptKeys}
            onDeleteProject={deleteProject}
          />
        ) : viewMode === 'dashboard' ? (
          <DashboardOverview
            role={role}
            serviceFilter={serviceFilter}
            serviceOptions={serviceOptions}
            summary={dashboardSummary}
            onChangeServiceFilter={setServiceFilter}
            onOpenProject={(projectId) => {
              setSelectedId(projectId)
              setViewMode('pipeline')
            }}
            onOpenStatus={(filter) => {
              setStatusFilter(filter)
              setViewMode('pipeline')
            }}
          />
        ) : (
        <section className="workArea">
          <div className="queuePanel">
            <div className="panelHeader">
              <div>
                <p className="eyebrow">Action Queue</p>
                <h2>처리 대기 목록</h2>
              </div>
            </div>

            <div className="searchFilterRow">
              <div className="searchBox">
                <Search size={17} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="프로젝트 검색" />
              </div>

              <div className="filterChips" aria-label="filters">
              <button className={statusFilter === 'all' ? 'active' : ''} type="button" onClick={() => setStatusFilter('all')}>
                전체
              </button>
              <button className={statusFilter === 'active' ? 'active' : ''} type="button" onClick={() => setStatusFilter('active')}>
                진행 중
              </button>
              <button className={statusFilter === 'dueSoon' ? 'active' : ''} type="button" onClick={() => setStatusFilter('dueSoon')}>
                마감 임박
              </button>
              <button className={statusFilter === 'mine' ? 'active' : ''} type="button" onClick={() => setStatusFilter('mine')}>
                내 할 일
              </button>
              <button className={statusFilter === 'risk' ? 'active' : ''} type="button" onClick={() => setStatusFilter('risk')}>
                위험
              </button>
              <button className={statusFilter === 'blocked' ? 'active' : ''} type="button" onClick={() => setStatusFilter('blocked')}>
                보류
              </button>
              </div>
            </div>

            <div className="projectList">
              {filteredProjects.length === 0 && (
                <div className="emptyList">
                  <strong>현재 역할과 관련된 프로젝트가 없습니다.</strong>
                  <span>선택한 서비스와 역할 기준으로 확인할 항목만 보여줍니다.</span>
                </div>
              )}
              {filteredProjects.map((project) => (
                <button
                  key={project.id}
                  className={`projectCard ${selected?.id === project.id ? 'selected' : ''} ${project.onHold ? 'onHold' : ''}`}
                  type="button"
                  onClick={() => setSelectedId(project.id)}
                >
                  <div className="cardTopPills">
                    <span className={`statusPill ${project.status}`}>{statusLabels[project.status]}</span>
                    <span className="requestTypePill">{requestTypeLabels[project.requestType]}</span>
                  </div>
                  <strong>{project.title}</strong>
                  <p>{project.summary}</p>
                  <div className="cardMeta">
                    <span className={`priority ${project.priority}`}>{priorityLabels[project.priority]}</span>
                    <span>{project.ownerTeam}</span>
                    <span>D-{Math.max(0, daysUntil(project.dueDate, demoToday))}</span>
                  </div>
                </button>
              ))}
            </div>

          </div>

          {selected && role !== 'admin' && !canAct && !isProjectAssignedToRole(selected, role) ? (
          <div className="detailPanel emptyStatePanel">
            <strong>{roleLabels[role]} 역할의 작업이 없습니다.</strong>
            <span>이 프로젝트의 현재 단계는 {statusLabels[selected.status]}이며, {roleLabels[role]} 차례가 아닙니다.</span>
          </div>
          ) : selected ? (
          <div className="detailPanel">
            <div className="workflowStrip">
              {selectedWorkflow.map((item, index) => {
                const state = index < currentStep ? 'done' : index === currentStep ? 'current' : 'next'
                return (
                  <div key={item.status} className={`step ${state}`}>
                    <div className="stepDot">{state === 'done' ? <Check size={13} /> : index + 1}</div>
                    <span>{item.label}</span>
                  </div>
                )
              })}
            </div>

            <section className="requirementsPanel numberedSection sectionRequester requesterContent">
              <div className="panelHeader compact">
                <div>
                  <p className="eyebrow">{selected.code}</p>
                  <h3>① 요청자가 요청한 내용</h3>
                  <span>요청 등록 시 작성된 원본 내용</span>
                </div>
                <div className="requesterContentBadges">
                  <span className="requestTypePill">{requestTypeLabels[selected.requestType]}</span>
                  <span className={`statusPill ${selected.status}`}>{statusLabels[selected.status]}</span>
                </div>
              </div>
              <div className="requesterSummary">
                <div className="requesterField">
                  <span>요청 제목</span>
                  <strong>{selected.title}</strong>
                </div>
                <div className="requesterField">
                  <span>{requestTypeOptions.find((item) => item.type === selected.requestType)?.summaryLabel ?? '요약'}</span>
                  <p>{selected.summary?.trim() || <em>(요청자 미입력)</em>}</p>
                </div>
                <div className="requesterField">
                  <span>{requestTypeOptions.find((item) => item.type === selected.requestType)?.serviceLabel ?? '대상 서비스'}</span>
                  <p>{selected.serviceName} · {selected.serviceArea}</p>
                </div>
                <div className="requesterField">
                  <span>요청자 · 담당 조직</span>
                  <p>{selected.requester} · {selected.ownerTeam}</p>
                </div>
                <div className="requesterField">
                  <span>희망 완료일</span>
                  <p>{selected.dueDate || <em>(요청자 미입력)</em>}</p>
                </div>
              </div>
              <div className="requirementGrid">
                <RequirementBlock label={requestTypeOptions.find((item) => item.type === selected.requestType)?.problemLabel ?? '현재 문제'} value={selected.currentProblem || '(요청자 미입력)'} />
                <RequirementBlock label={requestTypeOptions.find((item) => item.type === selected.requestType)?.outcomeLabel ?? '원하는 결과'} value={selected.desiredOutcome || '(요청자 미입력)'} />
                <RequirementBlock label={requestTypeOptions.find((item) => item.type === selected.requestType)?.metricLabel ?? '성공 기준'} value={selected.successMetric || '(요청자 미입력)'} />
                <RequirementBlock label={requestTypeOptions.find((item) => item.type === selected.requestType)?.audienceLabel ?? '영향 사용자/부서'} value={selected.affectedUsers || '(요청자 미입력)'} />
                <RequirementBlock label="리스크/검토 사항" value={selected.risk || '(요청자 미입력)'} />
              </div>
            </section>

            <section className="requirementsPanel numberedSection sectionSrsSds">
              <div className="panelHeader compact">
                <h3>② PM이 등록한 기획 문서 (SRS · SDS)</h3>
                <span>{selected.docsLocked ? '승인 완료 · 잠김 (수정하려면 이전 단계로 회송)' : role === 'pm' ? 'PM 작성 · 항목별 입력 · 첨부 가능' : 'PM이 작성하는 영역 · 읽기 전용'}</span>
              </div>
              {role === 'pm' && !selected.docsLocked ? (
                <>
                  <div className="srsSdsRow">
                    <section className="requirementsPanel docCard srsCard">
                      <div className="panelHeader compact">
                        <h3><span className="docTag srsTag">SRS</span> 요구사항 정의서</h3>
                        <span>PM 작성 · 항목별 입력 · 첨부 가능</span>
                      </div>
                      <div className="requestForm securityReviewEditor">
                        <div className="srsSectionGroup">
                          {srsSections.map((section) => {
                            const sectionsMap = parseSrsSections(currentReviewDocsDraft.srs)
                            return (
                              <label key={section.key} className="srsSectionField">
                                <span>
                                  {section.ko} <em>({section.en})</em>
                                </span>
                                <RichEditor
                                  value={sectionsMap[section.key]}
                                  placeholder={section.placeholder}
                                  minHeight={80}
                                  onChange={(html) => {
                                    const updated = { ...sectionsMap, [section.key]: html }
                                    const nextSrs = serializeSrsSections(updated)
                                    setReviewDocsDrafts((current) => ({
                                      ...current,
                                      [selected.id]: { ...currentReviewDocsDraft, srs: nextSrs },
                                    }))
                                  }}
                                />
                              </label>
                            )
                          })}
                        </div>
                        <DocAttachmentField
                          label="SRS 첨부 문서"
                          attachments={currentReviewDocsDraft.srsAttachments ?? []}
                          onChange={(next) => setReviewDocsDrafts((current) => ({
                            ...current,
                            [selected.id]: { ...currentReviewDocsDraft, srsAttachments: next },
                          }))}
                          onPreview={setPreviewAttachment}
                        />
                      </div>
                    </section>
                    <section className="requirementsPanel docCard sdsCard">
                      <div className="panelHeader compact">
                        <h3><span className="docTag sdsTag">SDS</span> 설계 명세서</h3>
                        <span>PM 작성 · 설계 검토 · 첨부 가능</span>
                      </div>
                      <div className="requestForm securityReviewEditor">
                        <div className="formGrid">
                          <label>
                            <span>설계 내용</span>
                            <RichEditor
                              value={currentReviewDocsDraft.sds}
                              placeholder={'예: 화면/기능 설계, 데이터/연동 설계, 권한/예외 처리, 운영 고려사항'}
                              minHeight={220}
                              onChange={(html) => setReviewDocsDrafts((current) => ({ ...current, [selected.id]: { ...currentReviewDocsDraft, sds: html } }))}
                            />
                          </label>
                        </div>
                        <DocAttachmentField
                          label="SDS 첨부 문서"
                          attachments={currentReviewDocsDraft.sdsAttachments ?? []}
                          onChange={(next) => setReviewDocsDrafts((current) => ({
                            ...current,
                            [selected.id]: { ...currentReviewDocsDraft, sdsAttachments: next },
                          }))}
                          onPreview={setPreviewAttachment}
                        />
                      </div>
                    </section>
                  </div>
                  <div className="docSaveBar">
                    <button className="primaryButton" type="button" onClick={() => void updateSelectedReviewDocs()}>
                      PM 문서 저장
                    </button>
                  </div>
                </>
              ) : (
                <div className="srsSdsRow">
                  <section className="requirementsPanel docCard srsCard">
                    <div className="panelHeader compact">
                      <h3><span className="docTag srsTag">SRS</span> 요구사항 정의서</h3>
                    </div>
                    <RichTextView html={selected.reviewDocs?.srs ?? ''} fallback="아직 등록된 SRS 내용이 없습니다." />
                    {(selected.reviewDocs?.srsAttachments?.length ?? 0) > 0 && (
                      <ul className="docAttachmentList">
                        {selected.reviewDocs?.srsAttachments?.map((file) => (
                          <li key={file.id}>
                            <button
                              type="button"
                              className="attachmentLink"
                              onClick={() => setPreviewAttachment({ name: file.name, type: file.type, dataUrl: file.dataUrl, size: file.size })}
                            >
                              {file.name}
                            </button>
                            <span>{formatBytes(file.size)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                  <section className="requirementsPanel docCard sdsCard">
                    <div className="panelHeader compact">
                      <h3><span className="docTag sdsTag">SDS</span> 설계 명세서</h3>
                    </div>
                    <RichTextView html={selected.reviewDocs?.sds ?? ''} fallback="아직 등록된 SDS 내용이 없습니다." />
                    {(selected.reviewDocs?.sdsAttachments?.length ?? 0) > 0 && (
                      <ul className="docAttachmentList">
                        {selected.reviewDocs?.sdsAttachments?.map((file) => (
                          <li key={file.id}>
                            <button
                              type="button"
                              className="attachmentLink"
                              onClick={() => setPreviewAttachment({ name: file.name, type: file.type, dataUrl: file.dataUrl, size: file.size })}
                            >
                              {file.name}
                            </button>
                            <span>{formatBytes(file.size)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>
              )}
            </section>

            <section className="requirementsPanel numberedSection sectionTasks">
              <div className="panelHeader compact">
                <h3>③ 태스크(일감) 목록</h3>
                <span>계획된 작업·이슈·티켓 · 의견 댓글</span>
              </div>
              <ProjectTasksPanel
                project={selected}
                onStatusChange={changeTaskStatus}
                onAddComment={(taskId, message) => void addTaskComment(taskId, message)}
                onAddTask={(task) => void addTaskToProject(selected.id, task)}
                onPreviewAttachment={setPreviewAttachment}
                currentRole={role}
              />
            </section>

            <section className="requirementsPanel numberedSection sectionInquiry">
              <div className="panelHeader compact">
                <h3>④ 단계별 문의 / 논의</h3>
                <span>현재 단계: {statusLabels[selected.status]} · 전 역할 작성 가능</span>
              </div>
              <StageInquiryPanel
                project={selected}
                currentRole={role}
                onAddComment={(message) => void addProjectComment(message)}
              />
            </section>

            {selected.onHold && (
              <div className="holdBanner" role="status">
                <strong>보류 중</strong>
                <span>{selected.holdReason || '진행이 일시 중단된 상태입니다. PM 또는 관리자가 해제할 때까지 단계 진행이 잠깁니다.'}</span>
              </div>
            )}

            <div className="actionBanner">
              <div className={canAct ? 'actionIcon active' : 'actionIcon'}>
                {canAct ? <Check size={18} /> : <ShieldCheck size={18} />}
              </div>
              <div>
                <strong>{canAct ? selected.nextAction : `${roleLabels[role]} 역할은 현재 단계에서 대기 상태입니다.`}</strong>
                <span>담당: {selected.status === 'qc_security' ? 'QC · 보안 · PM' : roleLabels[selected.assigneeRole]} · 마감 {formatDate(selected.dueDate)}</span>
                {selected.status === 'dept_review' && (
                  <div className="approvalMatrix">
                    {fullApprovalRoles.map((item) => {
                      const required = selectedApprovalState.requiredRoles.includes(item)
                      const approved = selectedApprovalState.approvedRoles.includes(item)
                      return (
                        <div key={item} className="approvalCell">
                          <span>{approvalStepLabels[item]}</span>
                          <strong className={approved ? 'done' : 'pending'}>
                            {approved ? '완료' : required ? approvalButtonLabels[item] ?? '승인' : '-'}
                          </strong>
                        </div>
                      )
                    })}
                  </div>
                )}
                {selected.status === 'dept_review' && (
                  <span className="approvalGuide">
                    {pendingApprovalRoles.length === 0
                      ? '요청자와 PM이 등록한 기준 정보 검토가 모두 끝났습니다.'
                      : `남은 승인 역할: ${pendingApprovalRoles.map((item) => approvalStepLabels[item]).join(', ')} · 요청자와 PM이 등록한 내용을 검토한 뒤 승인합니다.`}
                  </span>
                )}
                {selected.status === 'qc_security' && (
                  <div className="qcSignoffRow">
                    {(['qa', 'security', 'pm'] as const).map((r) => (
                      <span key={r} className={`qcSignoffChip ${qcSignoff[r] ? 'done' : 'pending'}`}>
                        {{ qa: 'QC', security: '보안', pm: 'PM' }[r]} {qcSignoff[r] ? '✓' : '대기'}
                      </span>
                    ))}
                    <span className="approvalGuide">
                      {qcAllSignedOff ? 'QC·보안·PM 검토 완료 · 다음 단계 진행 가능' : `검토 대기: ${qcPendingRoles.map((r) => ({ qa: 'QC', security: '보안', pm: 'PM' }[r])).join(', ')}`}
                    </span>
                  </div>
                )}
                {selected.status === 'completion' && (
                  <span className="approvalGuide">
                    {selected.requesterConfirmed ? '요청자 확인 완료 · 게시 가능' : '요청자 확인 대기 중입니다. 요청자가 결과물을 확인해야 게시할 수 있습니다.'}
                  </span>
                )}
                {selected.status === 'rejected' && (
                  <span className="approvalGuide">반려됨 ({selected.rejectedFromStatus ? statusLabels[selected.rejectedFromStatus] : ''} 단계) · 사유: {selected.rejectedReason}</span>
                )}
              </div>
              <div className="actionButtons">
                {canApproveCurrentRole && (
                  <button className="miniButton approveButton" type="button" onClick={() => void approveCurrentRole()}>
                    {approvalStepLabels[role]} {approvalButtonLabels[role] ?? '승인'}
                  </button>
                )}
                {canQcSignoff && (
                  <button className="miniButton approveButton" type="button" onClick={() => void toggleQcSignoff()}>
                    {myQcSignoffRole ? `${{ qa: 'QC', security: '보안', pm: 'PM' }[myQcSignoffRole]} 검토 ${qcSignoff[myQcSignoffRole] ? '취소' : '완료'}` : 'QC 사인오프(대행)'}
                  </button>
                )}
                {selected.status === 'completion' && (role === 'requester' || role === 'admin') && (
                  <button className="miniButton approveButton" type="button" onClick={() => void confirmByRequester()}>
                    요청자 확인 {selected.requesterConfirmed ? '취소' : '완료'}
                  </button>
                )}
                <button
                  className="primaryButton"
                  type="button"
                  onClick={() => void advanceSelectedProject()}
                  disabled={!canAct || selected.status === 'published' || selected.status === 'rejected' || selected.onHold || isStepAdvanceBlocked}
                >
                  <Send size={16} />
                  단계 진행
                </button>
                {['pm', 'admin'].includes(role) && !['published', 'rejected'].includes(selected.status) && currentStep > 0 && (
                  <button className="miniButton" type="button" onClick={() => void revertSelectedProject()}>
                    이전 단계로
                  </button>
                )}
                {canAct && !['published', 'rejected'].includes(selected.status) && (
                  <button className="miniButton rejectButton" type="button" onClick={() => void rejectSelectedProject()}>
                    반려
                  </button>
                )}
                <button
                  className="miniButton"
                  type="button"
                  onClick={() => void toggleHoldSelectedProject()}
                  disabled={!['pm', 'admin'].includes(role) || ['published', 'rejected'].includes(selected.status)}
                >
                  {selected.onHold ? '보류 해제' : '보류'}
                </button>
              </div>
            </div>

            {blockedTasks.length > 0 && (
              <section className="riskPanel">
                <AlertTriangle size={18} />
                <div>
                  <strong>보류 항목 {blockedTasks.length}개</strong>
                  <p>{blockedTasks.map((task) => task.title).join(', ')} 처리 전에는 다음 단계 일정이 밀릴 수 있습니다.</p>
                </div>
              </section>
            )}

            <div className="bottomGrid">
              <section className="infoPanel">
                <div className="panelHeader compact">
                  <h3>산출물</h3>
                  <FileText size={17} />
                </div>
                <div className="artifactList">
                  <Artifact label="요청 승인 기록" state="승인됨" />
                  <Artifact label="SRS" state={currentStep >= 2 ? '승인됨' : '대기'} />
                  <Artifact label="SDS" state={currentStep >= 3 ? '작성 중' : '대기'} />
                  <Artifact label="완료 보고서" state={currentStep >= 8 ? '게시 준비' : '대기'} />
                </div>
              </section>

              <section className="infoPanel">
                <div className="panelHeader compact">
                  <h3>활동 로그</h3>
                  <MessageSquareText size={17} />
                </div>
                <div className="logList">
                  {selected.logs.map((log) => (
                    <div key={log.id}>
                      <span>{log.at} · {log.actor}</span>
                      <p>{log.message}</p>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
          ) : (
            <EmptyDatabasePanel onCreate={() => setViewMode('request')} loading={loadState === 'loading'} />
          )}
        </section>
        )}
      </main>
      {previewAttachment && (
        <AttachmentPreviewModal
          attachment={previewAttachment}
          onClose={() => setPreviewAttachment(null)}
        />
      )}
    </div>
  )
}

function AttachmentPreviewModal({
  attachment,
  onClose,
}: {
  attachment: { name: string; type: string; dataUrl?: string; size: number }
  onClose: () => void
}) {
  const isImage = attachment.type.startsWith('image/')
  const isPdf = attachment.type === 'application/pdf'
  return (
    <div className="attachmentModalBackdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="attachmentModal" onClick={(event) => event.stopPropagation()}>
        <div className="attachmentModalHeader">
          <strong>{attachment.name}</strong>
          <div className="attachmentModalActions">
            {attachment.dataUrl && (
              <a className="miniButton" href={attachment.dataUrl} download={attachment.name}>다운로드</a>
            )}
            <button className="miniButton" type="button" onClick={onClose}>닫기</button>
          </div>
        </div>
        <div className="attachmentModalBody">
          {!attachment.dataUrl ? (
            <p className="attachmentModalFallback">미리볼 데이터가 없습니다.</p>
          ) : isImage ? (
            <img src={attachment.dataUrl} alt={attachment.name} />
          ) : isPdf ? (
            <iframe src={attachment.dataUrl} title={attachment.name} />
          ) : (
            <p className="attachmentModalFallback">
              이 파일 형식은 미리보기를 지원하지 않습니다. ({attachment.type || '알 수 없는 형식'})<br />
              다운로드 후 확인해주세요.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function EmptyDatabasePanel({ loading, onCreate }: { loading: boolean; onCreate: () => void }) {
  return (
    <div className="detailPanel emptyStatePanel">
      <Database size={34} />
      <h2>{loading ? 'Supabase에서 프로젝트를 불러오는 중입니다.' : '아직 DB에 등록된 프로젝트가 없습니다.'}</h2>
      <p>이 화면은 목업 데이터를 사용하지 않습니다. 새 요청을 등록하면 Supabase `pms_projects` 테이블에 실제 row가 생성됩니다.</p>
      <button className="primaryButton" type="button" onClick={onCreate} disabled={loading}>
        <Plus size={16} />
        새 요청 등록
      </button>
    </div>
  )
}

type DashboardSummary = {
  taskStatus: Record<TaskStatus, number>
  priority: Record<Priority, number>
  statusCounts: Array<(typeof workflow)[number] & { count: number }>
  projectsByStatus: Array<(typeof workflow)[number] & { projects: Project[] }>
  assignedProjects: Project[]
  dueSoon: Project[]
  recent: Project[]
  myQueue: Project[]
}

function DashboardOverview({
  role,
  serviceFilter,
  serviceOptions,
  summary,
  onChangeServiceFilter,
  onOpenProject,
  onOpenStatus,
}: {
  role: Role
  serviceFilter: ServiceFilter
  serviceOptions: string[]
  summary: DashboardSummary
  onChangeServiceFilter: Dispatch<SetStateAction<ServiceFilter>>
  onOpenProject: (projectId: string) => void
  onOpenStatus: (filter: StatusFilter) => void
}) {
  const focusProjects = summary.assignedProjects
  const serviceScopeLabel = serviceFilter === 'all' ? '전체 서비스' : serviceFilter
  const visibleStatuses = summary.projectsByStatus
  const isAdmin = role === 'admin'
  const phaseFor = (index: number) => (index < 3 ? 1 : index < 5 ? 2 : 3)
  const statusCountMap = Object.fromEntries(summary.statusCounts.map((item) => [item.status, item.count])) as Record<ProjectStatus, number>
  const roleDueSoon = role === 'admin' ? summary.dueSoon : summary.dueSoon.filter((project) => isProjectAssignedToRole(project, role))
  const roleRecent = role === 'admin' ? summary.recent : summary.recent.filter((project) => isProjectAssignedToRole(project, role))

  return (
    <section className="dashboardBoard" aria-label="dashboard overview">
      <section className="dashboardPanel workflowOverview">
        <div className="panelHeader compact">
          <div className="workflowSummary">
            <strong>{role === 'admin' ? '전체 단계 흐름' : `${roleLabels[role]} 관점 단계 흐름`}</strong>
            <p>
              {serviceScopeLabel} 기준 · {visibleStatuses.length}개 단계 · {focusProjects.length}개 프로젝트
            </p>
          </div>
          <label className="serviceFilterControl">
            <span>서비스 선택</span>
            <select value={serviceFilter} onChange={(event) => onChangeServiceFilter(event.target.value as ServiceFilter)} aria-label="서비스 선택 필터">
              <option value="all">전체</option>
              {serviceOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="workflowGuideStrip" aria-label="workflow guide">
          <div className="workflowGuideItem">
            <strong>1. 요청 정리</strong>
            <p>요청자가 배경과 목표를 등록하고 PM이 내용을 다듬습니다.</p>
          </div>
          <div className="workflowGuideItem">
            <strong>2. 문서 정리</strong>
            <p>SRS와 SDS를 등록한 뒤 승인자가 같은 기준으로 검토합니다.</p>
          </div>
          <div className="workflowGuideItem">
            <strong>3. 실행/검증</strong>
            <p>승인 이후 개발, QC/보안/PM 검토, 완료보고 순서로 진행합니다. PM이 전 단계 책임자입니다.</p>
          </div>
        </div>
        <div className="dashboardKanban adminScroll">
          {visibleStatuses.map((item, index) => {
            const isOwned = isAdmin || roleOwnsStatus(item.status, role)
            return (
              <section
                key={item.status}
                className={`kanbanColumn phase${phaseFor(index)} ${isOwned ? 'owned' : 'dim'}`}
              >
              <button className="kanbanColumnHeader" type="button" onClick={() => onOpenStatus(item.status)}>
                <div className="kanbanHeaderMeta">
                  <small>{String(index + 1).padStart(2, '0')}</small>
                  <span>{item.label}</span>
                  <em>{item.owner}</em>
                </div>
                <div className="kanbanHeaderCount">
                  <strong>{statusCountMap[item.status]}</strong>
                  {item.optional && <b>선택</b>}
                </div>
              </button>
              <div className="kanbanCardList">
                {item.projects.length === 0 ? (
                  <div className="kanbanEmpty">진행 중인 프로젝트 없음</div>
                ) : (
                  item.projects.map((project) => (
                    <button key={project.id} className={`kanbanCard ${project.onHold ? 'onHold' : ''}`} type="button" onClick={() => onOpenProject(project.id)}>
                      <div className="kanbanCardTop">
                        <span className={`statusPill ${project.status}`}>{statusLabels[project.status]}</span>
                        <span className="requestTypePill">{requestTypeLabels[project.requestType]}</span>
                      </div>
                      <strong>{project.title}</strong>
                      <p>{project.serviceName} · {project.serviceArea}</p>
                      <div className="kanbanMeta">
                        <span>{project.ownerTeam}</span>
                        <span>D-{Math.max(0, daysUntil(project.dueDate, demoToday))}</span>
                        <span>{project.progress}%</span>
                      </div>
                    </button>
                  ))
                )}
              </div>
              </section>
            )
          })}
        </div>
      </section>

      <section className="dashboardPanel dashboardListPanel">
        <div className="panelHeader compact">
          <h2>{role === 'admin' ? '전체 진행 현황' : `${roleLabels[role]} 확인 필요 프로젝트`}</h2>
          <button className="miniButton" type="button" onClick={() => onOpenStatus('mine')}>
            전체 보기
          </button>
        </div>
        <DashboardProjectList projects={summary.myQueue} emptyText={role === 'admin' ? '등록된 프로젝트가 없습니다.' : '현재 역할의 처리 대기 프로젝트가 없습니다.'} onOpenProject={onOpenProject} />
      </section>

      <section className="dashboardPanel dashboardListPanel">
        <div className="panelHeader compact">
          <h2>{role === 'admin' ? '전체 마감 임박' : '마감 임박'}</h2>
          <button className="miniButton" type="button" onClick={() => onOpenStatus('dueSoon')}>
            전체 보기
          </button>
        </div>
        <DashboardProjectList projects={roleDueSoon} emptyText="해당 역할의 마감 임박 프로젝트가 없습니다." onOpenProject={onOpenProject} />
      </section>

      <section className="dashboardPanel dashboardListPanel">
        <div className="panelHeader compact">
          <h2>최근 업데이트</h2>
          <button className="miniButton" type="button" onClick={() => onOpenStatus('all')}>
            전체 보기
          </button>
        </div>
        <DashboardProjectList projects={roleRecent} emptyText="해당 역할의 최근 업데이트가 없습니다." onOpenProject={onOpenProject} />
      </section>
    </section>
  )
}

function DashboardProjectList({
  projects,
  emptyText,
  onOpenProject,
}: {
  projects: Project[]
  emptyText: string
  onOpenProject: (projectId: string) => void
}) {
  if (projects.length === 0) {
    return <p className="dashboardEmpty">{emptyText}</p>
  }

  return (
    <div className="dashboardProjectList">
      {projects.map((project) => (
        <button key={project.id} className="dashboardProjectItem" type="button" onClick={() => onOpenProject(project.id)}>
          <div className="dashboardProjectItemTop">
            <span className={`statusPill ${project.status}`}>{statusLabels[project.status]}</span>
            <span className="requestTypePill">{requestTypeLabels[project.requestType]}</span>
          </div>
          <strong>{project.title}</strong>
          <p>{project.serviceName} · {project.serviceArea}</p>
          <small>
            <span className="metaDday">D-{Math.max(0, daysUntil(project.dueDate, demoToday))}</span>
            <span>{project.ownerTeam}</span>
            <span className="metaTime">{formatDateTime(project.updatedAt)}</span>
          </small>
        </button>
      ))}
    </div>
  )
}

function ProjectTasksPanel({
  project,
  onStatusChange,
  onAddComment,
  onAddTask,
  onPreviewAttachment,
  currentRole,
}: {
  project: Project
  onStatusChange: (taskId: string, status: TaskStatus, statusNote: string) => void
  onAddComment: (taskId: string, message: string) => void
  onAddTask?: (task: ProjectTask) => void
  onPreviewAttachment?: (attachment: { name: string; type: string; dataUrl?: string; size: number }) => void
  currentRole: Role
}) {
  const [statusDrafts, setStatusDrafts] = useState<Record<string, { status: TaskStatus; note: string }>>({})
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({})
  const [openComments, setOpenComments] = useState<Record<string, boolean>>({})
  const [showAddForm, setShowAddForm] = useState(false)
  const [newTask, setNewTask] = useState({ title: '', type: 'task' as IssueType, owner: '', priority: 'normal' as Priority, dueDate: '', note: '' })

  function submitNewTask() {
    if (!onAddTask || !newTask.title.trim()) return
    onAddTask({
      id: crypto.randomUUID(),
      key: `${project.code}-${project.tasks.length + 1}`,
      type: newTask.type,
      title: newTask.title.trim(),
      owner: newTask.owner.trim() || roleLabels[currentRole],
      reporter: roleLabels[currentRole],
      priority: newTask.priority,
      stage: project.status,
      output: '',
      acceptanceCriteria: '',
      estimate: 1,
      dueDate: newTask.dueDate || project.dueDate,
      status: 'todo',
      statusNote: newTask.note.trim(),
      statusChangedAt: new Date().toISOString(),
      attachments: [],
    })
    setNewTask({ title: '', type: 'task', owner: '', priority: 'normal', dueDate: '', note: '' })
    setShowAddForm(false)
  }

  function taskDraft(task: ProjectTask) {
    return statusDrafts[task.id] ?? { status: task.status, note: '' }
  }

  function updateTaskDraft(task: ProjectTask, patch: Partial<{ status: TaskStatus; note: string }>) {
    setStatusDrafts((current) => ({
      ...current,
      [task.id]: {
        ...taskDraft(task),
        ...patch,
      },
    }))
  }

  function submitTaskStatus(task: ProjectTask) {
    const draft = taskDraft(task)
    const note = draft.note.trim()
    if (!note) return
    onStatusChange(task.id, draft.status, note)
    setStatusDrafts((current) => ({
      ...current,
      [task.id]: { status: draft.status, note: '' },
    }))
  }

  const taskSummary = {
    todo: project.tasks.filter((task) => task.status === 'todo').length,
    doing: project.tasks.filter((task) => task.status === 'doing').length,
    blocked: project.tasks.filter((task) => task.status === 'blocked').length,
    done: project.tasks.filter((task) => task.status === 'done').length,
  }

  return (
    <section className="infoPanel taskPanel">
      <div className="panelHeader compact">
        <div>
          <h3>태스크(일감) 목록</h3>
          <p>계획된 작업과 이슈·티켓을 모두 태스크로 관리합니다. 누구나 댓글로 의견을 남길 수 있습니다.</p>
        </div>
        <div className="taskHeaderRight">
          <span className="taskTotal">{project.tasks.length}개</span>
          {onAddTask && (
            <button className="miniButton" type="button" onClick={() => setShowAddForm((v) => !v)}>
              {showAddForm ? '닫기' : '+ 태스크 추가'}
            </button>
          )}
        </div>
      </div>

      {showAddForm && onAddTask && (
        <div className="inlineTaskForm">
          <div className="inlineTaskGrid">
            <input placeholder="태스크 제목" value={newTask.title} onChange={(e) => setNewTask((s) => ({ ...s, title: e.target.value }))} />
            <select value={newTask.type} onChange={(e) => setNewTask((s) => ({ ...s, type: e.target.value as IssueType }))}>
              <option value="task">Task</option>
              <option value="story">Story</option>
              <option value="bug">Bug</option>
              <option value="change">Change</option>
              <option value="epic">Epic</option>
            </select>
            <input placeholder={`담당자 (기본: ${roleLabels[currentRole]})`} value={newTask.owner} onChange={(e) => setNewTask((s) => ({ ...s, owner: e.target.value }))} />
            <select value={newTask.priority} onChange={(e) => setNewTask((s) => ({ ...s, priority: e.target.value as Priority }))}>
              <option value="low">낮음</option>
              <option value="normal">보통</option>
              <option value="high">높음</option>
              <option value="urgent">긴급</option>
            </select>
            <input type="date" value={newTask.dueDate} onChange={(e) => setNewTask((s) => ({ ...s, dueDate: e.target.value }))} />
          </div>
          <input className="inlineTaskNote" placeholder="작업 내용 / 메모" value={newTask.note} onChange={(e) => setNewTask((s) => ({ ...s, note: e.target.value }))} />
          <div className="inlineTaskActions">
            <button className="primaryButton" type="button" onClick={submitNewTask} disabled={!newTask.title.trim()}>등록</button>
          </div>
        </div>
      )}

      <div className="taskSummary" aria-label="task summary">
        <span>대기 {taskSummary.todo}</span>
        <span>진행 {taskSummary.doing}</span>
        <span>보류 {taskSummary.blocked}</span>
        <span>완료 {taskSummary.done}</span>
      </div>

      {project.tasks.length === 0 && (
        <p className="dashboardEmpty">
          이 프로젝트에 등록된 태스크가 없습니다. 상단 "+ 태스크 추가"로 등록하세요.
        </p>
      )}

      <div className="taskList">
        {project.tasks.map((task) => {
          const draft = taskDraft(task)
          const canSaveStatus = draft.note.trim().length > 0 && (draft.status !== task.status || draft.note.trim() !== (task.statusNote ?? '').trim())

          return (
          <div key={task.id} className="taskRow">
            <span className={`taskState ${task.status}`}>{taskLabels[task.status]}</span>
            <div className="taskBody">
              <div className="ticketMeta">
                <span>{task.key ?? project.code}</span>
                <span>{issueTypeLabels[task.type ?? 'task']}</span>
                <span className={`priority ${task.priority ?? 'normal'}`}>{priorityLabels[task.priority ?? 'normal']}</span>
              </div>
              <strong>{task.title}</strong>
              <small>{statusLabels[task.stage ?? project.status]} · 담당 {task.owner} · 보고 {task.reporter ?? project.requester} · {formatDate(task.dueDate)} · {task.estimate ?? 0}pt</small>
              <p>{task.output || '산출물/완료 기준 미입력'}</p>
              <p>{task.acceptanceCriteria || '인수 조건 미입력'}</p>
              <p className="statusNote">최근 상태 메모: {task.statusNote || '아직 기록 없음'}</p>
              {(task.attachments?.length ?? 0) > 0 && (
                <div className="taskAttachments" aria-label={`${task.title} 첨부 파일`}>
                  {task.attachments?.map((attachment) => (
                    onPreviewAttachment ? (
                      <button
                        key={attachment.id}
                        type="button"
                        className="attachmentChip attachmentLink"
                        onClick={() => onPreviewAttachment({ name: attachment.name, type: attachment.type, dataUrl: attachment.dataUrl, size: attachment.size })}
                      >
                        <Paperclip size={13} />
                        {attachment.name}
                      </button>
                    ) : attachment.dataUrl ? (
                      <a key={attachment.id} href={attachment.dataUrl} download={attachment.name}>
                        <Paperclip size={13} />
                        {attachment.name}
                      </a>
                    ) : (
                      <span key={attachment.id}>
                        <Paperclip size={13} />
                        {attachment.name}
                      </span>
                    )
                  ))}
                </div>
              )}
            </div>
            <div className="taskStatusControl">
              <select value={draft.status} onChange={(event) => updateTaskDraft(task, { status: event.target.value as TaskStatus })} aria-label={`${task.title} 상태`}>
                <option value="todo">대기</option>
                <option value="doing">진행</option>
                <option value="blocked">보류</option>
                <option value="done">완료</option>
              </select>
              <input value={draft.note} onChange={(event) => updateTaskDraft(task, { note: event.target.value })} placeholder="상태 변경 내용 입력" aria-label={`${task.title} 상태 변경 내용`} />
              <button className="miniButton" type="button" onClick={() => submitTaskStatus(task)} disabled={!canSaveStatus}>
                저장
              </button>
            </div>
            <div className="taskComments">
              <button
                type="button"
                className="miniButton commentToggle"
                onClick={() => setOpenComments((current) => ({ ...current, [task.id]: !current[task.id] }))}
              >
                💬 댓글 {task.comments?.length ?? 0}
              </button>
              {openComments[task.id] && (
                <div className="commentThread">
                  {(task.comments ?? []).length === 0 ? (
                    <p className="docAttachmentEmpty">아직 댓글이 없습니다. 의견을 첫 번째로 남겨보세요.</p>
                  ) : (
                    <ul className="commentList">
                      {(task.comments ?? []).map((comment) => (
                        <li key={comment.id}>
                          <div className="commentMeta">
                            <strong>{comment.actor}</strong>
                            <span>{formatDateTime(comment.at)}</span>
                          </div>
                          <p>{comment.message}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                  <form
                    className="commentForm"
                    onSubmit={(event) => {
                      event.preventDefault()
                      const text = (commentDrafts[task.id] ?? '').trim()
                      if (!text) return
                      onAddComment(task.id, text)
                      setCommentDrafts((current) => ({ ...current, [task.id]: '' }))
                    }}
                  >
                    <input
                      value={commentDrafts[task.id] ?? ''}
                      onChange={(event) => setCommentDrafts((current) => ({ ...current, [task.id]: event.target.value }))}
                      placeholder={`${roleLabels[currentRole]}로 의견 남기기`}
                    />
                    <button className="miniButton" type="submit">등록</button>
                  </form>
                </div>
              )}
            </div>
          </div>
          )
        })}
      </div>
    </section>
  )
}

function RequestIntakePanel({
  form,
  serviceOptions,
  setForm,
  onSubmit,
}: {
  form: RequestFormState
  serviceOptions: string[]
  setForm: Dispatch<SetStateAction<RequestFormState>>
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  const config = requestTypeOptions.find((item) => item.type === form.requestType) ?? requestTypeOptions[0]
  const requestApprovalRoles = approvalRolesByRequestType[form.requestType]
  const fieldRules = requestFieldRules[form.requestType] ?? {}

  function updateField<K extends keyof RequestFormState>(field: K, value: RequestFormState[K]) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  return (
    <section className="requestPanel">
      <div className="requestIntro">
        <p className="eyebrow">Request Intake</p>
        <h2>{config.title}</h2>
        <p>{config.intro}</p>
      </div>
      <div className="requestFlowGuide" aria-label="request review guide">
        <div className="requestFlowStep">
          <strong>1. 요청자 작성</strong>
          <p>문제, 목표, 범위, 희망 일정까지 한 번에 정리합니다.</p>
        </div>
        <div className="requestFlowStep">
          <strong>2. PM 보완</strong>
          <p>승인자들이 판단할 수 있도록 범위와 리스크를 다듬습니다.</p>
        </div>
        <div className="requestFlowStep">
          <strong>3. 역할별 승인 검토</strong>
          <p>PM, CEM, 정보보호, 인프라, QA, 특허, 최종 승인자가 같은 기준으로 봅니다.</p>
        </div>
      </div>

      <form className="requestForm" onSubmit={onSubmit}>
        <fieldset>
          <legend>요청 분류</legend>
          <p className="fieldHint">요청 성격을 먼저 고르면 입력 문구와 승인 흐름이 맞춰집니다.</p>
          <div className="requestTypeSelector" role="tablist" aria-label="요청 분류 선택">
            {requestTypeOptions.map((item) => (
              <button
                key={item.type}
                className={`requestTypeButton ${form.requestType === item.type ? 'active' : ''}`}
                type="button"
                onClick={() => updateField('requestType', item.type)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <p className="requestTypeHint">{config.intro}</p>
          <div className="approvalPreset">
            <strong>승인 필요 역할</strong>
            <div className="approvalSummary">
              {requestApprovalRoles.map((item) => (
                <span key={item} className="approvalPill pending">
                  {approvalStepLabels[item]}
                </span>
              ))}
            </div>
            <p className="approvalGuide">이 요청 유형은 위 역할의 승인 완료 후 다음 단계로 진행됩니다.</p>
          </div>
        </fieldset>

        <fieldset>
          <legend>기본 정보</legend>
          <p className="fieldHint">누가 요청했고 어떤 서비스와 범위에 대한 요청인지 먼저 분명하게 남깁니다.</p>
          <div className="formGrid two">
            <label>
              <span>요청 제목</span>
              <input required value={form.title} onChange={(event) => updateField('title', event.target.value)} placeholder={config.titlePlaceholder} />
            </label>
            <label>
              <span>{config.serviceLabel}</span>
              {fieldRules.serviceFreeText ? (
                <input
                  value={form.serviceName}
                  onChange={(event) => updateField('serviceName', event.target.value)}
                  placeholder="예: 신규 출시 예정 서비스명"
                />
              ) : (
                <select value={form.serviceName} onChange={(event) => updateField('serviceName', event.target.value)}>
                  {serviceOptions.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              )}
            </label>
            <label>
              <span>{config.areaLabel}</span>
              <input required value={form.serviceArea} onChange={(event) => updateField('serviceArea', event.target.value)} placeholder="예: 체크아웃/PG, 알림, 정산" />
            </label>
            <label>
              <span>요청 부서</span>
              <input required value={form.ownerTeam} onChange={(event) => updateField('ownerTeam', event.target.value)} placeholder="예: 영업, 운영, 마케팅" />
            </label>
            <label>
              <span>요청자</span>
              <input required value={form.requester} onChange={(event) => updateField('requester', event.target.value)} />
            </label>
            <label>
              <span>희망 완료일{fieldRules.dueDateOptional ? ' (선택)' : ''}</span>
              <input
                required={!fieldRules.dueDateOptional}
                type="date"
                value={form.dueDate}
                onChange={(event) => updateField('dueDate', event.target.value)}
              />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>요구사항 이해</legend>
          <p className="fieldHint">요청자와 PM이 이후 승인자, 개발, QC, 보안이 함께 참고할 기준 정보를 정리합니다.</p>
          <div className="formGrid">
            <label>
              <span>{config.summaryLabel}</span>
              <textarea required value={form.summary} onChange={(event) => updateField('summary', event.target.value)} placeholder={config.summaryPlaceholder} />
            </label>
            <label>
              <span>{config.problemLabel}</span>
              <textarea required value={form.currentProblem} onChange={(event) => updateField('currentProblem', event.target.value)} placeholder={config.problemPlaceholder} />
            </label>
            <label>
              <span>{config.outcomeLabel}</span>
              <textarea required value={form.desiredOutcome} onChange={(event) => updateField('desiredOutcome', event.target.value)} placeholder={config.outcomePlaceholder} />
            </label>
            <label>
              <span>{config.metricLabel}{fieldRules.metricOptional ? ' (선택)' : ''}</span>
              <textarea
                required={!fieldRules.metricOptional}
                value={form.successMetric}
                onChange={(event) => updateField('successMetric', event.target.value)}
                placeholder={config.metricPlaceholder}
              />
            </label>
            <label>
              <span>{config.audienceLabel}</span>
              <input required value={form.affectedUsers} onChange={(event) => updateField('affectedUsers', event.target.value)} placeholder={config.audiencePlaceholder} />
            </label>
            <label>
              <span>{config.riskLabel}</span>
              <textarea value={form.risk} onChange={(event) => updateField('risk', event.target.value)} placeholder={config.riskPlaceholder} />
            </label>
          </div>
        </fieldset>

        <div className="requestFooter">
          <label>
            <span>우선순위</span>
            <select value={form.priority} onChange={(event) => updateField('priority', event.target.value as Priority)}>
              <option value="low">낮음</option>
              <option value="normal">보통</option>
              <option value="high">높음</option>
              <option value="urgent">긴급</option>
            </select>
          </label>
          <button className="primaryButton" type="submit">
            <Send size={16} />
            요청 등록
          </button>
        </div>
      </form>
    </section>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function DocAttachmentField({
  label,
  attachments,
  onChange,
  onPreview,
}: {
  label: string
  attachments: import('./types').ReviewDocAttachment[]
  onChange: (next: import('./types').ReviewDocAttachment[]) => void
  onPreview?: (attachment: { name: string; type: string; dataUrl?: string; size: number }) => void
}) {
  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const fileArray = Array.from(files)
    const readers = fileArray.map(
      (file) =>
        new Promise<import('./types').ReviewDocAttachment>((resolve) => {
          const reader = new FileReader()
          reader.onload = () => {
            resolve({
              id: crypto.randomUUID(),
              name: file.name,
              size: file.size,
              type: file.type || 'application/octet-stream',
              dataUrl: typeof reader.result === 'string' ? reader.result : undefined,
              uploadedAt: new Date().toISOString(),
            })
          }
          reader.readAsDataURL(file)
        }),
    )
    void Promise.all(readers).then((items) => onChange([...attachments, ...items]))
  }

  return (
    <div className="docAttachmentField">
      <div className="docAttachmentHeader">
        <strong>{label}</strong>
        <label className="miniButton uploadButton">
          파일 추가
          <input
            type="file"
            multiple
            hidden
            onChange={(event) => {
              handleFiles(event.target.files)
              event.target.value = ''
            }}
          />
        </label>
      </div>
      {attachments.length === 0 ? (
        <p className="docAttachmentEmpty">첨부된 문서가 없습니다.</p>
      ) : (
        <ul className="docAttachmentList">
          {attachments.map((file) => (
            <li key={file.id}>
              {onPreview ? (
                <button
                  type="button"
                  className="attachmentLink"
                  onClick={() => onPreview({ name: file.name, type: file.type, dataUrl: file.dataUrl, size: file.size })}
                >
                  {file.name}
                </button>
              ) : (
                <a href={file.dataUrl} download={file.name}>{file.name}</a>
              )}
              <span>{formatBytes(file.size)}</span>
              <button
                type="button"
                className="miniButton"
                onClick={() => onChange(attachments.filter((item) => item.id !== file.id))}
              >
                삭제
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function StageInquiryPanel({
  project,
  currentRole,
  onAddComment,
}: {
  project: Project
  currentRole: Role
  onAddComment: (message: string) => void
}) {
  const [draft, setDraft] = useState('')
  const [stageFilter, setStageFilter] = useState<'all' | ProjectStatus>('all')
  const comments = project.comments ?? []
  const filtered = stageFilter === 'all' ? comments : comments.filter((c) => c.stage === stageFilter)
  const stagesWithComments = Array.from(new Set(comments.map((c) => c.stage)))

  return (
    <div className="stageInquiry">
      <div className="inquiryFilterRow">
        <button type="button" className={stageFilter === 'all' ? 'active' : ''} onClick={() => setStageFilter('all')}>
          전체 {comments.length}
        </button>
        {stagesWithComments.map((stage) => (
          <button key={stage} type="button" className={stageFilter === stage ? 'active' : ''} onClick={() => setStageFilter(stage)}>
            {statusLabels[stage]} {comments.filter((c) => c.stage === stage).length}
          </button>
        ))}
      </div>

      <div className="inquiryList">
        {filtered.length === 0 ? (
          <p className="docAttachmentEmpty">아직 등록된 문의가 없습니다. 단계 진행 중 궁금한 점을 남겨보세요.</p>
        ) : (
          filtered
            .slice()
            .reverse()
            .map((comment) => (
              <div key={comment.id} className="inquiryItem">
                <div className="inquiryMeta">
                  <span className={`statusPill ${comment.stage}`}>{statusLabels[comment.stage]}</span>
                  <strong>{comment.actor}</strong>
                  <em>{roleLabels[comment.role]}</em>
                  <span className="inquiryTime">{formatDateTime(comment.at)}</span>
                </div>
                <p>{comment.message}</p>
              </div>
            ))
        )}
      </div>

      <form
        className="inquiryForm"
        onSubmit={(event) => {
          event.preventDefault()
          if (!draft.trim()) return
          onAddComment(draft)
          setDraft('')
        }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={`[${statusLabels[project.status]}] 단계 기준 · ${roleLabels[currentRole]}로 문의/의견 남기기`}
        />
        <button className="primaryButton" type="submit" disabled={!draft.trim()}>등록</button>
      </form>
    </div>
  )
}

function RequirementBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="requirementBlock">
      <span>{label}</span>
      <RichTextView html={value} fallback="(미입력)" />
    </div>
  )
}

function SettingsPanel({
  serviceOptions,
  setServiceOptions,
  projects,
  onToggleHold,
  onPurgeDemoTasks,
  onDeleteProject,
}: {
  serviceOptions: string[]
  setServiceOptions: (nextOptions: string[]) => void
  projects: Project[]
  onToggleHold: (projectId: string) => void
  onPurgeDemoTasks: (keepKeys: string[]) => void
  onDeleteProject: (projectId: string) => void
}) {
  const [draft, setDraft] = useState('')
  const [holdFilter, setHoldFilter] = useState<'all' | 'onHold' | 'active'>('all')
  const [purgeKeyInput, setPurgeKeyInput] = useState('PMS-2026-001-4')

  function addService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const next = draft.trim()
    if (!next) return
    if (serviceOptions.includes(next)) {
      setDraft('')
      return
    }
    setServiceOptions([...serviceOptions, next])
    setDraft('')
  }

  function removeService(target: string) {
    if (serviceOptions.length <= 1) return
    setServiceOptions(serviceOptions.filter((item) => item !== target))
  }

  return (
    <section className="requestPanel settingsPanel">
      <div className="requestIntro">
        <p className="eyebrow">Settings</p>
        <h2>개선할 서비스 목록 관리</h2>
        <p>새 요청의 서비스 선택과 대시보드 서비스 필터에서 공통으로 사용하는 목록입니다.</p>
      </div>

      <div className="settingsSection">
        <div className="panelHeader compact">
          <div>
            <h3>서비스 목록</h3>
            <p>현재 등록된 서비스는 {serviceOptions.length}개입니다.</p>
          </div>
        </div>

        <div className="serviceList">
          {serviceOptions.map((item) => (
            <div key={item} className="serviceListItem">
              <strong>{item}</strong>
              <button className="miniButton" type="button" onClick={() => removeService(item)} disabled={serviceOptions.length <= 1}>
                삭제
              </button>
            </div>
          ))}
        </div>

        <form className="serviceAddForm" onSubmit={addService}>
          <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="서비스 추가" aria-label="서비스 추가" />
          <button className="primaryButton" type="submit">
            <Plus size={16} />
            추가
          </button>
        </form>
      </div>

      <div className="settingsSection">
        <div className="panelHeader compact">
          <div>
            <h3>프로젝트 관리</h3>
            <p>전체 프로젝트({projects.length}개)의 보류 토글 및 삭제를 관리합니다. 삭제는 되돌릴 수 없습니다.</p>
          </div>
          <div className="filterChips">
            {([
              { key: 'all', label: '전체' },
              { key: 'onHold', label: '보류 중' },
              { key: 'active', label: '진행 중' },
            ] as const).map((item) => (
              <button
                key={item.key}
                type="button"
                className={holdFilter === item.key ? 'active' : ''}
                onClick={() => setHoldFilter(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="projectHoldList">
          {projects
            .filter((project) => {
              if (holdFilter === 'onHold') return project.onHold
              if (holdFilter === 'active') return !project.onHold && !['published', 'rejected'].includes(project.status)
              return true
            })
            .map((project) => {
              const disabled = ['published', 'rejected'].includes(project.status)
              return (
                <div key={project.id} className={`projectHoldRow ${project.onHold ? 'onHold' : ''}`}>
                  <div className="projectHoldInfo">
                    <div className="projectHoldTop">
                      <span className={`statusPill ${project.status}`}>{statusLabels[project.status]}</span>
                      <span className="requestTypePill">{requestTypeLabels[project.requestType]}</span>
                      {project.onHold && <span className="holdTag">보류</span>}
                    </div>
                    <strong>{project.title}</strong>
                    <small>{project.serviceName} · {project.ownerTeam} · D-{Math.max(0, daysUntil(project.dueDate, demoToday))}</small>
                    {project.onHold && project.holdReason && <em>사유: {project.holdReason}</em>}
                  </div>
                  <div className="projectManageActions">
                    <button
                      className="miniButton"
                      type="button"
                      disabled={disabled}
                      onClick={() => onToggleHold(project.id)}
                    >
                      {project.onHold ? '보류 해제' : '보류'}
                    </button>
                    <button
                      className="miniButton rejectButton"
                      type="button"
                      onClick={() => {
                        if (window.confirm(`"${project.title}" 프로젝트를 삭제합니다. 되돌릴 수 없습니다. 계속할까요?`)) {
                          onDeleteProject(project.id)
                        }
                      }}
                    >
                      삭제
                    </button>
                  </div>
                </div>
              )
            })}
          {projects.length === 0 && <p className="emptyText">등록된 프로젝트가 없습니다.</p>}
        </div>
      </div>

      <div className="settingsSection">
        <div className="panelHeader compact">
          <div>
            <h3>데모 태스크 일괄 삭제</h3>
            <p>아래 키 목록에 해당하는 태스크만 남기고 나머지는 전부 삭제합니다. 콤마로 여러 키 입력 가능.</p>
          </div>
        </div>
        <div className="serviceAddForm">
          <input
            value={purgeKeyInput}
            onChange={(event) => setPurgeKeyInput(event.target.value)}
            placeholder="예: PMS-2026-001-4"
            aria-label="유지할 태스크 키"
          />
          <button
            className="primaryButton"
            type="button"
            onClick={() => {
              const keepKeys = purgeKeyInput.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
              const totalTasks = projects.reduce((sum, project) => sum + project.tasks.length, 0)
              const keepCount = projects.reduce(
                (sum, project) => sum + project.tasks.filter((task) => task.key && keepKeys.includes(task.key)).length,
                0,
              )
              const purgeCount = totalTasks - keepCount
              if (purgeCount === 0) {
                window.alert('삭제 대상 태스크가 없습니다.')
                return
              }
              if (!window.confirm(`전체 ${totalTasks}개 태스크 중 ${purgeCount}개를 삭제합니다. 계속할까요?`)) return
              onPurgeDemoTasks(keepKeys)
            }}
          >
            정리 실행
          </button>
        </div>
      </div>
    </section>
  )
}

function Metric({ icon, label, value, tone, onClick }: { icon: ReactNode; label: string; value: number; tone: string; onClick: () => void }) {
  return (
    <button className={`metric ${tone}`} type="button" onClick={onClick}>
      <div>{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </button>
  )
}

function Artifact({ label, state }: { label: string; state: string }) {
  return (
    <div className="artifact">
      <FileText size={16} />
      <span>{label}</span>
      <strong>{state}</strong>
      <ChevronRight size={15} />
    </div>
  )
}

function nextRoleFor(status: ProjectStatus): Role {
  const roleMap: Partial<Record<ProjectStatus, Role>> = {
    dept_review: 'pm',
    planning: 'pm',
    schedule: 'pm',
    development: 'developer',
    qc_security: 'qa',
    completion: 'admin',
    published: 'admin',
  }
  return roleMap[status] ?? 'requester'
}

function nextActionFor(status: ProjectStatus) {
  const actionMap: Partial<Record<ProjectStatus, string>> = {
    dept_review: '승인 의견 취합',
    planning: '기획 문서(SRS+SDS) 작성 후 승인 단계로 이동',
    schedule: '개발 준비와 일정 확정',
    development: '개발 태스크 진행',
    qc_security: '품질/보안 검사 및 PM 인수 확인',
    completion: '완료 보고서 작성',
    published: '그룹웨어 게시 확인',
  }
  return actionMap[status] ?? '요청 내용 보완'
}

function daysUntil(date: string, from: Date) {
  const target = new Date(`${date}T23:59:59+09:00`)
  return Math.ceil((target.getTime() - from.getTime()) / 86_400_000)
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric' }).format(new Date(date))
}

function formatDateTime(date: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date))
}

export default App
