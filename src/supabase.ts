// Supabase 클라이언트 — 인증(이메일/비밀번호) 전용으로 유지한다.
// 프로젝트 데이터(pms_projects)는 Firestore로 이전했고(see projectsRepo.ts),
// 계정 인증(pms_accounts + pms_register/pms_authenticate RPC)만 Supabase를 사용한다.
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey)

export const supabase = hasSupabaseConfig
  ? createClient(supabaseUrl!, supabaseAnonKey!)
  : null
