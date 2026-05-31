import type { Project, ProjectStatus, Role } from './types'

export const workflow: Array<{ status: ProjectStatus; label: string; owner: string; optional?: boolean }> = [
  { status: 'request', label: '요청 단계', owner: '요청자' },
  { status: 'planning', label: '기획 단계', owner: 'PM' },
  { status: 'dept_review', label: '승인 단계', owner: '승인자' },
  { status: 'development', label: '개발 단계', owner: '기획·개발' },
  { status: 'qc_security', label: '검토 단계', owner: '품질·보안·PM' },
  { status: 'completion', label: '완료 보고', owner: 'PM' },
]

export const roleLabels: Record<Role, string> = {
  requester: '요청자',
  sales: '영업',
  marketing: '마케팅',
  pm: 'PM',
  cem: 'CEM',
  developer: '개발자',
  infra: '인프라',
  qa: 'QC',
  security: '보안',
  patent: '특허',
  admin: '관리자',
}

const fullRoles: Role[] = ['cem', 'developer', 'security', 'infra', 'qa', 'patent']

type DemoSeed = {
  id: string
  code: string
  requestType: Project['requestType']
  title: string
  serviceName: string
  serviceArea: string
  requester: string
  ownerTeam: string
  priority: Project['priority']
  status: ProjectStatus
  summary: string
  currentProblem: string
  desiredOutcome: string
  successMetric: string
  affectedUsers: string
  dueDate: string
  risk: string
  securityNotes: string
}

// 단계별 진행률·담당·승인 상태를 일관되게 생성하기 위한 헬퍼
const stageDefaults: Record<ProjectStatus, { progress: number; assignee: Project['assigneeRole']; approved: Role[]; nextAction: string }> = {
  request: { progress: 10, assignee: 'requester', approved: [], nextAction: 'PM이 요청 내용을 검토하고 기획 단계로 진행합니다.' },
  planning: { progress: 32, assignee: 'pm', approved: [], nextAction: 'PM이 기획 문서(SRS+SDS)를 작성합니다.' },
  dept_review: { progress: 46, assignee: 'pm', approved: ['cem', 'developer'], nextAction: '승인 역할 전원의 확인을 기다리고 있습니다.' },
  development: { progress: 66, assignee: 'developer', approved: fullRoles, nextAction: '일정 조율 후 개발 태스크를 진행합니다.' },
  qc_security: { progress: 86, assignee: 'qa', approved: fullRoles, nextAction: 'QC·보안·PM 3자 검토를 진행합니다.' },
  completion: { progress: 100, assignee: 'admin', approved: fullRoles, nextAction: '완료 보고를 작성하고 동사무소 게시판에 게시합니다.' },
  rejected: { progress: 8, assignee: 'requester', approved: [], nextAction: '반려 사유를 반영해 재요청합니다.' },
}

const stageStamp: Record<ProjectStatus, { created: string; updated: string; due: string }> = {
  request: { created: '2026-05-16', updated: '2026-05-17T09:10:00+09:00', due: '2026-06-20' },
  planning: { created: '2026-05-13', updated: '2026-05-17T09:40:00+09:00', due: '2026-06-12' },
  dept_review: { created: '2026-05-10', updated: '2026-05-17T10:05:00+09:00', due: '2026-06-05' },
  development: { created: '2026-05-06', updated: '2026-05-17T11:20:00+09:00', due: '2026-05-30' },
  qc_security: { created: '2026-05-02', updated: '2026-05-17T11:50:00+09:00', due: '2026-05-26' },
  completion: { created: '2026-04-24', updated: '2026-05-16T17:30:00+09:00', due: '2026-05-20' },
  rejected: { created: '2026-05-12', updated: '2026-05-16T16:00:00+09:00', due: '2026-06-15' },
}

