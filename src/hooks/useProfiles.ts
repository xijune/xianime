import { useCallback, useEffect, useState } from 'react';
import {
  auth,
  db,
  signInAnonymously,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  googleProvider,
  onAuthStateChanged,
  collection,
  doc,
  onSnapshot,
  setDoc,
  deleteDoc,
  handleFirestoreError,
  OperationType,
  type User,
} from '../services/firebase';
import type { UserProfile } from '../types/profile';

const PROFILES_STORAGE_KEY = 'kurostream_profiles_cache_v2';
const ACTIVE_PROFILE_STORAGE_KEY = 'kurostream_active_profile_id_v2';
const SESSION_PROFILE_CHOSEN_KEY = 'kurostream_session_profile_chosen_v1';
const LAST_AUTH_UID_KEY = 'kurostream_last_auth_uid_v1';

function profilesCacheKey(uid: string | null | undefined) {
  return uid ? `${PROFILES_STORAGE_KEY}:${uid}` : PROFILES_STORAGE_KEY;
}
function activeProfileCacheKey(uid: string | null | undefined) {
  return uid ? `${ACTIVE_PROFILE_STORAGE_KEY}:${uid}` : ACTIVE_PROFILE_STORAGE_KEY;
}

const DEFAULT_PROFILE: UserProfile = {
  id: 'profile-main',
  name: 'Principal',
  avatar: 'kuro',
  color: '#FF5E1A',
  defaultAudio: 'VOSTFR',
  isKid: false,
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
};

/** Firestore path root for a user's profiles */

/** Redirect only on mobile — popup works on desktop even via Tailscale IP. */
function preferRedirectSignIn(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
}

export function userProfilesPath(uid: string) {
  return `users/${uid}/profiles`;
}

