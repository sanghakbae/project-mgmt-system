// Cloudflare Worker — R2 presigned URL 발급기
// 브라우저가 R2로 직접 업로드/다운로드할 수 있도록 SigV4 presigned URL을 만들어 준다.
//
// 필요한 바인딩/시크릿(wrangler secret put 로 등록):
//   R2_ACCOUNT_ID         - Cloudflare 계정 ID
//   R2_ACCESS_KEY_ID      - R2 S3 API 액세스 키 ID (시크릿)
//   R2_SECRET_ACCESS_KEY  - R2 S3 API 시크릿 (시크릿)
//   R2_BUCKET             - 버킷 이름
//   ALLOWED_ORIGIN        - 앱 출처(CORS), 예: https://your-app.pages.dev
import { AwsClient } from 'aws4fetch'

const PUT_EXPIRY = 600 // 업로드 URL 10분
const GET_EXPIRY = 600 // 조회 URL 10분

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
  }
}

// ── 동사무소 게시판 프록시 ────────────────────────────────────────────────
// 브라우저는 CORS 때문에 게시판 API를 직접 호출할 수 없다. Worker가 서버 측에서
// 대신 호출하고 CORS 헤더를 붙여 응답한다.
//
// 대상 주소와 자격증명은 반드시 Worker 환경변수/시크릿에서 읽는다.
// (클라이언트가 보낸 URL로 요청하면 누구나 쓸 수 있는 오픈 프록시가 되어 위험하다)
//   OFFICE_BASE_URL   - 게시판 서버 주소, 예: https://center.example.com
//   OFFICE_POST_PATH  - 게시 경로, 기본 /api/boards/{board}/posts
//   OFFICE_USERNAME   - 계정 (시크릿)
//   OFFICE_PASSWORD   - 비밀번호 (시크릿)
function buildBoardUrl(env, board) {
  const base = String(env.OFFICE_BASE_URL || '').trim().replace(/\/+$/, '')
  if (!base) return null
  const rawPath = String(env.OFFICE_POST_PATH || '/api/boards/{board}/posts')
    .split('{board}')
    .join(encodeURIComponent(board || ''))
  return `${base}${rawPath.startsWith('/') ? rawPath : `/${rawPath}`}`
}

function boardAuthHeaders(env) {
  const username = String(env.OFFICE_USERNAME || '').trim()
  if (!username) return {}
  const password = String(env.OFFICE_PASSWORD || '').trim()
  // Workers 런타임의 btoa는 latin1만 처리하므로 UTF-8을 바이트로 변환
  const bytes = new TextEncoder().encode(`${username}:${password}`)
  let latin1 = ''
  for (const byte of bytes) latin1 += String.fromCharCode(byte)
  return { Authorization: `Basic ${btoa(latin1)}` }
}

async function presign(env, key, method, expiry, contentType) {
  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto',
  })
  const endpoint = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}/${encodeURIComponent(key).replace(/%2F/g, '/')}`
  const url = new URL(endpoint)
  url.searchParams.set('X-Amz-Expires', String(expiry))
  const signed = await client.sign(
    new Request(url, { method, headers: contentType ? { 'content-type': contentType } : {} }),
    { aws: { signQuery: true } },
  )
  return signed.url
}

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || request.headers.get('Origin') || '*'
    const headers = cors(origin)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers })
    }
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers })
    }

    const url = new URL(request.url)
    let body
    try {
      body = await request.json()
    } catch {
      return Response.json({ error: 'invalid_json' }, { status: 400, headers })
    }

    try {
      if (url.pathname === '/presign-put') {
        const { key, contentType } = body
        if (!key) return Response.json({ error: 'key_required' }, { status: 400, headers })
        const signedUrl = await presign(env, key, 'PUT', PUT_EXPIRY, contentType)
        return Response.json({ url: signedUrl, key }, { headers })
      }
      if (url.pathname === '/presign-get') {
        const { key } = body
        if (!key) return Response.json({ error: 'key_required' }, { status: 400, headers })
        const signedUrl = await presign(env, key, 'GET', GET_EXPIRY)
        return Response.json({ url: signedUrl }, { headers })
      }
      // 게시판 글 등록 프록시
      if (url.pathname === '/board-post' || url.pathname === '/board-test') {
        const target = buildBoardUrl(env, body.board)
        if (!target) {
          return Response.json(
            { error: 'office_not_configured', detail: 'Worker에 OFFICE_BASE_URL이 설정되지 않았습니다.' },
            { status: 503, headers },
          )
        }
        // /board-test 는 도달 여부만 확인 (글을 쓰지 않는다)
        if (url.pathname === '/board-test') {
          const probe = await fetch(target, { method: 'OPTIONS', headers: boardAuthHeaders(env) })
          return Response.json({ ok: probe.ok || probe.status === 405, status: probe.status, target }, { headers })
        }

        const { title, content, author, board } = body
        if (!title || !content) {
          return Response.json({ error: 'title_and_content_required' }, { status: 400, headers })
        }
        const upstream = await fetch(target, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...boardAuthHeaders(env) },
          body: JSON.stringify({ board, title, content, author }),
        })
        const text = await upstream.text()
        if (!upstream.ok) {
          return Response.json(
            { error: 'upstream_error', status: upstream.status, detail: text.slice(0, 500) },
            { status: 502, headers },
          )
        }
        let postId
        try {
          const json = JSON.parse(text)
          const found = json.postId ?? json.id ?? json.post_id
          if (found !== undefined) postId = String(found)
        } catch {
          // 응답이 JSON이 아니어도 2xx면 성공
        }
        return Response.json({ ok: true, postId, status: upstream.status }, { headers })
      }

      return Response.json({ error: 'not_found' }, { status: 404, headers })
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500, headers })
    }
  },
}
