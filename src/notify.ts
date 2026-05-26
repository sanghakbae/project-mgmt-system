// Google Chat Incoming Webhook 알림 헬퍼
// 사용하려면 .env (또는 GitHub Actions secret) 에 VITE_GOOGLE_CHAT_WEBHOOK_URL 설정 필요
// 형식: https://chat.googleapis.com/v1/spaces/<SPACE_ID>/messages?key=...&token=...

const webhookUrl = (import.meta.env.VITE_GOOGLE_CHAT_WEBHOOK_URL as string | undefined) ?? ''

export function isGoogleChatConfigured(): boolean {
  return Boolean(webhookUrl)
}

export type NotifyEvent =
  | 'project.create'
  | 'project.approve'
  | 'project.advance'
  | 'project.hold'
  | 'project.unhold'
  | 'task.create'
  | 'task.comment'
  | 'task.status'
  | 'doc.update'

export async function notifyGoogleChat(event: NotifyEvent, message: string, context?: Record<string, string | number | undefined>) {
  if (!webhookUrl) return
  const lines = [`*[${event}]* ${message}`]
  if (context) {
    for (const [key, value] of Object.entries(context)) {
      if (value === undefined || value === null || value === '') continue
      lines.push(`• *${key}*: ${String(value)}`)
    }
  }
  const payload = { text: lines.join('\n') }
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (error) {
    // 알림 실패는 본 흐름에 영향 주지 않음
    console.warn('Google Chat notify failed', error)
  }
}