// 기획 단계 이후로는 SRS+SDS 문서가 있어야 단계가 유지됨 (mapProjectRow 정규화 규칙)
function reviewDocsForStage(seed: DemoSeed): Project['reviewDocs'] {
  const docsReady: ProjectStatus[] = ['dept_review', 'development', 'qc_security', 'completion']
  if (docsReady.includes(seed.status)) {
    return {
      srs: `# ${seed.title} — 요구사항 정의서(SRS)\n\n## 1. 배경\n${seed.currentProblem}\n\n## 2. 목표\n${seed.desiredOutcome}\n\n## 3. 성공 지표\n${seed.successMetric}\n\n## 4. 대상 사용자\n${seed.affectedUsers}`,
      sds: `# ${seed.title} — 설계 명세서(SDS)\n\n## 1. 개요\n${seed.summary}\n\n## 2. 처리 방식\n${seed.serviceName} 서비스의 ${seed.serviceArea} 영역에 기능을 추가/개선합니다.\n\n## 3. 보안 고려사항\n${seed.securityNotes}`,
    }
  }
  if (seed.status === 'planning') {
    return {
      srs: `# ${seed.title} — 요구사항 정의서(SRS) 초안\n\n## 1. 배경\n${seed.currentProblem}\n\n(작성 중)`,
      sds: '',
    }
  }
  return { srs: '', sds: '' }
}

// 단계별 태스크(일감) — 요청/기획 단계에는 아직 일감이 없고, 승인 이후부터 생성됨
function tasksForStage(seed: DemoSeed, t: { created: string; due: string }): Project['tasks'] {
  const day = (n: number) => {
    const base = new Date(`${t.created}T09:00:00+09:00`)
    base.setDate(base.getDate() + n)
    return base.toISOString().slice(0, 10)
  }
  const mk = (
    n: number,
    type: 'story' | 'task' | 'bug' | 'change',
    title: string,
    owner: string,
    status: 'todo' | 'doing' | 'blocked' | 'done',
    note: string,
  ): Project['tasks'][number] => ({
    id: `${seed.id}-t${n}`,
    key: `${seed.code}-${n}`,
    type,
    title,
    owner,
    reporter: 'PM',
    priority: seed.priority,
    stage: seed.status,
    dueDate: day(6 + n * 3),
    status,
    statusNote: note,
    statusChangedAt: `${day(2 + n)} 14:00`,
  })

  switch (seed.status) {
    case 'dept_review':
      return [
        mk(1, 'story', `${seed.serviceArea} 요구사항 상세화`, 'PM', 'done', '기획 문서(SRS) 기준으로 상세 요구사항을 정리했습니다.'),
        mk(2, 'task', '개발 착수 전 영향 범위 점검', '개발자', 'todo', '승인 완료 후 착수 예정입니다.'),
      ]
    case 'development':
      return [
        mk(1, 'story', `${seed.serviceArea} 기본 화면 구현`, '개발자', 'done', 'UI 골격과 라우팅을 완료했습니다.'),
        mk(2, 'task', 'API 연동 및 데이터 처리', '개발자', 'doing', '연동 진행 중, 엣지 케이스 처리 남았습니다.'),
        mk(3, 'bug', '대량 데이터 조회 시 지연', '개발자', 'blocked', '인프라 캐시 정책 확정 대기 중입니다.'),
      ]
    case 'qc_security':
      return [
        mk(1, 'story', `${seed.serviceArea} 기능 구현`, '개발자', 'done', '기능 개발을 모두 완료했습니다.'),
        mk(2, 'task', 'QC 시나리오 검증', 'QA', 'doing', '핵심 시나리오 검증 중입니다.'),
        mk(3, 'task', '보안 점검 (권한·로그)', '보안', 'doing', '접근 권한과 감사 로그를 점검 중입니다.'),
      ]
    case 'completion':
      return [
        mk(1, 'story', `${seed.serviceArea} 기능 구현`, '개발자', 'done', '개발을 완료했습니다.'),
        mk(2, 'task', 'QC·보안 검토', 'QA', 'done', '3자 검토를 모두 통과했습니다.'),
        mk(3, 'task', '완료 보고서 작성 및 게시', 'PM', 'done', '완료 보고서를 작성하고 게시했습니다.'),
      ]
    default:
      return []
  }
}

