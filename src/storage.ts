// 첨부파일 스토리지 — Cloudflare R2 (Worker presigned URL) 사용.
// VITE_R2_WORKER_URL 이 설정되지 않으면 기존처럼 dataURL(base64)로 폴백해 로컬에서도 동작한다.
import type { TaskAttachment } from './types'

const workerUrl = (import.meta.env.VITE_R2_WORKER_URL as string | undefined)?.replace(/\/$/, '')
export const hasR2Config = Boolean(workerUrl)

function uuid(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.round(Math.random() * 1e9)}`
}

function safeName(name: string): string {
  return name.replace(/[^\w.\-가-힣]/g, '_').slice(0, 120)
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

// 파일 업로드 → 첨부 메타데이터(TaskAttachment) 반환
export async function uploadAttachment(file: File): Promise<TaskAttachment> {
  const base: TaskAttachment = {
    id: uuid(),
    name: file.name,
    size: file.size,
    type: file.type,
    uploadedAt: new Date().toISOString(),
  }

  if (!workerUrl) {
    // 폴백: R2 미설정 시 base64 dataURL로 저장(기존 동작)
    return { ...base, dataUrl: await readAsDataUrl(file) }
  }

  const key = `attachments/${uuid()}-${safeName(file.name)}`
  // 1) Worker에서 presigned PUT URL 발급
  const presignRes = await fetch(`${workerUrl}/presign-put`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key, contentType: file.type || 'application/octet-stream' }),
  })
  if (!presignRes.ok) throw new Error(`presign-put 실패: ${presignRes.status}`)
  const { url } = (await presignRes.json()) as { url: string }

  // 2) 브라우저에서 R2로 직접 업로드
  const putRes = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': file.type || 'application/octet-stream' },
    body: file,
  })
  if (!putRes.ok) throw new Error(`R2 업로드 실패: ${putRes.status}`)

  return { ...base, key }
}

// 미리보기/다운로드용 URL 해소. R2 키가 있으면 presigned GET URL 발급, 아니면 dataUrl 사용.
export async function resolveAttachmentUrl(att: { key?: string; dataUrl?: string }): Promise<string | undefined> {
  if (att.key && workerUrl) {
    const res = await fetch(`${workerUrl}/presign-get`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: att.key }),
    })
    if (!res.ok) throw new Error(`presign-get 실패: ${res.status}`)
    const { url } = (await res.json()) as { url: string }
    return url
  }
  return att.dataUrl
}
