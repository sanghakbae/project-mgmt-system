// 동사무소 게시판 등록 연동
//
// 접속 정보는 설정 화면(관리자 > 동사무소 게시판 API)에서 입력하며 localStorage에 보관한다.
// 게시 경로(postPath)는 게시판 스펙에 맞춰 설정에서 바꿀 수 있게 두었다.
// {board} 토큰은 저장된 게시판명으로 치환된다.

import type { Project } from './types'

export const officeApiStorageKey = 'pms-office-api'

export const DEFAULT_OFFICE_POST_PATH = '/api/boards/{board}/posts'

/**
 * 게시판 프록시(Worker) 주소. .env 의 VITE_OFFICE_PROXY_URL 로 설정한다.
 *
 * 왜 프록시가 필요한가 — 브라우저는 다른 출처의 API를 호출할 때 그 서버가
 * Access-Control-Allow-Origin 을 내려주지 않으면 요청을 차단한다(CORS).
 * 게시판 서버가 이 앱 도메인을 허용해 주지 않는 한 브라우저 직접 호출은 불가능하고,
 * 실패는 상세 정보 없는 "Failed to fetch" 로만 나타난다.
 * 프록시 모드에서는 Worker가 서버 측에서 대신 호출하므로 CORS가 적용되지 않으며,
 * 자격증명도 브라우저에 저장하지 않는다(Worker 시크릿에 보관).
 */
const proxyUrl = ((import.meta.env.VITE_OFFICE_PROXY_URL as string | undefined) ?? '').replace(/\/+$/, '')

export function isOfficeProxyMode(): boolean {
  return Boolean(proxyUrl)
}

export function getOfficeProxyUrl(): string {
  return proxyUrl
}

export type OfficeApiConfig = {
  baseUrl: string
  boardName: string
  username: string
  password: string
  /** 게시 엔드포인트 경로. 비우면 DEFAULT_OFFICE_POST_PATH 사용 */
  postPath?: string
}

export const emptyOfficeApiConfig: OfficeApiConfig = {
  baseUrl: '',
  boardName: '',
  username: '',
  password: '',
  postPath: DEFAULT_OFFICE_POST_PATH,
}

export function readOfficeApiConfig(): OfficeApiConfig {
  if (typeof window === 'undefined') return emptyOfficeApiConfig
  try {
    const saved = window.localStorage.getItem(officeApiStorageKey)
    if (!saved) return emptyOfficeApiConfig
    return { ...emptyOfficeApiConfig, ...(JSON.parse(saved) as Partial<OfficeApiConfig>) }
  } catch {
    return emptyOfficeApiConfig
  }
}

export function isOfficeBoardConfigured(config = readOfficeApiConfig()): boolean {
  // 프록시 모드에서는 주소·자격증명이 Worker에 있으므로 게시판명만 있으면 된다
  if (isOfficeProxyMode()) return Boolean(config.boardName.trim())
  return Boolean(config.baseUrl.trim() && config.boardName.trim())
}

/** baseUrl + postPath 조합으로 최종 게시 URL 생성 */
export function buildOfficePostUrl(config: OfficeApiConfig): string {
  const base = config.baseUrl.trim().replace(/\/+$/, '')
  // {board} 토큰이 여러 번 나올 수 있으므로 전체 치환
  const rawPath = (config.postPath?.trim() || DEFAULT_OFFICE_POST_PATH).split('{board}').join(
    encodeURIComponent(config.boardName.trim()),
  )
  const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`
  return `${base}${path}`
}

/**
 * Base URL이 스킴을 포함한 절대 URL인지 검증.
 * 스킴이 없으면 fetch가 현재 사이트 기준 상대 경로로 붙어 엉뚱한 곳(SPA index.html)에
 * 요청이 가고도 200이 떠서 "연결 성공"으로 오인된다.
 */
export function validateOfficeBaseUrl(baseUrl: string): string | null {
  const value = baseUrl.trim()
  if (!value) return 'Base URL을 입력해 주세요.'
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return `Base URL에 스킴이 필요합니다. 예: https://${value.replace(/^\/+/, '')}`
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return `지원하지 않는 프로토콜입니다: ${parsed.protocol}`
  }
  return null
}

/**
 * Basic 인증 헤더. username/password는 앞뒤 공백을 제거해 사용한다
 * (붙여넣기로 들어간 공백 때문에 401이 나는 것을 방지).
 */
function buildAuthHeader(config: OfficeApiConfig): Record<string, string> {
  const username = config.username.trim()
  if (!username) return {}
  const raw = `${username}:${config.password.trim()}`
  // btoa는 latin1만 처리하므로 UTF-8 자격증명을 바이트로 변환해 인코딩
  const bytes = new TextEncoder().encode(raw)
  let latin1 = ''
  for (const byte of bytes) latin1 += String.fromCharCode(byte)
  return { Authorization: `Basic ${btoa(latin1)}` }
}