// 단계별 문의 사항(댓글) — 단계 흐름에 맞는 논의 1~2건
function commentsForStage(seed: DemoSeed, t: { updated: string }): NonNullable<Project['comments']> {
  const at = t.updated.replace('T', ' ').slice(0, 16)
  const mk = (n: number, actor: string, role: Role, message: string, resolved = false): NonNullable<Project['comments']>[number] => ({
    id: `${seed.id}-c${n}`,
    at,
    actor,
    role,
    stage: seed.status,
    message,
    resolved,
  })
  switch (seed.status) {
    case 'request':
      return [mk(1, seed.requester, 'requester', `${seed.serviceName} 쪽 우선순위가 높습니다. 기획 단계 일정 가능한지 확인 부탁드립니다.`)]
    case 'planning':
      return [
        mk(1, 'PM', 'pm', '요구사항 정리했습니다. 성공 지표 기준이 이 정도면 적절할까요?'),
        mk(2, seed.requester, 'requester', '네 적절합니다. 대상 사용자 범위만 한 번 더 확인 부탁드립니다.', true),
      ]
    case 'dept_review':
      return [
        mk(1, '보안', 'security', '개인정보 포함 여부에 따라 접근 권한 분리가 필요해 보입니다. 확인 부탁드립니다.'),
        mk(2, 'PM', 'pm', '해당 부분 반영했습니다. 나머지 역할 승인 부탁드립니다.', true),
      ]
    case 'development':
      return [mk(1, '개발자', 'developer', '대량 데이터 조회 성능 이슈가 있어 인프라팀 캐시 정책 협의가 필요합니다.')]
    case 'qc_security':
      return [mk(1, 'QA', 'qa', '핵심 시나리오는 통과했습니다. 보안 점검 결과만 공유되면 사인오프하겠습니다.')]
    case 'completion':
      return [mk(1, 'PM', 'pm', '3자 검토 완료되어 게시했습니다. 운영 모니터링은 2주간 진행합니다.', true)]
    default:
      return []
  }
}

// 승인 완료 역할별 메모 + 타임스탬프 (승인 이력에 시간이 찍히도록)
function approvalMemos(approved: Role[], created: string): NonNullable<Project['approvalState']['memos']> {
  const memos: NonNullable<Project['approvalState']['memos']> = {}
  const p = (n: number) => String(n).padStart(2, '0')
  approved.forEach((r, i) => {
    const base = new Date(`${created}T10:00:00+09:00`)
    base.setDate(base.getDate() + 1)
    base.setMinutes(base.getMinutes() + i * 35)
    const at = `${base.getFullYear()}-${p(base.getMonth() + 1)}-${p(base.getDate())} ${p(base.getHours())}:${p(base.getMinutes())}`
    memos[r] = { at, actor: `${roleLabels[r]} 담당`, message: '검토 후 승인했습니다.' }
  })
  return memos
}

function buildDemoProject(seed: DemoSeed): Project {
  const d = stageDefaults[seed.status]
  const t = stageStamp[seed.status]
  return {
    id: seed.id,
    code: seed.code,
    requestType: seed.requestType,
    title: seed.title,
    serviceName: seed.serviceName,
    serviceArea: seed.serviceArea,
    requester: seed.requester,
    ownerTeam: seed.ownerTeam,
    priority: seed.priority,
    status: seed.status,
    summary: seed.summary,
    currentProblem: seed.currentProblem,
    desiredOutcome: seed.desiredOutcome,
    successMetric: seed.successMetric,
    affectedUsers: seed.affectedUsers,
    dueDate: seed.dueDate || t.due,
    createdAt: t.created,
    updatedAt: t.updated,
    risk: seed.risk,
    progress: d.progress,
    nextAction: d.nextAction,
    assigneeRole: d.assignee,
    workflowConfig: { requiresQcSecurity: true },
    approvalState: {
      requiredRoles: [...fullRoles],
      approvedRoles: [...d.approved],
      memos: approvalMemos(d.approved, t.created),
    },
    securityReview: {
      dataClassification: `${seed.serviceName} 운영 데이터 기준으로 분류, 민감정보 포함 여부 확인 필요`,
      accessScope: `${seed.ownerTeam} 및 담당 운영자 중심으로 접근 권한 분리`,
      externalExposure: '외부 연동 범위는 기획 단계에서 확정',
      storagePolicy: '운영 로그 90일 보관, 산출물은 내부 저장소 관리',
      securityNotes: seed.securityNotes,
    },
    reviewDocs: reviewDocsForStage(seed),
    schedule:
      seed.status === 'development' || seed.status === 'qc_security' || seed.status === 'completion'
        ? {
            plannedStart: t.created,
            plannedEnd: seed.dueDate || t.due,
            milestones: '킥오프 → 개발 → 통합 테스트 → 검토 → 완료 보고',
            note: '기획(PM)과 개발자가 협의해 확정한 일정입니다.',
          }
        : undefined,
    tasks: tasksForStage(seed, t),
    comments: commentsForStage(seed, t),
    logs: [
      { id: `${seed.id}-l1`, at: t.updated.replace('T', ' ').slice(0, 16), actor: d.assignee === 'requester' ? seed.requester : '담당자', message: `${seed.title} 항목을 ${seed.status} 단계로 업데이트했습니다.` },
      { id: `${seed.id}-l0`, at: `${t.created} 09:00`, actor: seed.requester, message: '신규 요청을 등록했습니다.' },
    ],
  }
}