export function useProfiles() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [hasSelectedSessionProfile, setHasSelectedSessionProfile] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(SESSION_PROFILE_CHOSEN_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const [profiles, setProfiles] = useState<UserProfile[]>(() => {
    try {
      const raw = localStorage.getItem(PROFILES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as UserProfile[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // Ignore cache error
    }
    return [DEFAULT_PROFILE];
  });

  const [activeProfileId, setActiveProfileId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(ACTIVE_PROFILE_STORAGE_KEY);
      if (saved) return saved;
    } catch {
      // Ignore
    }
    return DEFAULT_PROFILE.id;
  });

  // 1. Auth: existing session or silent anonymous
  useEffect(() => {
    let unmounted = false;

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (unmounted) return;
      if (user) {
        // Si le compte change (invité → Google ou autre UID), vider le cache local
        // pour ne pas afficher les profils d'un autre utilisateur.
        try {
          const prevUid = localStorage.getItem(LAST_AUTH_UID_KEY);
          if (prevUid && prevUid !== user.uid) {
            setHasSelectedSessionProfile(false);
            sessionStorage.removeItem(SESSION_PROFILE_CHOSEN_KEY);
            const cached = localStorage.getItem(profilesCacheKey(user.uid));
            if (cached) {
              const parsed = JSON.parse(cached) as UserProfile[];
              if (Array.isArray(parsed) && parsed.length > 0) {
                setProfiles(parsed);
              } else {
                setProfiles([DEFAULT_PROFILE]);
              }
            } else {
              setProfiles([DEFAULT_PROFILE]);
            }
            const savedActive = localStorage.getItem(activeProfileCacheKey(user.uid));
            setActiveProfileId(savedActive || DEFAULT_PROFILE.id);
          }
          localStorage.setItem(LAST_AUTH_UID_KEY, user.uid);
        } catch {
          // Ignore
        }
        setCurrentUser(user);
        setAuthLoading(false);
      } else {
        // Anonymous is optional (often disabled in Firebase = auth/admin-restricted-operation).
        // App works without it; user can still sign in with Google.
        signInAnonymously(auth)
          .then((res) => {
            if (!unmounted) {
              setCurrentUser(res.user);
              setAuthLoading(false);
            }
          })
          .catch((err) => {
            if (!unmounted) {
              console.warn('Anonymous auth unavailable (use Google to sync profiles):', err);
              setCurrentUser(null);
              setAuthLoading(false);
            }
          });
      }
    });

    return () => {
      unmounted = true;
      unsubscribe();
    };
  }, []);

  // 2. Real-time sync: users/{uid}/profiles
  useEffect(() => {
    if (!currentUser) return;

    const colPath = userProfilesPath(currentUser.uid);
    const colRef = collection(db, colPath);

    const unsubscribe = onSnapshot(
      colRef,
      (snapshot) => {
        if (snapshot.empty) {
          // Ne jamais pousser le cache local d'un autre appareil / invité.
          // Un compte Google vide démarre uniquement avec le profil par défaut.
          const seed = [DEFAULT_PROFILE];
          seed.forEach((p) => {
            void setDoc(doc(db, colPath, p.id), {
              name: p.name,
              avatar: p.avatar,
              color: p.color,
              defaultAudio: p.defaultAudio,
              isKid: Boolean(p.isKid),
              createdAt: new Date(p.createdAt).toISOString(),
              updatedAt: new Date(p.updatedAt).toISOString(),
            }).catch((err) =>
              handleFirestoreError(err, OperationType.WRITE, `${colPath}/${p.id}`)
            );
          });
          return;
        }

        const remoteProfiles: UserProfile[] = [];
        snapshot.forEach((snapDoc) => {
          const d = snapDoc.data();
          remoteProfiles.push({
            id: snapDoc.id,
            name: String(d.name || 'Profil'),
            avatar: String(d.avatar || 'kuro'),
            color: String(d.color || '#FF5E1A'),
            defaultAudio: d.defaultAudio === 'VF' ? 'VF' : 'VOSTFR',
            isKid: Boolean(d.isKid),
            createdAt: d.createdAt ? new Date(d.createdAt).getTime() : Date.now(),
            updatedAt: d.updatedAt ? new Date(d.updatedAt).getTime() : Date.now(),
          });
        });

        remoteProfiles.sort((a, b) => a.createdAt - b.createdAt);
        setProfiles(remoteProfiles);

        try {
          localStorage.setItem(
            profilesCacheKey(currentUser.uid),
            JSON.stringify(remoteProfiles)
          );
          localStorage.setItem(LAST_AUTH_UID_KEY, currentUser.uid);
        } catch {
          // Ignore
        }

        setActiveProfileId((prev) => {
          if (remoteProfiles.some((p) => p.id === prev)) return prev;
          return remoteProfiles[0]?.id ?? DEFAULT_PROFILE.id;
        });
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, colPath);
      }
    );

    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid]);

  useEffect(() => {
    try {
      const uid = currentUser?.uid;
      localStorage.setItem(activeProfileCacheKey(uid), activeProfileId);
    } catch {
      // Ignore
    }
  }, [activeProfileId, currentUser?.uid]);

  const activeProfile =
    profiles.find((p) => p.id === activeProfileId) ?? profiles[0] ?? DEFAULT_PROFILE;

  const selectProfile = useCallback((profileId: string) => {
    setActiveProfileId(profileId);
    setHasSelectedSessionProfile(true);
    try {
      sessionStorage.setItem(SESSION_PROFILE_CHOSEN_KEY, 'true');
    } catch {
      // Ignore
    }
  }, []);

  const createProfile = useCallback(
    async (data: {
      name: string;
      avatar: string;
      color: string;
      defaultAudio: 'VOSTFR' | 'VF';
      isKid?: boolean;
    }) => {
      const newId = `profile-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const newProf: UserProfile = {
        id: newId,
        name: data.name.trim() || 'Nouveau profil',
        avatar: data.avatar || 'kuro',
        color: data.color || '#FF5E1A',
        defaultAudio: data.defaultAudio || 'VOSTFR',
        isKid: Boolean(data.isKid),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      setProfiles((prev) => {
        const next = [...prev, newProf];
        try {
          localStorage.setItem(
            profilesCacheKey(currentUser?.uid),
            JSON.stringify(next)
          );
        } catch {
          // Ignore
        }
        return next;
      });

      setActiveProfileId(newId);
      setHasSelectedSessionProfile(true);
      try {
        sessionStorage.setItem(SESSION_PROFILE_CHOSEN_KEY, 'true');
      } catch {
        // Ignore
      }

      if (currentUser) {
        const docPath = `${userProfilesPath(currentUser.uid)}/${newId}`;
        try {
          await setDoc(doc(db, docPath), {
            name: newProf.name,
            avatar: newProf.avatar,
            color: newProf.color,
            defaultAudio: newProf.defaultAudio,
            isKid: newProf.isKid,
            createdAt: new Date(newProf.createdAt).toISOString(),
            updatedAt: new Date(newProf.updatedAt).toISOString(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, docPath);
        }
      }

      return newProf;
    },
    [currentUser]
  );

  const updateProfile = useCallback(
    async (profileId: string, patch: Partial<UserProfile>) => {
      const now = Date.now();
      let updatedProfile: UserProfile | null = null;

      setProfiles((prev) => {
        const next = prev.map((p) => {
          if (p.id === profileId) {
            updatedProfile = {
              ...p,
              ...patch,
              id: p.id,
              updatedAt: now,
            };
            return updatedProfile;
          }
          return p;
        });
        try {
          localStorage.setItem(
            profilesCacheKey(currentUser?.uid),
            JSON.stringify(next)
          );
        } catch {
          // Ignore
        }
        return next;
      });

      if (!currentUser) return;

      const docPath = `${userProfilesPath(currentUser.uid)}/${profileId}`;
      try {
        const target =
          updatedProfile ??
          profiles.find((p) => p.id === profileId) ?? {
            id: profileId,
            name: patch.name || 'Profil',
            avatar: patch.avatar || 'kuro',
            color: patch.color || '#FF5E1A',
            defaultAudio: patch.defaultAudio || 'VOSTFR',
            isKid: Boolean(patch.isKid),
            createdAt: now,
            updatedAt: now,
          };

        await setDoc(
          doc(db, docPath),
          {
            name: target.name,
            avatar: target.avatar,
            color: target.color,
            defaultAudio: target.defaultAudio,
            isKid: Boolean(target.isKid),
            updatedAt: new Date(now).toISOString(),
          },
          { merge: true }
        );
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, docPath);
      }
    },
    [profiles, currentUser]
  );

  const deleteProfile = useCallback(
    async (profileId: string) => {
      if (profiles.length <= 1) {
        await updateProfile(profileId, {
          name: 'Principal',
          avatar: 'kuro',
          color: '#FF5E1A',
          defaultAudio: 'VOSTFR',
        });
        return;
      }

      const remaining = profiles.filter((p) => p.id !== profileId);
      setProfiles(remaining);
      try {
        localStorage.setItem(
          profilesCacheKey(currentUser?.uid),
          JSON.stringify(remaining)
        );
      } catch {
        // Ignore
      }

      if (activeProfileId === profileId) {
        setActiveProfileId(remaining[0].id);
      }

      if (currentUser) {
        const docPath = `${userProfilesPath(currentUser.uid)}/${profileId}`;
        try {
          await deleteDoc(doc(db, docPath));
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, docPath);
        }
      }
    },
    [profiles, activeProfileId, currentUser, updateProfile]
  );

  /**
   * Connexion Google : le même compte (et ses profils) sur tous les appareils.
   * Si session anonyme, tente d'abord un link pour conserver les données.
   */
  // Complete redirect-based Google sign-in when returning from Google (iPhone / mobile)
  useEffect(() => {
    let cancelled = false;
    let pending = false;
    try {
      pending = sessionStorage.getItem('kurostream_google_redirect_pending') === '1';
    } catch {
      // Ignore
    }
    if (pending) {
      setAuthBusy(true);
    }
    getRedirectResult(auth)
      .then((result) => {
        if (cancelled) return;
        try {
          sessionStorage.removeItem('kurostream_google_redirect_pending');
        } catch {
          // Ignore
        }
        if (!result?.user) {
          if (pending) {
            // Redirect came back without a user — usually unauthorized-domain or blocked storage
            console.warn('[auth] Redirect returned without user');
            setAuthError(
              "Connexion Google interrompue sur mobile. Vérifie que 100.122.236.5 est dans Firebase → Authentication → Authorized domains, puis réessaie dans Safari (pas un navigateur intégré)."
            );
          }
          setAuthBusy(false);
          return;
        }
        console.log('[auth] Google redirect OK', {
          uid: result.user.uid,
          email: result.user.email,
        });
        setCurrentUser(result.user);
        setHasSelectedSessionProfile(false);
        try {
          sessionStorage.removeItem(SESSION_PROFILE_CHOSEN_KEY);
        } catch {
          // Ignore
        }
        setAuthBusy(false);
      })
      .catch((err) => {
        if (cancelled) return;
        try {
          sessionStorage.removeItem('kurostream_google_redirect_pending');
        } catch {
          // Ignore
        }
        console.warn('[auth] Google redirect result failed:', err);
        const code =
          err && typeof err === 'object' && 'code' in err
            ? String((err as { code: string }).code)
            : '';
        let message =
          err instanceof Error ? err.message : 'Connexion Google impossible';
        if (code === 'auth/unauthorized-domain') {
          message =
            'Domaine non autorisé. Ajoute 100.122.236.5 dans Firebase → Authentication → Authorized domains.';
        } else if (code === 'auth/operation-not-allowed') {
          message = 'Google Sign-In n’est pas activé dans Firebase Authentication.';
        }
        setAuthError(message);
        setAuthBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Connexion Google : toujours un vrai sign-in (jamais link de l'anonyme).
   * Ainsi PC et téléphone partagent le même UID Firebase = les mêmes profils.
   */
  const signInWithGoogle = useCallback(async () => {
    setAuthBusy(true);
    setAuthError(null);
    const useRedirect = preferRedirectSignIn();
    console.log('[auth] Google sign-in start', {
      useRedirect,
      host: typeof window !== 'undefined' ? window.location.host : '',
      currentUid: auth.currentUser?.uid ?? null,
    });
    try {
      // Never link anonymous — same Google UID on every device.
      if (useRedirect) {
        try {
          sessionStorage.setItem('kurostream_google_redirect_pending', '1');
        } catch {
          // Ignore
        }
        console.log('[auth] Starting Google redirect…');
        await signInWithRedirect(auth, googleProvider);
        // Page navigates away; busy stays true
        return;
      }
      const cred = await signInWithPopup(auth, googleProvider);
      console.log('[auth] Google popup OK', {
        uid: cred.user.uid,
        email: cred.user.email,
      });
      // Update UI immediately (don't wait only for onAuthStateChanged)
      setCurrentUser(cred.user);
      setHasSelectedSessionProfile(false);
      try {
        sessionStorage.removeItem(SESSION_PROFILE_CHOSEN_KEY);
      } catch {
        // Ignore
      }
    } catch (err) {
      let message =
        err instanceof Error ? err.message : 'Connexion Google impossible';
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code: string }).code)
          : '';
      if (code === 'auth/unauthorized-domain') {
        message =
          'Domaine non autorisé dans Firebase. Ajoute 100.122.236.5 (ou ton hostname Tailscale) dans Authentication → Authorized domains.';
      } else if (code === 'auth/popup-blocked' || code === 'auth/popup-closed-by-user') {
        message = 'Popup Google bloquée ou fermée. Réessaie, ou autorise les popups.';
      } else if (code === 'auth/operation-not-allowed') {
        message = 'Le fournisseur Google n’est pas activé dans Firebase Authentication.';
      }
      console.warn('Google sign-in failed:', code, err);
      setAuthError(message);
      throw err;
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const signOutUser = useCallback(async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      // Drop currentUser first so Firestore listeners unsubscribe before auth is gone
      setCurrentUser(null);
      setProfiles([DEFAULT_PROFILE]);
      setActiveProfileId(DEFAULT_PROFILE.id);
      setHasSelectedSessionProfile(false);
      try {
        sessionStorage.removeItem(SESSION_PROFILE_CHOSEN_KEY);
        localStorage.removeItem(PROFILES_STORAGE_KEY);
        localStorage.removeItem(LAST_AUTH_UID_KEY);
      } catch {
        // Ignore
      }
      await signOut(auth);
    } catch (err) {
      console.warn('Sign-out failed:', err);
      setAuthError(err instanceof Error ? err.message : 'Déconnexion impossible');
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const isAnonymous = Boolean(!currentUser || currentUser.isAnonymous);
  // Signed-in non-anonymous user = cloud account (Google, etc.)
  const isGoogleUser = Boolean(currentUser && !currentUser.isAnonymous);

  return {
    currentUser,
    authLoading,
    authBusy,
    authError,
    isAnonymous,
    isGoogleUser,
    profiles,
    activeProfile,
    activeProfileId,
    hasSelectedSessionProfile,
    selectProfile,
    createProfile,
    updateProfile,
    deleteProfile,
    signInWithGoogle,
    signOutUser,
  };
}
