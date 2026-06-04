// Firebase (Firestore) 초기화 — 인증 계정(pms_users)과 프로젝트 데이터(pms_projects) 저장소.
import { initializeApp, type FirebaseApp } from 'firebase/app'
import { initializeFirestore, type Firestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
}

// projectId + apiKey 정도만 있으면 Firestore 동작에 충분
export const hasFirebaseConfig = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId)

let app: FirebaseApp | null = null
let firestore: Firestore | null = null

if (hasFirebaseConfig) {
  app = initializeApp({
    apiKey: firebaseConfig.apiKey!,
    authDomain: firebaseConfig.authDomain,
    projectId: firebaseConfig.projectId!,
    storageBucket: firebaseConfig.storageBucket,
    messagingSenderId: firebaseConfig.messagingSenderId,
    appId: firebaseConfig.appId,
  })
  // ignoreUndefinedProperties: 로그 meta의 optional 필드(undefined)를 자동 무시(Firestore는 undefined 거부)
  firestore = initializeFirestore(app, { ignoreUndefinedProperties: true })
}

export const db = firestore
export { app as firebaseApp }
