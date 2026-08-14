import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type ReactNode, type SetStateAction } from 'react'
import {
  AlertTriangle,
  BarChart3,
  Bell,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CornerDownRight,
  ClipboardList,
  Database,
  Download,
  FileText,
  LayoutDashboard,
  ListChecks,
  MessageSquareText,
  Paperclip,
  Plus,
  Search,
  Send,
  Shield,
  SlidersHorizontal,
  Users,
  Workflow,
} from 'lucide-react'
import './App.css'
import { RichEditor, RichTextView } from './RichEditor'
import { notifyGoogleChat } from './notify'
import {
  BOARD_POST_FAIL_PREFIX,
  BOARD_POST_OK_PREFIX,
  buildCompletionBody,
  buildCompletionTitle,
  buildOfficePostUrl,
  DEFAULT_OFFICE_POST_PATH,
  getOfficeProxyUrl,
  hasBeenPostedToBoard,
  isOfficeBoardConfigured,
  isOfficeProxyMode,
  officeApiStorageKey,
  postToOfficeBoard,
  readOfficeApiConfig,
  testOfficeBoardConnection,
  validateOfficeBaseUrl,
  type OfficeApiConfig,
} from './officeBoard'
import { roleLabels, stageBaselineProgress, workflow } from './data'
import {
  deleteProject as deleteProjectDoc,
  deleteProjects as deleteProjectsDoc,
  fetchProjects,
  fetchAccessLogs,
  hasFirebaseConfig,
  insertProject,
  updateProject as updateProjectDoc,
  writeAccessLog,
  type AccessLogEntry,
  type ProjectRow,
} from './projectsRepo'
import { registerWithEmail, signInWithEmail } from './authRepo'
import { resolveAttachmentUrl, uploadAttachment } from './storage'
import type { ApprovalState, DeploymentState, IssueType, Priority, Project, ProjectRequestType, ProjectStatus, ProjectTask, QcSignoffRole, QcSignoffState, ReviewDocs, Role, ScheduleInfo, SecurityReview, TaskAttachment, TaskStatus, WorkflowConfig } from './types'

const statusLabels: Record<ProjectStatus, string> = {
  request: '요청 단계',
  dept_review: '승인 단계',
  planning: '기획 단계',
  development: '개발 단계',
  qc_security: '검토 단계',
  deployment: '배포 단계',
  completion: '완료 보고',
  rejected: '반려',
}

// 모바일 리스트 카드용 짧은 단계 라벨('단계' 생략) — PC는 statusLabels 사용
const shortStatusLabels: Record<ProjectStatus, string> = {
  request: '요청',
  dept_review: '승인',
  planning: '기획',
  development: '개발',
  qc_security: '검토',
  deployment: '배포',
  completion: '완료',
  rejected: '반려',
}

const approvalStepLabels: Record<Role, string> = {
  requester: '요청자',
  sales: '영업',
  marketing: '마케팅',
  pm: 'PM',
  cem: 'CEM',
  developer: '개발',
  qa: 'QA',
  security: '정보보호',
  infra: '인프라',
  patent: '특허',
  admin: '최종',
}

const priorityLabels: Record<Priority, string> = {
  low: '낮음',
  normal: '보통',
  high: '높음',
  urgent: '긴급',
}

// 자주 쓰는 반려 사유 프리셋
const rejectReasonPresets = [
  '요구사항이 불명확합니다. 상세 내용을 보완해 주세요.',
  '우선순위/일정이 현 분기 계획과 맞지 않습니다.',
  '보안·개인정보 검토 기준을 충족하지 못했습니다.',
  '유사 기능과 중복됩니다. 기존 기능으로 대응 가능합니다.',
  '예산·리소스 확보가 어렵습니다.',
  '성공 기준(지표)이 측정 가능하지 않습니다.',
]

const taskLabels: Record<TaskStatus, string> = {
  todo: '대기',
  doing: '진행',
  blocked: '보류',
  done: '완료',
}

const defaultServiceOptions = ['카피킬러', '프리즘', '몬스터']
const serviceOptionsStorageKey = 'pms-service-options'
const sessionStateStorageKey = 'pms-session-state'

// ── DB 계정 인증 ──────────────────────────────────────────────
// 로그인한 계정 정보 (비밀번호는 보관하지 않음)
export type Account = { id: string; email: string; fullName: string; role: Role }

// ⚠️ 임시 데모 모드: 로그인 페이지를 건너뛰고 바로 접속. (다시 로그인 강제하려면 false)
const DEV_NO_LOGIN = true
const DEV_ACCOUNT: Account = { id: 'demo', email: 'demo@local', fullName: '데모', role: 'admin' }
const accountStorageKey = 'pms-account'
const sessionStartStorageKey = 'pms-session-start'
const sessionTimeoutStorageKey = 'pms-session-timeout'
const DEFAULT_SESSION_TIMEOUT_MIN = 60

function getStoredSessionTimeoutMin(): number {
  try {
    const stored = window.localStorage.getItem(sessionTimeoutStorageKey)
    if (stored) {
      const m = Number(stored)
      if (Number.isFinite(m) && m >= 5 && m <= 480) return m
    }
  } catch {
    return DEFAULT_SESSION_TIMEOUT_MIN
  }
  return DEFAULT_SESSION_TIMEOUT_MIN
}

// localStorage에서 계정 복원. 세션 타임아웃이 지났으면 만료 처리하고 null 반환.
function loadStoredAccount(): Account | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(accountStorageKey)
    if (!raw) return null
    const startRaw = window.localStorage.getItem(sessionStartStorageKey)
    const start = startRaw ? Number(startRaw) : NaN
    const maxMs = getStoredSessionTimeoutMin() * 60 * 1000
    if (!Number.isFinite(start) || Date.now() - start >= maxMs) {
      window.localStorage.removeItem(accountStorageKey)
      window.localStorage.removeItem(sessionStartStorageKey)
      return null
    }
    return JSON.parse(raw) as Account
  } catch {
    return null
  }
}

// 로그인 성공 시 계정 + 세션 시작 시각 저장
function storeAccount(account: Account) {
  window.localStorage.setItem(accountStorageKey, JSON.stringify(account))
  window.localStorage.setItem(sessionStartStorageKey, String(Date.now()))
}

function clearStoredAccount() {
  window.localStorage.removeItem(accountStorageKey)
  window.localStorage.removeItem(sessionStartStorageKey)
}

function readSessionState(): { viewMode?: ViewMode; role?: Role; selectedId?: string } {
  if (typeof window === 'undefined') return {}
  try {
    const saved = window.localStorage.getItem(sessionStateStorageKey)
    return saved ? JSON.parse(saved) : {}
  } catch {
    return {}
  }
}
type ServiceFilter = 'all' | string

const issueTypeLabels: Record<IssueType, string> = {
  epic: '에픽',
  story: '스토리',
  task: '작업',
  bug: '버그',
  change: '변경',
  vulnerability: '취약점',
}