export type OfficePostResult =
  | { ok: true; postId?: string; status: number }
  | { ok: false; error: string; status?: number }

function htmlToText(html?: string): string {
  if (!html) return ''
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  return (tmp.textContent || tmp.innerText || '').replace(/\n{3,}/g, '\n\n').trim()
}

function formatDate(value?: string): string {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toISOString().slice(0, 10)
}

/**
 * 게시 성공 로그 접두사.
 * boardResults는 컴포넌트 상태라 새로고침하면 사라지므로,
 * "이미 게시됨" 판정은 영속되는 활동 로그에서 이 접두사로 찾는다.
 */
export const BOARD_POST_OK_PREFIX = '[게시판 등록 완료]'
export const BOARD_POST_FAIL_PREFIX = '[게시판 등록 실패]'

/** 활동 로그를 보고 이 프로젝트가 이미 게시판에 등록됐는지 판정 */
export function hasBeenPostedToBoard(project: Project): boolean {
  return (project.logs ?? []).some((log) => log.message.startsWith(BOARD_POST_OK_PREFIX))
}

/** 완료 보고 게시글 제목 */
export function buildCompletionTitle(project: Project): string {
  return `[개발 완료] ${project.code} ${project.title}`
}

/** 완료 보고 게시글 본문 — 프로젝트 메타 + SRS/SDS 요약 + 일감 처리 내역 */
export function buildCompletionBody(project: Project): string {
  const tasks = project.tasks ?? []
  const doneTasks = tasks.filter((t) => t.status === 'done')
  const lines: string[] = []

  lines.push('■ 프로젝트 개요')
  lines.push(`- 코드: ${project.code}`)
  lines.push(`- 제목: ${project.title}`)
  lines.push(`- 서비스: ${project.serviceName} (${project.serviceArea})`)
  lines.push(`- 담당팀: ${project.ownerTeam}`)
  lines.push(`- 요청자: ${project.requester}`)
  lines.push(`- 요청일: ${formatDate(project.createdAt)} / 마감일: ${formatDate(project.dueDate)}`)
  lines.push(`- 완료일: ${formatDate(new Date().toISOString())}`)
  lines.push('')

  lines.push('■ 요청 배경')
  lines.push(project.summary?.trim() || '—')
  if (project.currentProblem?.trim()) {
    lines.push('')
    lines.push(`현재 상황: ${project.currentProblem.trim()}`)
  }
  lines.push('')

  const srs = htmlToText(project.reviewDocs?.srs)
  if (srs) {
    lines.push('■ 요구사항 정의서(SRS) 요약')
    lines.push(srs.slice(0, 2000))
    lines.push('')
  }

  const sds = htmlToText(project.reviewDocs?.sds)
  if (sds) {
    lines.push('■ 설계 명세서(SDS) 요약')
    lines.push(sds.slice(0, 2000))
    lines.push('')
  }

  lines.push(`■ 처리 내역 (완료 ${doneTasks.length} / 전체 ${tasks.length})`)
  if (doneTasks.length === 0) {
    lines.push('- 등록된 완료 일감이 없습니다.')
  } else {
    for (const t of doneTasks) {
      lines.push(`- [${t.type ?? 'task'}] ${t.title}${t.owner ? ` (담당: ${t.owner})` : ''}`)
    }
  }
  lines.push('')

  lines.push('■ 검토')
  const sign = project.qcSignoff
  lines.push(`- QA: ${sign?.qa ? '완료' : '미완'} / 보안: ${sign?.security ? '완료' : '미완'} / PM: ${sign?.pm ? '완료' : '미완'}`)
  lines.push(`- 요청자 확인: ${project.requesterConfirmed ? '완료' : '미완'}`)

  return lines.join('\n')
}

/**
 * 게시판에 글 등록.
 * 인증은 Basic(username/password) — 게시판이 다른 방식을 쓰면 이 함수만 교체하면 된다.
 */
export async function postToOfficeBoard(
  payload: { title: string; body: string; author: string },
  config = readOfficeApiConfig(),
): Promise<OfficePostResult> {
  if (!isOfficeBoardConfigured(config)) {
    return {
      ok: false,
      error: isOfficeProxyMode()
        ? '게시판명을 입력해 주세요. (설정 > 동사무소 게시판 API)'
        : '게시판 연동 정보가 설정되지 않았습니다. (설정 > 동사무소 게시판 API)',
    }
  }

  const usingProxy = isOfficeProxyMode()
  let url: string
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }

  if (usingProxy) {
    url = `${proxyUrl}/board-post`
  } else {
    const urlError = validateOfficeBaseUrl(config.baseUrl)
    if (urlError) return { ok: false, error: urlError }
    url = buildOfficePostUrl(config)
    Object.assign(headers, buildAuthHeader(config))
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        board: config.boardName,
        title: payload.title,
        content: payload.body,
        author: payload.author,
      }),
    })

    const text = await response.text()
    if (!response.ok) {
      // 프록시는 실패 원인을 JSON으로 돌려주므로 그대로 노출한다
      let detail = text.slice(0, 300)
      try {
        const json = JSON.parse(text) as Record<string, unknown>
        if (json.detail) detail = String(json.detail).slice(0, 300)
        else if (json.error) detail = String(json.error)
      } catch {
        // 평문 응답은 그대로 사용
      }
      return { ok: false, status: response.status, error: `${response.status} ${response.statusText} ${detail}`.trim() }
    }

    let postId: string | undefined
    try {
      const json = JSON.parse(text) as Record<string, unknown>
      const found = json.postId ?? json.id ?? json.post_id
      if (found !== undefined) postId = String(found)
    } catch {
      // 응답이 JSON이 아니어도 2xx면 성공으로 본다
    }
    return { ok: true, postId, status: response.status }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: describeFetchFailure(message, usingProxy) }
  }
}

