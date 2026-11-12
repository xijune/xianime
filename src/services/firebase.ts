import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  linkWithRedirect,
  signInAnonymously,
  signOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
  collection,
  onSnapshot,
  setDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  type DocumentData,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);

const firestoreDbId = (firebaseConfig as { firestoreDatabaseId?: string })
  .firestoreDatabaseId;
export const db =
  !firestoreDbId || firestoreDbId === '(default)'
    ? getFirestore(app)
    : getFirestore(app, firestoreDbId);

export const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

function firestoreErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    return String((error as { code: string }).code);
  }
  return '';
}

/** permission-denied after sign-out is expected — log only, do not crash the app */
export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): void {
  const code = firestoreErrorCode(error);
  const message = error instanceof Error ? error.message : String(error);
  const soft =
    code === 'permission-denied' ||
    code === 'unauthenticated' ||
    message.toLowerCase().includes('insufficient permissions') ||
    message.toLowerCase().includes('missing or insufficient permissions');

  const errInfo: FirestoreErrorInfo = {
    error: message,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((p) => ({
          providerId: p.providerId,
          email: p.email,
        })) || [],
    },
    operationType,
    path,
  };

  if (soft) {
    console.warn('Firestore (ignored): ', JSON.stringify(errInfo));
    return;
  }

  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('the client is offline')
    ) {
      console.warn('Firebase client is offline or connecting.');
    }
  }
}
void testConnection();

export {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  linkWithRedirect,
  signInAnonymously,
  signOut,
  onAuthStateChanged,
  doc,
  collection,
  onSnapshot,
  setDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
};
export type { User, DocumentData };