// 단계별 일감 유형: 개발=작업/버그/변경, 검토=버그/취약점/변경(작업 제외)
const issueTypesByStage: Partial<Record<ProjectStatus, IssueType[]>> = {
  development: ['task', 'bug', 'change'],
  qc_security: ['bug', 'vulnerability', 'change'],
}
// 검토 단계에서 역할별 기본 유형: QA=버그, 보안=취약점, PM/기획=변경
const defaultIssueTypeByRole: Partial<Record<Role, IssueType>> = {
  qa: 'bug',
  security: 'vulnerability',
  pm: 'change',
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

const fullApprovalRoles: Role[] = ['cem', 'developer', 'security', 'infra', 'qa', 'patent']

// ── 검토 단계 사인오프 ────────────────────────────────────────────────────
// 순서: 개발자 단위테스트 → QA 통합테스트. 보안 테스트는 테스트 결과에 종속되지
// 않으므로(코드·설정·의존성 점검) 병행 가능. PM은 SRS 대조 검토로 언제든 가능.
const qcSignoffRoles: QcSignoffRole[] = ['developer', 'qa', 'security', 'pm']
const emptyQcSignoff: QcSignoffState = { developer: false, qa: false, security: false, pm: false }
const emptyDeployment: DeploymentState = { released: false }
const qcSignoffLabels: Record<QcSignoffRole, string> = {
  developer: '개발',
  qa: 'QA',
  security: '보안',
  pm: 'PM',
}
// 각 역할이 검토 단계에서 수행하는 작업 (버튼·입력 안내용)
const qcSignoffWork: Record<QcSignoffRole, string> = {
  developer: '단위테스트',
  qa: '통합테스트',
  security: '보안테스트',
  pm: 'SRS 대조 검토',
}
// 카드 제목·대기 목록 표시명 (역할명과 작업명이 중복되지 않게 별도 관리)
const qcSignoffTitles: Record<QcSignoffRole, string> = {
  developer: '개발 단위테스트',
  qa: 'QA 통합테스트',
  security: '보안테스트',
  pm: 'PM 검토 (SRS 대조)',
}

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

// 요청 분류별 기획(SRS/SDS) 단계 필요 여부.
// 가벼운 요청(버그/운영변경/데이터·리포트/인프라)은 기획 문서 없이 바로 승인으로 진행.
const planningRequiredByType: Record<ProjectRequestType, boolean> = {
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

// 프로젝트별 기획 필요 여부: workflowConfig 토글이 있으면 우선, 없으면 분류 기본값
function isPlanningRequired(project: Pick<Project, 'requestType' | 'workflowConfig'>): boolean {
  return project.workflowConfig?.requiresPlanning ?? planningRequiredByType[project.requestType]
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

// 가입 시 선택 가능한 역할 — '요청자'는 별도 선택지로 두지 않음(영업·마케팅이 요청자 역할을 겸함)
const activeRoles: Role[] = ['sales', 'marketing', 'pm', 'cem', 'developer', 'security', 'infra', 'qa', 'patent', 'admin']
// 요청자 성격의 역할 — 영업·마케팅은 주로 요청자이며, 요청자와 동일하게 요청을 만들고 추적함
const requesterRoles: Role[] = ['requester', 'sales', 'marketing']
function isRequesterRole(role: Role) {
  return requesterRoles.includes(role)
}
const demoToday = new Date('2026-05-17T09:00:00+09:00')

type ViewMode = 'dashboard' | 'requestFlow' | 'pipeline' | 'flow' | 'settings' | 'allProjects' | 'auditLog'

type NotificationItem = {
  id: string
  kind: 'approval' | 'qc' | 'due' | 'overdue' | 'new_request'
  tone: 'action' | 'overdue' | 'soon'
  projectId: string
  projectTitle: string
  text: string
}
type StatusFilter = ProjectStatus | 'all' | 'allProjects' | 'active' | 'dueSoon' | 'mine' | 'queue' | 'preDev' | 'inProgress' | 'myWork' | 'risk' | 'blocked'

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
  selectedApprovalRoles: Role[]
  securityReview: SecurityReview
}

function isProjectAssignedToRole(project: Project, role: Role) {
  // 관리자의 실제 처리 차례는 '완료 보고' 단계뿐 — 그 외 단계는 내 할 일이 아님
  if (role === 'admin') return project.status === 'completion'
  if (project.status === 'dept_review') {
    // 이미 승인한 역할은 더 이상 '내 할 일'이 아님 — 미승인 필수 역할에게만 노출
    return project.approvalState.requiredRoles.includes(role) && !project.approvalState.approvedRoles.includes(role)
  }
  return (
    project.assigneeRole === role ||
    // 요청자에게 배정된 단계는 영업·마케팅도 본인 할 일로 봄
    (project.assigneeRole === 'requester' && isRequesterRole(role)) ||
    // 검토 단계는 개발(단위테스트)·QA(통합테스트)·보안·PM 4자가 모두 담당
    (project.status === 'qc_security' && qcSignoffRoles.includes(role as QcSignoffRole)) ||
    // 배포 단계는 인프라 담당
    (project.status === 'deployment' && role === 'infra')
  )
}

// 단계별로 해당 역할이 실제로 '처리'하는 차례인지 — 대시보드 단계 컬럼 활성화 기준
function roleActsOnStatus(role: Role, status: ProjectStatus): boolean {
  if (role === 'admin') return status === 'completion'
  switch (status) {
    case 'request':
      return isRequesterRole(role)
    case 'planning':
      return role === 'pm' || isRequesterRole(role)
    case 'dept_review':
      return fullApprovalRoles.includes(role)
    case 'development':
      return role === 'pm' || role === 'developer'
    case 'qc_security':
      // 개발(단위테스트) 포함 4자
      return qcSignoffRoles.includes(role as QcSignoffRole)
    case 'deployment':
      // 배포 승인·실행은 인프라 (PM·관리자는 대행)
      return role === 'infra' || role === 'pm'
    case 'completion':
      return role === 'pm'
    default:
      return false
  }
}

function isProjectRelevantToRole(project: Project, role: Role, currentName?: string) {
  if (role === 'admin') return true
  // 요청자(영업·마케팅 포함)는 "본인이 올린 요청"만 모든 단계에서 추적·열람한다.
  // (실제 작업/진행 권한은 canAct로 별도 제어 — 승인·개발 단계에서는 열람만 가능)
  if (isRequesterRole(role)) return Boolean(currentName) && project.requester === currentName
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
  selectedApprovalRoles: approvalRolesByRequestType['improvement'],
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

const emptySchedule: ScheduleInfo = {
  plannedStart: '',
  plannedEnd: '',
  milestones: '',
  note: '',
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
  const restoredSession = readSessionState()
  const [projects, setProjects] = useState<Project[]>([])
  // 비동기 작업(게시판 전송 등) 완료 후 최신 프로젝트를 읽기 위한 ref.
  // await 전에 캡처한 project 객체로 logs를 덮으면 그 사이의 로그가 유실된다.
  const projectsRef = useRef(projects)
  useEffect(() => { projectsRef.current = projects }, [projects])
  const [selectedId, setSelectedId] = useState(restoredSession.selectedId ?? '')
  const [role, setRole] = useState<Role>(restoredSession.role ?? (DEV_NO_LOGIN ? 'admin' : 'requester'))
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
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('queue')
  // 대시보드 카드 클릭 등으로 특정 프로젝트 1건만 보여줄 때 사용(다른 필터·검색·내비게이션 시 해제)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  // 프로젝트 목록 옆 단계(상태) 필터
  const [listStatusFilter, setListStatusFilter] = useState<ProjectStatus | 'all'>('all')
  // 추가 다중 필터: 담당 팀 / 우선순위 / 요청 유형
  const [listTeamFilter, setListTeamFilter] = useState<string>('all')
  const [listPriorityFilter, setListPriorityFilter] = useState<Priority | 'all'>('all')
  const [listTypeFilter, setListTypeFilter] = useState<ProjectRequestType | 'all'>('all')
  const [listServiceFilter, setListServiceFilter] = useState<string>('all')
  // 모바일: 필터 bottom sheet 열림 여부 (데스크톱은 항상 인라인 노출)
  const [filterSheetOpen, setFilterSheetOpen] = useState(false)
  const [loadState, setLoadState] = useState<'loading' | 'live' | 'error'>(hasFirebaseConfig ? 'loading' : 'error')
  const [viewMode, setViewMode] = useState<ViewMode>(restoredSession.viewMode ?? 'dashboard')
  // 프로젝트 상세에서 스텝퍼 클릭으로 보고 있는 단계(실제 프로젝트 상태와 별개)
  const [viewedStageIndex, setViewedStageIndex] = useState<number | null>(null)
  // 승인 단계에서 각 담당자가 확인하며 남길 메모 임시 입력
  const [approvalMemoDraft, setApprovalMemoDraft] = useState('')
  // 인라인 승인 입력창 열림 여부 (확인 버튼 클릭 시 토글)
  const [approvalInlineOpen, setApprovalInlineOpen] = useState(false)
  // 승인 이력 내 임시 댓글 입력
  const [approvalCommentInput, setApprovalCommentInput] = useState('')
  // 반려 사유 입력 (프리셋 + 직접 입력)
  const [rejectReasonDraft, setRejectReasonDraft] = useState('')
  const [rejectOpen, setRejectOpen] = useState(false)
  // 활동 로그 표시 방식: 세로 타임라인 / 표
  const [logView, setLogView] = useState<'timeline' | 'table'>('timeline')
  // 검토 단계(QC/보안/PM) 역할별 검토 내용 임시 입력
  const [qcReviewDraft, setQcReviewDraft] = useState('')
  const [requestForm, setRequestForm] = useState<RequestFormState>(emptyRequestForm)
  const [reviewDocsDrafts, setReviewDocsDrafts] = useState<Record<string, ReviewDocs>>({})
  const [scheduleDrafts, setScheduleDrafts] = useState<Record<string, ScheduleInfo>>({})
  const [skipReasonDrafts, setSkipReasonDrafts] = useState<Record<string, string>>({})
  const [previewAttachment, setPreviewAttachment] = useState<{ name: string; type: string; dataUrl?: string; key?: string; size: number } | null>(null)
  const [srsCollapsed, setSrsCollapsed] = useState(false)
  const [sdsCollapsed, setSdsCollapsed] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  // 인증 상태 — DB 계정 기반 로그인(계정당 고정 역할). localStorage에 60분 세션 보관.
  const [account, setAccount] = useState<Account | null>(() => loadStoredAccount() ?? (DEV_NO_LOGIN ? DEV_ACCOUNT : null))
  const [sessionTimeoutMin, setSessionTimeoutMin] = useState<number>(() => getStoredSessionTimeoutMin())
  // 게시판 전송 상태 (프로젝트 id 기준)
  const [deployNoteDraft, setDeployNoteDraft] = useState('')
  const [boardSendingId, setBoardSendingId] = useState<string | null>(null)
  const [boardResults, setBoardResults] = useState<Record<string, { ok: boolean; message: string }>>({})
  // 작성자 표기 — "이름(역할)" 형식. 이름이 없으면 역할만 표시
  const authorName = account?.fullName?.trim()
  const authorLabel = authorName ? `${authorName}(${roleLabels[role]})` : roleLabels[role]
  // 요청자 "본인 요청" 판별용 현재 사용자 이름.
  // 실로그인 시 계정 이름, 데모(DEV_NO_LOGIN)에서는 새 요청 폼의 요청자 값(기본 '이영업')을 신원으로 사용.
  const currentUserName = (!DEV_NO_LOGIN && authorName) ? authorName : requestForm.requester
  const requestTypeConfig = requestTypeOptions.find((item) => item.type === requestForm.requestType) ?? requestTypeOptions[0]

  // 로그인하면 계정의 고정 역할을 적용. 관리자가 아니면 설정 화면에서 대시보드로 이동.
  // (데모 모드에서는 역할 필터로 자유롭게 바꾸므로 계정 역할 강제를 생략)
  useEffect(() => {
    if (!account || DEV_NO_LOGIN) return
    setRole(account.role)
    if (account.role !== 'admin') {
      setViewMode((mode) => (mode === 'settings' ? 'dashboard' : mode))
    }
  }, [account])

  // 로그아웃: 저장된 계정·세션을 비운다
  const handleLogout = useCallback(() => {
    clearStoredAccount()
    setAccount(null)
  }, [])

  // 세션 타임아웃: 로그인 시점 기준 설정된 시간이 지나면 강제 로그아웃
  useEffect(() => {
    if (!account) return
    const maxMs = sessionTimeoutMin * 60 * 1000
    const startRaw = window.localStorage.getItem(sessionStartStorageKey)
    const start = startRaw ? Number(startRaw) : Date.now()
    const remaining = start + maxMs - Date.now()
    if (remaining <= 0) {
      handleLogout()
      return
    }
    const timer = window.setTimeout(() => {
      handleLogout()
      window.alert(`세션이 만료되었습니다(${sessionTimeoutMin}분). 다시 로그인해 주세요.`)
    }, remaining)
    return () => window.clearTimeout(timer)
  }, [account, handleLogout, sessionTimeoutMin])

  // 프로젝트 로드(Firestore) — 로그인(계정) 이후에만
  useEffect(() => {
    if (!hasFirebaseConfig || !account) {
      return
    }
    setLoadState('loading')

    fetchProjects()
      .then((liveProjects) => {
        setProjects(liveProjects)
        setSelectedId((current) =>
          current && liveProjects.some((project) => project.id === current)
            ? current
            : liveProjects[0]?.id ?? '',
        )
        setLoadState('live')
      })
      .catch(() => setLoadState('error'))
  }, [account])

  useEffect(() => {
    window.localStorage.setItem(serviceOptionsStorageKey, JSON.stringify(serviceOptions))
  }, [serviceOptions])

  // 새로고침 시 마지막으로 보던 화면·역할·선택 프로젝트 복원
  useEffect(() => {
    window.localStorage.setItem(sessionStateStorageKey, JSON.stringify({ viewMode, role, selectedId }))
  }, [viewMode, role, selectedId])

  // 역할 전환 + 접근 로그 기록
  const handleRoleChange = useCallback((next: Role) => {
    setRole(next)
    void writeAccessLog({
      at: new Date().toISOString(),
      actor: currentUserName || '데모',
      role: next,
      action: 'role_switch',
      detail: `역할 전환 → ${roleLabels[next]}`,
      userAgent: navigator.userAgent,
    })
  }, [currentUserName])

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
  const currentScheduleDraft = selected ? scheduleDrafts[selected.id] ?? selected.schedule ?? emptySchedule : emptySchedule
  const serviceScopedProjects = useMemo(
    () => projects.filter((project) => matchesServiceFilter(project, serviceFilter, serviceOptions)),
    [projects, serviceFilter, serviceOptions],
  )
  const queueScopedProjects = useMemo(
    () => serviceScopedProjects.filter((project) => isProjectRelevantToRole(project, role, currentUserName)),
    [role, serviceScopedProjects, currentUserName],
  )
  useEffect(() => {
    const selectedProjectInScope = serviceScopedProjects.find((project) => project.id === selectedId)
    let timeoutId: number | undefined

    // '전체 프로젝트' 보기·특정 프로젝트 포커스에서는 역할 범위 밖 프로젝트도 선택·열람 가능해야 하므로 queueScoped로 강제하지 않음
    // 선택된 프로젝트가 유효(서비스 범위 내)하면 유지 — 작업 목록의 '처리 대기(직전 단계)' 항목도 클릭해 열 수 있게.
    // 아무것도 선택되지 않았을 때만 역할 관련(queueScoped) 첫 프로젝트로 기본 선택.
    if (viewMode === 'pipeline' && statusFilter !== 'allProjects' && !focusedId && queueScopedProjects.length > 0) {
      if (!selectedProjectInScope) {
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
  }, [queueScopedProjects, selectedId, serviceScopedProjects, viewMode, statusFilter, focusedId])
  const rawApprovalState = selected?.approvalState ?? { requiredRoles: [] as Role[], approvedRoles: [] as Role[] }
  // 옛 데이터에 'pm'/'admin' 같은 더 이상 쓰지 않는 승인 역할이 남아 있을 수 있으니 항상 현재 fullApprovalRoles 기준으로 정리
  const selectedApprovalState = {
    ...rawApprovalState,
    requiredRoles: rawApprovalState.requiredRoles.filter((r) => fullApprovalRoles.includes(r)),
    approvedRoles: rawApprovalState.approvedRoles.filter((r) => fullApprovalRoles.includes(r)),
  }
  const selectedWorkflow = selected ? workflow.filter((item) => {
    if (item.status === 'qc_security') return selected.workflowConfig.requiresQcSecurity
    return true
  }) : workflow
  const metrics = useMemo(() => {
    const countable = (project: Project) => !['completion', 'rejected'].includes(project.status)
    const isDueSoon = (project: Project) => countable(project) && daysUntil(project.dueDate, demoToday) <= 5
    const isBlocked = (project: Project) => project.onHold || project.tasks.some((task) => task.status === 'blocked')
    const active = serviceScopedProjects.filter(countable)
    const dueSoon = serviceScopedProjects.filter(isDueSoon)
    const blocked = serviceScopedProjects.filter(isBlocked)
    // 내 차례인 작업(작업 목록과 동일). 요청자 계열은 본인이 올린 요청만 거른다.
    const inRoleScope = (project: Project) => !isRequesterRole(role) || project.requester === currentUserName
    const myTurn = serviceScopedProjects.filter((p) => inRoleScope(p) && isProjectAssignedToRole(p, role) && roleActsOnStatus(role, p.status))
    // 처리 대기 = 내 승인 대기(승인 단계), 진행 중 = 그 외 내 작업(기획·개발·검토). 둘의 합 = 작업 목록.
    const relevantWaiting = myTurn.filter((p) => p.status === 'dept_review')
    const relevantInProgress = myTurn.filter((p) => p.status !== 'dept_review')
    const relevantDueSoon = myTurn.filter((p) => isDueSoon(p))

    return {
      total: serviceScopedProjects.length,
      active: active.length,
      dueSoon: dueSoon.length,
      blocked: blocked.length,
      relevantDueSoon: relevantDueSoon.length,
      relevantWaiting: relevantWaiting.length,
      relevantInProgress: relevantInProgress.length,
    }
  }, [role, serviceScopedProjects, currentUserName])

  const filteredProjects = useMemo(() => {
    // 특정 프로젝트 1건만 포커스(대시보드 카드 클릭)
    if (focusedId) return serviceScopedProjects.filter((project) => project.id === focusedId)
    // 내 차례인 작업(요청자 계열은 본인 요청만). 처리 대기/진행 중/작업 목록/마감 임박은 모두 이 집합 기준.
    const inRoleScope = (project: Project) => !isRequesterRole(role) || project.requester === currentUserName
    const isMyTurn = (project: Project) => inRoleScope(project) && isProjectAssignedToRole(project, role) && roleActsOnStatus(role, project.status)
    const stageBased = ['preDev', 'inProgress', 'myWork', 'dueSoon'].includes(statusFilter)
    const base = statusFilter === 'allProjects' || stageBased ? serviceScopedProjects : queueScopedProjects
    return base
      .filter((project) => {
        if (statusFilter === 'allProjects') return true
        // 요청자는 본인 요청을 모든 단계에서 추적할 수 있도록 '내 프로젝트'에 전 단계 포함 (다른 역할은 본인 차례만)
        if (statusFilter === 'mine') return isRequesterRole(role) ? isProjectRelevantToRole(project, role, currentUserName) : isProjectAssignedToRole(project, role)
        // 작업 목록 = 내 차례 전체 (= 처리 대기 + 진행 중)
        if (statusFilter === 'queue' || statusFilter === 'myWork') return isMyTurn(project)
        // 처리 대기 = 내 승인 대기(승인 단계), 진행 중 = 그 외 내 작업(기획·개발·검토)
        if (statusFilter === 'preDev') return isMyTurn(project) && project.status === 'dept_review'
        if (statusFilter === 'inProgress') return isMyTurn(project) && project.status !== 'dept_review'
        if (statusFilter === 'active') return !['completion', 'rejected'].includes(project.status)
        if (statusFilter === 'dueSoon') return isMyTurn(project) && daysUntil(project.dueDate, demoToday) <= 5
        if (statusFilter === 'blocked') return project.onHold || project.tasks.some((task) => task.status === 'blocked')
        if (statusFilter === 'risk') return project.priority === 'urgent' || project.priority === 'high'
        if (statusFilter === 'all') return true
        return project.status === statusFilter
      })
      .filter((project) => listStatusFilter === 'all' || project.status === listStatusFilter)
      .filter((project) => listTeamFilter === 'all' || project.ownerTeam === listTeamFilter)
      .filter((project) => listPriorityFilter === 'all' || project.priority === listPriorityFilter)
      .filter((project) => listTypeFilter === 'all' || project.requestType === listTypeFilter)
      .filter((project) => listServiceFilter === 'all' || inferServiceOption(project, serviceOptions) === listServiceFilter)
      .filter((project) => `${project.title} ${project.summary} ${project.code}`.toLowerCase().includes(query.toLowerCase()))
  }, [focusedId, query, queueScopedProjects, serviceScopedProjects, statusFilter, role, currentUserName, listStatusFilter, listTeamFilter, listPriorityFilter, listTypeFilter, listServiceFilter, serviceOptions])

  // '전체 프로젝트' 별도 페이지: 역할 무관 전체 프로젝트를 검색어로만 필터해 목록으로 노출 (단계 순 정렬)
  const allProjectsList = useMemo(() => {
    const order: Record<ProjectStatus, number> = { request: 0, planning: 1, dept_review: 2, development: 3, qc_security: 4, deployment: 5, completion: 6, rejected: 7 }
    return serviceScopedProjects
      .filter((project) => `${project.title} ${project.summary} ${project.code}`.toLowerCase().includes(query.toLowerCase()))
      .slice()
      .sort((a, b) => order[a.status] - order[b.status])
  }, [serviceScopedProjects, query])

  // 적용된 목록 필터(칩 표시용) — 모바일에서 한 줄로 압축 노출
  const activeListFilters = [
    listStatusFilter !== 'all' && { key: 'status', label: statusLabels[listStatusFilter] ?? '단계', clear: () => setListStatusFilter('all') },
    listTeamFilter !== 'all' && { key: 'team', label: listTeamFilter, clear: () => setListTeamFilter('all') },
    listPriorityFilter !== 'all' && { key: 'priority', label: priorityLabels[listPriorityFilter], clear: () => setListPriorityFilter('all') },
    listTypeFilter !== 'all' && { key: 'type', label: requestTypeLabels[listTypeFilter], clear: () => setListTypeFilter('all') },
    listServiceFilter !== 'all' && { key: 'service', label: listServiceFilter, clear: () => setListServiceFilter('all') },
  ].filter(Boolean) as Array<{ key: string; label: string; clear: () => void }>
  const clearAllListFilters = () => { setListStatusFilter('all'); setListTeamFilter('all'); setListPriorityFilter('all'); setListTypeFilter('all'); setListServiceFilter('all') }

  // 담당 팀 필터 옵션 (현재 역할이 볼 수 있는 프로젝트 기준)
  const teamFilterOptions = useMemo(() => {
    const set = new Set<string>()
    queueScopedProjects.filter((project) => isProjectAssignedToRole(project, role)).forEach((p) => p.ownerTeam && set.add(p.ownerTeam))
    return Array.from(set).sort()
  }, [queueScopedProjects, role])

  // 알림/리마인더: 내 승인 차례·검토 요청·마감 임박·지연
  const notifications = useMemo<NotificationItem[]>(() => {
    const items: NotificationItem[] = []
    for (const p of serviceScopedProjects) {
      if (p.onHold) continue
      // PM에게 새 요청 접수 알림 — 기획 생략된 경우 PM이 할 일 없으므로 알림 제외
      if (p.status === 'request' && isPlanningRequired(p) && (role === 'pm' || role === 'admin')) {
        items.push({ id: `req-${p.id}`, kind: 'new_request', tone: 'action', projectId: p.id, projectTitle: p.title, text: '새 요청이 접수됐습니다. 기획 단계 진행이 필요합니다.' })
      }
      // 내 승인 차례 (부서 승인 단계)
      if (p.status === 'dept_review' && p.approvalState.requiredRoles.includes(role) && !p.approvalState.approvedRoles.includes(role)) {
        items.push({ id: `appr-${p.id}`, kind: 'approval', tone: 'action', projectId: p.id, projectTitle: p.title, text: '내 승인 차례입니다.' })
      }
      // 내 검토 차례 (개발·QA·보안·PM 검토 단계)
      if (p.status === 'qc_security' && qcSignoffRoles.includes(role as QcSignoffRole)) {
        const r = role as QcSignoffRole
        if (!p.qcSignoff?.[r]) {
          // QA 통합테스트는 개발자 단위테스트 완료 전에는 알림하지 않는다(아직 내 차례가 아님)
          const waitingForUnitTest = r === 'qa' && !p.qcSignoff?.developer
          if (!waitingForUnitTest) {
            items.push({
              id: `qc-${p.id}`,
              kind: 'qc',
              tone: 'action',
              projectId: p.id,
              projectTitle: p.title,
              text: `${qcSignoffTitles[r]}가 필요합니다.`,
            })
          }
        }
      }
      // 마감 임박 / 지연 (내 할 일 프로젝트만)
      if (!['completion', 'rejected'].includes(p.status) && isProjectAssignedToRole(p, role)) {
        const d = daysUntil(p.dueDate, demoToday)
        if (d < 0) {
          items.push({ id: `over-${p.id}`, kind: 'overdue', tone: 'overdue', projectId: p.id, projectTitle: p.title, text: `마감 ${Math.abs(d)}일 지연 (D+${Math.abs(d)})` })
        } else if (d <= 1) {
          items.push({ id: `due-${p.id}`, kind: 'due', tone: 'soon', projectId: p.id, projectTitle: p.title, text: `마감 임박 (${d === 0 ? 'D-DAY' : 'D-1'})` })
        }
      }
    }
    // 처리 필요(action) → 지연 → 임박 순으로 정렬
    const order: Record<string, number> = { action: 0, overdue: 1, soon: 2 }
    return items.sort((a, b) => (order[a.tone] ?? 9) - (order[b.tone] ?? 9))
  }, [serviceScopedProjects, role])

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
      .filter((project) => daysUntil(project.dueDate, demoToday) <= 10 && true)
      .sort((a, b) => daysUntil(a.dueDate, demoToday) - daysUntil(b.dueDate, demoToday))
      .slice(0, 5)
    const recent = [...serviceScopedProjects].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 5)
    const assignedProjects = serviceScopedProjects.filter((project) => isProjectAssignedToRole(project, role))
    const myQueue = serviceScopedProjects.filter((project) => isProjectAssignedToRole(project, role)).slice(0, 5)

    // 평균 처리 기간(일): 완료된 프로젝트의 등록→완료 소요일 평균
    const completedProjects = serviceScopedProjects.filter((project) => project.status === 'completion')
    const avgCompletionDays = completedProjects.length
      ? Math.round(
          completedProjects.reduce((sum, project) => sum + Math.max(0, (Date.parse(project.updatedAt) - Date.parse(project.createdAt)) / 86_400_000), 0) /
            completedProjects.length,
        )
      : 0

    // 역할별 대기 건수: 진행 중 프로젝트에서 각 역할이 처리해야 할 건수
    const roleBuckets: Partial<Record<Role, number>> = {}
    const bump = (r: Role) => { roleBuckets[r] = (roleBuckets[r] ?? 0) + 1 }
    for (const project of serviceScopedProjects) {
      if (project.onHold || ['completion', 'rejected'].includes(project.status)) continue
      if (project.status === 'dept_review') {
        project.approvalState.requiredRoles.filter((r) => !project.approvalState.approvedRoles.includes(r)).forEach(bump)
      } else if (project.status === 'qc_security') {
        qcSignoffRoles.forEach((r) => { if (!project.qcSignoff?.[r]) bump(r) })
      } else {
        bump(project.assigneeRole)
      }
    }
    const pendingByRole = (Object.entries(roleBuckets) as Array<[Role, number]>)
      .map(([r, count]) => ({ role: r, count }))
      .sort((a, b) => b.count - a.count)

    return { taskStatus, priority, statusCounts, projectsByStatus, assignedProjects, dueSoon, recent, myQueue, avgCompletionDays, completedCount: completedProjects.length, pendingByRole }
  }, [role, serviceScopedProjects])

  const currentStep = Math.max(
    0,
    selectedWorkflow.findIndex((item) => item.status === selected?.status),
  )
  // 클릭으로 보고 있는 단계 (null이면 현재 단계와 동일)
  const viewedStep = viewedStageIndex ?? currentStep
  const viewedStatus: ProjectStatus = selectedWorkflow[viewedStep]?.status ?? (selected?.status ?? 'request')
  // 프로젝트가 바뀌면 viewedStageIndex 초기화
  useEffect(() => {
    setViewedStageIndex(null)
  }, [selectedId])
  const canAct = Boolean(
    selected && (
      role === 'admin' ||
      isProjectAssignedToRole(selected, role) ||
      (selected.status === 'dept_review' && selectedApprovalState.requiredRoles.includes(role)) ||
      (selected.status === 'request' && role === 'pm') ||
      (selected.status === 'request' && role === 'requester' && !isPlanningRequired(selected)) ||
      // 기획 생략 시 요청자가 직접 기획자(SRS/SDS 작성) 역할을 수행 — 기획 단계에서도 진행 가능
      (selected.status === 'planning' && role === 'requester' && !isPlanningRequired(selected)) ||
      // 개발 단계: PM·개발자가 진행(검토 단계로) 가능
      (selected.status === 'development' && ['pm', 'developer'].includes(role))
    ),
  )
  const openTasks = selected?.tasks.filter((task) => task.status !== 'done') ?? []
  const hasSrsDraft = currentReviewDocsDraft.srs.trim().length > 0
  const hasSdsDraft = currentReviewDocsDraft.sds.trim().length > 0
  const pendingApprovalRoles = selectedApprovalState.requiredRoles.filter((item) => !selectedApprovalState.approvedRoles.includes(item))
  // 검토 단계 합의 게이트 (개발자 단위테스트 → QA 통합테스트 순서, 보안·PM 병행)
  const qcSignoff = selected?.qcSignoff ?? emptyQcSignoff
  const qcAllSignedOff = qcSignoffRoles.every((r) => qcSignoff[r])
  const qcPendingRoles = qcSignoffRoles.filter((r) => !qcSignoff[r])
  // QA 통합테스트는 개발자 단위테스트가 끝나야 시작할 수 있다
  const qaBlockedByUnitTest = !qcSignoff.developer

  // 배포 단계: 인프라가 운영 반영을 완료해야 완료 보고로 진행
  const deployment = selected?.deployment ?? emptyDeployment
  const deployDone = deployment.released
  const isStepAdvanceBlocked = Boolean(
    selected?.onHold ||
    (selected?.status === 'dept_review' && pendingApprovalRoles.length > 0) ||
    // SRS/SDS 문서를 만드는 유형(개념 A)에서만 문서 미완성 시 진행 차단.
    // '기획 생략' 토글(개념 B)은 담당자만 바꿀 뿐 문서 필수 여부와 무관 — 생략 시에도 요청자가 직접 작성해야 함.
    (selected?.status === 'planning' && planningRequiredByType[selected.requestType] && !hasSrsDraft) ||
    (selected?.status === 'development' && planningRequiredByType[selected.requestType] && !hasSdsDraft) ||
    (selected?.status === 'qc_security' && !qcAllSignedOff) ||
    (selected?.status === 'deployment' && !deployDone) ||
    (selected?.status === 'completion' && !selected?.requesterConfirmed),
  )
  const canApproveCurrentRole = Boolean(
    selected?.status === 'dept_review' &&
    selectedApprovalState.requiredRoles.includes(role) &&
    !selectedApprovalState.approvedRoles.includes(role),
  )
  // 검토 사인오프 가능한 역할인지 (admin은 모든 역할 대행 가능)
  const myQcSignoffRole: QcSignoffRole | null =
    role === 'developer' ? 'developer' : role === 'qa' ? 'qa' : role === 'security' ? 'security' : role === 'pm' ? 'pm' : null

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
        : '승인 단계'

    const baseLogEntry = {
      id: crypto.randomUUID(),
      at: logStamp(),
      actor: authorLabel,
      message,
      // 승인 완료로 진행되면 문서 잠금 스냅샷 포함 (#12)
      meta: { approvalState, ...(shouldAdvance ? { docsLocked: true } : {}) },
    }
    const advanceLogEntry = shouldAdvance
      ? {
          id: crypto.randomUUID(),
          at: logStamp(),
          actor: authorLabel,
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

    if (!hasFirebaseConfig) return
    try {
      await updateProjectDoc(selected.id, {
        status: advancedStatus,
        assignee_role: persistAssigneeRole(advancedAssigneeRole),
        progress: advancedProgress,
        next_action: nextAction,
        logs: nextLogs,
        approval_state: approvalState,
      })
    } catch {
      setLoadState('error')
    }
  }

  async function updateSelectedReviewDocs() {
    if (!selected) return

    const nextLogs = [
      {
        id: crypto.randomUUID(),
        at: logStamp(),
        actor: authorLabel,
        message: `${authorLabel}이(가) 기획 문서(SRS+SDS)를 업데이트했습니다.`,
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

    void notifyGoogleChat('doc.update', `${authorLabel}이(가) 기획 문서를 업데이트했습니다.`, {
      프로젝트: selected.title,
      코드: selected.code,
    })

    if (!hasFirebaseConfig) return
    try {
      await updateProjectDoc(selected.id, { review_docs: currentReviewDocsDraft, logs: nextLogs })
    } catch {
      setLoadState('error')
    }
  }

  /**
   * 일정 조율 저장.
   *
   * confirm=true 로 호출하면 개발 단계 일정 조율 결과를 확정하고,
   * 그 시점의 완료 예정일(plannedEnd)을 프로젝트 마감일(dueDate)로 반영한다.
   * → 마감일 확정 주체·시점 = 개발 단계 일정 조율 (KPI 'D-5 마감 임박'의 기준)
   */
  async function updateSelectedSchedule(confirm = false) {
    if (!selected) return

    const plannedEnd = currentScheduleDraft.plannedEnd?.trim() ?? ''
    if (confirm && !plannedEnd) {
      window.alert('완료 예정일을 입력해야 마감일을 확정할 수 있습니다.')
      return
    }
    if (confirm && !window.confirm(`완료 예정일 ${plannedEnd} 을 프로젝트 마감일로 확정합니다.\n\n확정 후에도 일정을 다시 조율해 재확정할 수 있습니다.`)) return

    const nextSchedule: ScheduleInfo = confirm
      ? { ...currentScheduleDraft, confirmed: true, confirmedAt: logStamp(), confirmedBy: authorLabel }
      : currentScheduleDraft

    const nextLogs = [
      {
        id: crypto.randomUUID(),
        at: logStamp(),
        actor: authorLabel,
        message: confirm
          ? `${roleLabels[role]}이(가) 일정 조율 결과로 마감일을 ${plannedEnd} 로 확정했습니다.`
          : `${roleLabels[role]}이(가) 일정 조율 정보를 업데이트했습니다.`,
        meta: { schedule: nextSchedule },
      },
      ...selected.logs,
    ]

    setProjects((current) =>
      current.map((project) =>
        project.id === selected.id
          ? {
              ...project,
              schedule: nextSchedule,
              // 확정 시에만 마감일을 덮어쓴다 (단순 저장은 마감일에 영향 없음)
              ...(confirm ? { dueDate: plannedEnd } : {}),
              logs: nextLogs,
              updatedAt: new Date().toISOString(),
            }
          : project,
      ),
    )
    setScheduleDrafts((current) => {
      const { [selected.id]: _removed, ...rest } = current
      void _removed
      return rest
    })
    window.alert(confirm ? `마감일을 ${plannedEnd} 로 확정했습니다.` : '일정 조율 정보를 저장했습니다.')

    void notifyGoogleChat('schedule.update', confirm
      ? `${roleLabels[role]}이(가) 마감일을 ${plannedEnd} 로 확정했습니다.`
      : `${roleLabels[role]}이(가) 일정을 업데이트했습니다.`, {
      프로젝트: selected.title,
      코드: selected.code,
      착수예정: nextSchedule.plannedStart || '미정',
      완료예정: nextSchedule.plannedEnd || '미정',
    })

    if (!hasFirebaseConfig) return
    try {
      await updateProjectDoc(selected.id, {
        schedule: nextSchedule,
        logs: nextLogs,
        ...(confirm ? { due_date: plannedEnd } : {}),
      })
    } catch {
      setLoadState('error')
    }
  }

  async function approveCurrentRole(memo: string = '') {
    if (!selected || !canApproveCurrentRole) return

    const trimmedMemo = memo.trim()
    const approvalState: ApprovalState = {
      ...selectedApprovalState,
      approvedRoles: [...selectedApprovalState.approvedRoles, role],
      memos: {
        ...(selectedApprovalState.memos ?? {}),
        [role]: { at: logStamp(), actor: authorLabel, message: trimmedMemo },
      },
    }

    const logMessage = trimmedMemo
      ? `${roleLabels[role]} 확인 완료 — 메모: ${trimmedMemo}`
      : `${roleLabels[role]} 확인을 완료했습니다.`
    await updateApprovalState(approvalState, logMessage)
    const allApproved = approvalState.requiredRoles.every((item) => approvalState.approvedRoles.includes(item))
    void notifyGoogleChat('project.approve', `${roleLabels[role]}이(가) 확인했습니다.`, {
      프로젝트: selected.title,
      코드: selected.code,
      ...(trimmedMemo ? { 메모: trimmedMemo } : {}),
      ...(allApproved ? { 상태: '모든 확인 완료 → 다음 단계 자동 진행' } : { 남은확인: approvalState.requiredRoles.filter((r) => !approvalState.approvedRoles.includes(r)).map((r) => approvalStepLabels[r]).join(', ') }),
    })
  }

  async function toggleHoldProject(projectId: string) {
    if (!['pm', 'admin'].includes(role)) return
    const target = projects.find((project) => project.id === projectId)
    if (!target) return
    if (['rejected'].includes(target.status)) return

    const willHold = !target.onHold
    let reason = ''
    if (willHold) {
      const input = window.prompt(`"${target.title}" 보류 사유를 입력하세요. (선택)`) ?? ''
      reason = input.trim()
    }
    const nextLogs = [
      {
        id: crypto.randomUUID(),
        at: logStamp(),
        actor: authorLabel,
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

    if (!hasFirebaseConfig) return
    try {
      await updateProjectDoc(projectId, { on_hold: willHold, hold_reason: willHold ? reason : '', logs: nextLogs })
    } catch {
      setLoadState('error')
    }
  }

  async function toggleHoldSelectedProject() {
    if (selected) void toggleHoldProject(selected.id)
  }

  async function advanceSelectedProject() {
    if (!selected || !canAct) return
    if (selected.onHold) { window.alert('보류 중인 프로젝트입니다. 보류를 해제한 뒤 진행하세요.'); return }
    if (selected.status === 'dept_review' && pendingApprovalRoles.length > 0) return
    if (selected.status === 'planning' && planningRequiredByType[selected.requestType] && !hasSrsDraft) { window.alert('요구사항 정의서(SRS)를 작성해야 다음 단계로 진행할 수 있습니다.'); return }
    if (selected.status === 'development' && planningRequiredByType[selected.requestType] && !hasSdsDraft) { window.alert('설계 명세서(SDS)를 작성해야 검토 단계로 진행할 수 있습니다.'); return }
    if (selected.status === 'qc_security' && !qcAllSignedOff) { window.alert(`검토가 모두 완료되어야 다음 단계로 진행할 수 있습니다.\n대기: ${qcPendingRoles.map((r) => qcSignoffTitles[r]).join(', ')}`); return }
    if (selected.status === 'deployment' && !deployDone) { window.alert('운영 반영이 완료되어야 완료 보고로 진행할 수 있습니다.'); return }
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
        at: logStamp(),
        actor: authorLabel,
        message: `${statusLabels[targetStatus]} 단계로 이동했습니다.`,
        meta: selected.status === 'planning' ? { reviewDocs: currentReviewDocsDraft } : undefined,
      },
      ...selected.logs,
    ]
    // 기획 생략(요청자가 직접 기획) 시, 기획 단계 담당을 요청자로 지정해 본인이 SRS/SDS 작성·진행
    const nextAssigneeRole = (targetStatus === 'planning' && !isPlanningRequired(selected))
      ? 'requester'
      : nextRoleFor(targetStatus)
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

    if (hasFirebaseConfig) {
      try {
        await updateProjectDoc(selected.id, {
          status: targetStatus,
          progress: nextProgress,
          assignee_role: persistAssigneeRole(nextAssigneeRole),
          next_action: nextAction,
          logs: nextLogs,
        })
      } catch {
        setLoadState('error')
      }
    }

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
      workflowConfig: merged.workflowConfig,
      qcSignoff: merged.qcSignoff,
      requesterConfirmed: merged.requesterConfirmed,
      docsLocked: merged.docsLocked,
      rejectedReason: merged.rejectedReason,
      rejectedFromStatus: merged.rejectedFromStatus,
      comments: merged.comments,
      deployment: merged.deployment,
    }
    const nextLogs = [
      { id: crypto.randomUUID(), at: logStamp(), actor: authorLabel, message: logMessage, meta: stateMeta },
      ...selected.logs,
    ]
    merged.logs = nextLogs
    setProjects((current) => current.map((project) => (project.id === selected.id ? merged : project)))
    if (!hasFirebaseConfig) return
    const dbPatch: Partial<ProjectRow> = { logs: nextLogs }
    if (patch.status) dbPatch.status = patch.status
    if (patch.assigneeRole) dbPatch.assignee_role = persistAssigneeRole(patch.assigneeRole)
    if (patch.nextAction) dbPatch.next_action = patch.nextAction
    if (patch.progress !== undefined) dbPatch.progress = patch.progress
    // 승인 역할/워크플로 설정 변경은 전용 컬럼에도 영속화
    if (patch.approvalState) dbPatch.approval_state = merged.approvalState
    if (patch.workflowConfig) dbPatch.workflow_config = merged.workflowConfig
    if (patch.published !== undefined) dbPatch.published = merged.published
    // 보류 상태(반려 → 보류 전환 포함)도 전용 컬럼에 영속화.
    // 누락되면 새로고침 시 보류가 풀린 것처럼 보인다.
    if (patch.onHold !== undefined) dbPatch.on_hold = merged.onHold
    if (patch.holdReason !== undefined) dbPatch.hold_reason = merged.holdReason ?? ''
    // 마감일 확정(개발 단계 일정 조율 결과)
    if (patch.dueDate) dbPatch.due_date = patch.dueDate
    try {
      await updateProjectDoc(selected.id, dbPatch)
    } catch {
      setLoadState('error')
    }
  }

  // 완료 보고 → 동사무소 게시판(그룹웨어) 글 등록
  // 작업 목록의 '완료 보고' 행에서 [전송] 버튼으로 실행한다.
  async function sendProjectToBoard(project: Project) {
    if (boardSendingId) return
    if (!isOfficeBoardConfigured()) {
      window.alert('게시판 연동 정보가 없습니다.\n설정 > 동사무소 게시판 API 에서 Base URL과 게시판명을 먼저 저장해 주세요.')
      return
    }
    // finalizeProject()와 동일한 게이트 — 요청자 확인 전에 외부 게시판으로 나가면 안 된다
    if (!project.requesterConfirmed) {
      window.alert('요청자 확인이 완료되어야 게시판에 등록할 수 있습니다.')
      return
    }

    // 새로고침해도 유지되는 활동 로그로 중복 게시 여부를 판정
    const already = hasBeenPostedToBoard(project) || boardResults[project.id]?.ok
    const confirmText = already
      ? `"${project.title}" 완료 보고는 이미 게시판에 등록된 기록이 있습니다.\n다시 등록하면 중복 게시됩니다. 계속할까요?`
      : `"${project.title}" 완료 보고를 동사무소 게시판에 등록합니다.\n\n제목: ${buildCompletionTitle(project)}`
    if (!window.confirm(confirmText)) return

    setBoardSendingId(project.id)
    const result = await postToOfficeBoard({
      title: buildCompletionTitle(project),
      body: buildCompletionBody(project),
      author: authorLabel,
    })
    setBoardSendingId(null)

    const message = result.ok
      ? `${BOARD_POST_OK_PREFIX} 동사무소 게시판에 완료 보고를 등록했습니다.${result.postId ? ` (글 ID: ${result.postId})` : ''}`
      : `${BOARD_POST_FAIL_PREFIX} ${result.error}`
    setBoardResults((current) => ({ ...current, [project.id]: { ok: result.ok, message } }))

    // 성공·실패 모두 활동 로그로 남긴다 (감사 추적).
    // await 동안 다른 로그가 추가됐을 수 있으므로 캡처된 project가 아닌 최신 상태에서 읽는다.
    const fresh = projectsRef.current.find((p) => p.id === project.id) ?? project
    const nextLogs = [
      { id: crypto.randomUUID(), at: logStamp(), actor: authorLabel, message },
      ...fresh.logs,
    ]
    setProjects((current) => current.map((p) => (p.id === project.id ? { ...p, logs: nextLogs } : p)))
    if (hasFirebaseConfig) {
      try {
        await updateProjectDoc(project.id, { logs: nextLogs })
      } catch {
        setLoadState('error')
      }
    }

    void notifyGoogleChat(result.ok ? 'project.advance' : 'project.reject', message, {
      프로젝트: project.title,
      코드: project.code,
    })
    if (!result.ok) window.alert(message)
  }

  // #4 검토 단계 사인오프 토글 (개발 단위테스트 → QA 통합테스트 순서 강제)
  async function toggleQcSignoff(signRoleArg?: QcSignoffRole, note?: string) {
    if (!selected || selected.status !== 'qc_security') return
    if (selected.onHold) { window.alert('보류 중에는 검토할 수 없습니다.'); return }
    const targetRole = signRoleArg ?? myQcSignoffRole
    // admin이면 어떤 역할을 대행할지 선택
    let signRole = targetRole
    if (!signRole && role === 'admin') {
      const pick = (window.prompt('대행 사인오프할 역할 입력 (developer / qa / security / pm)') ?? '').trim().toLowerCase()
      if (!qcSignoffRoles.includes(pick as QcSignoffRole)) return
      signRole = pick as QcSignoffRole
    }
    if (!signRole) return
    const current = selected.qcSignoff ?? emptyQcSignoff
    const nextDone = !current[signRole]

    // 순서 게이트: 단위테스트(개발) 완료 전에는 통합테스트(QA) 불가
    if (signRole === 'qa' && nextDone && !current.developer) {
      window.alert('개발자 단위테스트가 완료되어야 QA 통합테스트를 시작할 수 있습니다.')
      return
    }
    // 통합테스트가 끝난 뒤 단위테스트를 취소하면 순서가 깨진다 → QA도 함께 취소
    let cascadeQa = false
    if (signRole === 'developer' && !nextDone && current.qa) {
      if (!window.confirm('단위테스트를 취소하면 이미 완료된 QA 통합테스트도 함께 취소됩니다. 계속할까요?')) return
      cascadeQa = true
    }

    const trimmedNote = (note ?? '').trim()
    const nextReviews = { ...(current.reviews ?? {}) }
    if (nextDone) {
      nextReviews[signRole] = { note: trimmedNote, actor: authorLabel, at: logStamp() }
    } else {
      // 취소 시 검토 내용도 함께 비움
      delete nextReviews[signRole]
    }
    if (cascadeQa) delete nextReviews.qa

    const nextSignoff: QcSignoffState = {
      ...current,
      [signRole]: nextDone,
      ...(cascadeQa ? { qa: false } : {}),
      reviews: nextReviews,
    }
    const label = qcSignoffTitles[signRole]
    await patchSelectedProject(
      { qcSignoff: nextSignoff },
      `${label}를 ${nextDone ? '완료' : '취소'} 처리했습니다.${cascadeQa ? ' (QA 통합테스트도 함께 취소)' : ''}${nextDone && trimmedNote ? ` (${trimmedNote})` : ''}`,
    )
    void notifyGoogleChat('task.status', `검토 ${nextDone ? '완료' : '취소'}: ${label}`, { 프로젝트: selected.title })
  }

  // 배포 단계: 운영 반영 완료/취소 (담당 = 인프라, PM·관리자 대행)
  async function toggleDeployStep(note?: string) {
    if (!selected || selected.status !== 'deployment') return
    if (selected.onHold) { window.alert('보류 중에는 배포를 진행할 수 없습니다.'); return }
    const current = selected.deployment ?? emptyDeployment
    const nextDone = !current.released
    const trimmed = (note ?? '').trim()
    const next: DeploymentState = {
      released: nextDone,
      ...(nextDone ? { releasedAt: logStamp(), releasedBy: authorLabel } : {}),
      ...(trimmed ? { note: trimmed } : current.note ? { note: current.note } : {}),
    }
    await patchSelectedProject(
      { deployment: next },
      `운영 반영을 ${nextDone ? '완료' : '취소'} 처리했습니다.${nextDone && trimmed ? ` (${trimmed})` : ''}`,
    )
    void notifyGoogleChat('project.advance', `운영 반영 ${nextDone ? '완료' : '취소'}`, { 프로젝트: selected.title })
  }

  // 배포 실패 → 개발 단계로 롤백
  async function rollbackDeployment(reason: string) {
    if (!selected || selected.status !== 'deployment') return
    const trimmed = reason.trim()
    if (!trimmed) { window.alert('롤백 사유를 입력해 주세요.'); return }
    if (!window.confirm(`배포 실패로 "${selected.title}"을(를) 개발 단계로 되돌립니다.\n\n사유: ${trimmed}\n\n배포·검토 상태가 모두 초기화됩니다.`)) return
    await patchSelectedProject(
      {
        status: 'development',
        assigneeRole: 'developer',
        progress: Math.min(selected.progress, stageBaselineProgress.development),
        deployment: emptyDeployment,
        qcSignoff: emptyQcSignoff,
        docsLocked: false,
        nextAction: '배포 롤백 조치 후 재검토 요청',
      },
      `배포 실패로 개발 단계로 롤백했습니다. (사유: ${trimmed})`,
    )
    void notifyGoogleChat('project.reject', `배포 롤백 → 개발 단계: ${selected.title}`, { 사유: trimmed })
  }

  // #3 검토 합의 실패 → 개발 단계로 되돌린다 (Bug·취약점이 남은 경우)
  async function returnToDevelopment(reason: string) {
    if (!selected || selected.status !== 'qc_security') return
    const trimmed = reason.trim()
    if (!trimmed) { window.alert('되돌리는 사유(남은 Bug·취약점)를 입력해 주세요.'); return }
    if (!window.confirm(`검토에서 발견된 문제로 "${selected.title}"을(를) 개발 단계로 되돌립니다.\n\n사유: ${trimmed}\n\n검토 완료 상태는 모두 초기화됩니다.`)) return
    await patchSelectedProject(
      {
        status: 'development',
        assigneeRole: 'developer',
        // 진행률도 개발 단계 기준으로 되돌린다 (진행률은 단계 진행 시 +12 누적이라
        // 되돌리면서 놔두면 검토 단계 수준(86%)이 남아 실제보다 부풀려진다)
        progress: Math.min(selected.progress, stageBaselineProgress.development),
        // 재검토가 필요하므로 사인오프 전체 초기화
        qcSignoff: emptyQcSignoff,
        // 개발 단계에서 다시 문서를 수정할 수 있도록 잠금 해제
        docsLocked: false,
        nextAction: '검토 반려 조치 후 재검토 요청',
      },
      `검토 결과 개발 단계로 되돌렸습니다. (사유: ${trimmed})`,
    )
    void notifyGoogleChat('project.reject', `검토 반려 → 개발 단계 회귀: ${selected.title}`, { 사유: trimmed })
  }

  // 반려 처리: 단계를 유지한 채 보류로 전환한다.
  //
  // 이전에는 status를 'rejected'로 바꿔 더 진행할 수 없는 종료 상태가 됐다.
  // 반려는 "이 단계에서 진행을 멈춰야 한다"는 뜻이므로 보류(HOLD)로 전환하고,
  // PM·관리자가 보류를 해제하면 같은 단계에서 그대로 재개한다.
  async function rejectSelectedProject(reason: string) {
    if (!selected) return
    // 검토 단계의 반려는 성격이 다르다 — Bug·취약점이 남았다는 뜻이므로 개발 단계로 되돌린다
    if (selected.status === 'qc_security') {
      await returnToDevelopment(reason)
      return
    }
    // 배포 단계의 반려 = 배포 실패 롤백
    if (selected.status === 'deployment') {
      await rollbackDeployment(reason)
      return
    }
    const trimmed = reason.trim()
    if (!trimmed) { window.alert('반려 사유를 입력하거나 선택해 주세요.'); return }
    if (selected.onHold) { window.alert('이미 보류 중인 프로젝트입니다.'); return }
    if (!window.confirm(`"${selected.title}" 프로젝트를 반려합니다.\n사유: ${trimmed}\n\n${statusLabels[selected.status]} 단계에서 보류 처리되며, 보류를 해제하면 이 단계에서 재개됩니다.`)) return
    await patchSelectedProject(
      {
        onHold: true,
        holdReason: `[반려] ${trimmed}`,
        // 어느 단계에서 반려됐는지는 남겨두어 상세·이력에서 확인할 수 있게 한다
        rejectedReason: trimmed,
        rejectedFromStatus: selected.status,
        nextAction: `반려 보류 중 · ${statusLabels[selected.status]} 단계 (보류 해제 시 재개)`,
      },
      `프로젝트를 반려하여 보류 처리했습니다. (사유: ${trimmed})`,
    )
    void notifyGoogleChat('project.reject', `프로젝트 반려(보류 전환): ${selected.title}`, {
      단계: statusLabels[selected.status],
      사유: trimmed,
    })
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

  // 완료 보고 단계: 최종 완료 처리(게시) — 마지막 단계라 '단계 진행'이 아니라 완료/게시
  async function finalizeProject() {
    if (!selected || selected.status !== 'completion') return
    if (!selected.requesterConfirmed) { window.alert('요청자 확인이 완료되어야 완료 처리(게시)할 수 있습니다.'); return }
    if (selected.published) return
    await patchSelectedProject(
      { published: true, progress: 100, nextAction: '완료 처리(게시) 완료' },
      '프로젝트를 완료 처리(게시)했습니다.',
    )
    void notifyGoogleChat('project.advance', '완료 처리(게시)', { 프로젝트: selected.title, 코드: selected.code })
  }

  // 목표2: 단계별 문의 댓글 등록
  async function addProjectCommentForStage(stage: ProjectStatus, message: string, parentId?: string) {
    if (!selected) return
    const trimmed = message.trim()
    if (!trimmed) return
    const comment = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      actor: authorLabel,
      role,
      stage,
      message: trimmed,
      ...(parentId ? { parentId } : {}),
    }
    const nextComments = [...(selected.comments ?? []), comment]
    const verb = parentId ? '답변을' : '문의/의견을'
    await patchSelectedProject({ comments: nextComments }, `[${statusLabels[stage]}] ${verb} 남겼습니다.`)
    void notifyGoogleChat('task.comment', `[${statusLabels[stage]}] ${parentId ? '답변' : '문의'}: ${selected.title}`, { 작성자: roleLabels[role], 내용: trimmed })
  }

  // 댓글 수정 (작성자 역할 또는 관리자)
  async function editProjectComment(id: string, message: string, sectionPrefix?: string) {
    if (!selected) return
    const trimmed = message.trim()
    if (!trimmed) return
    const finalMsg = sectionPrefix ? `${sectionPrefix} ${trimmed}` : trimmed
    const nextComments = (selected.comments ?? []).map((c) => (c.id === id ? { ...c, message: finalMsg } : c))
    await patchSelectedProject({ comments: nextComments }, '문의/답변을 수정했습니다.')
  }

  // 댓글 삭제 (해당 문의의 답변도 함께 삭제)
  async function deleteProjectComment(id: string) {
    if (!selected) return
    const nextComments = (selected.comments ?? []).filter((c) => c.id !== id && c.parentId !== id)
    await patchSelectedProject({ comments: nextComments }, '문의/답변을 삭제했습니다.')
  }

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!hasFirebaseConfig) {
      setLoadState('error')
      return
    }

    const now = new Date().toISOString()
    const projectCode = `PRJ-2505-${String(projects.length + 1).padStart(3, '0')}`
    const initialApprovalState: ApprovalState = {
      requiredRoles: requestForm.selectedApprovalRoles.length > 0 ? requestForm.selectedApprovalRoles : approvalRolesByRequestType[requestForm.requestType],
      approvedRoles: [],
    }
    const newWorkflowConfig = { ...defaultWorkflowConfig, requiresPlanning: true }
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
      workflowConfig: newWorkflowConfig,
      approvalState: initialApprovalState,
      securityReview: requestForm.securityReview,
      reviewDocs: emptyReviewDocs,
      tasks: [],
      logs: [
        {
          id: crypto.randomUUID(),
          at: logStamp(),
          actor: requestForm.requester,
          message: requestTypeConfig.createdLog,
          meta: {
            requestType: requestForm.requestType,
            workflowConfig: newWorkflowConfig,
            approvalState: initialApprovalState,
            securityReview: requestForm.securityReview,
            reviewDocs: emptyReviewDocs,
          },
        },
      ],
    }

    const row: ProjectRow = {
      id: newProject.id,
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
      created_at: now,
      updated_at: now,
      risk: newProject.risk,
      progress: newProject.progress,
      next_action: newProject.nextAction,
      assignee_role: persistAssigneeRole(newProject.assigneeRole),
      tasks: newProject.tasks,
      logs: newProject.logs,
      approval_state: initialApprovalState,
      workflow_config: newWorkflowConfig,
    }

    let savedProject: Project
    try {
      savedProject = await insertProject(row)
    } catch {
      setLoadState('error')
      return
    }

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
    if (!selected || !hasFirebaseConfig) {
      setLoadState('error')
      return
    }

    const nextLogs = [
      {
        id: crypto.randomUUID(),
        at: logStamp(),
        actor: authorLabel,
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

    try {
      await updateProjectDoc(selected.id, { tasks: nextTasks, logs: nextLogs })
    } catch {
      setLoadState('error')
    }
  }

  async function addTaskToProject(projectId: string, task: ProjectTask) {
    const target = projects.find((project) => project.id === projectId)
    if (!target) return
    const nextTasks = [task, ...target.tasks]
    const nextLogs = [
      {
        id: crypto.randomUUID(),
        at: logStamp(),
        actor: authorLabel,
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

    if (!hasFirebaseConfig) return
    try {
      await updateProjectDoc(projectId, { tasks: nextTasks, logs: nextLogs })
    } catch {
      setLoadState('error')
    }
  }

  // 일감 등록자(또는 관리 권한자)가 태스크 내용을 수정
  async function editTaskInProject(projectId: string, taskId: string, patch: Partial<ProjectTask>) {
    const target = projects.find((project) => project.id === projectId)
    if (!target) return
    const task = target.tasks.find((t) => t.id === taskId)
    if (!task) return
    const nextTasks = target.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t))
    const nextLogs = [
      { id: crypto.randomUUID(), at: logStamp(), actor: authorLabel, message: `일감을 수정했습니다: ${patch.title ?? task.title}` },
      ...target.logs,
    ]
    setProjects((current) =>
      current.map((project) =>
        project.id === projectId
          ? { ...project, tasks: nextTasks, logs: nextLogs, updatedAt: new Date().toISOString() }
          : project,
      ),
    )
    if (!hasFirebaseConfig) return
    try {
      await updateProjectDoc(projectId, { tasks: nextTasks, logs: nextLogs })
    } catch {
      setLoadState('error')
    }
  }

  // 일감 삭제
  async function deleteTaskInProject(projectId: string, taskId: string) {
    const target = projects.find((project) => project.id === projectId)
    if (!target) return
    const task = target.tasks.find((t) => t.id === taskId)
    if (!task) return
    if (!window.confirm(`일감 "${task.title}"을(를) 삭제할까요?`)) return
    const nextTasks = target.tasks.filter((t) => t.id !== taskId)
    const nextLogs = [
      { id: crypto.randomUUID(), at: logStamp(), actor: authorLabel, message: `일감을 삭제했습니다: ${task.title}` },
      ...target.logs,
    ]
    setProjects((current) =>
      current.map((project) =>
        project.id === projectId
          ? { ...project, tasks: nextTasks, logs: nextLogs, updatedAt: new Date().toISOString() }
          : project,
      ),
    )
    if (!hasFirebaseConfig) return
    try {
      await updateProjectDoc(projectId, { tasks: nextTasks, logs: nextLogs })
    } catch {
      setLoadState('error')
    }
  }


  // 요청자/관리자: 요청 원본 내용 수정 (승인 전 단계만)
  async function updateRequesterContent(patch: Partial<Project>) {
    if (!selected) return
    const nextLogs = [
      { id: crypto.randomUUID(), at: logStamp(), actor: authorLabel, message: '요청자가 요청 내용을 수정했습니다.' },
      ...selected.logs,
    ]
    const merged: Project = { ...selected, ...patch, logs: nextLogs, updatedAt: new Date().toISOString() }
    setProjects((current) => current.map((project) => (project.id === selected.id ? merged : project)))
    if (!hasFirebaseConfig) return
    try {
      await updateProjectDoc(selected.id, {
        title: merged.title,
        service_name: merged.serviceName,
        service_area: merged.serviceArea,
        owner_team: merged.ownerTeam,
        requester: merged.requester,
        due_date: merged.dueDate,
        summary: merged.summary,
        current_problem: merged.currentProblem,
        desired_outcome: merged.desiredOutcome,
        success_metric: merged.successMetric,
        affected_users: merged.affectedUsers,
        risk: merged.risk,
        logs: nextLogs,
      })
    } catch {
      setLoadState('error')
    }
  }

  // 요청자/PM/관리자: 기획 단계 필요 여부 토글 (즉시 양방향 전환 — 사유는 인라인 입력란에서 별도로 받음)
  async function togglePlanningRequired() {
    if (!selected) return
    if (!['pm', 'admin', 'requester'].includes(role)) return
    if (selected.status !== 'request') { window.alert('기획 단계 설정은 요청 단계에서만 변경할 수 있습니다.'); return }
    const willSkip = isPlanningRequired(selected) // 현재 '포함'이면 이번 클릭으로 '생략'이 됨
    if (willSkip) {
      // 생략으로 전환 — requiresPlanning만 false로. 사유는 인라인 입력란에서 입력/저장한다.
      await patchSelectedProject(
        { workflowConfig: { ...selected.workflowConfig, requiresPlanning: false } },
        '기획(SRS/SDS) 단계를 생략으로 설정했습니다. (사유 입력 필요)',
      )
    } else {
      // 포함으로 되돌림 — skipReason 키는 제거(undefined 저장 금지)
      const { skipReason: _omit, ...restConfig } = selected.workflowConfig
      void _omit
      setSkipReasonDrafts((d) => ({ ...d, [selected.id]: '' }))
      await patchSelectedProject(
        { workflowConfig: { ...restConfig, requiresPlanning: true } },
        '기획(SRS/SDS) 단계를 포함으로 설정했습니다.',
      )
    }
  }

  // 기획 생략 사유 저장 (인라인 입력란 blur 시)
  async function saveSkipReason() {
    if (!selected || selected.status !== 'request') return
    if (isPlanningRequired(selected)) return // 생략 상태일 때만 의미 있음
    const reason = (skipReasonDrafts[selected.id] ?? selected.workflowConfig.skipReason ?? '').trim()
    if (reason === (selected.workflowConfig.skipReason ?? '')) return // 변경 없으면 패치 생략
    await patchSelectedProject(
      { workflowConfig: { ...selected.workflowConfig, requiresPlanning: false, skipReason: reason } },
      reason ? `기획 생략 사유 입력 — ${reason}` : '기획 생략 사유를 비웠습니다.',
    )
  }

  // 관리자: 프로젝트 삭제
  async function deleteProject(projectId: string) {
    setProjects((current) => current.filter((project) => project.id !== projectId))
    setSelectedId((current) => (current === projectId ? '' : current))
    if (!hasFirebaseConfig) return
    try {
      await deleteProjectDoc(projectId)
    } catch {
      setLoadState('error')
    }
  }

  async function deleteAllProjects() {
    const ids = projects.map((project) => project.id)
    if (ids.length === 0) return
    setProjects([])
    setSelectedId('')
    if (!hasFirebaseConfig) return
    try {
      await deleteProjectsDoc(ids)
    } catch {
      setLoadState('error')
    }
  }

  async function addTaskComment(taskId: string, message: string) {
    if (!selected) return
    const trimmed = message.trim()
    if (!trimmed) return
    const newComment = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      actor: authorLabel,
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

  // 인증 게이트: Firebase가 설정된 경우 로그인 전에는 앱 셸을 렌더링하지 않음
  if (!DEV_NO_LOGIN && hasFirebaseConfig && !account) {
    return <AuthGate onAuthenticated={(next) => { storeAccount(next); setAccount(next) }} />
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
        </div>

        <nav className="navGroup" aria-label="main">
          <button
            className={`navItem ${viewMode === 'dashboard' ? 'active' : ''}`}
            type="button"
            onClick={() => {
              setFocusedId(null)
              setViewMode('dashboard')
              setStatusFilter('all')
            }}
            title="대시보드"
          >
            <LayoutDashboard size={17} />
            <span>대시보드</span>
          </button>
          <button
            className={`navItem ${viewMode === 'requestFlow' ? 'active' : ''}`}
            type="button"
            onClick={() => setViewMode('requestFlow')}
            title="새 요청"
          >
            <Plus size={17} />
            <span>새 요청</span>
          </button>
          <button
            className={`navItem ${viewMode === 'pipeline' ? 'active' : ''}`}
            type="button"
            onClick={() => {
              setFocusedId(null)
              setViewMode('pipeline')
              setStatusFilter('queue')
            }}
            title="작업 목록"
          >
            <ListChecks size={17} />
            <span>작업 목록</span>
          </button>
          <button
            className={`navItem flowNavItem ${viewMode === 'flow' ? 'active' : ''}`}
            type="button"
            onClick={() => setViewMode('flow')}
            title="시스템 가이드"
          >
            <Workflow size={17} />
            {/* 좁은 화면(≤400px)에서는 6개 탭 폭에 '시스템 가이드'가 들어가지 않아 잘린다 → 축약 라벨 사용 */}
            <span className="navLabelFull">시스템 가이드</span>
            <span className="navLabelShort">가이드</span>
          </button>
          {(role === 'admin' || role === 'security') && (
            <button className={`navItem ${viewMode === 'auditLog' ? 'active' : ''}`} type="button" title="감사 로그" onClick={() => setViewMode('auditLog')}>
              <Shield size={17} />
              <span>감사 로그</span>
            </button>
          )}
          {(role === 'admin' || role === 'security') && (
            <button className={`navItem ${viewMode === 'settings' ? 'active' : ''}`} type="button" title={role === 'security' ? '보안 설정' : '설정'} onClick={() => setViewMode('settings')}>
              <SlidersHorizontal size={17} />
              <span>{role === 'security' ? '보안 설정' : '설정'}</span>
            </button>
          )}
        </nav>
      </aside>

      <button
        className="sidebarToggleEdge"
        type="button"
        onClick={() => setIsSidebarCollapsed((current) => !current)}
        aria-label={isSidebarCollapsed ? '사이드 메뉴 펼치기' : '사이드 메뉴 접기'}
        title={isSidebarCollapsed ? '사이드 메뉴 펼치기' : '사이드 메뉴 접기'}
      >
        {isSidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>

      <main className="main">
        <header className="topbar">
          <div />
          <div className="topbarActions">
            {/* 임시 데모: 역할 필터 — 클릭 시 아래로 펼쳐지는 드롭다운 */}
            <RoleSwitcher role={role} onChange={handleRoleChange} />
            <NotificationBell
              items={notifications}
              onOpenProject={(projectId) => {
                setSelectedId(projectId)
                setViewMode('pipeline')
              }}
            />
            {account && !DEV_NO_LOGIN ? (
              <AccountMenu email={account.email} role={role} onLogout={handleLogout} />
            ) : null}
          </div>
        </header>

        {viewMode === 'dashboard' && (
          <section className="metricGrid cols4" aria-label="project metrics">
            {role === 'admin' ? (
              <>
                <Metric icon={<BarChart3 size={20} />} label="전체 프로젝트" value={metrics.total} tone="red" onClick={() => { setViewMode('pipeline'); setStatusFilter('all') }} />
                <Metric icon={<ListChecks size={20} />} label="진행 중" value={metrics.active} tone="amber" onClick={() => { setViewMode('pipeline'); setStatusFilter('active') }} />
                <Metric icon={<CalendarDays size={20} />} label="마감 임박" value={metrics.dueSoon} tone="green" onClick={() => { setViewMode('pipeline'); setStatusFilter('dueSoon') }} />
                <Metric icon={<AlertTriangle size={20} />} label="보류" value={metrics.blocked} tone="wine" onClick={() => { setViewMode('pipeline'); setStatusFilter('blocked') }} />
              </>
            ) : (
              <>
                <Metric icon={<Users size={20} />} label="처리 대기" value={metrics.relevantWaiting} tone="red" onClick={() => { setViewMode('pipeline'); setStatusFilter('preDev') }} />
                <Metric icon={<ListChecks size={20} />} label="진행 중" value={metrics.relevantInProgress} tone="amber" onClick={() => { setViewMode('pipeline'); setStatusFilter('inProgress') }} />
                <Metric icon={<CalendarDays size={20} />} label="마감 임박" value={metrics.relevantDueSoon} tone="green" onClick={() => { setViewMode('pipeline'); setStatusFilter('dueSoon') }} />
                <Metric icon={<BarChart3 size={20} />} label="전체 프로젝트" value={metrics.total} tone="wine" onClick={() => { setFocusedId(null); setViewMode('allProjects') }} />
              </>
            )}
          </section>
        )}

        {viewMode === 'requestFlow' ? (
          <RequestFlowPanel form={requestForm} serviceOptions={serviceOptions} setForm={setRequestForm} onSubmit={submitRequest} />
        ) : viewMode === 'flow' ? (
          <SystemGuidePanel />
        ) : viewMode === 'auditLog' && (role === 'admin' || role === 'security') ? (
          <AuditLogPanel projects={projects} />
        ) : viewMode === 'settings' && (role === 'admin' || role === 'security') ? (
          <SettingsPanel
            role={role}
            serviceOptions={serviceOptions}
            setServiceOptions={replaceServiceOptions}
            projects={projects}
            onToggleHold={toggleHoldProject}
            onDeleteProject={deleteProject}
            onDeleteAllProjects={deleteAllProjects}
            sessionTimeoutMin={sessionTimeoutMin}
            onSaveSessionTimeout={(min) => {
              window.localStorage.setItem(sessionTimeoutStorageKey, String(min))
              setSessionTimeoutMin(min)
            }}
          />
        ) : viewMode === 'dashboard' ? (
          <DashboardOverview
            role={role}
            currentName={currentUserName}
            projects={projects}
            serviceFilter={serviceFilter}
            serviceOptions={serviceOptions}
            summary={dashboardSummary}
            onChangeServiceFilter={setServiceFilter}
            onOpenProject={(projectId) => {
              setSelectedId(projectId)
              setFocusedId(projectId)
              setViewMode('pipeline')
            }}
            onOpenStatus={(filter) => {
              setFocusedId(null)
              setStatusFilter(filter)
              setViewMode('pipeline')
            }}
          />
        ) : viewMode === 'allProjects' ? (
          <section className="workArea allProjectsPage">
            <div className="queuePanel">
              <div className="panelHeader compact">
                <div>
                  <h2>전체 프로젝트</h2>
                  <p>{allProjectsList.length}개 · 단계별 현황</p>
                </div>
                <button className="miniButton" type="button" onClick={() => setViewMode('dashboard')}>← 대시보드</button>
              </div>
              <div className="searchFilterRow">
                <div className="searchBox">
                  <Search size={17} />
                  <input value={query} onChange={(event) => { setFocusedId(null); setQuery(event.target.value) }} placeholder="프로젝트 검색" />
                </div>
              </div>
              {allProjectsList.length === 0 ? (
                <div className="dashboardEmpty">표시할 프로젝트가 없습니다.</div>
              ) : (
                <div className="allProjectsTableWrap">
                  <div className="allProjectsTable">
                    <div className="allProjectsHead">
                      <span>단계</span>
                      <span>프로젝트명</span>
                      <span>서비스</span>
                      <span>유형</span>
                      <span>우선순위</span>
                      <span>담당 유닛</span>
                      <span>마감</span>
                    </div>
                    {allProjectsList.map((project) => {
                      const dd = dDayInfo(project.dueDate, demoToday)
                      return (
                        <div
                          key={project.id}
                          className={`allProjectsRow ${role === 'admin' ? 'clickable' : ''}`}
                          onClick={role === 'admin' ? () => { setSelectedId(project.id); setFocusedId(project.id); setViewMode('pipeline') } : undefined}
                          title={role === 'admin' ? '클릭하면 상세·단계별 내용 보기' : undefined}
                        >
                          <span className={`statusPill ${project.status}`}>
                            <span className="stageFull">{statusLabels[project.status]}</span>
                            <span className="stageShort">{shortStatusLabels[project.status]}</span>
                          </span>
                          <strong>{project.title}</strong>
                          <span className="serviceBadge">{inferServiceOption(project, serviceOptions)}</span>
                          <span className="requestTypePill">{requestTypeLabels[project.requestType]}</span>
                          <span className={`priority ${project.priority}`}>{priorityLabels[project.priority]}</span>
                          <span className="allProjectsTeam">{project.ownerTeam}</span>
                          <span className={`ddayPill ${dd.tone}`}>{dd.label}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </section>
        ) : (
        <section className="workArea">
          <div className="topStickyArea">
          <div className="queuePanel">
            <div className="searchFilterRow">
              <div className="searchBox">
                <Search size={17} />
                <input value={query} onChange={(event) => { setFocusedId(null); setQuery(event.target.value) }} placeholder="프로젝트 검색" />
              </div>
              {/* 모바일 전용: 필터 열기 버튼 */}
              <button type="button" className="filterTriggerBtn" onClick={() => setFilterSheetOpen(true)}>
                <SlidersHorizontal size={15} />
                필터{activeListFilters.length > 0 && <b className="filterTriggerCount">{activeListFilters.length}</b>}
              </button>
              {/* 모바일 전용: 적용된 필터 칩 */}
              {activeListFilters.length > 0 && (
                <div className="filterChips">
                  {activeListFilters.map((f) => (
                    <button key={f.key} type="button" className="filterChip" onClick={f.clear} title={`${f.label} 필터 해제`}>
                      {f.label} <span aria-hidden="true">✕</span>
                    </button>
                  ))}
                  <button type="button" className="filterChipClear" onClick={clearAllListFilters}>전체 해제</button>
                </div>
              )}
              <div className={`filterControls ${filterSheetOpen ? 'sheetOpen' : ''}`}>
                <div className="filterSheetHeader">
                  <strong>필터</strong>
                  <button type="button" className="filterSheetClose" onClick={() => setFilterSheetOpen(false)} aria-label="필터 닫기">✕</button>
                </div>
              <div className="listFilterBox">
                <SlidersHorizontal size={15} />
                <select
                  value={listStatusFilter}
                  onChange={(event) => setListStatusFilter(event.target.value as ProjectStatus | 'all')}
                  aria-label="단계 필터"
                >
                  <option value="all">전체 단계</option>
                  {workflow.map((item) => (
                    <option key={item.status} value={item.status}>{statusLabels[item.status]}</option>
                  ))}
                  <option value="rejected">{statusLabels.rejected}</option>
                </select>
              </div>
              <div className="listFilterBox">
                <select
                  value={listTeamFilter}
                  onChange={(event) => setListTeamFilter(event.target.value)}
                  aria-label="담당 팀 필터"
                >
                  <option value="all">전체 담당팀</option>
                  {teamFilterOptions.map((team) => (
                    <option key={team} value={team}>{team}</option>
                  ))}
                </select>
              </div>
              <div className="listFilterBox">
                <select
                  value={listPriorityFilter}
                  onChange={(event) => setListPriorityFilter(event.target.value as Priority | 'all')}
                  aria-label="우선순위 필터"
                >
                  <option value="all">전체 우선순위</option>
                  {(['urgent', 'high', 'normal', 'low'] as Priority[]).map((p) => (
                    <option key={p} value={p}>{priorityLabels[p]}</option>
                  ))}
                </select>
              </div>
              <div className="listFilterBox">
                <select
                  value={listTypeFilter}
                  onChange={(event) => setListTypeFilter(event.target.value as ProjectRequestType | 'all')}
                  aria-label="요청 유형 필터"
                >
                  <option value="all">전체 유형</option>
                  {(Object.keys(requestTypeLabels) as ProjectRequestType[]).map((t) => (
                    <option key={t} value={t}>{requestTypeLabels[t]}</option>
                  ))}
                </select>
              </div>
              <div className="listFilterBox">
                <select
                  value={listServiceFilter}
                  onChange={(event) => setListServiceFilter(event.target.value)}
                  aria-label="서비스 필터"
                >
                  <option value="all">전체 서비스</option>
                  {serviceOptions.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
                {/* 모바일 sheet 하단 액션 */}
                <div className="filterSheetFooter">
                  <button type="button" className="filterSheetReset" onClick={clearAllListFilters}>전체 해제</button>
                  <button type="button" className="filterSheetApply" onClick={() => setFilterSheetOpen(false)}>적용</button>
                </div>
              </div>
              <button
                type="button"
                className="csvExportButton"
                disabled={filteredProjects.length === 0}
                title="현재 목록을 CSV로 내보내기"
                onClick={() => {
                  const header = ['코드', '제목', '요청유형', '담당팀', '요청자', '우선순위', '단계', '진행률(%)', '마감일', '등록일']
                  const rows = filteredProjects.map((p) => [
                    p.code, p.title, requestTypeLabels[p.requestType], p.ownerTeam, p.requester,
                    priorityLabels[p.priority], statusLabels[p.status], p.progress, p.dueDate, p.createdAt,
                  ])
                  downloadCsv(`projects_${todayStamp()}.csv`, [header, ...rows])
                }}
              >
                <Download size={15} /> CSV
              </button>
            </div>
            {/* 모바일 필터 시트 배경 */}
            {filterSheetOpen && <div className="filterSheetBackdrop" onClick={() => setFilterSheetOpen(false)} aria-hidden="true" />}

            <div className="projectList">
              {filteredProjects.map((project) => {
                const sendResult = boardResults[project.id]
                const sending = boardSendingId === project.id
                // 새로고침 후에도 유지되도록 활동 로그 기준으로 게시 여부 판정
                const posted = sendResult?.ok ?? hasBeenPostedToBoard(project)
                // '완료 보고' 단계에서만 게시판 전송 노출 (PM·관리자)
                const canSendToBoard = project.status === 'completion' && (role === 'pm' || role === 'admin')
                const sendBlockedReason = !project.requesterConfirmed ? '요청자 확인이 완료되어야 등록할 수 있습니다' : null
                return (
                  <div key={project.id} className="projectCardRow">
                    <button
                      className={`projectCard ${selected?.id === project.id ? 'selected' : ''} ${project.onHold ? 'onHold' : ''}`}
                      type="button"
                      onClick={() => setSelectedId(project.id)}
                    >
                      <span className={`statusPill ${project.status}`}>
                        <span className="stageFull">{statusLabels[project.status]}</span>
                        <span className="stageShort">{shortStatusLabels[project.status]}</span>
                      </span>
                      <strong>{project.title}</strong>
                      <span className="cardMeta">
                        <span className="serviceBadge">{inferServiceOption(project, serviceOptions)}</span>
                        <span className="requestTypePill">{requestTypeLabels[project.requestType]}</span>
                        <span className={`priority ${project.priority}`}>{priorityLabels[project.priority]}</span>
                        <span>{project.ownerTeam}</span>
                        {(() => { const dd = dDayInfo(project.dueDate, demoToday); return <span className={`ddayPill ${dd.tone}`}>{dd.label}</span> })()}
                      </span>
                    </button>
                    {canSendToBoard && (
                      <button
                        type="button"
                        className={`miniButton boardSendButton ${posted ? 'sent' : ''}`}
                        disabled={sending || Boolean(boardSendingId) || Boolean(sendBlockedReason)}
                        onClick={() => void sendProjectToBoard(project)}
                        title={sendBlockedReason ?? sendResult?.message ?? '완료 보고를 동사무소 게시판에 등록합니다'}
                      >
                        <Send size={13} />
                        {sending ? '전송 중…' : posted ? '게시됨' : '전송'}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>

          </div>

          {selected && !(role !== 'admin' && !canAct && !isProjectAssignedToRole(selected, role) && !(isRequesterRole(role) && selected.requester === currentUserName)) && (
            <div className="detailHeaderPanel">
              <div className="flowRequestHead">
                <div>
                  <p className="eyebrow">
                    <span className="mobileOptionalText">Project · </span>
                    {selected.code}
                  </p>
                  <h2>{selected.title}</h2>
                </div>
                <div className="flowHeadActions">
                  <span className={`statusPill ${selected.status}`}>{statusLabels[selected.status]}</span>
                  <span className="flowCurrentStep">
                    <span className="mobileOptionalText">현재 단계 </span>
                    {currentStep + 1}. {selectedWorkflow[currentStep]?.label}
                  </span>
                  {canAct && (
                    <button
                      type="button"
                      className={`miniButton ${selected.onHold ? 'holdActive' : ''}`}
                      onClick={() => void toggleHoldProject(selected.id)}
                      title={selected.onHold ? '보류를 해제합니다' : '현재 단계 담당자가 프로젝트를 보류합니다(사유 입력)'}
                    >
                      {selected.onHold ? '보류 해제' : '보류'}
                    </button>
                  )}
                </div>
              </div>

              <ol className="flowStepper projectFlowStepper detailStepper" aria-label="프로젝트 진행 단계">
                {selectedWorkflow.map((item, index) => {
                  const state = index < currentStep ? 'done' : index === currentStep ? 'current' : 'pending'
                  const viewing = index === viewedStep
                  return (
                    <li key={item.status} className={`flowStepperItem ${state} ${viewing ? 'viewing' : ''}`}>
                      <button
                        type="button"
                        className="flowStepperBtn"
                        disabled={state === 'pending'}
                        onClick={() => setViewedStageIndex(index)}
                        title={state === 'pending' ? `${item.label} 단계는 아직 진행되지 않았습니다` : `${item.label} 단계 보기`}
                      >
                        <span className="flowStepNum">{state === 'done' ? <Check size={13} /> : index + 1}</span>
                        <span className="flowStepText">
                          <strong>{item.label}</strong>
                          <em>{item.owner}</em>
                        </span>
                      </button>
                      {index < selectedWorkflow.length - 1 && <span className="flowStepConn" aria-hidden="true" />}
                    </li>
                  )
                })}
              </ol>
            </div>
          )}

          </div>

          {selected && role !== 'admin' && !canAct && !isProjectAssignedToRole(selected, role) && !(isRequesterRole(role) && selected.requester === currentUserName) ? (
          <div className="detailPanel emptyStatePanel">
            <strong>{roleLabels[role]} 역할의 작업이 없습니다.</strong>
            <span>이 프로젝트의 현재 단계는 {statusLabels[selected.status]}이며, {roleLabels[role]} 차례가 아닙니다.</span>
          </div>
          ) : selected ? (
          <div className="detailPanel">

            {viewedStatus === 'request' && (
            <RequesterContentPanel
              project={selected}
              currentRole={role}
              highlight={role === 'requester' && selected.status === 'request'}
              canEdit={(role === 'requester' || role === 'admin') && ['request', 'planning'].includes(selected.status)}
              onSave={(patch) => void updateRequesterContent(patch)}
              onEditInquiry={(id, msg, prefix) => void editProjectComment(id, msg, prefix)}
              onDeleteInquiry={(id) => void deleteProjectComment(id)}
            />
            )}

            {viewedStatus === 'planning' && (
            !planningRequiredByType[selected.requestType] ? (
            <section className="requirementsPanel numberedSection sectionSrsSds" data-section="기획" data-section-tone="planning">
              <div className="panelHeader compact">
                <h3>기획 문서 (생략)</h3>
                <span>{requestTypeLabels[selected.requestType]} 유형은 SRS/SDS 없이 바로 승인 단계로 진행합니다.</span>
              </div>
            </section>
            ) : (
            <section className={`requirementsPanel numberedSection sectionSrsSds ${['pm', 'requester'].includes(role) && !selected.docsLocked && selected.status === 'planning' ? 'neonHighlight' : ''}`} data-section="기획 (SRS+SDS)" data-section-tone="planning">
              <div className="panelHeader compact">
                <h3>기획 문서 (요구사항 정의서 · SRS)</h3>
                <span>
                  {selected.docsLocked
                    ? '승인 완료 · 잠김 (수정하려면 이전 단계로 회송)'
                    : ['pm', 'requester'].includes(role)
                    ? (isPlanningRequired(selected)
                        ? 'PM이 요구사항 정의서 작성 (설계 명세서는 개발 단계)'
                        : 'PM 기획 생략 — 요청자가 직접 요구사항 정의서 작성 (설계 명세서는 개발 단계)')
                    : '읽기 전용'}
                </span>
              </div>
              {(['pm', 'requester', 'admin'].includes(role)) && !selected.docsLocked && (
                <div className="approvalPreset planningApproval">
                  <strong>승인 필요 역할</strong>
                  <div className="approvalSummary">
                    {fullApprovalRoles.map((r) => {
                      const checked = selectedApprovalState.requiredRoles.includes(r)
                      return (
                        <button
                          key={r}
                          type="button"
                          className={`approvalPill ${checked ? 'pending' : 'unchecked'}`}
                          onClick={() => {
                            const nextRequired = checked
                              ? selectedApprovalState.requiredRoles.filter((x) => x !== r)
                              : [...selectedApprovalState.requiredRoles, r]
                            void patchSelectedProject(
                              { approvalState: { ...selectedApprovalState, requiredRoles: nextRequired, approvedRoles: selectedApprovalState.approvedRoles.filter((x) => nextRequired.includes(x)) } },
                              `승인 필요 역할을 변경했습니다: ${nextRequired.map((x) => approvalStepLabels[x]).join(', ') || '없음'}`,
                            )
                          }}
                        >
                          {approvalStepLabels[r]}
                        </button>
                      )
                    })}
                  </div>
                  <p className="approvalGuide">기획 단계에서 승인 대상을 정합니다. 체크된 역할만 승인 단계에서 승인합니다.</p>
                </div>
              )}
              {(['pm', 'requester'].includes(role) || role === 'admin') && !selected.docsLocked ? (
                <>
                  <div className={`srsSdsRow ${srsCollapsed ? 'srsCollapsed' : ''} ${sdsCollapsed ? 'sdsCollapsed' : ''}`}>
                    <section className={`requirementsPanel docCard srsCard ${srsCollapsed ? 'collapsed' : ''}`}>
                      <div className="panelHeader compact docCardHeader" role="button" onClick={() => { const next = !srsCollapsed; setSrsCollapsed(next); if (next) setSdsCollapsed(false) }} title={srsCollapsed ? '펼치기' : '접기'}>
                        <h3><span className="docTag srsTag">SRS</span> <span className="docTitle">요구사항 정의서</span></h3>
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
                  </div>
                  <div className="docSaveBar">
                    <button className="primaryButton" type="button" onClick={() => void updateSelectedReviewDocs()}>
                      문서 저장
                    </button>
                  </div>
                </>
              ) : (
                <div className={`srsSdsRow ${srsCollapsed ? 'srsCollapsed' : ''} ${sdsCollapsed ? 'sdsCollapsed' : ''}`}>
                  <section className={`requirementsPanel docCard srsCard ${srsCollapsed ? 'collapsed' : ''}`}>
                    <div className="panelHeader compact docCardHeader" role="button" onClick={() => { const next = !srsCollapsed; setSrsCollapsed(next); if (next) setSdsCollapsed(false) }} title={srsCollapsed ? '펼치기' : '접기'}>
                      <h3><span className="docTag srsTag">SRS</span> <span className="docTitle">요구사항 정의서</span></h3>
                    </div>
                    <SrsReadView srs={selected.reviewDocs?.srs ?? ''} />
                    {(selected.reviewDocs?.srsAttachments?.length ?? 0) > 0 && (
                      <ul className="docAttachmentList">
                        {selected.reviewDocs?.srsAttachments?.map((file) => (
                          <li key={file.id}>
                            <button
                              type="button"
                              className="attachmentLink"
                              onClick={() => setPreviewAttachment({ name: file.name, type: file.type, dataUrl: file.dataUrl, key: file.key, size: file.size })}
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
            ))}

            {viewedStatus === 'qc_security' && (
            <section className="requirementsPanel numberedSection sectionSrsSds" data-section="기획·설계 문서 (SRS · SDS)" data-section-tone="planning">
              <div className="panelHeader compact">
                <h3>기획·설계 문서 (SRS · SDS)</h3>
                <span>읽기 전용 (검토용) — 요구사항(SRS)과 설계(SDS)를 함께 검토</span>
              </div>
              <div className="srsSdsRow">
                <section className="requirementsPanel docCard srsCard">
                  <div className="panelHeader compact docCardHeader">
                    <h3><span className="docTag srsTag">SRS</span> <span className="docTitle">요구사항 정의서</span></h3>
                  </div>
                  <SrsReadView srs={selected.reviewDocs?.srs ?? ''} />
                </section>
                <section className="requirementsPanel docCard sdsCard">
                  <div className="panelHeader compact docCardHeader">
                    <h3><span className="docTag sdsTag">SDS</span> <span className="docTitle">설계 명세서</span></h3>
                  </div>
                  <SdsReadView sds={selected.reviewDocs?.sds ?? ''} />
                </section>
              </div>
            </section>
            )}

            {viewedStatus === 'development' && (
            <section className={`requirementsPanel numberedSection sectionSrsSds ${selected.status === 'development' && ['developer', 'pm'].includes(role) && !hasSdsDraft ? 'neonHighlight' : ''}`} data-section="설계 명세서 (SDS)" data-section-tone="planning">
              <div className="panelHeader compact">
                <h3><span className="docTag sdsTag">SDS</span> <span className="docTitle">설계 명세서</span></h3>
                <span>{viewedStatus === 'development' && ['developer', 'pm', 'admin'].includes(role) ? '개발 단계에서 개발(리더)이 설계 작성 · 첨부 가능' : '읽기 전용 (검토용)'}</span>
              </div>
              {viewedStatus === 'development' && ['developer', 'pm', 'admin'].includes(role) ? (
                <div className="requestForm securityReviewEditor">
                  <div className="formGrid">
                    <label>
                      <span>설계 내용</span>
                      <RichEditor
                        value={currentReviewDocsDraft.sds}
                        placeholder={'예: 아키텍처 개요, 데이터/연동 설계, API, 보안·예외 처리, 배포·운영'}
                        minHeight={160}
                        onChange={(html) => setReviewDocsDrafts((current) => ({ ...current, [selected.id]: { ...currentReviewDocsDraft, sds: html } }))}
                      />
                    </label>
                  </div>
                  <DocAttachmentField
                    label="SDS 첨부 문서"
                    attachments={currentReviewDocsDraft.sdsAttachments ?? []}
                    onChange={(next) => setReviewDocsDrafts((current) => ({ ...current, [selected.id]: { ...currentReviewDocsDraft, sdsAttachments: next } }))}
                    onPreview={setPreviewAttachment}
                  />
                  <div className="docSaveBar">
                    <button className="primaryButton" type="button" onClick={() => void updateSelectedReviewDocs()}>설계 저장</button>
                  </div>
                </div>
              ) : (
                <SdsReadView sds={selected.reviewDocs?.sds ?? ''} />
              )}
            </section>
            )}

            {viewedStatus === 'development' && ['pm', 'developer', 'admin'].includes(role) && (
            <section className={`requirementsPanel numberedSection sectionSchedule ${selected.status === 'development' && viewedStep === currentStep ? 'neonHighlight' : ''}`} data-section="일정 조율" data-section-tone="schedule">
              <div className="panelHeader compact">
                <h3>일정 조율</h3>
                <span>요청자 희망 완료일 {formatDate(selected.dueDate)} 기준으로 기획(PM)과 개발이 협의해 실제 일정을 확정합니다.</span>
              </div>
              {['pm', 'developer', 'admin'].includes(role) ? (
                <div className="scheduleEditor">
                  <div className="scheduleDateRow">
                    <label>
                      <span>착수 예정일</span>
                      <input
                        type="date"
                        value={currentScheduleDraft.plannedStart}
                        onChange={(e) => setScheduleDrafts((c) => ({ ...c, [selected.id]: { ...currentScheduleDraft, plannedStart: e.target.value } }))}
                      />
                    </label>
                    <label>
                      <span>완료 예정일</span>
                      <input
                        type="date"
                        value={currentScheduleDraft.plannedEnd}
                        onChange={(e) => setScheduleDrafts((c) => ({ ...c, [selected.id]: { ...currentScheduleDraft, plannedEnd: e.target.value } }))}
                      />
                    </label>
                    <span className={`scheduleCompare ${currentScheduleDraft.plannedEnd && currentScheduleDraft.plannedEnd > selected.dueDate ? 'info' : 'onTime'}`}>
                      {currentScheduleDraft.plannedEnd
                        ? currentScheduleDraft.plannedEnd > selected.dueDate
                          ? `희망일 +${Math.ceil((new Date(currentScheduleDraft.plannedEnd).getTime() - new Date(selected.dueDate).getTime()) / 86_400_000)}일 (개발 확정 일정)`
                          : '희망일 내 완료 예정'
                        : '완료 예정일 미정'}
                    </span>
                  </div>
                  <div className="scheduleField">
                    <span>주요 마일스톤</span>
                    <RichEditor
                      value={currentScheduleDraft.milestones}
                      placeholder="예) 설계 완료 6/5 · 개발 완료 6/20 · QA 6/25"
                      minHeight={40}
                      onChange={(html) => setScheduleDrafts((c) => ({ ...c, [selected.id]: { ...currentScheduleDraft, milestones: html } }))}
                    />
                  </div>
                  <div className="scheduleField">
                    <span>일정 협의 메모</span>
                    <RichEditor
                      value={currentScheduleDraft.note}
                      placeholder="일정 조율 과정에서의 합의 사항, 리스크, 의존성 등을 적어주세요."
                      minHeight={40}
                      onChange={(html) => setScheduleDrafts((c) => ({ ...c, [selected.id]: { ...currentScheduleDraft, note: html } }))}
                    />
                  </div>
                  <div className="docSaveBar scheduleSaveBar">
                    <span className="dueDateConfirmHint">
                      {selected.schedule?.confirmed
                        ? `마감일 확정됨 · ${formatDate(selected.dueDate)}${selected.schedule.confirmedBy ? ` (${selected.schedule.confirmedBy})` : ''}`
                        : '마감일은 이 단계의 일정 조율 결과로 확정됩니다.'}
                    </span>
                    <button className="miniButton" type="button" onClick={() => void updateSelectedSchedule()}>
                      일정 저장
                    </button>
                    <button
                      className="primaryButton"
                      type="button"
                      disabled={!currentScheduleDraft.plannedEnd}
                      title={currentScheduleDraft.plannedEnd ? '완료 예정일을 프로젝트 마감일로 확정합니다' : '완료 예정일을 먼저 입력하세요'}
                      onClick={() => void updateSelectedSchedule(true)}
                    >
                      {selected.schedule?.confirmed ? '마감일 재확정' : '마감일 확정'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="scheduleReadView">
                  <div className="scheduleDateRow">
                    <div className="scheduleReadItem"><span>착수 예정일</span><strong>{selected.schedule?.plannedStart || '미정'}</strong></div>
                    <div className="scheduleReadItem"><span>완료 예정일</span><strong>{selected.schedule?.plannedEnd || '미정'}</strong></div>
                    <div className="scheduleReadItem"><span>희망 완료일</span><strong>{formatDate(selected.dueDate)}</strong></div>
                  </div>
                  <div className="scheduleReadBlock"><span>주요 마일스톤</span><RichTextView html={selected.schedule?.milestones ?? ''} fallback="아직 등록된 마일스톤이 없습니다." /></div>
                  <div className="scheduleReadBlock"><span>일정 협의 메모</span><RichTextView html={selected.schedule?.note ?? ''} fallback="아직 등록된 협의 메모가 없습니다." /></div>
                </div>
              )}
            </section>
            )}

            {(viewedStatus === 'development' || viewedStatus === 'qc_security') && viewedStep <= currentStep && (() => {
              const taskLabel = viewedStatus === 'qc_security' ? '검토 태스크(일감) 등록' : '개발 태스크(일감) 등록'
              return (
                <ProjectTasksPanel
                  project={selected}
                  onStatusChange={changeTaskStatus}
                  onAddComment={(taskId, message) => void addTaskComment(taskId, message)}
                  onAddTask={(task) => void addTaskToProject(selected.id, task)}
                  onEditTask={(taskId, patch) => void editTaskInProject(selected.id, taskId, patch)}
                  onDeleteTask={(taskId) => void deleteTaskInProject(selected.id, taskId)}
                  onPreviewAttachment={setPreviewAttachment}
                  currentRole={role}
                  stage={viewedStatus}
                  label={taskLabel}
                />
              )
            })()}

            {/* 단계 문의 / 논의 — 승인 단계 제외한 모든 단계의 하단에 표시 */}
            {viewedStatus !== 'dept_review' && viewedStatus !== 'rejected' && (
              <section className="requirementsPanel numberedSection sectionInquiry" data-section="단계 문의" data-section-tone="inquiry">
                <div className="panelHeader compact">
                  <h3>{statusLabels[viewedStatus]} 문의 / 논의</h3>
                  <span>이 단계와 관련된 문의·의견 · 전 역할 작성 가능</span>
                </div>
                <SectionInquiryBox
                  sectionLabel={statusLabels[viewedStatus]}
                  comments={selected.comments?.filter((c) => c.stage === viewedStatus)}
                  currentRole={role}
                  onAdd={(msg, parentId) => void addProjectCommentForStage(viewedStatus, msg, parentId)}
                  onEdit={(id, msg, prefix) => void editProjectComment(id, msg, prefix)}
                  onDelete={(id) => void deleteProjectComment(id)}
                />
              </section>
            )}

            {selected.onHold && (
              <div className="holdBanner" role="status">
                <strong>보류 중</strong>
                <span>{selected.holdReason || '진행이 일시 중단된 상태입니다. PM 또는 관리자가 해제할 때까지 단계 진행이 잠깁니다.'}</span>
              </div>
            )}

            {viewedStep === currentStep && ['request', 'planning', 'development'].includes(viewedStatus) && (() => {
              const canEditSkip = viewedStatus === 'request' && ['pm', 'requester', 'admin'].includes(role)
              const skipEnabled = !isPlanningRequired(selected)
              const skipReasonValue = skipReasonDrafts[selected.id] ?? selected.workflowConfig.skipReason ?? ''
              // 생략 사유 검증은 요청 단계에서만 적용
              const skipReasonMissing = viewedStatus === 'request' && skipEnabled && skipReasonValue.trim().length === 0
              const canAdvance = viewedStatus === 'request'
                ? (['pm', 'admin'].includes(role) || (skipEnabled && role === 'requester'))
                : viewedStatus === 'development'
                  ? ['pm', 'developer', 'admin'].includes(role)
                  : ['pm', 'requester', 'admin'].includes(role)
              const isDisabled = !canAdvance || isStepAdvanceBlocked || selected.onHold || skipReasonMissing
              const bannerMsg = selected.nextAction || (
                viewedStatus === 'request' ? '요청 내용을 검토한 뒤 기획 단계로 진행하세요.'
                : viewedStatus === 'development' ? '개발 완료 후 검토 단계로 진행하세요.'
                : 'SRS·SDS 문서를 등록하면 승인 단계로 진행할 수 있습니다.')
              return (
            <div className="actionBanner simpleAction">
              <div className="simpleActionRow">
                <strong>{bannerMsg}</strong>
                <div className="actionButtons">
                  {canEditSkip && (
                    <button
                      type="button"
                      className={`planningSkipSlider ${skipEnabled ? 'active' : ''}`}
                      title="PM 기획 단계를 거치지 않고 요청자가 직접 SRS를 작성합니다. 요구사항 정의서 자체가 생략되는 것은 아닙니다."
                      onClick={() => void togglePlanningRequired()}
                    >
                      <span className="sliderTrack">
                        <span className="sliderThumb" />
                      </span>
                      <span>PM 기획 생략</span>
                    </button>
                  )}
                  <button
                    className="primaryButton"
                    type="button"
                    disabled={isDisabled}
                    title={skipReasonMissing ? 'PM 기획 생략 사유를 입력해야 진행할 수 있습니다.' : undefined}
                    onClick={() => void advanceSelectedProject()}
                  >
                    <Send size={16} />
                    단계 진행
                  </button>
                </div>
              </div>
              {skipEnabled && canEditSkip && (
                <label className="skipReasonField">
                  <span>PM 기획 생략 사유 <em>(필수)</em></span>
                  <input
                    type="text"
                    value={skipReasonValue}
                    placeholder="PM 기획 단계 없이 직접 기획·SRS/SDS를 작성하려는 사유를 입력하세요"
                    onChange={(e) => setSkipReasonDrafts((d) => ({ ...d, [selected.id]: e.target.value }))}
                    onBlur={() => void saveSkipReason()}
                  />
                </label>
              )}
            </div>
              )
            })()}

            {viewedStep === currentStep && ['dept_review', 'qc_security', 'deployment', 'completion', 'rejected'].includes(viewedStatus) && (
            <div className={`actionBanner ${['completion', 'rejected'].includes(viewedStatus) ? 'rowAction' : ''} ${canAct && !selected.onHold ? 'neonHighlight' : ''}`} data-section="현재 단계 액션" data-section-tone="approval">
              <div>
                <strong>{selected.status === 'dept_review' ? '승인 단계' : selected.status === 'qc_security' ? '개발·QA·보안·PM 4자 검토' : selected.status === 'deployment' ? '배포 (운영 반영)' : (canAct ? selected.nextAction : `${roleLabels[role]} 역할은 현재 단계에서 대기 상태입니다.`)}</strong>
                <span>담당: {selected.status === 'qc_security' ? 'QA · 보안 · PM' : roleLabels[selected.assigneeRole]} · 마감 {formatDate(selected.dueDate)}</span>
                {selected.status === 'dept_review' && (
                  <div className="approvalGrid" style={{ ['--cols' as string]: selectedApprovalState.requiredRoles.length }}>
                    <div className="approvalUnitGrid">
                      {selectedApprovalState.requiredRoles.map((r) => {
                        const done = selectedApprovalState.approvedRoles.includes(r)
                        const isMine = r === role && !done && canApproveCurrentRole
                        return (
                          <div key={r} className={`approvalUnitCard ${done ? 'done' : isMine ? 'mine' : 'pending'}`}>
                            <div className="approvalUnitHead">{approvalStepLabels[r]}</div>
                            <button
                              type="button"
                              className={`approvalCellPill ${done ? 'done' : isMine ? 'mine' : 'pending'}`}
                              disabled={!isMine && !done}
                              onClick={() => { if (isMine) setApprovalInlineOpen((v) => !v) }}
                              title={done ? '확인 완료' : isMine ? '내 차례 — 클릭하면 의견·승인/보류 입력' : '대기'}
                            >
                              {done ? '완료' : isMine ? '확인' : '승인'}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                    <div className="approvalGridFoot">
                      <span><b>{selectedApprovalState.approvedRoles.length}</b> / {selectedApprovalState.requiredRoles.length} 완료</span>
                      {pendingApprovalRoles.length === 0 && <span className="doneAll">모든 역할 확인 완료 · 자동 진행</span>}
                    </div>

                    {approvalInlineOpen && canApproveCurrentRole && (
                      <div className="approvalInlineComposer">
                        <label className="approvalInlineLabel">
                          <span>{approvalStepLabels[role]} 의견 (선택)</span>
                          <textarea
                            rows={3}
                            placeholder="검토 의견·이유·조건을 적어 주세요. 빈 칸으로 두고 승인할 수도 있습니다."
                            value={approvalMemoDraft}
                            onChange={(e) => setApprovalMemoDraft(e.target.value)}
                          />
                        </label>
                        <div className="approvalInlineActions">
                          <button
                            type="button"
                            className="approveBtn"
                            onClick={() => { void approveCurrentRole(approvalMemoDraft); setApprovalMemoDraft(''); setApprovalInlineOpen(false) }}
                          >
                            승인
                          </button>
                          <button
                            type="button"
                            className="holdBtn"
                            onClick={() => { void toggleHoldSelectedProject(); setApprovalInlineOpen(false) }}
                          >
                            보류
                          </button>
                          <button
                            type="button"
                            className="rejectBtn"
                            onClick={() => setRejectOpen((v) => !v)}
                          >
                            반려
                          </button>
                          <button
                            type="button"
                            className="closeBtn"
                            onClick={() => { setApprovalInlineOpen(false); setRejectOpen(false) }}
                          >
                            닫기
                          </button>
                        </div>
                        {rejectOpen && (
                          <div className="rejectComposer">
                            <span className="rejectComposerLabel">반려 사유 — 프리셋 선택 또는 직접 입력</span>
                            <div className="rejectPresetList">
                              {rejectReasonPresets.map((preset) => (
                                <button
                                  key={preset}
                                  type="button"
                                  className={`rejectPreset ${rejectReasonDraft === preset ? 'active' : ''}`}
                                  onClick={() => setRejectReasonDraft(preset)}
                                >
                                  {preset}
                                </button>
                              ))}
                            </div>
                            <textarea
                              rows={2}
                              placeholder="반려 사유를 입력하거나 위 프리셋을 선택하세요."
                              value={rejectReasonDraft}
                              onChange={(e) => setRejectReasonDraft(e.target.value)}
                            />
                            <div className="rejectComposerActions">
                              <button
                                type="button"
                                className="rejectConfirmBtn"
                                onClick={() => { void rejectSelectedProject(rejectReasonDraft); setRejectReasonDraft(''); setRejectOpen(false); setApprovalInlineOpen(false) }}
                              >
                                반려 확정
                              </button>
                              <button type="button" className="closeBtn" onClick={() => setRejectOpen(false)}>취소</button>
                            </div>
                          </div>
                        )}
                        <div className="approvalCommentRow inline">
                          <input
                            type="text"
                            value={approvalCommentInput}
                            onChange={(e) => setApprovalCommentInput(e.target.value)}
                            placeholder="댓글 입력 (승인 전 확인해야 하는 내용이 있다면 입력)"
                          />
                          <button
                            type="button"
                            className="miniButton"
                            onClick={() => {
                              const t = approvalCommentInput.trim()
                              if (!t) return
                              void addProjectCommentForStage('dept_review', t)
                              setApprovalCommentInput('')
                            }}
                          >
                            저장
                          </button>
                        </div>
                      </div>
                    )}

                  </div>
                )}
                {selected.status === 'qc_security' && (
                  <div className="qcReviewBlock">
                    <div className="qcReviewGrid">
                      {qcSignoffRoles.map((r) => {
                        const label = qcSignoffLabels[r]
                        const work = qcSignoffWork[r]
                        const done = qcSignoff[r]
                        const review = qcSignoff.reviews?.[r]
                        const isMine = (r === myQcSignoffRole) || role === 'admin'
                        // QA 통합테스트는 개발자 단위테스트가 끝나야 시작 가능
                        const blocked = r === 'qa' && qaBlockedByUnitTest
                        return (
                          <div key={r} className={`qcReviewCard ${done ? 'done' : blocked ? 'blocked' : 'pending'}`}>
                            <div className="qcReviewHead">
                              <strong>{qcSignoffTitles[r]}</strong>
                              <span className={`qcReviewBadge ${done ? 'done' : blocked ? 'blocked' : 'pending'}`}>
                                {done ? '완료' : blocked ? '선행 대기' : '대기'}
                              </span>
                            </div>
                            {done ? (
                              <div className="qcReviewBody">
                                <p className="qcReviewNote">{review?.note?.trim() || '검토 내용 미입력'}</p>
                                <small>{review?.actor ?? label} · {review?.at ? formatTimestamp(review.at) : ''}</small>
                                {isMine && (
                                  <button className="miniButton qcReviewCancel" type="button" onClick={() => void toggleQcSignoff(r)}>
                                    검토 취소
                                  </button>
                                )}
                              </div>
                            ) : blocked ? (
                              <p className="qcReviewWait">개발 단위테스트 완료 후 진행</p>
                            ) : isMine && !selected.onHold ? (
                              <div className="qcReviewBody">
                                <textarea
                                  rows={2}
                                  className="qcReviewInput"
                                  placeholder={`${work} 결과 (예: ${work} 완료, 이슈 없음)`}
                                  value={qcReviewDraft}
                                  onChange={(e) => setQcReviewDraft(e.target.value)}
                                />
                                <button
                                  className="miniButton approveButton"
                                  type="button"
                                  onClick={() => { void toggleQcSignoff(r, qcReviewDraft); setQcReviewDraft('') }}
                                >
                                  {work} 완료
                                </button>
                              </div>
                            ) : (
                              <p className="qcReviewWait">담당자 검토 대기 중</p>
                            )}
                          </div>
                        )
                      })}
                    </div>
                    <span className="approvalGuide">
                      {qcAllSignedOff
                        ? '개발·QA·보안·PM 검토 완료 · 다음 단계 진행 가능'
                        : `검토 대기: ${qcPendingRoles.map((r) => qcSignoffTitles[r]).join(', ')}`}
                      {' · 순서: 단위테스트 → 통합테스트 (보안테스트는 병행)'}
                    </span>
                    {(myQcSignoffRole || role === 'admin') && !selected.onHold && (
                      <div className="qcRejectArea">
                        <button type="button" className="rejectBtn" onClick={() => setRejectOpen((v) => !v)}>
                          개발 단계로 되돌리기
                        </button>
                        {rejectOpen && (
                          <div className="rejectComposer">
                            <span className="rejectComposerLabel">
                              남은 Bug·취약점 — 프리셋 선택 또는 직접 입력 (검토 완료 상태는 모두 초기화됩니다)
                            </span>
                            <div className="rejectPresetList">
                              {rejectReasonPresets.map((preset) => (
                                <button
                                  key={preset}
                                  type="button"
                                  className={`rejectPreset ${rejectReasonDraft === preset ? 'active' : ''}`}
                                  onClick={() => setRejectReasonDraft(preset)}
                                >
                                  {preset}
                                </button>
                              ))}
                            </div>
                            <textarea
                              rows={2}
                              placeholder="반려 사유를 입력하거나 위 프리셋을 선택하세요."
                              value={rejectReasonDraft}
                              onChange={(e) => setRejectReasonDraft(e.target.value)}
                            />
                            <div className="rejectComposerActions">
                              <button
                                type="button"
                                className="rejectConfirmBtn"
                                onClick={() => { void rejectSelectedProject(rejectReasonDraft); setRejectReasonDraft(''); setRejectOpen(false) }}
                              >
                                개발 단계로 되돌리기
                              </button>
                              <button type="button" className="closeBtn" onClick={() => setRejectOpen(false)}>취소</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {selected.status === 'deployment' && (
                  <div className="qcReviewBlock">
                    <div className="qcReviewGrid">
                      {(() => {
                        const done = deployment.released
                        const isMine = role === 'infra' || role === 'pm' || role === 'admin'
                        return (
                          <div className={`qcReviewCard ${done ? 'done' : 'pending'}`}>
                            <div className="qcReviewHead">
                              <strong>운영 반영</strong>
                              <span className={`qcReviewBadge ${done ? 'done' : 'pending'}`}>{done ? '완료' : '대기'}</span>
                            </div>
                            {done ? (
                              <div className="qcReviewBody">
                                <p className="qcReviewNote">{deployment.note?.trim() || '배포 메모 미입력'}</p>
                                {deployment.releasedAt && (
                                  <small>{deployment.releasedBy ?? ''} · {formatTimestamp(deployment.releasedAt)}</small>
                                )}
                                {isMine && (
                                  <button className="miniButton qcReviewCancel" type="button" onClick={() => void toggleDeployStep()}>
                                    반영 취소
                                  </button>
                                )}
                              </div>
                            ) : isMine && !selected.onHold ? (
                              <div className="qcReviewBody">
                                <textarea
                                  rows={2}
                                  className="qcReviewInput"
                                  placeholder="배포 방식·버전·롤백 계획 (예: v1.4.2 blue-green, 롤백 태그 v1.4.1)"
                                  value={deployNoteDraft}
                                  onChange={(e) => setDeployNoteDraft(e.target.value)}
                                />
                                <button
                                  className="miniButton approveButton"
                                  type="button"
                                  onClick={() => { void toggleDeployStep(deployNoteDraft); setDeployNoteDraft('') }}
                                >
                                  운영 반영 완료
                                </button>
                              </div>
                            ) : (
                              <p className="qcReviewWait">인프라 처리 대기 중</p>
                            )}
                          </div>
                        )
                      })()}
                    </div>
                    <span className="approvalGuide">
                      {deployDone ? '운영 반영 완료 · 완료 보고로 진행 가능' : '인프라가 운영에 반영하면 완료 보고로 진행할 수 있습니다.'}
                    </span>
                    {(role === 'infra' || role === 'pm' || role === 'admin') && !selected.onHold && (
                      <div className="qcRejectArea">
                        <button type="button" className="rejectBtn" onClick={() => setRejectOpen((v) => !v)}>
                          배포 실패 · 개발 단계로 롤백
                        </button>
                        {rejectOpen && (
                          <div className="rejectComposer">
                            <span className="rejectComposerLabel">롤백 사유 (배포·검토 상태가 모두 초기화됩니다)</span>
                            <textarea
                              rows={2}
                              placeholder="예) 운영 반영 후 결제 API 오류 발생, v1.4.1로 롤백"
                              value={rejectReasonDraft}
                              onChange={(e) => setRejectReasonDraft(e.target.value)}
                            />
                            <div className="rejectComposerActions">
                              <button
                                type="button"
                                className="rejectConfirmBtn"
                                onClick={() => { void rollbackDeployment(rejectReasonDraft); setRejectReasonDraft(''); setRejectOpen(false) }}
                              >
                                개발 단계로 롤백
                              </button>
                              <button type="button" className="closeBtn" onClick={() => setRejectOpen(false)}>취소</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
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
                {selected.status === 'completion' && !selected.published && (role === 'requester' || role === 'admin') && (
                  <button className="miniButton approveButton" type="button" onClick={() => void confirmByRequester()}>
                    요청자 확인 {selected.requesterConfirmed ? '취소' : '완료'}
                  </button>
                )}
                {selected.status === 'completion' && canAct && !selected.onHold && !isStepAdvanceBlocked && viewedStep === currentStep && (
                  selected.published ? (
                    <span className="publishedBadge"><Check size={15} /> 게시 완료</span>
                  ) : (
                    <button className="primaryButton" type="button" onClick={() => void finalizeProject()}>
                      <Send size={16} />
                      완료 처리
                    </button>
                  )
                )}
                {selected.status !== 'dept_review' &&
                  selected.status !== 'rejected' &&
                  selected.status !== 'request' &&
                  selected.status !== 'planning' &&
                  selected.status !== 'completion' &&
                  !selected.onHold &&
                  canAct &&
                  !isStepAdvanceBlocked &&
                  viewedStep === currentStep && (
                  <button
                    className="primaryButton"
                    type="button"
                    onClick={() => void advanceSelectedProject()}
                  >
                    <Send size={16} />
                    단계 진행
                  </button>
                )}
              </div>
            </div>
            )}

            {viewedStatus === 'dept_review' && (() => {
              type Entry = { at: string; dept: string; actor: string; message: string }
              const stageComments = (selected.comments ?? [])
                .filter((c) => c.stage === 'dept_review' && c.role !== 'pm')
                .map<Entry>((c) => ({ at: c.at, dept: approvalStepLabels[c.role], actor: c.actor, message: c.message }))
              const memoEntries: Entry[] = []
              for (const r of selectedApprovalState.approvedRoles.filter((r) => r !== 'pm')) {
                const memo = selectedApprovalState.memos?.[r]
                if (memo?.message?.trim()) {
                  memoEntries.push({ at: memo.at, dept: approvalStepLabels[r], actor: memo.actor, message: memo.message })
                }
                memoEntries.push({ at: memo?.at ?? '', dept: approvalStepLabels[r], actor: memo?.actor ?? roleLabels[r], message: '승인이 완료되었습니다.' })
              }
              const history = [...stageComments, ...memoEntries].sort((a, b) => (a.at || '').localeCompare(b.at || ''))
              return (
                <section className="requirementsPanel numberedSection approvalHistoryPanel" data-section="승인 이력" data-section-tone="history">
                  <div className="panelHeader compact">
                    <h3>승인 이력</h3>
                    <span>의견·승인 처리가 시간순으로 기록됩니다 · 총 {history.length}건</span>
                  </div>
                  <div className="approvalHistoryWrap">
                    <table className="approvalHistoryTable">
                      <thead>
                        <tr>
                          <th>시간</th>
                          <th>승인 부서</th>
                          <th>승인자</th>
                          <th>의견</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.length === 0 ? (
                          <tr><td colSpan={4} className="approvalHistoryEmpty">아직 등록된 의견이 없습니다.</td></tr>
                        ) : (
                          history.map((h, idx) => (
                            <tr key={idx}>
                              <td className="approvalHistoryTime">{formatTimestamp(h.at)}</td>
                              <td className="approvalHistoryDept">{h.dept}</td>
                              <td className="approvalHistoryActor">{h.actor}</td>
                              <td className="approvalHistoryMsg">{h.message}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              )
            })()}



            {(viewedStatus === 'completion') && (
            <div className="bottomGrid">
              <section className="infoPanel">
                <div className="panelHeader compact">
                  <h3><FileText size={15} style={{verticalAlign:'middle', marginRight:5}} />산출물</h3>
                </div>
                <div className="artifactList">
                  <Artifact label="요청 승인 기록" state="승인됨" />
                  <Artifact label="SRS" state={(selected.reviewDocs?.srs ?? '').trim().length > 0 ? '완료' : '대기'} />
                  <Artifact label="SDS" state={(selected.reviewDocs?.sds ?? '').trim().length > 0 ? '완료' : '대기'} />
                  <Artifact label="완료 보고서" state={['completion'].includes(selected.status) ? '게시 준비' : '대기'} />
                </div>
              </section>

              <section className="infoPanel">
                <div className="panelHeader compact">
                  <h3><MessageSquareText size={16} style={{ verticalAlign: '-3px', marginRight: 4 }} />활동 로그</h3>
                  <div className="logViewToggle">
                    <button type="button" className={logView === 'timeline' ? 'active' : ''} onClick={() => setLogView('timeline')}>타임라인</button>
                    <button type="button" className={logView === 'table' ? 'active' : ''} onClick={() => setLogView('table')}>표</button>
                  </div>
                </div>
                {logView === 'timeline' ? (
                  selected.logs.length === 0 ? (
                    <p className="logEmpty">활동 기록이 없습니다.</p>
                  ) : (
                    <ol className="logTimeline">
                      {selected.logs.map((log) => (
                        <li key={log.id} className={`logTimelineItem ${logTone(log.message)}`}>
                          <span className="logTimelineDot" aria-hidden="true" />
                          <div className="logTimelineBody">
                            <div className="logTimelineMeta">
                              <span className="logTimelineActor">{log.actor}</span>
                              <span className="logTimelineTime">{formatTimestamp(log.at)}</span>
                            </div>
                            <p className="logTimelineMsg">{log.message}</p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  )
                ) : (
                  <div className="logTableWrap">
                    <table className="logTable">
                      <thead>
                        <tr>
                          <th>시각</th>
                          <th>담당</th>
                          <th>내용</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.logs.map((log) => (
                          <tr key={log.id}>
                            <td className="logTime">{log.at}</td>
                            <td className="logActor">{log.actor}</td>
                            <td className="logMsg">{log.message}</td>
                          </tr>
                        ))}
                        {selected.logs.length === 0 && (
                          <tr><td colSpan={3} className="logEmpty">활동 기록이 없습니다.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
            )}
          </div>
          ) : (
            <EmptyDatabasePanel onCreate={() => setViewMode('requestFlow')} loading={loadState === 'loading'} />
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
  attachment: { name: string; type: string; dataUrl?: string; key?: string; size: number }
  onClose: () => void
}) {
  const isImage = attachment.type.startsWith('image/')
  const isPdf = attachment.type === 'application/pdf'
  // R2 키가 있으면 presigned URL을 비동기로 해소, 아니면 dataUrl 사용
  const [url, setUrl] = useState<string | undefined>(attachment.dataUrl)
  const [resolving, setResolving] = useState(Boolean(attachment.key && !attachment.dataUrl))
  useEffect(() => {
    let active = true
    if (attachment.key && !attachment.dataUrl) {
      resolveAttachmentUrl(attachment)
        .then((u) => { if (active) { setUrl(u); setResolving(false) } })
        .catch(() => { if (active) { setUrl(undefined); setResolving(false) } })
    }
    return () => { active = false }
  }, [attachment])
  return (
    <div className="attachmentModalBackdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="attachmentModal" onClick={(event) => event.stopPropagation()}>
        <div className="attachmentModalHeader">
          <strong>{attachment.name}</strong>
          <div className="attachmentModalActions">
            {url && (
              <a className="miniButton" href={url} download={attachment.name} target="_blank" rel="noreferrer">다운로드</a>
            )}
            <button className="miniButton" type="button" onClick={onClose}>닫기</button>
          </div>
        </div>
        <div className="attachmentModalBody">
          {resolving ? (
            <p className="attachmentModalFallback">불러오는 중…</p>
          ) : !url ? (
            <p className="attachmentModalFallback">미리볼 데이터가 없습니다.</p>
          ) : isImage ? (
            <img src={url} alt={attachment.name} />
          ) : isPdf ? (
            <iframe src={url} title={attachment.name} />
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

// 비밀번호 정책: 영문·숫자·특수문자 혼용, 8자 이상
function validatePasswordPolicy(password: string): string | null {
  if (password.length < 8) return '비밀번호는 8자 이상이어야 합니다.'
  if (!/[A-Za-z]/.test(password)) return '비밀번호에 영문자를 포함해야 합니다.'
  if (!/[0-9]/.test(password)) return '비밀번호에 숫자를 포함해야 합니다.'
  if (!/[^A-Za-z0-9]/.test(password)) return '비밀번호에 특수문자를 포함해야 합니다.'
  return null
}

// 가입/로그인 화면 — Firebase Authentication(이메일/비밀번호) + Firestore 프로필(role)
function AuthGate({ onAuthenticated }: { onAuthenticated: (account: Account) => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [signupRole, setSignupRole] = useState<Role>('sales')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!hasFirebaseConfig || busy) return
    setError('')
    setNotice('')
    if (mode === 'signup') {
      const pwError = validatePasswordPolicy(password)
      if (pwError) {
        setError(pwError)
        return
      }
    }
    setBusy(true)
    try {
      const account = mode === 'login'
        ? await signInWithEmail(email, password)
        : await registerWithEmail(email, password, fullName, signupRole)
      onAuthenticated(account)
    } catch (err) {
      setError((err as Error)?.message || '인증 처리 중 오류가 발생했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="authShell">
      <form className="authCard" onSubmit={handleSubmit}>
        <div className="authBrand">
          <div className="authBrandMark"><ClipboardList size={22} /></div>
          <div>
            <strong>프로젝트 관리 시스템</strong>
            <span>Workflow PMO</span>
          </div>
        </div>

        <div className="authTabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); setNotice('') }}>로그인</button>
          <button type="button" role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'active' : ''} onClick={() => { setMode('signup'); setError(''); setNotice('') }}>가입</button>
        </div>

        {mode === 'signup' && (
          <label className="authField">
            <span>이름</span>
            <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="홍길동" autoComplete="name" required />
          </label>
        )}

        <label className="authField">
          <span>이메일</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" required />
        </label>

        <label className="authField">
          <span>비밀번호</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === 'signup' ? '영문+숫자+특수문자 8자 이상' : '비밀번호'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'signup' ? 8 : undefined} required />
          {mode === 'signup' && <small className="authHint">영문·숫자·특수문자를 모두 포함해 8자 이상으로 입력하세요.</small>}
        </label>

        {mode === 'signup' && (
          <label className="authField">
            <span>역할</span>
            <select value={signupRole} onChange={(e) => setSignupRole(e.target.value as Role)}>
              {activeRoles.map((item) => (
                <option key={item} value={item}>{roleLabels[item]}</option>
              ))}
            </select>
          </label>
        )}

        {error && <p className="authError">{error}</p>}
        {notice && <p className="authNotice">{notice}</p>}

        <button type="submit" className="authSubmit" disabled={busy}>
          {busy ? '처리 중…' : mode === 'login' ? '로그인' : '가입하기'}
        </button>

        {mode === 'signup' && (
          <p className="authHint">가입 후 역할은 계정에 고정됩니다. 변경이 필요하면 관리자에게 문의하세요.</p>
        )}
      </form>
    </div>
  )
}

// 계정 메뉴 — 로그인 사용자 이메일·고정 역할 표시 + 로그아웃
function AccountMenu({ email, role, onLogout }: { email: string; role: Role; onLogout: () => void }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [open])
  return (
    <div className="roleControl accountMenu" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="accountMenuBtn" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
        <span className="accountRoleBadge">{roleLabels[role]}</span>
        <span className="accountEmail">{email}</span>
        <span className="roleSwitcherChevron">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="accountMenuPanel" role="menu">
          <div className="accountMenuInfo">
            <strong>{email}</strong>
            <span>역할: {roleLabels[role]}</span>
          </div>
          <button type="button" className="accountLogout" onClick={onLogout}>
            로그아웃
          </button>
        </div>
      )}
    </div>
  )
}

// 역할 필터 — 클릭하면 아래로 펼쳐지는 드롭다운, 선택 시 해당 역할 관점으로 전환(임시 데모)
function RoleSwitcher({ role, onChange }: { role: Role; onChange: (next: Role) => void }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [open])
  const roles = ['requester', ...activeRoles] as Role[]
  return (
    <div className="roleSwitch" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="roleSwitchBtn" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
        <span className="roleSwitchLabel">역할</span>
        <span className="roleSwitchCurrent">{roleLabels[role]}</span>
        <span className="roleSwitchChevron">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="roleSwitchPanel" role="menu">
          {roles.map((r) => (
            <button
              key={r}
              type="button"
              className={`roleSwitchOption ${r === role ? 'active' : ''}`}
              onClick={() => { onChange(r); setOpen(false) }}
            >
              {roleLabels[r]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// 알림 벨 — 내 승인/검토 차례·마감 임박·지연을 모아 보여준다
function NotificationBell({ items, onOpenProject }: { items: NotificationItem[]; onOpenProject: (projectId: string) => void }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [open])
  const kindLabel: Record<NotificationItem['kind'], string> = { approval: '승인', qc: '검토', due: '임박', overdue: '지연', new_request: '신규 요청' }
  return (
    <div className="notifBell" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="notifBellBtn" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} title="알림">
        <Bell size={17} />
        {items.length > 0 && <span className="notifBadge">{items.length > 99 ? '99+' : items.length}</span>}
      </button>
      {open && (
        <div className="notifPanel" role="menu">
          <div className="notifPanelHead">
            <strong>알림</strong>
            <span>{items.length}건</span>
          </div>
          {items.length === 0 ? (
            <p className="notifEmpty">새 알림이 없습니다.</p>
          ) : (
            <ul className="notifList">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className={`notifItem ${n.tone}`}
                    onClick={() => { onOpenProject(n.projectId); setOpen(false) }}
                  >
                    <span className={`notifTag ${n.tone}`}>{kindLabel[n.kind]}</span>
                    <span className="notifItemBody">
                      <span className="notifItemTitle">{n.projectTitle}</span>
                      <span className="notifItemText">{n.text}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function EmptyDatabasePanel({ loading, onCreate }: { loading: boolean; onCreate: () => void }) {
  return (
    <div className="detailPanel emptyStatePanel">
      <Database size={34} />
      <h2>{loading ? '프로젝트를 불러오는 중입니다.' : '아직 등록된 프로젝트가 없습니다.'}</h2>
      <p>이 화면은 목업 데이터를 사용하지 않습니다. 새 요청을 등록하면 Firestore `pms_projects` 컬렉션에 실제 문서가 생성됩니다.</p>
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
  avgCompletionDays: number
  completedCount: number
  pendingByRole: Array<{ role: Role; count: number }>
}

function DashboardOverview({
  role,
  currentName,
  projects,
  serviceFilter,
  serviceOptions,
  summary,
  onChangeServiceFilter,
  onOpenProject,
  onOpenStatus,
}: {
  role: Role
  currentName?: string
  projects: Project[]
  serviceFilter: ServiceFilter
  serviceOptions: string[]
  summary: DashboardSummary
  onChangeServiceFilter: Dispatch<SetStateAction<ServiceFilter>>
  onOpenProject: (projectId: string) => void
  onOpenStatus: (filter: StatusFilter) => void
}) {
  const visibleStatuses = summary.projectsByStatus
  const phaseFor = (index: number) => (index < 3 ? 1 : index < 5 ? 2 : 3)

  // 서비스별 단계 흐름: 역할 관련 프로젝트를 서비스별로 묶고, 각 서비스마다 6단계 칸반을 그림
  // 단계 흐름(칸반): 내가 이미 승인한 승인 단계 건은 '내 차례'가 아니므로 보드에서도 제외
  const relevantAll = projects.filter((project) =>
    role === 'admin' ||
    (isProjectRelevantToRole(project, role, currentName) &&
      !(project.status === 'dept_review' && project.approvalState.approvedRoles.includes(role))),
  )
  const servicesToShow = serviceFilter === 'all' ? serviceOptions : [serviceFilter]
  const serviceFlows = servicesToShow.map((service) => {
    const serviceProjects = relevantAll.filter((project) => inferServiceOption(project, serviceOptions) === service)
    const columns = visibleStatuses.map((stage) => ({
      ...stage,
      projects: serviceProjects
        .filter((project) => project.status === stage.status)
        .sort((a, b) => daysUntil(a.dueDate, demoToday) - daysUntil(b.dueDate, demoToday)),
    }))
    return { service, total: serviceProjects.length, columns }
  })


  return (
    <section className="dashboardBoard" aria-label="dashboard overview">
      <section className="dashboardPanel workflowOverview">
        <div className="panelHeader compact">
          <div className="workflowSummary">
            <strong>프로젝트 진행 현황</strong>
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
        {serviceFlows.map((flow) => {
          const serviceTone = flow.service === '카피킬러' ? 'copykiller' : flow.service === '프리즘' ? 'prism' : flow.service === '몬스터' ? 'monster' : 'default'
          return (
          <div className={`serviceFlow ${serviceTone}`} key={flow.service}>
            <div className="serviceFlowHead">
              <strong>{flow.service}</strong>
              <span>{flow.total}개 프로젝트</span>
            </div>
            <div className="dashboardKanban adminScroll">
              {flow.columns.map((item, index) => {
                // 내 역할이 처리하는 단계이면서 프로젝트가 있을 때만 컬러풀·클릭 가능, 그 외엔 음영 처리
                const hasProjects = item.projects.length > 0
                const active = hasProjects && roleActsOnStatus(role, item.status)
                return (
                  <section
                    key={item.status}
                    className={`kanbanColumn phase${phaseFor(index)} ${active ? 'owned' : 'dim'}`}
                  >
                  <button className="kanbanColumnHeader" type="button" disabled={!active} onClick={() => onOpenStatus(item.status)}>
                    <div className="kanbanHeaderMeta">
                      <span>{item.label} <em>({item.owner})</em></span>
                    </div>
                    <div className="kanbanHeaderCount">
                      <strong>{item.projects.length}</strong>
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
                            {(() => { const dd = dDayInfo(project.dueDate, demoToday); return <span className={`ddayPill ${dd.tone}`}>{dd.label}</span> })()}
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
          </div>
          )
        })}
      </section>
    </section>
  )
}

function ProjectTasksPanel({
  project,
  onStatusChange,
  onAddComment,
  onAddTask,
  onEditTask,
  onDeleteTask,
  onPreviewAttachment,
  currentRole,
  stage,
  label = '개발 태스크(일감) 등록',
}: {
  project: Project
  onStatusChange: (taskId: string, status: TaskStatus, statusNote: string) => void
  onAddComment: (taskId: string, message: string) => void
  onAddTask?: (task: ProjectTask) => void
  onEditTask?: (taskId: string, patch: Partial<ProjectTask>) => void
  onDeleteTask?: (taskId: string) => void
  onPreviewAttachment?: (attachment: { name: string; type: string; dataUrl?: string; key?: string; size: number }) => void
  currentRole: Role
  stage?: ProjectStatus
  label?: string
}) {
  const [statusDrafts, setStatusDrafts] = useState<Record<string, { status: TaskStatus; note: string }>>({})
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({})
  const [openComments, setOpenComments] = useState<Record<string, boolean>>({})
  const [showAddForm, setShowAddForm] = useState(false)
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null)
  const [taskFilter, setTaskFilter] = useState<TaskStatus>('todo')
  // 단계별 선택 가능한 일감 유형 (없으면 작업/버그/변경 기본)
  const availableIssueTypes = (stage && issueTypesByStage[stage]) ?? ['task', 'bug', 'change']
  // 검토 단계 역할별 기본 유형(QA=버그, 보안=취약점, PM=변경), 그 외 첫 유형
  const defaultIssueType: IssueType = (stage === 'qc_security' && defaultIssueTypeByRole[currentRole] && availableIssueTypes.includes(defaultIssueTypeByRole[currentRole]!))
    ? defaultIssueTypeByRole[currentRole]!
    : availableIssueTypes[0]
  const emptyNewTask = { title: '', type: defaultIssueType, owner: '', priority: 'normal' as Priority, dueDate: '', note: '', attachments: [] as TaskAttachment[] }
  const [newTask, setNewTask] = useState(emptyNewTask)
  // 일감 수정: 편집 중인 태스크 id + 임시 입력값
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editTask, setEditTask] = useState({ title: '', type: 'task' as IssueType, owner: '', priority: 'normal' as Priority, dueDate: '' })

  function startEditTask(task: ProjectTask) {
    setEditingTaskId(task.id)
    setEditTask({
      title: task.title,
      type: task.type ?? 'task',
      owner: task.owner,
      priority: task.priority ?? 'normal',
      dueDate: task.dueDate ?? '',
    })
  }

  function submitEditTask() {
    if (!onEditTask || !editingTaskId || !editTask.title.trim()) return
    onEditTask(editingTaskId, {
      title: editTask.title.trim(),
      type: editTask.type,
      owner: editTask.owner.trim(),
      priority: editTask.priority,
      dueDate: editTask.dueDate,
    })
    setEditingTaskId(null)
  }

  function handleNewTaskFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    // R2 업로드(미설정 시 storage.ts가 dataURL로 폴백)
    void Promise.all(Array.from(files).map((file) => uploadAttachment(file)))
      .then((items) => setNewTask((s) => ({ ...s, attachments: [...s.attachments, ...items] })))
      .catch(() => window.alert('첨부파일 업로드에 실패했습니다.'))
  }

  function removeNewTaskAttachment(id: string) {
    setNewTask((s) => ({ ...s, attachments: s.attachments.filter((a) => a.id !== id) }))
  }

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
      attachments: newTask.attachments,
    })
    setNewTask(emptyNewTask)
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
    <section className="infoPanel taskPanel" data-section="태스크" data-section-tone="tasks">
      <div className="panelHeader compact">
        <div>
          <h3>{label}</h3>
          <p>계획된 작업과 이슈·티켓을 모두 태스크로 관리합니다. 누구나 댓글로 의견을 남길 수 있습니다.</p>
        </div>
        <div className="taskHeaderRight">
          <span className="taskTotal">{project.tasks.length}개</span>
          <button
            className="miniButton"
            type="button"
            disabled={project.tasks.length === 0}
            title="태스크를 CSV로 내보내기"
            onClick={() => {
              const header = ['키', '유형', '제목', '담당', '보고자', '우선순위', '상태', '마감일', '공수(pt)', '최근 메모']
              const rows = project.tasks.map((t) => [
                t.key ?? project.code,
                issueTypeLabels[t.type ?? 'task'],
                t.title,
                t.owner,
                t.reporter ?? project.requester,
                priorityLabels[t.priority ?? 'normal'],
                taskLabels[t.status],
                t.dueDate,
                t.estimate ?? 0,
                stripHtml(t.statusNote ?? ''),
              ])
              downloadCsv(`tasks_${project.code}_${todayStamp()}.csv`, [header, ...rows])
            }}
          >
            <Download size={14} /> CSV
          </button>
          {onAddTask && (
            <button className="miniButton" type="button" onClick={() => setShowAddForm((v) => { if (!v) setNewTask(emptyNewTask); return !v })}>
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
              {availableIssueTypes.map((t) => (<option key={t} value={t}>{issueTypeLabels[t]}</option>))}
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
          <div className="inlineTaskNoteField">
            <label className="inlineTaskNoteLabel">작업 내용 / 메모</label>
            <RichEditor
              value={newTask.note}
              onChange={(html) => setNewTask((s) => ({ ...s, note: html }))}
              placeholder="작업 내용·완료 기준·메모를 입력하세요"
              minHeight={84}
            />
          </div>
          <div className="inlineTaskAttachField">
            <div className="inlineTaskAttachHeader">
              <span className="inlineTaskNoteLabel">첨부 파일</span>
              <label className="miniButton uploadButton">
                파일 추가
                <input
                  type="file"
                  multiple
                  hidden
                  onChange={(event) => {
                    handleNewTaskFiles(event.target.files)
                    event.target.value = ''
                  }}
                />
              </label>
            </div>
            {newTask.attachments.length === 0 ? (
              <p className="docAttachmentEmpty">첨부된 파일이 없습니다.</p>
            ) : (
              <ul className="docAttachmentList">
                {newTask.attachments.map((file) => (
                  <li key={file.id}>
                    <span className="attachmentName">{file.name}</span>
                    <span>{formatBytes(file.size)}</span>
                    <button type="button" className="attachmentRemove" onClick={() => removeNewTaskAttachment(file.id)} aria-label={`${file.name} 제거`}>✕</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="inlineTaskActions">
            <button className="primaryButton" type="button" onClick={submitNewTask} disabled={!newTask.title.trim()}>등록</button>
          </div>
        </div>
      )}

      <div className="taskSummary" aria-label="task summary" role="tablist">
        <button type="button" className={`taskFilterPill todo ${taskFilter === 'todo' ? 'active' : ''}`} aria-pressed={taskFilter === 'todo'} onClick={() => setTaskFilter('todo')}>대기 {taskSummary.todo}</button>
        <button type="button" className={`taskFilterPill doing ${taskFilter === 'doing' ? 'active' : ''}`} aria-pressed={taskFilter === 'doing'} onClick={() => setTaskFilter('doing')}>진행 {taskSummary.doing}</button>
        <button type="button" className={`taskFilterPill blocked ${taskFilter === 'blocked' ? 'active' : ''}`} aria-pressed={taskFilter === 'blocked'} onClick={() => setTaskFilter('blocked')}>보류 {taskSummary.blocked}</button>
        <button type="button" className={`taskFilterPill done ${taskFilter === 'done' ? 'active' : ''}`} aria-pressed={taskFilter === 'done'} onClick={() => setTaskFilter('done')}>완료 {taskSummary.done}</button>
      </div>

      {project.tasks.length === 0 && (
        <p className="dashboardEmpty">
          이 프로젝트에 등록된 태스크가 없습니다. 상단 "+ 태스크 추가"로 등록하세요.
        </p>
      )}

      {project.tasks.length > 0 && taskSummary[taskFilter] === 0 && (
        <p className="dashboardEmpty">
          {taskLabels[taskFilter]} 상태의 태스크가 없습니다.
        </p>
      )}

      <div className="taskTableWrap">
        <table className="taskTable">
          <thead>
            <tr>
              <th>상태</th>
              <th>제목</th>
              <th>유형</th>
              <th>우선순위</th>
              <th>담당/보고</th>
              <th>마감</th>
              <th>최근 메모</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {project.tasks.filter((task) => task.status === taskFilter).flatMap((task) => {
              const draft = taskDraft(task)
              const canSaveStatus = draft.note.trim().length > 0 && (draft.status !== task.status || draft.note.trim() !== (task.statusNote ?? '').trim())
              const expanded = expandedTaskId === task.id
              const dd = dDayInfo(task.dueDate, demoToday)
              const ddTone = task.status === 'done' ? 'normal' : dd.tone
              const rows = [
                <tr key={task.id} className={`taskTr ${expanded ? 'expanded' : ''}`} onClick={() => setExpandedTaskId(expanded ? null : task.id)}>
                  <td><span className={`taskState ${task.status}`}>{taskLabels[task.status]}</span></td>
                  <td className="taskTrTitle"><strong>{task.title}</strong><span className="taskKey">{task.key ?? project.code}</span></td>
                  <td>{issueTypeLabels[task.type ?? 'task']}</td>
                  <td><span className={`priority ${task.priority ?? 'normal'}`}>{priorityLabels[task.priority ?? 'normal']}</span></td>
                  <td className="taskTrOwner">{task.owner}{task.reporter ? ` / ${task.reporter}` : ''}</td>
                  <td className="taskTrDue">{formatDate(task.dueDate)} <span className={`ddayPill ${ddTone}`}>{dd.label}</span></td>
                  <td className="taskTrMemo">{stripHtml(task.statusNote ?? '') || '—'}</td>
                  <td className="taskTrManage" onClick={(e) => e.stopPropagation()}>
                    {onEditTask && <button type="button" className="taskEditBtn" onClick={() => { startEditTask(task); setExpandedTaskId(task.id) }}>수정</button>}
                    {onDeleteTask && <button type="button" className="taskDeleteBtn" onClick={() => onDeleteTask(task.id)}>삭제</button>}
                  </td>
                </tr>,
              ]
              if (expanded) {
                rows.push(
                  <tr key={`${task.id}-detail`} className="taskExpandRow">
                    <td colSpan={8}>
                      <div className="taskExpand" onClick={(e) => e.stopPropagation()}>
                        {onEditTask && editingTaskId === task.id && (
                          <div className="inlineTaskForm taskEditForm">
                            <div className="inlineTaskGrid">
                              <input placeholder="태스크 제목" value={editTask.title} onChange={(e) => setEditTask((s) => ({ ...s, title: e.target.value }))} />
                              <select value={editTask.type} onChange={(e) => setEditTask((s) => ({ ...s, type: e.target.value as IssueType }))}>
                                {(availableIssueTypes.includes(editTask.type) ? availableIssueTypes : [editTask.type, ...availableIssueTypes]).map((t) => (
                                  <option key={t} value={t}>{issueTypeLabels[t]}</option>
                                ))}
                              </select>
                              <input placeholder="담당자" value={editTask.owner} onChange={(e) => setEditTask((s) => ({ ...s, owner: e.target.value }))} />
                              <select value={editTask.priority} onChange={(e) => setEditTask((s) => ({ ...s, priority: e.target.value as Priority }))}>
                                <option value="low">낮음</option>
                                <option value="normal">보통</option>
                                <option value="high">높음</option>
                                <option value="urgent">긴급</option>
                              </select>
                              <input type="date" value={editTask.dueDate} onChange={(e) => setEditTask((s) => ({ ...s, dueDate: e.target.value }))} />
                            </div>
                            <div className="inlineTaskActions">
                              <button className="miniButton" type="button" onClick={() => setEditingTaskId(null)}>취소</button>
                              <button className="primaryButton" type="button" onClick={submitEditTask} disabled={!editTask.title.trim()}>저장</button>
                            </div>
                          </div>
                        )}
                        {task.output?.trim() && (
                          <div className="taskField"><span className="taskFieldLabel">산출물 · 완료 기준</span><span className="taskFieldValue">{task.output}</span></div>
                        )}
                        {task.acceptanceCriteria?.trim() && (
                          <div className="taskField"><span className="taskFieldLabel">인수 조건</span><span className="taskFieldValue">{task.acceptanceCriteria}</span></div>
                        )}
                        <div className="taskField"><span className="taskFieldLabel">최근 상태 메모</span><span className="taskFieldValue"><RichTextView html={task.statusNote ?? ''} fallback="아직 기록 없음" /></span></div>
                        {(task.attachments?.length ?? 0) > 0 && (
                          <div className="taskAttachments" aria-label={`${task.title} 첨부 파일`}>
                            {task.attachments?.map((attachment) => (
                              onPreviewAttachment ? (
                                <button key={attachment.id} type="button" className="attachmentChip attachmentLink" onClick={() => onPreviewAttachment({ name: attachment.name, type: attachment.type, dataUrl: attachment.dataUrl, key: attachment.key, size: attachment.size })}>
                                  {attachment.type.startsWith('image/') && attachment.dataUrl ? (<img className="attachmentThumb" src={attachment.dataUrl} alt="" />) : (<Paperclip size={13} />)}
                                  {attachment.name}
                                </button>
                              ) : attachment.dataUrl ? (
                                <a key={attachment.id} href={attachment.dataUrl} download={attachment.name}><Paperclip size={13} />{attachment.name}</a>
                              ) : (
                                <span key={attachment.id}><Paperclip size={13} />{attachment.name}</span>
                              )
                            ))}
                          </div>
                        )}
                        <div className="taskStatusControl">
                          <select value={draft.status} onChange={(event) => updateTaskDraft(task, { status: event.target.value as TaskStatus })} aria-label={`${task.title} 상태`}>
                            <option value="todo">대기</option>
                            <option value="doing">진행</option>
                            <option value="blocked">보류</option>
                            <option value="done">완료</option>
                          </select>
                          <input value={draft.note} onChange={(event) => updateTaskDraft(task, { note: event.target.value })} placeholder="상태 변경 내용 입력" aria-label={`${task.title} 상태 변경 내용`} />
                          <button className="miniButton" type="button" onClick={() => submitTaskStatus(task)} disabled={!canSaveStatus}>저장</button>
                        </div>
                        <div className="taskComments">
                          <button type="button" className="miniButton commentToggle" onClick={() => setOpenComments((current) => ({ ...current, [task.id]: !current[task.id] }))}>💬 댓글 {task.comments?.length ?? 0}</button>
                          {openComments[task.id] && (
                            <div className="commentThread">
                              {(task.comments ?? []).length === 0 ? (
                                <p className="docAttachmentEmpty">아직 댓글이 없습니다. 의견을 첫 번째로 남겨보세요.</p>
                              ) : (
                                <ul className="commentList">
                                  {(task.comments ?? []).map((comment) => (
                                    <li key={comment.id}>
                                      <div className="commentMeta"><strong>{comment.actor}</strong><span>{formatDateTime(comment.at)}</span></div>
                                      <p>{comment.message}</p>
                                    </li>
                                  ))}
                                </ul>
                              )}
                              <form className="commentForm" onSubmit={(event) => { event.preventDefault(); const text = (commentDrafts[task.id] ?? '').trim(); if (!text) return; onAddComment(task.id, text); setCommentDrafts((current) => ({ ...current, [task.id]: '' })) }}>
                                <input value={commentDrafts[task.id] ?? ''} onChange={(event) => setCommentDrafts((current) => ({ ...current, [task.id]: event.target.value }))} placeholder={`${roleLabels[currentRole]}로 의견 남기기`} />
                                <button className="miniButton" type="submit">등록</button>
                              </form>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>,
                )
              }
              return rows
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ─── 감사 로그 패널 ────────────────────────────────────────────────────────────
function AuditLogPanel({ projects }: { projects: Project[] }) {
  const [tab, setTab] = useState<'access' | 'changes'>('changes')
  const [accessLogs, setAccessLogs] = useState<AccessLogEntry[] | null>(null)
  const [changeSearch, setChangeSearch] = useState('')

  // accessLoading: 접근 탭인데 아직 데이터가 없으면 로딩 중
  const accessLoading = tab === 'access' && accessLogs === null

  // 접근 로그 로드 (탭 진입 시) — setState는 비동기 콜백 안에서만 호출
  useEffect(() => {
    if (tab !== 'access') return
    let cancelled = false
    fetchAccessLogs(300)
      .then(logs => { if (!cancelled) setAccessLogs(logs) })
      .catch(() => { if (!cancelled) setAccessLogs([]) })
    return () => { cancelled = true }
  }, [tab])

  // 프로젝트 변경 로그: 모든 프로젝트의 logs를 평탄화 + 시간 역순
  const changeLogs = useMemo(() => {
    const all: Array<{ projectId: string; projectTitle: string; log: (typeof projects)[0]['logs'][0] }> = []
    for (const p of projects) {
      for (const log of (p.logs ?? [])) {
        all.push({ projectId: p.id, projectTitle: p.title, log })
      }
    }
    all.sort((a, b) => b.log.at.localeCompare(a.log.at))
    return all
  }, [projects])

  const filteredChanges = useMemo(() => {
    if (!changeSearch.trim()) return changeLogs
    const q = changeSearch.toLowerCase()
    return changeLogs.filter(
      (item) =>
        item.projectTitle.toLowerCase().includes(q) ||
        item.log.actor.toLowerCase().includes(q) ||
        item.log.message.toLowerCase().includes(q),
    )
  }, [changeLogs, changeSearch])

  function formatAt(at: string) {
    if (!at) return '—'
    const d = new Date(at)
    if (isNaN(d.getTime())) return at.slice(0, 16).replace('T', ' ')
    return d.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
  }

  const actionLabels: Record<string, string> = {
    login: '로그인',
    logout: '로그아웃',
    role_switch: '역할 전환',
    page_view: '페이지 조회',
  }

  function exportCsv() {
    const isChanges = tab === 'changes'
    const headers = isChanges
      ? ['일시', '프로젝트', '담당자', '변경 내용']
      : ['일시', '사용자', '역할', '유형', '상세']
    const rows = isChanges
      ? filteredChanges.map((item) => [
          item.log.at,
          item.projectTitle,
          item.log.actor,
          item.log.message,
        ])
      : (accessLogs ?? []).map((entry) => [
          entry.at,
          entry.actor,
          roleLabels[entry.role as Role] ?? entry.role,
          actionLabels[entry.action] ?? entry.action,
          entry.detail ?? '',
        ])
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit_${tab}_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="guidePanel auditLogPage">
      <div className="guideHead auditLogHead">
        <div>
          <h2>감사 로그</h2>
          <p>접근 기록 및 프로젝트 변경 이력</p>
        </div>
        <button type="button" className="csvExportButton" onClick={exportCsv}>
          <Download size={14} /> CSV
        </button>
      </div>

      <div className="auditTabBar">
        <button type="button" className={`auditTab ${tab === 'changes' ? 'active' : ''}`} onClick={() => setTab('changes')}>
          <ClipboardList size={15} /> 프로젝트 변경
          <span className="auditTabCount">{changeLogs.length}</span>
        </button>
        <button type="button" className={`auditTab ${tab === 'access' ? 'active' : ''}`} onClick={() => setTab('access')}>
          <Shield size={15} /> 접근 기록
        </button>
        {tab === 'changes' && (
          <div className="searchBox auditSearch">
            <Search size={15} />
            <input value={changeSearch} onChange={(e) => setChangeSearch(e.target.value)} placeholder="프로젝트·담당자·내용 검색" />
          </div>
        )}
      </div>

      {tab === 'changes' && (
        <div className="auditContent">
          {filteredChanges.length === 0 ? (
            <div className="dashboardEmpty">변경 이력이 없습니다.</div>
          ) : (
            <div className="auditTableWrap">
              <table className="auditTable">
                <thead>
                  <tr>
                    <th>일시</th>
                    <th>프로젝트</th>
                    <th>담당자</th>
                    <th>변경 내용</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredChanges.map(({ projectId, projectTitle, log }) => (
                    <tr key={`${projectId}-${log.id}`}>
                      <td className="auditTime">{formatAt(log.at)}</td>
                      <td className="auditProject">{projectTitle}</td>
                      <td className="auditActor">{log.actor}</td>
                      <td className="auditMessage">{log.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'access' && (
        <div className="auditContent">
          {accessLoading ? (
            <div className="dashboardEmpty">로딩 중…</div>
          ) : (accessLogs ?? []).length === 0 ? (
            <div className="dashboardEmpty">접근 기록이 없습니다. (데모 모드에서는 역할 전환 시 기록됩니다)</div>
          ) : (
            <div className="auditTableWrap">
              <table className="auditTable">
                <thead>
                  <tr>
                    <th>일시</th>
                    <th>사용자</th>
                    <th>역할</th>
                    <th>유형</th>
                    <th>상세</th>
                  </tr>
                </thead>
                <tbody>
                  {(accessLogs ?? []).map((entry) => (
                    <tr key={entry.id}>
                      <td className="auditTime">{formatAt(entry.at)}</td>
                      <td className="auditActor">{entry.actor}</td>
                      <td><span className="statusPill request">{roleLabels[entry.role as Role] ?? entry.role}</span></td>
                      <td><span className={`auditActionBadge action-${entry.action}`}>{actionLabels[entry.action] ?? entry.action}</span></td>
                      <td className="auditMessage">{entry.detail ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

// 역할×단계 매트릭스의 열 라벨. 모바일에서는 각 셀의 data-stage로도 노출된다.
const laneStages = ['① 요청', '② 기획', '③ 승인', '④ 개발', '⑤ 검토', '⑥ 배포', '⑦ 완료']

// 프로젝트 관리 시스템 가이드 — 워크플로·역할·산출물·화면·KPI 전반 설명
function SystemGuidePanel() {
  return (
    <section className="guidePanel" aria-label="시스템 가이드">
      <div className="guideHead">
        <h2>프로젝트 관리 시스템 가이드</h2>
        <p>요청 접수부터 완료까지의 워크플로, 역할별 책임, 단계별 산출물, 화면·지표 사용법을 한 곳에 정리했습니다.</p>
      </div>

      <div className="guideSection">
        <h3>1. 개요</h3>
        <p>본 시스템은 사내 서비스(카피킬러·프리즘·몬스터 등)의 개선·신규 요청을 <strong>요청 → 기획 → 승인 → 개발 → 검토 → 배포 → 완료</strong> 7단계로 표준화해 관리합니다. 각 단계마다 책임 주체와 산출물이 정해져 있으며, 모든 상태 변경은 활동 로그로 기록됩니다.</p>
      </div>

      <div className="guideSection">
        <h3>2. 워크플로 7단계</h3>
        <div className="guideTableWrap">
          <table className="guideTable">
            <thead><tr><th>단계</th><th>주체</th><th>산출물</th><th>핵심 활동</th></tr></thead>
            <tbody>
              <tr><td><span className="statusPill request">요청</span></td><td>요청자(영업·마케팅·운영 등)</td><td>요청서(니즈)</td><td>요청 분류 선택, 요청 내용·배경 작성 후 제출</td></tr>
              <tr><td><span className="statusPill planning">기획</span></td><td>PM / 기획자</td><td><strong>요구사항 정의서(SRS)</strong></td><td>요구사항 12개 항목 작성, 승인 필요 역할 지정</td></tr>
              <tr><td><span className="statusPill dept_review">승인</span></td><td>지정 승인자(CEM·개발·정보보호·인프라·QA·특허)</td><td>승인 내역</td><td>역할별 검토·승인, 전원 승인 시 자동 진행</td></tr>
              <tr><td><span className="statusPill development">개발</span></td><td>개발자(리더)</td><td><strong>설계 명세서(SDS)</strong> · 일감(Task)</td><td>설계 작성, 일정 조율, 개발 태스크 수행</td></tr>
              <tr><td><span className="statusPill qc_security">검토</span></td><td>QA · 보안 · PM</td><td>Bug · 취약점 · Change</td><td>SRS·SDS 대조 검증, 3자(QA·보안·PM) 합의</td></tr>
              <tr><td><span className="statusPill deployment">배포</span></td><td>인프라</td><td>운영 반영 내역</td><td>운영 환경 반영 (실패 시 개발 단계로 롤백)</td></tr>
              <tr><td><span className="statusPill completion">완료</span></td><td>PM / 관리자</td><td>완료 보고</td><td>요청자 확인 후 게시·완료 처리</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="guideSection">
        <h3>2-1. 한눈에 보는 7단계</h3>
        <p className="guideDiagramLead">pms.sanghak.kr · 시스템 가이드 기준</p>
        <div className="stageFlow">
          {[
            { no: '①', name: '요청', owner: '요청자 · 영업 · 마케팅 · 운영', tone: 'req', acts: ['요청 분류 선택', '요청 내용 작성', '배경 / 현재 상황 작성'], out: ['요청서 (니즈)'], req: ['요청 분류', '제목·서비스·담당팀·요청자', '요청 내용', '배경/현재 상황'] },
            { no: '②', name: '기획', owner: 'PM / 기획자', tone: 'plan', acts: ['요구사항 12개 항목 작성', '승인 필요 역할 지정'], out: ['요구사항 정의서 (SRS)'], req: ['SRS 작성 완료', '승인 필요 역할 지정'] },
            { no: '③', name: '승인', owner: '지정 승인자', tone: 'appr', acts: ['역할별 개별 검토·승인', 'CEM · 개발 · 정보보호', '인프라 · QA · 특허'], out: ['승인 내역'], req: ['지정 승인자 전원 승인'] },
            { no: '④', name: '개발', owner: '개발자 (리더)', tone: 'dev', acts: ['설계 작성', '일정 조율', '개발 태스크 수행'], out: ['설계 명세서 (SDS)', '일감 : Task · Bug · Change'], req: ['SDS 작성 완료', '마감일 확정(일정 조율)'] },
            { no: '⑤', name: '검토', owner: '개발 · QA · 보안 · PM', tone: 'rev', acts: ['단위테스트 → 통합테스트', '보안테스트 (병행)', 'SRS · SDS 대조 검증'], out: ['Bug (QA)', '취약점 (보안)', 'Change (PM)'], req: ['개발 단위테스트', 'QA 통합테스트', '보안테스트', 'PM 검토'] },
            { no: '⑥', name: '배포', owner: '인프라', tone: 'appr', acts: ['운영 환경 반영', '배포 방식·버전 기록', '실패 시 개발 롤백'], out: ['운영 반영 내역'], req: ['운영 반영 완료'] },
            { no: '⑦', name: '완료', owner: 'PM / 관리자', tone: 'done', acts: ['완료 보고 작성', '요청자 확인', '게시 · 완료 처리'], out: ['완료 보고서'], req: ['요청자 확인'] },
          ].map((s, i) => (
            <div key={s.no} className="stageFlowItem">
              <div className={`stageCard tone-${s.tone}`}>
                <div className="stageCardTop">
                  <strong>{s.no} {s.name}</strong>
                  <span className="stageCardOwner">{s.owner}</span>
                </div>
                <div className="stageCardBlock">
                  <b>핵심 활동</b>
                  <ul>{s.acts.map((a) => <li key={a}>{a}</li>)}</ul>
                </div>
                <div className="stageCardBlock">
                  <b>산출물</b>
                  <ul>{s.out.map((o) => <li key={o}>{o}</li>)}</ul>
                </div>
                <div className="stageCardBlock">
                  <b>필수 입력 (진행 조건)</b>
                  <div className="stageReqBadges">
                    {s.req.map((r) => <span key={r} className="stageReqBadge">{r}</span>)}
                  </div>
                </div>
              </div>
              {i < 6 && <span className="stageFlowArrow" aria-hidden="true">G{i + 1}</span>}
            </div>
          ))}
        </div>

        <div className="guideSplit">
          <div className="guideSubBox">
            <h4>단계 전이 조건</h4>
            <ul className="gateList">
              <li><b>G1</b> 요청 제출 → 시스템이 프로젝트 생성, PM에게 신규 요청 알림</li>
              <li><b>G2</b> 기획 → 승인 : SRS 작성 완료 필요</li>
              <li><b>G3</b> 승인 → 개발 : 지정 승인자 <strong>전원 승인</strong> → 개발 단계 자동 진행</li>
              <li><b>G4</b> 개발 → 검토 : SDS 작성 완료 필요</li>
              <li><b>G5</b> 검토 → 배포 : 개발 · QA · 보안 · PM <strong>4자 합의</strong></li>
              <li><b>G6</b> 배포 → 완료 : 인프라의 <strong>운영 반영 완료</strong></li>
              <li><b>G7</b> 완료(게시) : 요청자 확인 후 처리</li>
            </ul>
          </div>
          <div className="guideSubBox">
            <h4>전 단계 공통</h4>
            <ul className="gateList">
              <li><b>보류(HOLD)</b> PM · 관리자가 사유와 함께 보류 → 단계는 유지되고 진행만 잠김</li>
              <li><b>알림(벨)</b> 내 승인 / 검토 차례 · 새 요청 접수(PM) · 마감 임박 / 지연</li>
              <li><b>활동 로그</b> 모든 상태 변경 자동 기록</li>
              <li><b>열람 권한</b> 요청자는 본인 요청의 전 단계 열람 · 관리자는 전체 열람</li>
              <li><b>일감 상태</b> 대기 → 진행 → 완료 (보류 가능, 댓글·첨부 지원)</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="guideSection">
        <h3>2-2. 역할별 처리 흐름</h3>
        <p className="guideDiagramLead">행 = 역할 · 열 = 단계 · 회색 점선 = 시스템 자동 처리</p>
        <div className="laneMatrix">
          <div className="laneMatrixHead">
            <span className="laneRoleHead">역할</span>
            {laneStages.map((st) => (
              <span key={st} className="laneStageHead">{st}</span>
            ))}
          </div>
          {[
            { role: '요청자', tone: 'req', cells: [['새 요청 작성'], [], [], [], [], [], ['요청자 확인']] },
            { role: 'PM / 기획자', tone: 'plan', cells: [[], ['SRS 작성', '승인 역할 지정'], [], [], ['PM 검토 (Change)'], [], ['완료 보고 작성']] },
            { role: '승인자', tone: 'appr', cells: [[], [], ['역할별 검토 · 승인', 'CEM · 개발 · 정보보호', '인프라 · QA · 특허'], [], [], [], []] },
            { role: '개발자', tone: 'dev', cells: [[], [], [], ['SDS 작성', '개발 태스크 수행'], ['단위테스트'], [], []] },
            { role: 'QA · 보안', tone: 'rev', cells: [[], [], [], [], ['통합테스트 (Bug)', '보안테스트 (취약점)'], [], []] },
            { role: '인프라', tone: 'appr', cells: [[], [], [], [], [], ['운영 반영', '롤백 판단'], []] },
            { role: '시스템', tone: 'sys', cells: [['요청 접수 · 프로젝트 생성', 'PM 알림'], ['승인 요청 알림'], ['전원 승인 시 개발 단계 자동 진행'], [], [], [], ['게시 · 완료 처리']] },
          ].map((row) => (
            <div key={row.role} className={`laneRow lane-${row.tone}`}>
              <span className="laneRole">{row.role}</span>
              {row.cells.map((items, ci) => (
                <div key={ci} className="laneCell" data-stage={laneStages[ci]}>
                  {items.map((it) => (
                    <span key={it} className={`laneChip ${row.tone === 'sys' ? 'laneChipAuto' : ''}`}>{it}</span>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="guideSection">
        <h3>3. 역할</h3>
        <div className="guideTableWrap">
          <table className="guideTable">
            <thead><tr><th>역할</th><th>담당</th><th>처리 단계</th></tr></thead>
            <tbody>
              <tr><td>요청자 / 영업 / 마케팅</td><td>요청 작성·추적</td><td>요청 (본인이 올린 요청은 전 단계 열람)</td></tr>
              <tr><td>PM</td><td>기획(SRS)·일정·검토</td><td>기획, 검토</td></tr>
              <tr><td>CEM · 특허</td><td>승인</td><td>승인</td></tr>
              <tr><td>인프라</td><td>승인 · 운영 반영(배포)</td><td>승인, 배포</td></tr>
              <tr><td>개발자</td><td>설계(SDS)·개발</td><td>승인, 개발</td></tr>
              <tr><td>QA</td><td>품질 검토(Bug)</td><td>승인, 검토</td></tr>
              <tr><td>보안</td><td>보안 검토(취약점)</td><td>승인, 검토</td></tr>
              <tr><td>관리자</td><td>전체 열람·운영</td><td>모든 프로젝트 열람(직접 처리 없음)</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="guideSection">
        <h3>4. 산출물</h3>
        <ul>
          <li><strong>요청 내용</strong> — 요청 단계에서 작성(요청 내용 + 배경/현재 상황). 상세 분석은 기획 단계로 미룸.</li>
          <li><strong>요구사항 정의서(SRS)</strong> — 기획 단계에서 PM이 작성. 개요·요약·배경·목표·목표가 아닌 것·이외 고려사항·요구사항 상세·설계 고려사항·다국어/모바일·개발 가이드라인·리스크·참고자료 12개 항목.</li>
          <li><strong>설계 명세서(SDS)</strong> — 개발 단계에서 개발(리더)이 작성. 아키텍처·구성요소·데이터모델·API·처리흐름·보안·성능·배포·테스트 전략.</li>
          <li><strong>일감(Task/Bug/Change/취약점)</strong> — 개발·검토 단계에서 등록. 상태(대기·진행·보류·완료) 관리, 댓글·첨부 지원.</li>
        </ul>
      </div>

      <div className="guideSection">
        <h3>5. 화면 안내</h3>
        <ul>
          <li><strong>대시보드</strong> — 내 KPI 4종 + 역할 관점 단계 흐름 보드(본인 관련 프로젝트의 진행 위치).</li>
          <li><strong>작업 목록</strong> — 내가 직접 처리할 차례인 일감만(= 처리 대기 + 진행 중). 일감은 테이블로, 행 클릭 시 상세·상태변경·댓글 펼침.</li>
          <li><strong>새 요청</strong> — 누구나 요청 분류에 따라 작성. 기본 정보 + 요청 내용/배경.</li>
          <li><strong>전체 프로젝트</strong> — 모든 프로젝트를 단계와 함께 표로 열람. 관리자는 행 클릭 시 상세·단계별 내용 확인.</li>
          <li><strong>설정</strong>(관리자) — 서비스 목록·외부 연동·프로젝트 보류/삭제 관리.</li>
        </ul>
      </div>

      <div className="guideSection">
        <h3>6. KPI 정의</h3>
        <div className="guideTableWrap">
          <table className="guideTable kpiGuideTable">
            <thead><tr><th>지표</th><th>의미</th></tr></thead>
            <tbody>
              <tr><td><strong>처리 대기</strong></td><td>내가 승인해야 할 건(승인 단계, 미승인분)</td></tr>
              <tr><td><strong>진행 중</strong></td><td>그 외 내가 직접 수행하는 작업(기획·개발·검토)</td></tr>
              <tr><td><strong>작업 목록</strong></td><td>처리 대기 + 진행 중 = 내 차례인 전체 일감</td></tr>
              <tr><td><strong>마감 임박</strong></td><td>내 작업 중 마감 D-5 이내</td></tr>
              <tr><td><strong>전체/관련 프로젝트</strong></td><td>관리자=전체, 그 외=본인 관련 프로젝트 수</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="guideSection">
        <h3>7. 일감 유형 (단계별)</h3>
        <ul>
          <li><strong>개발 단계</strong> — Task(작업) · Bug(버그) · Change(변경)</li>
          <li><strong>검토 단계</strong> — Bug(QA) · 취약점(보안) · Change(PM) — 역할별 기본 유형 자동 지정</li>
          <li><strong>배포 단계</strong> — 운영 반영 내역·롤백 기록 (인프라)</li>
        </ul>
      </div>

      <div className="guideSection">
        <h3>8. 승인 · 보류 · 알림</h3>
        <ul>
          <li><strong>승인</strong> — 기획 단계에서 지정한 역할만 승인 단계에서 검토·승인. 전원 승인 시 개발 단계로 자동 진행.</li>
          <li><strong>보류</strong> — PM · 관리자가 사유와 함께 프로젝트를 보류. 단계는 그대로 유지되고 진행만 잠기며, 해제하면 같은 단계에서 재개됩니다. 승인 단계에서 <strong>반려</strong>하면 보류로 전환됩니다.</li>
          <li><strong>알림</strong> — 내 승인/검토 차례, 새 요청 접수(PM), 마감 임박/지연을 벨에 모아 표시.</li>
        </ul>
      </div>

      <div className="guideSection">
        <h3>9. 단계 진행 규칙</h3>
        <ul>
          <li>기획 → 승인: <strong>SRS 작성 완료</strong> 필요</li>
          <li>승인 → 개발: <strong>지정 승인자 전원 승인</strong></li>
          <li>개발 → 검토: <strong>SDS 작성 완료</strong> 필요</li>
          <li>검토 → 배포: <strong>개발·QA·보안·PM 4자 합의</strong> (단위테스트 → 통합테스트 순서, 보안테스트 병행)</li>
          <li>배포 → 완료: <strong>인프라의 운영 반영 완료</strong> (실패 시 개발 단계로 롤백)</li>
          <li>검토 → 개발(회귀): <strong>Bug·취약점이 남으면</strong> 개발 단계로 되돌리고 검토 상태 초기화</li>
          <li>승인 반려: 단계를 유지한 채 <strong>보류로 전환</strong> (해제 시 같은 단계에서 재개)</li>
          <li>마감일 확정: <strong>개발 단계 일정 조율</strong>의 완료 예정일로 확정 (KPI 마감 임박 D-5 기준)</li>
          <li>완료(게시): <strong>요청자 확인</strong> 후 처리</li>
        </ul>
      </div>

      <div className="guideSection">
        <h3>9-1. 보류(HOLD) 흐름</h3>
        <p className="guideDiagramLead">보류·해제 권한은 PM · 관리자 · 보류 중에는 단계가 바뀌지 않고 진행만 잠긴다</p>
        <div className="holdFlowRow">
          <div className="holdCol">
            <span className="holdColLabel">진입</span>
            <div className="forkBox tone-req">단계 진행 중</div>
          </div>
          <span className="forkArrow" aria-hidden="true" />
          <div className="holdCol">
            <span className="holdColLabel">보류 전환 (2가지)</span>
            <div className="forkBox tone-rev">PM · 관리자 보류<em>사유 입력 (선택)</em></div>
            <div className="forkBox tone-rev">승인 반려<em>사유 입력 (필수)</em></div>
          </div>
          <span className="forkArrow" aria-hidden="true" />
          <div className="holdCol">
            <span className="holdColLabel">보류 상태</span>
            <div className="forkBox tone-rev holdLocked">단계 진행 잠김<em>단계는 그대로 유지</em></div>
          </div>
          <span className="forkArrow" aria-hidden="true" />
          <div className="holdCol">
            <span className="holdColLabel">해소</span>
            <div className="forkBox tone-plan">보류 해제 (PM · 관리자)<em>같은 단계에서 재개</em></div>
            <div className="forkBox tone-sys">관리자 삭제 / 종료</div>
          </div>
        </div>
      </div>

      <div className="guideSection gapSection">
        <h3>10. 가이드에 정의되지 않은 구간 (검토 필요)</h3>
        <p className="guideDiagramLead">
          아래 항목은 아직 규칙이 없어 흐름도에 그리지 않았습니다. 확정 후 반영이 필요합니다.
          (승인 반려 · 검토 합의 실패 · 역할 중복 · 마감일 확정 시점은 확정되어 위 9 / 9-1 및 2-2에 반영됨)
        </p>
        <div className="gapGrid">
          {[
            { tone: 'warn', title: '요청자 무응답 시 완료 처리', body: '완료(게시)가 요청자 확인에 종속. 요청자가 확인하지 않으면 프로젝트가 완료 단계에 무기한 대기. 타임아웃 · 자동 확인 규칙 없음.' },
            { tone: 'crit', title: 'SDS 승인 게이트 부재', body: 'SRS는 승인 단계를 거치지만 SDS는 "작성 완료" 여부만 확인하고 검토 단계로 진행. 설계에 대한 승인 주체가 없음.' },
          ].map((g) => (
            <div key={g.title} className={`gapCard gap-${g.tone}`}>
              <strong>{g.title}</strong>
              <p>{g.body}</p>
            </div>
          ))}
        </div>
        <div className="gapLegend">
          <span><i className="gapDot gap-warn" /> 예외 경로 미정의</span>
          <span><i className="gapDot gap-crit" /> 구조적 검토 필요</span>
        </div>
      </div>
    </section>
  )
}

function RequestFlowPanel({
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
  const fieldRules = requestFieldRules[form.requestType] ?? {}

  function updateField<K extends keyof RequestFormState>(field: K, value: RequestFormState[K]) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  // 프로젝트 워크플로 8단계와 동일한 순서로 표시 (요청 단계만 입력 가능)
  const stages = workflow
  const currentStageIndex = 0 // 새 요청은 '요청' 단계(인덱스 0)에 해당

  const titleValid = Boolean(form.title.trim() && form.serviceName.trim() && form.serviceArea.trim() && form.ownerTeam.trim() && form.requester.trim()) && (fieldRules.dueDateOptional || Boolean(form.dueDate))
  // 요청 단계는 내용·배경만 필수(상세 항목은 분석·기획/SRS 단계에서 작성)
  const detailValid = Boolean(form.summary.trim() && form.currentProblem.trim())
  const allValid = Boolean(form.requestType) && titleValid && detailValid

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!allValid) return
    onSubmit(event)
  }

  return (
    <section className="requestPanel flowRequestPanel">
      <div className="flowRequestHead">
        <div>
          <p className="eyebrow">Request Intake · 단계별</p>
          <h2>{config.title}</h2>
        </div>
        <div className="flowHeadActions">
          <span className="flowCurrentStep">현재 단계 {currentStageIndex + 1}. {stages[currentStageIndex].label}</span>
        </div>
      </div>

      <ol className="flowStepper projectFlowStepper" aria-label="프로젝트 진행 단계">
        {stages.map((s, idx) => {
          const state = idx < currentStageIndex ? 'done' : idx === currentStageIndex ? 'current' : 'pending'
          return (
            <li key={s.status} className={`flowStepperItem ${state}`}>
              <div className="flowStepperBtn" role="presentation">
                <span className="flowStepNum">{idx + 1}</span>
                <span className="flowStepText">
                  <strong>{s.label}</strong>
                  <em>{s.owner}</em>
                </span>
              </div>
              {idx < stages.length - 1 && <span className="flowStepConn" aria-hidden="true" />}
            </li>
          )
        })}
      </ol>

      <form className="requestForm flowRequestForm" onSubmit={handleSubmit}>
        <p className="flowSectionLead">현재 작업 단계: <b>1 · 요청</b> — 요청자가 입력하는 단계입니다. 아래 정보를 모두 작성한 뒤 등록하면 다음 단계로 자동 진행됩니다.</p>
        <fieldset>
            <legend>요청 분류</legend>
            <div className="requestTypeSelector" role="tablist" aria-label="요청 분류 선택">
              {requestTypeOptions.map((item) => (
                <button
                  key={item.type}
                  className={`requestTypeButton ${form.requestType === item.type ? 'active' : ''}`}
                  type="button"
                  onClick={() => setForm((s) => ({ ...s, requestType: item.type, selectedApprovalRoles: approvalRolesByRequestType[item.type] }))}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </fieldset>

        <fieldset>
            <legend>기본 정보</legend>
            <div className="formGrid three">
              <label>
                <span>요청 제목</span>
                <input required value={form.title} onChange={(event) => updateField('title', event.target.value)} placeholder={config.titlePlaceholder} />
              </label>
              <label>
                <span>{config.serviceLabel}</span>
                {fieldRules.serviceFreeText ? (
                  <input value={form.serviceName} onChange={(event) => updateField('serviceName', event.target.value)} placeholder="예: 신규 출시 예정 서비스명" />
                ) : (
                  <select value={form.serviceName} onChange={(event) => updateField('serviceName', event.target.value)}>
                    {serviceOptions.map((item) => (<option key={item} value={item}>{item}</option>))}
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
                <input required={!fieldRules.dueDateOptional} type="date" value={form.dueDate} onChange={(event) => updateField('dueDate', event.target.value)} />
              </label>
            </div>
          </fieldset>

        <fieldset>
            <legend>요청 내용</legend>
            <div className="formGrid two">
              <label>
                <span>{config.summaryLabel}</span>
                <textarea required value={form.summary} onChange={(event) => updateField('summary', event.target.value)} placeholder={config.summaryPlaceholder} />
              </label>
              <label>
                <span>배경 / 현재 상황</span>
                <textarea required value={form.currentProblem} onChange={(event) => updateField('currentProblem', event.target.value)} placeholder={config.problemPlaceholder} />
              </label>
            </div>
            <p className="approvalGuide">상세 요구사항(성공 기준·영향 범위·리스크 등)은 분석·기획(SRS) 단계에서 작성합니다.</p>
          </fieldset>

        <fieldset>
            <legend>검토 · 제출</legend>
            <div className="formGrid two">
              <label>
                <span>우선순위</span>
                <select value={form.priority} onChange={(event) => updateField('priority', event.target.value as Priority)}>
                  <option value="low">낮음</option>
                  <option value="normal">보통</option>
                  <option value="high">높음</option>
                  <option value="urgent">긴급</option>
                </select>
              </label>
              <label>
                <span>요청 유형</span>
                <input value={requestTypeLabels[form.requestType]} readOnly />
              </label>
            </div>
            <div className="flowReviewBox">
              <div className="flowReviewRow"><span>제목</span><strong>{form.title || '—'}</strong></div>
              <div className="flowReviewRow"><span>서비스 / 영역</span><strong>{form.serviceName} · {form.serviceArea || '—'}</strong></div>
              <div className="flowReviewRow"><span>요청자 / 부서</span><strong>{form.requester || '—'} · {form.ownerTeam || '—'}</strong></div>
              <div className="flowReviewRow"><span>희망 완료일</span><strong>{form.dueDate || '미정'}</strong></div>
            </div>
          </fieldset>

        <div className="flowStepActions">
          <button type="submit" className="primaryButton" disabled={!allValid}>
            <Send size={16} /> 요청 등록
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

// HTML 문자열에서 태그를 제거하고 순수 텍스트만 추출 (CSV/요약용)
function stripHtml(html: string): string {
  if (!html) return ''
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  return (tmp.textContent || tmp.innerText || '').replace(/\s+/g, ' ').trim()
}

// CSV 한 셀 이스케이프 (쉼표·따옴표·줄바꿈 처리)
function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// 행 배열을 CSV 파일로 다운로드 (엑셀 한글 호환 위해 UTF-8 BOM 추가)
function downloadCsv(filename: string, rows: (string | number | undefined)[][]) {
  const body = rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
  const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
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
  onPreview?: (attachment: { name: string; type: string; dataUrl?: string; key?: string; size: number }) => void
}) {
  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    void Promise.all(Array.from(files).map((file) => uploadAttachment(file)))
      .then((items) => onChange([...attachments, ...items]))
      .catch(() => window.alert('첨부파일 업로드에 실패했습니다.'))
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
                  onClick={() => onPreview({ name: file.name, type: file.type, dataUrl: file.dataUrl, key: file.key, size: file.size })}
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

// 섹션별 문의 입력 박스: 해당 섹션 라벨을 붙여 프로젝트 댓글로 등록
// SRS 읽기 전용: 섹션별 볼드 타이틀 + 본문
function SrsReadView({ srs }: { srs: string }) {
  if (!srs.trim()) return <p className="richEditorFallback">아직 등록된 SRS 내용이 없습니다.</p>
  const map = parseSrsSections(srs)
  const filled = srsSections.filter((s) => (map[s.key] ?? '').trim().length > 0)
  if (filled.length === 0) return <RichTextView html={srs} fallback="아직 등록된 SRS 내용이 없습니다." />
  return (
    <div className="srsReadView">
      <table className="srsReadTable">
        <tbody>
          {filled.map((s) => (
            <tr key={s.key}>
              <th scope="row">
                <span className="srsRowKo">{s.ko}</span>
                <em>{s.en}</em>
              </th>
              <td><RichTextView html={map[s.key]} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// SDS 읽기 뷰: 본문의 h3 소제목을 항목으로 파싱해 SRS와 동일한 2열 테이블로 표시
function SdsReadView({ sds }: { sds: string }) {
  if (!sds.trim()) return <p className="richEditorFallback">아직 등록된 SDS 내용이 없습니다.</p>
  const parts = sds.split(/<h3[^>]*>([\s\S]*?)<\/h3>/g)
  const rows: { title: string; body: string }[] = []
  for (let i = 1; i < parts.length; i += 2) {
    const title = parts[i].replace(/<[^>]+>/g, '').replace(/^\d+\.\s*/, '').trim()
    const body = (parts[i + 1] ?? '').trim()
    if (title) rows.push({ title, body })
  }
  if (rows.length === 0) return <RichTextView html={sds} fallback="아직 등록된 SDS 내용이 없습니다." />
  return (
    <div className="srsReadView">
      <table className="srsReadTable">
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <th scope="row"><span className="srsRowKo">{r.title}</span></th>
              <td><RichTextView html={r.body} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// 댓글 한 행: 왼쪽 작성자/시각, 오른쪽 내용 + 작성자 수정/삭제
// 문의 댓글의 @담당자 멘션 후보 목록 (역할 라벨 기준)
const mentionTargets: { value: string; label: string }[] = [
  { value: 'PM', label: 'PM' },
  { value: 'CEM', label: 'CEM' },
  { value: '개발', label: '개발' },
  { value: 'QA', label: 'QA' },
  { value: '정보보호', label: '정보보호' },
  { value: '인프라', label: '인프라' },
  { value: '특허', label: '특허' },
  { value: '요청자', label: '요청자' },
  { value: '관리자', label: '관리자' },
]

const mentionRegex = new RegExp(`@(${mentionTargets.map((m) => m.value).join('|')})`, 'g')

function renderWithMentions(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0
  const regex = new RegExp(mentionRegex.source, 'g')
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index))
    nodes.push(<span key={key++} className="mentionChip">@{match[1]}</span>)
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes.length > 0 ? nodes : [text]
}

function CommentItem({
  comment,
  kind,
  currentRole,
  stripPrefix,
  onEdit,
  onDelete,
}: {
  comment: import('./types').ProjectComment
  kind: 'q' | 'a'
  currentRole: Role
  stripPrefix?: string
  onEdit?: (id: string, message: string) => void
  onDelete?: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const display = stripPrefix ? comment.message.replace(`${stripPrefix} `, '') : comment.message
  const [draft, setDraft] = useState(display)
  const canManage = (comment.role === currentRole || currentRole === 'admin') && (onEdit || onDelete)
  return (
    <div className={`commentRow ${kind === 'a' ? 'reply' : ''}`}>
      {kind === 'a' && <CornerDownRight size={14} className="replyIcon" />}
      <span className={`qaBadge ${kind}`}>{kind === 'q' ? '문의' : '답변'}</span>
      <strong className="commentAuthor">{comment.actor}</strong>
      <span className="commentRowTime">{formatDateTime(comment.at)}</span>
      {editing ? (
        <form
          className="inquiryForm commentEditForm"
          onSubmit={(e) => {
            e.preventDefault()
            if (!draft.trim() || !onEdit) return
            onEdit(comment.id, draft)
            setEditing(false)
          }}
        >
          <input value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
          <button className="primaryButton" type="submit" disabled={!draft.trim()}>저장</button>
          <button className="miniButton" type="button" onClick={() => { setDraft(display); setEditing(false) }}>취소</button>
        </form>
      ) : (
        <>
          <p className="commentBody">{renderWithMentions(display)}</p>
          {canManage && (
            <div className="commentRowActions">
              {onEdit && <button type="button" onClick={() => { setDraft(display); setEditing(true) }}>수정</button>}
              {onDelete && <button type="button" className="danger" onClick={() => { if (window.confirm('삭제할까요?')) onDelete(comment.id) }}>삭제</button>}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function SectionInquiryBox({ sectionLabel, comments, currentRole, onAdd, onEdit, onDelete }: { sectionLabel: string; comments?: import('./types').ProjectComment[]; currentRole: Role; onAdd: (message: string, parentId?: string) => void; onEdit?: (id: string, message: string, sectionPrefix?: string) => void; onDelete?: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [replyDraft, setReplyDraft] = useState('')
  const all = (comments ?? []).filter((c) => c.message.startsWith(`[${sectionLabel}]`))
  const threads = all.filter((c) => !c.parentId)
  const repliesOf = (id: string) => all.filter((c) => c.parentId === id)
  return (
    <div className="sectionInquiryBox">
      <button type="button" className="sectionInquiryToggle" onClick={() => setOpen((v) => !v)}>
        💬 문의 사항 {threads.length > 0 ? `(${threads.length})` : ''}
      </button>
      {open && (
        <div className="sectionInquiryBody">
          {threads.length > 0 && (
            <div className="commentThreadList">
              {threads.slice().reverse().map((q) => (
                <div key={q.id} className="commentThread">
                  <CommentItem
                    comment={q}
                    kind="q"
                    currentRole={currentRole}
                    stripPrefix={`[${sectionLabel}]`}
                    onEdit={onEdit ? (id, msg) => onEdit(id, msg, `[${sectionLabel}]`) : undefined}
                    onDelete={onDelete}
                  />
                  {repliesOf(q.id).map((a) => (
                    <CommentItem
                      key={a.id}
                      comment={a}
                      kind="a"
                      currentRole={currentRole}
                      stripPrefix={`[${sectionLabel}]`}
                      onEdit={onEdit ? (id, msg) => onEdit(id, msg, `[${sectionLabel}]`) : undefined}
                      onDelete={onDelete}
                    />
                  ))}
                  {replyTo === q.id ? (
                    <form
                      className="inquiryForm replyForm"
                      onSubmit={(e) => {
                        e.preventDefault()
                        if (!replyDraft.trim()) return
                        onAdd(`[${sectionLabel}] ${replyDraft.trim()}`, q.id)
                        setReplyDraft('')
                        setReplyTo(null)
                      }}
                    >
                      <select
                        className="mentionSelect"
                        value=""
                        onChange={(e) => {
                          const v = e.target.value
                          if (!v) return
                          setReplyDraft((d) => (d ? `${d.replace(/\s+$/, '')} @${v} ` : `@${v} `))
                          e.target.value = ''
                        }}
                        aria-label="담당자 멘션 추가"
                      >
                        <option value="">@담당자</option>
                        {mentionTargets.map((m) => (
                          <option key={m.value} value={m.value}>@{m.label}</option>
                        ))}
                      </select>
                      <textarea
                        className="inquiryInput"
                        rows={1}
                        value={replyDraft}
                        onChange={(e) => setReplyDraft(e.target.value)}
                        onInput={(e) => { e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px` }}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (replyDraft.trim()) { onAdd(`[${sectionLabel}] ${replyDraft.trim()}`, q.id); setReplyDraft(''); setReplyTo(null) } } }}
                        placeholder="답변 입력"
                        autoFocus
                      />
                      <button className="primaryButton" type="submit" disabled={!replyDraft.trim()}>답변</button>
                    </form>
                  ) : (
                    <button type="button" className="qaReplyBtn" onClick={() => { setReplyTo(q.id); setReplyDraft('') }}>답변 달기</button>
                  )}
                </div>
              ))}
            </div>
          )}
          <form
            className="inquiryForm"
            onSubmit={(e) => {
              e.preventDefault()
              if (!draft.trim()) return
              onAdd(`[${sectionLabel}] ${draft.trim()}`)
              setDraft('')
            }}
          >
            <select
              className="mentionSelect"
              value=""
              onChange={(e) => {
                const v = e.target.value
                if (!v) return
                setDraft((d) => (d ? `${d.replace(/\s+$/, '')} @${v} ` : `@${v} `))
                e.target.value = ''
              }}
              aria-label="담당자 멘션 추가"
            >
              <option value="">@담당자</option>
              {mentionTargets.map((m) => (
                <option key={m.value} value={m.value}>@{m.label}</option>
              ))}
            </select>
            <textarea
              className="inquiryInput"
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onInput={(e) => { e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px` }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (draft.trim()) { onAdd(`[${sectionLabel}] ${draft.trim()}`); setDraft('') } } }}
              placeholder={`${sectionLabel}에 대한 문의/의견`}
            />
            <button className="primaryButton" type="submit" disabled={!draft.trim()}>등록</button>
          </form>
        </div>
      )}
    </div>
  )
}

function RequesterContentPanel({
  project,
  currentRole,
  canEdit,
  highlight,
  onSave,
  onInquire,
  onEditInquiry,
  onDeleteInquiry,
}: {
  project: Project
  currentRole: Role
  canEdit: boolean
  highlight?: boolean
  onSave: (patch: Partial<Project>) => void
  onInquire?: (message: string, parentId?: string) => void
  onEditInquiry?: (id: string, message: string, sectionPrefix?: string) => void
  onDeleteInquiry?: (id: string) => void
}) {
  const cfg = requestTypeOptions.find((item) => item.type === project.requestType)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    title: project.title,
    summary: project.summary,
    serviceName: project.serviceName,
    serviceArea: project.serviceArea,
    requester: project.requester,
    ownerTeam: project.ownerTeam,
    dueDate: project.dueDate,
    currentProblem: project.currentProblem,
    desiredOutcome: project.desiredOutcome,
    successMetric: project.successMetric,
    affectedUsers: project.affectedUsers,
    risk: project.risk,
  })

  function startEdit() {
    setForm({
      title: project.title,
      summary: project.summary,
      serviceName: project.serviceName,
      serviceArea: project.serviceArea,
      requester: project.requester,
      ownerTeam: project.ownerTeam,
      dueDate: project.dueDate,
      currentProblem: project.currentProblem,
      desiredOutcome: project.desiredOutcome,
      successMetric: project.successMetric,
      affectedUsers: project.affectedUsers,
      risk: project.risk,
    })
    setEditing(true)
  }

  function save() {
    if (!form.title.trim()) { window.alert('요청 제목은 필수입니다.'); return }
    onSave(form)
    setEditing(false)
  }

  const set = <K extends keyof typeof form>(k: K, v: string) => setForm((s) => ({ ...s, [k]: v }))

  return (
    <section className={`requirementsPanel numberedSection sectionRequester requesterContent ${highlight && canEdit ? 'neonHighlight' : ''}`} data-section="요청 내용" data-section-tone="request">
      <div className="panelHeader compact">
        <div>
          <h3>요청자 작성 내용</h3>
          <span>{editing ? '수정 중 · 저장하면 반영됩니다' : '요청 등록 시 작성된 원본 내용'}</span>
        </div>
        {canEdit && !editing && (
          <div className="requesterContentBadges">
            <button className="miniButton" type="button" onClick={startEdit}>수정</button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="requestForm">
          <div className="formGrid two">
            <label><span>요청 제목</span><input value={form.title} onChange={(e) => set('title', e.target.value)} /></label>
            <label><span>{cfg?.serviceLabel ?? '대상 서비스'}</span><input value={form.serviceName} onChange={(e) => set('serviceName', e.target.value)} /></label>
            <label><span>{cfg?.areaLabel ?? '영역'}</span><input value={form.serviceArea} onChange={(e) => set('serviceArea', e.target.value)} /></label>
            <label><span>요청 부서</span><input value={form.ownerTeam} onChange={(e) => set('ownerTeam', e.target.value)} /></label>
            <label><span>요청자</span><input value={form.requester} onChange={(e) => set('requester', e.target.value)} /></label>
            <label><span>희망 완료일</span><input type="date" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} /></label>
          </div>
          <div className="formGrid">
            <label><span>{cfg?.summaryLabel ?? '요약'}</span><RichEditor value={form.summary} onChange={(html) => set('summary', html)} minHeight={70} placeholder="무엇을 왜 요청하는지" /></label>
            <label><span>{cfg?.problemLabel ?? '현재 문제'}</span><RichEditor value={form.currentProblem} onChange={(html) => set('currentProblem', html)} minHeight={70} /></label>
            <label><span>{cfg?.outcomeLabel ?? '원하는 결과'}</span><RichEditor value={form.desiredOutcome} onChange={(html) => set('desiredOutcome', html)} minHeight={70} /></label>
            <label><span>{cfg?.metricLabel ?? '성공 기준'}</span><RichEditor value={form.successMetric} onChange={(html) => set('successMetric', html)} minHeight={60} /></label>
            <label><span>{cfg?.audienceLabel ?? '영향 사용자/부서'}</span><input value={form.affectedUsers} onChange={(e) => set('affectedUsers', e.target.value)} /></label>
            <label><span>리스크/검토 사항</span><RichEditor value={form.risk} onChange={(html) => set('risk', html)} minHeight={60} /></label>
          </div>
          <div className="docSaveBar">
            <button className="miniButton" type="button" onClick={() => setEditing(false)}>취소</button>
            <button className="primaryButton" type="button" onClick={save}>저장</button>
          </div>
        </div>
      ) : (
        <>
          <div className="requesterSummary">
            <div className="requesterField"><span>요청 제목</span><strong>{project.title}</strong></div>
            <div className="requesterField"><span>{cfg?.summaryLabel ?? '요약'}</span><p>{project.summary?.trim() || <em>(요청자 미입력)</em>}</p></div>
            <div className="requesterField"><span>{cfg?.serviceLabel ?? '대상 서비스'}</span><p>{project.serviceName} · {project.serviceArea}</p></div>
            <div className="requesterField"><span>요청자 · 담당 조직</span><p>{project.requester} · {project.ownerTeam}</p></div>
            <div className="requesterField"><span>희망 완료일</span><p>{project.dueDate || <em>(요청자 미입력)</em>}</p></div>
          </div>
          <div className="requirementGrid">
            <RequirementBlock label={cfg?.problemLabel ?? '현재 문제'} value={project.currentProblem || '(요청자 미입력)'} />
            <RequirementBlock label={cfg?.outcomeLabel ?? '원하는 결과'} value={project.desiredOutcome || '(요청자 미입력)'} />
            <RequirementBlock label={cfg?.metricLabel ?? '성공 기준'} value={project.successMetric || '(요청자 미입력)'} />
            <RequirementBlock label={cfg?.audienceLabel ?? '영향 사용자/부서'} value={project.affectedUsers || '(요청자 미입력)'} />
            <RequirementBlock label="리스크/검토 사항" value={project.risk || '(요청자 미입력)'} />
          </div>
          {onInquire && <SectionInquiryBox sectionLabel="요청내용" comments={project.comments} currentRole={currentRole} onAdd={onInquire} onEdit={onEditInquiry} onDelete={onDeleteInquiry} />}
        </>
      )}
    </section>
  )
}

// ④ 단계별 문의/논의: 문의 + 답변을 표시만 (입력은 각 섹션 문의 박스에서)
function RequirementBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="requirementBlock">
      <span>{label}</span>
      <RichTextView html={value} fallback="(미입력)" />
    </div>
  )
}

function SettingsPanel({
  role,
  serviceOptions,
  setServiceOptions,
  projects,
  onToggleHold,
  onDeleteProject,
  onDeleteAllProjects,
  sessionTimeoutMin,
  onSaveSessionTimeout,
}: {
  role: Role
  serviceOptions: string[]
  setServiceOptions: (nextOptions: string[]) => void
  projects: Project[]
  onToggleHold: (projectId: string) => void
  onDeleteProject: (projectId: string) => void
  onDeleteAllProjects: () => void
  sessionTimeoutMin: number
  onSaveSessionTimeout: (min: number) => void
}) {
  const [draft, setDraft] = useState('')
  const [holdFilter, setHoldFilter] = useState<'all' | 'onHold' | 'active'>('all')
  const [timeoutDraft, setTimeoutDraft] = useState(String(sessionTimeoutMin))
  const [timeoutSaved, setTimeoutSaved] = useState(false)

  type ConfirmAction = { type: 'delete'; projectId: string; title: string } | { type: 'hold'; projectId: string; title: string; isHold: boolean } | { type: 'deleteAll' }
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [confirmKey, setConfirmKey] = useState('')

  const REQUIRED_KEY = '확인'

  function handleConfirmSubmit() {
    if (confirmKey !== REQUIRED_KEY || !confirmAction) return
    if (confirmAction.type === 'delete') onDeleteProject(confirmAction.projectId)
    else if (confirmAction.type === 'hold') onToggleHold(confirmAction.projectId)
    else if (confirmAction.type === 'deleteAll') onDeleteAllProjects()
    setConfirmAction(null)
    setConfirmKey('')
  }

  function handleSaveTimeout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const min = Number(timeoutDraft)
    // 범위·정수 검증은 input의 min/max/step으로 브라우저가 먼저 막아 안내까지 해준다.
    // 아래는 프로그램적 호출 등 우회 경로에 대한 방어용 가드.
    if (!Number.isFinite(min) || !Number.isInteger(min) || min < 5 || min > 480) return
    onSaveSessionTimeout(min)
    setTimeoutSaved(true)
    setTimeout(() => setTimeoutSaved(false), 1800)
  }

  // 동사무소 게시판 API 등록 설정 (localStorage 영속)
  const [officeApi, setOfficeApi] = useState<OfficeApiConfig>(() => readOfficeApiConfig())
  const [officeApiSaved, setOfficeApiSaved] = useState(false)
  const [officeTest, setOfficeTest] = useState<{ ok: boolean; message: string } | null>(null)
  const [officeTesting, setOfficeTesting] = useState(false)

  function saveOfficeApi(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    window.localStorage.setItem(officeApiStorageKey, JSON.stringify(officeApi))
    setOfficeApiSaved(true)
    setTimeout(() => setOfficeApiSaved(false), 1800)
  }

  async function runOfficeTest() {
    // 저장 버튼(native submit)의 type="url" 검증을 우회하므로 여기서 직접 확인.
    // 프록시 모드에서는 Base URL을 쓰지 않으므로 검사하지 않는다.
    if (!isOfficeProxyMode()) {
      const urlError = validateOfficeBaseUrl(officeApi.baseUrl)
      if (urlError) {
        setOfficeTest({ ok: false, message: urlError })
        return
      }
    }
    setOfficeTesting(true)
    setOfficeTest(null)
    const result = await testOfficeBoardConnection(officeApi)
    setOfficeTesting(false)
    setOfficeTest(
      result.ok
        ? {
            ok: true,
            message:
              `주소 도달 확인 (HTTP ${result.status})` +
              (isOfficeProxyMode() ? ` · 프록시 ${getOfficeProxyUrl()}` : ` · ${buildOfficePostUrl(officeApi)}`) +
              '\n※ 경로·자격증명이 맞는지는 확인되지 않습니다. 완료 보고 1건을 실제 전송해 검증하세요.',
          }
        : { ok: false, message: result.error },
    )
  }

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
    <>
    {role === 'security' && (
    <section className="requestPanel settingsPanel">
      <div className="requestIntro">
        <p className="eyebrow">Security</p>
        <h2>보안 설정</h2>
        <p>시스템 보안 정책을 설정합니다. 변경 사항은 즉시 적용됩니다.</p>
      </div>
      <div className="settingsSection">
        <div className="panelHeader compact">
          <div>
            <h3>세션 타임아웃</h3>
            <p>로그인 후 자동 로그아웃까지의 시간을 설정합니다. (5분 ~ 480분)</p>
          </div>
        </div>
        <form onSubmit={handleSaveTimeout} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="number"
            min={5}
            max={480}
            value={timeoutDraft}
            onChange={(e) => { setTimeoutDraft(e.target.value); setTimeoutSaved(false) }}
            placeholder="분 단위 입력"
            aria-label="세션 타임아웃(분)"
            style={{ width: 120, height: 34, padding: '0 10px', border: '1px solid #cfd3da', borderRadius: 8, fontSize: 14, color: '#20242b', background: '#fff', boxSizing: 'border-box' }}
          />
          <span style={{ fontSize: 13, color: '#606772', whiteSpace: 'nowrap' }}>분</span>
          <button className="miniButton" type="submit" disabled={timeoutSaved}>
            {timeoutSaved ? '저장됨 ✓' : '저장'}
          </button>
        </form>
        <p style={{ fontSize: 12, color: '#8a909a', marginTop: 4 }}>현재 설정: <strong>{sessionTimeoutMin}분</strong> — 로그인 후 {sessionTimeoutMin}분이 지나면 자동 로그아웃됩니다.</p>
      </div>
    </section>
    )}

    {role === 'admin' && (
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
        <form className="officeApiForm" onSubmit={saveOfficeApi}>
          <div className="panelHeader compact officeApiHeader">
            <div>
              <h3>동사무소 게시판 API <span className="wipBadge">연동 미완</span></h3>
              <p>
                완료된 프로젝트를 동사무소 게시판에 게시하기 위한 연결 정보입니다.
                <br />
                <strong>현재는 전송이 실패합니다</strong> — 게시판 서버(center.muhayu.com)가 CORS를 허용하지 않고,
                인증도 Basic이 아닌 세션(JSESSIONID) 방식입니다. 게시 엔드포인트·인증 흐름 확정 후 동작합니다.
              </p>
            </div>
            <div className="officeApiActions">
              {officeApiSaved && <span className="officeApiSavedHint">저장되었습니다 ✓</span>}
              <button className="miniButton" type="button" onClick={() => void runOfficeTest()} disabled={officeTesting}>
                {officeTesting ? '테스트 중…' : '연결 테스트'}
              </button>
              <button className="primaryButton" type="submit">저장</button>
            </div>
          </div>
          <div className="formGrid two">
            <label>
              <span>Base URL</span>
              <input
                type="url"
                value={officeApi.baseUrl}
                onChange={(e) => setOfficeApi((c) => ({ ...c, baseUrl: e.target.value }))}
                placeholder="https://center.muhayu.com"
              />
            </label>
            <label>
              <span>Board name</span>
              <input
                type="text"
                value={officeApi.boardName}
                onChange={(e) => setOfficeApi((c) => ({ ...c, boardName: e.target.value }))}
                placeholder="security"
              />
            </label>
            <label>
              <span>Username</span>
              <input
                type="text"
                value={officeApi.username}
                onChange={(e) => setOfficeApi((c) => ({ ...c, username: e.target.value }))}
                placeholder="shbae"
                autoComplete="off"
              />
            </label>
            <label>
              <span>Password</span>
              <input
                type="password"
                value={officeApi.password}
                onChange={(e) => setOfficeApi((c) => ({ ...c, password: e.target.value }))}
                placeholder="새 비밀번호를 입력하면 갱신됩니다."
                autoComplete="new-password"
              />
            </label>
            <label>
              <span>게시 경로 (Post path)</span>
              <input
                type="text"
                value={officeApi.postPath ?? ''}
                onChange={(e) => setOfficeApi((c) => ({ ...c, postPath: e.target.value }))}
                placeholder={DEFAULT_OFFICE_POST_PATH}
              />
            </label>
          </div>
          {isOfficeProxyMode() ? (
            <p className="officeApiHint">
              <strong>프록시 모드</strong> — 주소·계정·비밀번호는 Worker에 보관되며 위 입력값 대신 사용됩니다.
              브라우저에는 <strong>게시판명만</strong> 필요합니다.
              <br />
              프록시: <code>{getOfficeProxyUrl()}</code>
            </p>
          ) : (
            <p className="officeApiHint">
              {'게시판 스펙에 맞춰 경로를 지정하세요. {board} 는 게시판명으로 치환됩니다. 비우면 '}
              <code>{DEFAULT_OFFICE_POST_PATH}</code>
              {' 를 사용합니다.'}
              {isOfficeBoardConfigured(officeApi) && officeApi.baseUrl.trim() && (
                <>
                  <br />
                  전송 대상: <code>{buildOfficePostUrl(officeApi)}</code>
                </>
              )}
              <br />
              <strong>직접 호출 모드</strong>입니다. 게시판 서버가 이 도메인의 CORS를 허용하지 않으면
              브라우저가 요청을 차단합니다(&quot;Failed to fetch&quot;). 그 경우 <code>VITE_OFFICE_PROXY_URL</code> 로
              프록시 모드를 사용하세요.
            </p>
          )}
          {officeTest && (
            <p className={`officeApiTestResult ${officeTest.ok ? 'ok' : 'fail'}`}>{officeTest.message}</p>
          )}
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
            <button
              type="button"
              className="dangerChip"
              disabled={projects.length === 0}
              onClick={() => { setConfirmAction({ type: 'deleteAll' }); setConfirmKey('') }}
            >
              전체 삭제
            </button>
          </div>
        </div>

        <div className="projectHoldList">
          {projects
            .filter((project) => {
              if (holdFilter === 'onHold') return project.onHold
              if (holdFilter === 'active') return !project.onHold && !['rejected'].includes(project.status)
              return true
            })
            .map((project) => {
              const disabled = ['rejected'].includes(project.status)
              return (
                <div key={project.id} className={`projectHoldRow ${project.onHold ? 'onHold' : ''}`}>
                  <div className="projectHoldInfo">
                    <div className="projectHoldTop">
                      <span className={`statusPill ${project.status}`}>{statusLabels[project.status]}</span>
                      <span className="requestTypePill">{requestTypeLabels[project.requestType]}</span>
                      {project.onHold && <span className="holdTag">보류</span>}
                    </div>
                    <strong>{project.title}</strong>
                    <small>{project.serviceName} · {project.ownerTeam} · {(() => { const dd = dDayInfo(project.dueDate, demoToday); return <span className={`ddayPill ${dd.tone}`}>{dd.label}</span> })()}</small>
                    {project.onHold && project.holdReason && <em>사유: {project.holdReason}</em>}
                  </div>
                  <div className="projectManageActions">
                    <button
                      className="miniButton"
                      type="button"
                      disabled={disabled}
                      onClick={() => { setConfirmAction({ type: 'hold', projectId: project.id, title: project.title, isHold: !project.onHold }); setConfirmKey('') }}
                    >
                      {project.onHold ? '보류 해제' : '보류'}
                    </button>
                    <button
                      className="miniButton rejectButton"
                      type="button"
                      onClick={() => { setConfirmAction({ type: 'delete', projectId: project.id, title: project.title }); setConfirmKey('') }}
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
    </section>
    )}

    {confirmAction && (
      <div className="attachmentModalBackdrop" role="dialog" aria-modal="true" onClick={() => { setConfirmAction(null); setConfirmKey('') }}>
        <div className="confirmKeyModal" onClick={(e) => e.stopPropagation()}>
          <div className="confirmKeyModalHeader">
            <strong>
              {confirmAction.type === 'deleteAll' ? '전체 삭제 확인' :
               confirmAction.type === 'delete' ? '프로젝트 삭제 확인' :
               confirmAction.isHold ? '보류 확인' : '보류 해제 확인'}
            </strong>
          </div>
          <div className="confirmKeyModalBody">
            <p>
              {confirmAction.type === 'deleteAll'
                ? `전체 프로젝트 ${projects.length}개를 모두 삭제합니다. 되돌릴 수 없습니다.`
                : confirmAction.type === 'delete'
                ? `"${confirmAction.title}" 프로젝트를 삭제합니다. 되돌릴 수 없습니다.`
                : confirmAction.isHold
                ? `"${confirmAction.title}" 프로젝트를 보류 처리합니다.`
                : `"${confirmAction.title}" 프로젝트의 보류를 해제합니다.`}
            </p>
            <p className="confirmKeyInstruction">아래에 <strong>{REQUIRED_KEY}</strong>을 입력하세요.</p>
            <input
              className="confirmKeyInput"
              type="text"
              value={confirmKey}
              placeholder={REQUIRED_KEY}
              autoFocus
              onChange={(e) => setConfirmKey(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleConfirmSubmit() }}
            />
          </div>
          <div className="confirmKeyModalFooter">
            <button className="miniButton" type="button" onClick={() => { setConfirmAction(null); setConfirmKey('') }}>취소</button>
            <button
              className="miniButton rejectButton"
              type="button"
              disabled={confirmKey !== REQUIRED_KEY}
              onClick={handleConfirmSubmit}
            >
              {confirmAction.type === 'delete' || confirmAction.type === 'deleteAll' ? '삭제' : confirmAction.isHold ? '보류' : '보류 해제'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}

function Metric({ icon, label, value, tone, onClick }: { icon: ReactNode; label: string; value: number; tone: string; onClick: () => void }) {
  const disabled = value === 0
  return (
    <button className={`metric ${tone}`} type="button" onClick={onClick} disabled={disabled} aria-disabled={disabled}>
      <div>{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </button>
  )
}

function Artifact({ label, state }: { label: string; state: string }) {
  const doneStates = ['승인됨', '게시 준비', '완료', '게시됨']
  const isDone = doneStates.includes(state)
  const isPending = state === '대기'
  return (
    <div className={`artifact ${isDone ? 'done' : isPending ? 'pending' : 'progress'}`}>
      <FileText size={16} />
      <span>{label}</span>
      <strong>{isDone ? `✓ ${state}` : state}</strong>
      <ChevronRight size={15} />
    </div>
  )
}

function nextRoleFor(status: ProjectStatus): Role {
  const roleMap: Partial<Record<ProjectStatus, Role>> = {
    dept_review: 'pm',
    planning: 'pm',
    development: 'developer',
    qc_security: 'qa',
    deployment: 'infra',
    completion: 'admin',
  }
  return roleMap[status] ?? 'requester'
}

function nextActionFor(status: ProjectStatus) {
  const actionMap: Partial<Record<ProjectStatus, string>> = {
    dept_review: '승인 의견 취합',
    planning: '기획 문서(SRS+SDS) 작성 후 승인 단계로 이동',
    development: '일정 확정 후 개발 태스크 진행',
    qc_security: '단위·통합·보안 테스트 및 PM 검토',
    deployment: '인프라 운영 반영 및 smoke test 확인',
    completion: '완료 보고서 작성 및 게시 확인',
  }
  return actionMap[status] ?? '요청 내용 보완'
}

function daysUntil(date: string, from: Date) {
  const target = new Date(`${date}T23:59:59+09:00`)
  return Math.ceil((target.getTime() - from.getTime()) / 86_400_000)
}

// 활동 로그 메시지로 타임라인 도트 색/종류 추정
function logTone(message: string): 'reject' | 'approve' | 'advance' | 'hold' | 'doc' | 'default' {
  if (/반려/.test(message)) return 'reject'
  if (/승인|확인|완료/.test(message)) return 'approve'
  if (/단계 진행|진행했|진행 처리|단계를/.test(message)) return 'advance'
  if (/보류/.test(message)) return 'hold'
  if (/문서|기획|일정|업데이트/.test(message)) return 'doc'
  return 'default'
}

// 마감일 기준 D-day 라벨/상태. overdue면 D+n, 오늘이면 D-DAY, 임박/여유 구분.
function dDayInfo(date: string, from: Date): { label: string; tone: 'overdue' | 'today' | 'soon' | 'normal' } {
  if (!date) return { label: '미정', tone: 'normal' }
  const d = daysUntil(date, from)
  if (d < 0) return { label: `D+${Math.abs(d)}`, tone: 'overdue' }
  if (d === 0) return { label: 'D-DAY', tone: 'today' }
  return { label: `D-${d}`, tone: d <= 3 ? 'soon' : 'normal' }
}

// 파일명용 날짜 스탬프: 'YYYYMMDD'
function todayStamp() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}

// 로그용 타임스탬프: 'YYYY-MM-DD HH:mm'
function logStamp() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// 다양한 형식의 'at' 값을 'YYYY-MM-DD HH:mm:ss'로 보여주기 위해 정규화
function formatTimestamp(at: string): string {
  if (!at) return ''
  // ISO 형식 (2026-05-31T14:23:45.123Z)
  if (/T.*Z|T.*[+-]\d{2}:?\d{2}/.test(at)) {
    const d = new Date(at)
    if (isNaN(d.getTime())) return at
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  }
  // 'YYYY-MM-DD HH:mm' (초가 없으면 :00 추가)
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(at)) return `${at}:00`
  return at
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
