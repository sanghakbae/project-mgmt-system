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
      return Response.json({ error: 'not_found' }, { status: 404, headers })
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500, headers })
    }
  },
}
