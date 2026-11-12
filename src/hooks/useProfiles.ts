import { useCallback, useEffect, useState } from 'react';
import {
  auth,
  db,
  signInAnonymously,
  signInWithPopup,
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
import { linkWithPopup } from 'firebase/auth';
import type { UserProfile } from '../types/profile';

const PROFILES_STORAGE_KEY = 'kurostream_profiles_cache_v2';
const ACTIVE_PROFILE_STORAGE_KEY = 'kurostream_active_profile_id_v2';
const SESSION_PROFILE_CHOSEN_KEY = 'kurostream_session_profile_chosen_v1';

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
        setCurrentUser(user);
        setAuthLoading(false);
      } else {
        signInAnonymously(auth)
          .then((res) => {
            if (!unmounted) {
              setCurrentUser(res.user);
              setAuthLoading(false);
            }
          })
          .catch((err) => {
            if (!unmounted) {
              console.warn('Anonymous auth failed:', err);
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
          const baseProfiles = profiles.length > 0 ? profiles : [DEFAULT_PROFILE];
          baseProfiles.forEach((p) => {
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
          localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(remoteProfiles));
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
      localStorage.setItem(ACTIVE_PROFILE_STORAGE_KEY, activeProfileId);
    } catch {
      // Ignore
    }
  }, [activeProfileId]);

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
          localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(next));
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
          localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(next));
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
        localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(remaining));
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
  const signInWithGoogle = useCallback(async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const user = auth.currentUser;
      if (user && user.isAnonymous) {
        try {
          await linkWithPopup(user, googleProvider);
          return;
        } catch (linkErr: unknown) {
          const code =
            linkErr && typeof linkErr === 'object' && 'code' in linkErr
              ? String((linkErr as { code: string }).code)
              : '';
          if (
            code !== 'auth/credential-already-in-use' &&
            code !== 'auth/email-already-in-use' &&
            code !== 'auth/provider-already-linked'
          ) {
            throw linkErr;
          }
        }
      }
      await signInWithPopup(auth, googleProvider);
      setHasSelectedSessionProfile(false);
      try {
        sessionStorage.removeItem(SESSION_PROFILE_CHOSEN_KEY);
      } catch {
        // Ignore
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Connexion Google impossible';
      console.warn('Google sign-in failed:', err);
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
      await signOut(auth);
      setHasSelectedSessionProfile(false);
      try {
        sessionStorage.removeItem(SESSION_PROFILE_CHOSEN_KEY);
        localStorage.removeItem(PROFILES_STORAGE_KEY);
      } catch {
        // Ignore
      }
      setProfiles([DEFAULT_PROFILE]);
      setActiveProfileId(DEFAULT_PROFILE.id);
    } catch (err) {
      console.warn('Sign-out failed:', err);
      setAuthError(err instanceof Error ? err.message : 'Déconnexion impossible');
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const isAnonymous = Boolean(currentUser?.isAnonymous);
  const isGoogleUser = Boolean(
    currentUser &&
      !currentUser.isAnonymous &&
      currentUser.providerData?.some((p) => p.providerId === 'google.com')
  );

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