const demoSeeds: DemoSeed[] = [
  // ───────── 카피킬러 (표절·문서 검사) ─────────
  {
    id: 'ck-1', code: 'PRJ-2505-001', requestType: 'new_feature', status: 'request',
    title: '검사 결과 PDF 리포트 다운로드', serviceName: '카피킬러', serviceArea: '표절 검사/리포트',
    requester: '이영업', ownerTeam: '영업', priority: 'normal',
    summary: '표절 검사 결과를 PDF 리포트로 내려받는 기능을 추가합니다.',
    currentProblem: '검사 결과를 화면 캡처로 공유해 가독성과 신뢰도가 떨어집니다.',
    desiredOutcome: '검사 항목·유사도·출처를 포함한 PDF 리포트를 제공합니다.',
    successMetric: '리포트 다운로드 사용률 40% 이상, 생성 오류 0건',
    affectedUsers: '교육기관 검사 담당자, 일반 사용자', dueDate: '2026-06-20',
    risk: '리포트 양식 표준화 합의 필요', securityNotes: '리포트에 원문 일부 포함되므로 다운로드 권한 통제 필요',
  },
  {
    id: 'ck-2', code: 'PRJ-2505-002', requestType: 'improvement', status: 'planning',
    title: '실시간 표절 하이라이트 뷰어 개선', serviceName: '카피킬러', serviceArea: '검사 결과 뷰어',
    requester: '김검토', ownerTeam: 'PMO', priority: 'high',
    summary: '검사 결과 문장 단위 하이라이트와 출처 매칭 뷰어를 개선합니다.',
    currentProblem: '긴 문서에서 표절 구간 탐색이 느리고 출처 연결이 끊깁니다.',
    desiredOutcome: '문장 클릭 시 출처로 이동하고 유사도 색상으로 구분합니다.',
    successMetric: '결과 확인 평균 시간 30% 단축',
    affectedUsers: '검사 담당자, 검수자', dueDate: '2026-06-12',
    risk: '대용량 문서 렌더링 성능', securityNotes: '원문·출처 텍스트 노출 범위 검토 필요',
  },
  {
    id: 'ck-3', code: 'PRJ-2505-003', requestType: 'integration_api', status: 'dept_review',
    title: '외부 LMS 연동 표절검사 API', serviceName: '카피킬러', serviceArea: 'LMS 연동/개발자 API',
    requester: '이영업', ownerTeam: '영업', priority: 'high',
    summary: '대학 LMS에서 과제 제출 시 자동으로 표절 검사를 호출하는 API를 제공합니다.',
    currentProblem: '교수가 과제를 수동으로 업로드해 검사하는 절차가 번거롭습니다.',
    desiredOutcome: 'LMS 제출과 동시에 검사 결과를 LMS에 회신합니다.',
    successMetric: '연동 기관 검사 자동화율 80%',
    affectedUsers: '대학 LMS 운영자, 교수, 학생', dueDate: '2026-06-05',
    risk: '기관별 인증 방식 상이', securityNotes: '기관 API 키 분리·과제 원문 전송 암호화 필요',
  },
  {
    id: 'ck-4', code: 'PRJ-2505-004', requestType: 'improvement', status: 'development',
    title: 'AI 문장 유사도 탐지 정확도 개선', serviceName: '카피킬러', serviceArea: '검사 엔진',
    requester: '박개발', ownerTeam: '개발', priority: 'urgent',
    summary: 'AI 생성·패러프레이징 문장 탐지 정확도를 높이는 엔진 개선입니다.',
    currentProblem: '문장을 바꿔 쓴 표절을 충분히 잡지 못합니다.',
    desiredOutcome: '의미 기반 유사도 모델을 추가해 패러프레이징을 탐지합니다.',
    successMetric: '패러프레이징 탐지 재현율 25%p 향상',
    affectedUsers: '전체 검사 사용자', dueDate: '2026-05-30',
    risk: '모델 추론 비용 증가', securityNotes: '검사 원문이 모델 학습에 반영되지 않도록 분리 필요',
  },
  {
    id: 'ck-5', code: 'PRJ-2505-005', requestType: 'infra_performance', status: 'qc_security',
    title: '대용량 문서 일괄 검사 큐 시스템', serviceName: '카피킬러', serviceArea: '검사 인프라',
    requester: '정인프라', ownerTeam: '인프라', priority: 'high',
    summary: '대량 과제 제출 시 검사 작업을 큐로 분산 처리합니다.',
    currentProblem: '제출 폭주 시 검사 지연과 타임아웃이 발생합니다.',
    desiredOutcome: '검사 작업을 큐에 적재하고 워커로 병렬 처리합니다.',
    successMetric: '피크 시 검사 대기 시간 70% 감소',
    affectedUsers: '검사 담당자, 인프라 운영자', dueDate: '2026-05-26',
    risk: '큐 적체 시 모니터링 필요', securityNotes: '큐에 적재되는 문서 데이터 암호화·보존 기간 관리',
  },
  {
    id: 'ck-6', code: 'PRJ-2505-006', requestType: 'data_report', status: 'completion',
    title: '검사 이력 통계 대시보드', serviceName: '카피킬러', serviceArea: '운영 통계',
    requester: '최운영', ownerTeam: '운영', priority: 'normal',
    summary: '기관·기간별 검사 건수와 표절률 통계를 제공하는 대시보드입니다.',
    currentProblem: '검사 이력을 엑셀로 집계해 월간 보고에 시간이 걸립니다.',
    desiredOutcome: '기관·기간별 통계를 대시보드에서 즉시 확인합니다.',
    successMetric: '월간 보고 준비 시간 80% 절감',
    affectedUsers: '운영팀, 기관 관리자', dueDate: '2026-05-20',
    risk: '집계 기준 정의 합의 필요', securityNotes: '통계는 식별정보 제거 후 집계',
  },

  // ───────── 몬스터 (채용·공고·지원자) ─────────
  {
    id: 'ms-1', code: 'PRJ-2505-007', requestType: 'new_feature', status: 'request',
    title: '공고 자동 추천 알고리즘 도입', serviceName: '몬스터', serviceArea: '채용 공고/추천',
    requester: '이영업', ownerTeam: '영업', priority: 'normal',
    summary: '구직자 프로필 기반으로 맞춤 채용 공고를 추천합니다.',
    currentProblem: '구직자가 직접 검색해야 해 적합 공고 노출이 낮습니다.',
    desiredOutcome: '프로필·지원 이력 기반 추천 공고를 노출합니다.',
    successMetric: '추천 공고 클릭률 15% 이상',
    affectedUsers: '구직자, 채용 담당자', dueDate: '2026-06-20',
    risk: '추천 편향 방지 기준 필요', securityNotes: '구직자 프로필 활용 동의 범위 확인 필요',
  },
  {
    id: 'ms-2', code: 'PRJ-2505-008', requestType: 'improvement', status: 'planning',
    title: '지원자 이력서 파싱 고도화', serviceName: '몬스터', serviceArea: '이력서 처리',
    requester: '김검토', ownerTeam: 'PMO', priority: 'high',
    summary: '다양한 양식의 이력서에서 핵심 정보를 자동 추출합니다.',
    currentProblem: '이력서 양식이 제각각이라 파싱 누락이 많습니다.',
    desiredOutcome: '경력·학력·스킬을 구조화해 검색·필터에 활용합니다.',
    successMetric: '핵심 항목 파싱 정확도 90% 이상',
    affectedUsers: '채용 담당자, 지원자', dueDate: '2026-06-12',
    risk: '비정형 양식 처리 한계', securityNotes: '이력서 개인정보 추출·보관 기준 검토 필요',
  },
  {
    id: 'ms-3', code: 'PRJ-2505-009', requestType: 'new_feature', status: 'dept_review',
    title: '채용 담당자용 칸반 파이프라인', serviceName: '몬스터', serviceArea: '지원자 관리',
    requester: '한채용', ownerTeam: 'HR', priority: 'high',
    summary: '서류·면접·합격 단계를 칸반으로 관리하는 파이프라인입니다.',
    currentProblem: '지원자 진행 상태를 스프레드시트로 관리해 누락이 잦습니다.',
    desiredOutcome: '단계별 칸반에서 지원자를 이동·코멘트 관리합니다.',
    successMetric: '지원자 상태 업데이트 누락 0건',
    affectedUsers: '채용 담당자, 면접관', dueDate: '2026-06-05',
    risk: '권한별 지원자 열람 범위 정의 필요', securityNotes: '지원자 개인정보 단계별 접근 권한 분리 필요',
  },
  {
    id: 'ms-4', code: 'PRJ-2505-010', requestType: 'new_feature', status: 'development',
    title: '면접 일정 자동 조율 기능', serviceName: '몬스터', serviceArea: '면접 운영',
    requester: '박개발', ownerTeam: '개발', priority: 'normal',
    summary: '면접관·지원자 가능 시간을 수집해 일정을 자동 조율합니다.',
    currentProblem: '면접 일정 조율을 메일·전화로 반복해 리드타임이 깁니다.',
    desiredOutcome: '가능 시간대를 매칭해 면접 일정을 자동 제안합니다.',
    successMetric: '면접 일정 확정 리드타임 50% 단축',
    affectedUsers: '면접관, 지원자, 채용 담당자', dueDate: '2026-05-30',
    risk: '캘린더 연동 인증 처리', securityNotes: '캘린더 연동 토큰 보관·갱신 정책 필요',
  },
  {
    id: 'ms-5', code: 'PRJ-2505-011', requestType: 'security_permission', status: 'qc_security',
    title: '지원자 개인정보 마스킹 강화', serviceName: '몬스터', serviceArea: '개인정보 보호',
    requester: '오보안', ownerTeam: '정보보호', priority: 'urgent',
    summary: '권한 없는 사용자에게 지원자 민감정보를 마스킹 처리합니다.',
    currentProblem: '담당자 외에도 일부 화면에서 연락처가 노출됩니다.',
    desiredOutcome: '역할별로 연락처·생년월일 등을 마스킹합니다.',
    successMetric: '비인가 노출 0건, 감사 로그 100% 기록',
    affectedUsers: '채용 담당자, 정보보호 담당', dueDate: '2026-05-26',
    risk: '마스킹 누락 화면 점검 필요', securityNotes: '마스킹 해제 이력 감사 로그 필수',
  },
  {
    id: 'ms-6', code: 'PRJ-2505-012', requestType: 'data_report', status: 'completion',
    title: '공고 성과 리포트 자동 발송', serviceName: '몬스터', serviceArea: '채용 성과',
    requester: '최운영', ownerTeam: '운영', priority: 'normal',
    summary: '공고별 조회·지원·합격 지표를 주간 리포트로 자동 발송합니다.',
    currentProblem: '공고 성과를 수기로 정리해 고객사에 전달합니다.',
    desiredOutcome: '주간 성과 리포트를 자동 생성·발송합니다.',
    successMetric: '리포트 발송 자동화율 100%',
    affectedUsers: '채용 담당자, 고객사', dueDate: '2026-05-20',
    risk: '지표 정의 일관성 확보', securityNotes: '고객사 데이터 분리 발송 검증 필요',
  },

  // ───────── 프리즘 (데이터 분석·대시보드) ─────────
  {
    id: 'pr-1', code: 'PRJ-2505-013', requestType: 'new_feature', status: 'request',
    title: '사용자 행동 퍼널 분석 보드', serviceName: '프리즘', serviceArea: '퍼널 분석',
    requester: '이영업', ownerTeam: '영업', priority: 'normal',
    summary: '가입→활성화→결제 전환 퍼널을 시각화하는 분석 보드입니다.',
    currentProblem: '단계별 이탈 지점을 한눈에 파악하기 어렵습니다.',
    desiredOutcome: '퍼널 단계별 전환율·이탈률을 시각화합니다.',
    successMetric: '핵심 퍼널 분석 사용률 50% 이상',
    affectedUsers: '그로스팀, 기획자', dueDate: '2026-06-20',
    risk: '이벤트 정의 표준화 필요', securityNotes: '행동 로그 식별정보 분리 필요',
  },
  {
    id: 'pr-2', code: 'PRJ-2505-014', requestType: 'new_feature', status: 'planning',
    title: '실시간 지표 알림 룰 엔진', serviceName: '프리즘', serviceArea: '알림/룰',
    requester: '김검토', ownerTeam: 'PMO', priority: 'high',
    summary: '지표 임계치 초과 시 슬랙·메일로 알림을 보내는 룰 엔진입니다.',
    currentProblem: '지표 이상을 사후에 발견해 대응이 늦습니다.',
    desiredOutcome: '임계치 룰을 설정해 실시간 알림을 받습니다.',
    successMetric: '이상 지표 평균 인지 시간 80% 단축',
    affectedUsers: '운영팀, 그로스팀', dueDate: '2026-06-12',
    risk: '알림 과다 발송 방지 필요', securityNotes: '알림 채널 연동 토큰 보관 정책 필요',
  },
  {
    id: 'pr-3', code: 'PRJ-2505-015', requestType: 'new_feature', status: 'dept_review',
    title: '커스텀 대시보드 위젯 빌더', serviceName: '프리즘', serviceArea: '대시보드',
    requester: '한기획', ownerTeam: '기획', priority: 'high',
    summary: '사용자가 드래그로 위젯을 배치해 대시보드를 구성합니다.',
    currentProblem: '고정 대시보드라 팀별 지표 요구를 못 맞춥니다.',
    desiredOutcome: '위젯을 선택·배치해 맞춤 대시보드를 만듭니다.',
    successMetric: '커스텀 대시보드 생성 팀 비율 60%',
    affectedUsers: '각 팀 데이터 사용자', dueDate: '2026-06-05',
    risk: '위젯 권한·공유 범위 정의 필요', securityNotes: '대시보드 공유 시 데이터 접근 권한 검증 필요',
  },
  {
    id: 'pr-4', code: 'PRJ-2505-016', requestType: 'integration_api', status: 'development',
    title: '데이터 export 스케줄러', serviceName: '프리즘', serviceArea: '데이터 내보내기',
    requester: '박개발', ownerTeam: '개발', priority: 'normal',
    summary: '지정 주기로 데이터셋을 외부 스토리지로 내보냅니다.',
    currentProblem: '데이터 추출을 수동으로 반복 실행합니다.',
    desiredOutcome: '스케줄·대상·포맷을 설정해 자동 export합니다.',
    successMetric: '수동 추출 작업 90% 제거',
    affectedUsers: '데이터 분석가, 운영팀', dueDate: '2026-05-30',
    risk: '외부 스토리지 자격증명 관리', securityNotes: 'export 대상·자격증명 암호화 보관 필요',
  },
  {
    id: 'pr-5', code: 'PRJ-2505-017', requestType: 'security_permission', status: 'qc_security',
    title: '대시보드 권한별 데이터 분리', serviceName: '프리즘', serviceArea: '접근 제어',
    requester: '오보안', ownerTeam: '정보보호', priority: 'high',
    summary: '역할·조직별로 대시보드 데이터 접근을 분리합니다.',
    currentProblem: '권한과 무관하게 전체 지표가 노출됩니다.',
    desiredOutcome: '역할·조직 단위 행/열 수준 접근 제어를 적용합니다.',
    successMetric: '비인가 데이터 접근 0건',
    affectedUsers: '전체 대시보드 사용자', dueDate: '2026-05-26',
    risk: '권한 매트릭스 정의 복잡도', securityNotes: '접근 제어 정책·감사 로그 필수',
  },
  {
    id: 'pr-6', code: 'PRJ-2505-018', requestType: 'data_report', status: 'completion',
    title: '이상 탐지 자동 리포트', serviceName: '프리즘', serviceArea: '이상 탐지',
    requester: '최운영', ownerTeam: '운영', priority: 'normal',
    summary: '지표 이상 패턴을 탐지해 원인 후보와 함께 리포트를 발송합니다.',
    currentProblem: '이상 원인 분석을 매번 수작업으로 진행합니다.',
    desiredOutcome: '이상 구간·연관 지표를 자동 리포트로 제공합니다.',
    successMetric: '이상 대응 착수 시간 60% 단축',
    affectedUsers: '운영팀, 그로스팀', dueDate: '2026-05-20',
    risk: '오탐 비율 관리 필요', securityNotes: '리포트 내 민감 지표 접근 권한 확인 필요',
  },
]

export const demoProjects: Project[] = demoSeeds.map(buildDemoProject)