/**
 * fetch 자체가 실패했을 때(TypeError: Failed to fetch)의 원인 안내.
 * 이 단계에서는 브라우저가 응답을 주지 않아 상태코드가 없으므로 원인을 추론해 설명한다.
 */
function describeFetchFailure(message: string, usingProxy: boolean): string {
  if (usingProxy) {
    return `프록시 요청 실패: ${message}\n· Worker(${proxyUrl})가 배포되어 있는지\n· Worker의 ALLOWED_ORIGIN이 ${typeof location !== 'undefined' ? location.origin : '이 앱 주소'} 로 설정됐는지 확인해 주세요.`
  }
  return (
    `요청 실패: ${message}\n` +
    '원인은 대부분 CORS입니다 — 브라우저는 게시판 서버가 이 앱 도메인을 허용(Access-Control-Allow-Origin)하지 않으면 요청을 차단하고, 실패 이유를 알려주지 않습니다.\n' +
    '해결: ① 게시판 서버에 이 도메인 CORS 허용을 요청, 또는 ② 프록시 모드 사용 (.env 에 VITE_OFFICE_PROXY_URL 설정 + worker 배포).\n' +
    '주소·경로 오타도 같은 오류로 보일 수 있으니 함께 확인해 주세요.'
  )
}

/**
 * 설정 화면 연결 테스트: 글을 쓰지 않고 엔드포인트 도달 여부만 확인한다.
 *
 * 주의 — 이 테스트로 증명되는 것은 "브라우저에서 그 주소에 도달 가능하다"까지다.
 * 다음은 증명되지 않으므로 결과 문구에 그대로 밝힌다:
 *  - 게시 경로가 맞는지 (CORS 미들웨어가 모든 경로에 OPTIONS 응답을 주는 서버가 많음)
 *  - 자격증명이 유효한지 (POST 시점에야 검증됨)
 * 실제 검증은 완료 보고 1건을 전송해 봐야 한다.
 */
export async function testOfficeBoardConnection(config: OfficeApiConfig): Promise<OfficePostResult> {
  if (!isOfficeBoardConfigured(config)) {
    return {
      ok: false,
      error: isOfficeProxyMode() ? '게시판명을 먼저 입력해 주세요.' : 'Base URL과 게시판명을 먼저 입력해 주세요.',
    }
  }

  // 프록시 모드: Worker의 /board-test 로 도달 여부 확인
  if (isOfficeProxyMode()) {
    try {
      const response = await fetch(`${proxyUrl}/board-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board: config.boardName }),
      })
      const json = (await response.json()) as Record<string, unknown>
      if (!response.ok) {
        return { ok: false, status: response.status, error: String(json.detail ?? json.error ?? response.statusText) }
      }
      return json.ok
        ? { ok: true, status: Number(json.status) || 200 }
        : { ok: false, status: Number(json.status), error: `게시판 응답 ${json.status} · ${String(json.target ?? '')}` }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: describeFetchFailure(message, true) }
    }
  }

  const urlError = validateOfficeBaseUrl(config.baseUrl)
  if (urlError) return { ok: false, error: urlError }

  try {
    const response = await fetch(buildOfficePostUrl(config), {
      method: 'OPTIONS',
      headers: buildAuthHeader(config),
    })
    if (response.status === 401 || response.status === 403) {
      return { ok: false, status: response.status, error: `인증 거부 (${response.status}) — 계정/비밀번호를 확인해 주세요.` }
    }
    if (response.status === 404) {
      return { ok: false, status: response.status, error: `경로를 찾을 수 없습니다 (404) — 게시 경로를 확인해 주세요.` }
    }
    // 405(Method Not Allowed)는 엔드포인트가 존재하고 POST만 받는다는 뜻이라 도달 성공으로 본다
    return response.ok || response.status === 405
      ? { ok: true, status: response.status }
      : { ok: false, status: response.status, error: `${response.status} ${response.statusText}` }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: describeFetchFailure(message, false) }
  }
}
