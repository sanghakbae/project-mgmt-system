// Firestore 기반 계정 인증 — 계정 정보를 pms_users 컬렉션에 직접 저장한다.
// (별도 인증 서비스를 쓰지 않음. 기존 Supabase pms_accounts 방식을 Firestore로 옮긴 형태)
//
// 보안 메모: 현재 Firestore 규칙이 공개라 password_hash가 노출될 수 있다(평문 아님).
// 비밀번호는 PBKDF2(SHA-256, 10만 회)로 해시해 저장한다. 더 강한 보호는 규칙 강화/Cloud Functions로.
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db, hasFirebaseConfig } from './firebase'
import type { Role } from './types'

export type AuthAccount = { id: string; email: string; fullName: string; role: Role }

export const hasAuthConfig = hasFirebaseConfig

function requireDb() {
  if (!db) throw new Error('Firebase가 설정되지 않았습니다. .env의 VITE_FIREBASE_* 값을 확인하세요.')
  return db
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}
function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

// PBKDF2(SHA-256) 해시. salt 미지정 시 새로 생성.
async function pbkdf2(password: string, saltHex?: string): Promise<{ salt: string; hash: string }> {
  const enc = new TextEncoder()
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16))
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    256,
  )
  return { salt: bytesToHex(salt), hash: bytesToHex(new Uint8Array(bits)) }
}

const emailKey = (email: string) => email.trim().toLowerCase()

class AuthError extends Error {}

type UserDoc = { email: string; full_name?: string; role?: string; salt?: string; password_hash?: string }

// 가입: pms_users/{email} 문서 생성(이메일 중복이면 에러)
export async function registerWithEmail(email: string, password: string, fullName: string, role: Role): Promise<AuthAccount> {
  const database = requireDb()
  const id = emailKey(email)
  if (!id || !id.includes('@')) throw new AuthError('이메일 형식이 올바르지 않습니다.')
  const ref = doc(database, 'pms_users', id)
  const existing = await getDoc(ref)
  if (existing.exists()) throw new AuthError('이미 가입된 이메일입니다. 로그인해 주세요.')
  const { salt, hash } = await pbkdf2(password)
  await setDoc(ref, {
    email: id,
    full_name: fullName.trim(),
    role,
    salt,
    password_hash: hash,
    created_at: new Date().toISOString(),
  })
  return { id, email: id, fullName: fullName.trim(), role }
}

// 로그인: pms_users/{email} 조회 + 해시 비교
export async function signInWithEmail(email: string, password: string): Promise<AuthAccount> {
  const database = requireDb()
  const id = emailKey(email)
  const snap = await getDoc(doc(database, 'pms_users', id))
  if (!snap.exists()) throw new AuthError('이메일 또는 비밀번호가 올바르지 않습니다.')
  const data = snap.data() as UserDoc
  if (!data.salt || !data.password_hash) throw new AuthError('이메일 또는 비밀번호가 올바르지 않습니다.')
  const { hash } = await pbkdf2(password, data.salt)
  if (hash !== data.password_hash) throw new AuthError('이메일 또는 비밀번호가 올바르지 않습니다.')
  return { id, email: id, fullName: data.full_name ?? '', role: (data.role as Role) ?? 'requester' }
}
