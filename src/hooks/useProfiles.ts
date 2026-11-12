import { useCallback, useEffect, useState } from 'react';
import {
  auth,
  db,
  signInAnonymously,
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

export function useProfiles() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Initial arrival check: has the user picked a profile during this session?
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

  // 1. Silent background authentication so all devices can connect to Firestore
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

  // 2. Real-time sync from top-level /profiles collection in Firestore
  useEffect(() => {
    if (!currentUser) return;
    const colRef = collection(db, 'profiles');

    const unsubscribe = onSnapshot(
      colRef,
      (snapshot) => {
        if (snapshot.empty) {
          // Initialize database with default profile if empty
          const baseProfiles = profiles.length > 0 ? profiles : [DEFAULT_PROFILE];
          baseProfiles.forEach((p) => {
            void setDoc(doc(db, 'profiles', p.id), {
              name: p.name,
              avatar: p.avatar,
              color: p.color,
              defaultAudio: p.defaultAudio,
              isKid: Boolean(p.isKid),
              createdAt: new Date(p.createdAt).toISOString(),
              updatedAt: new Date(p.updatedAt).toISOString(),
            }).catch((err) =>
              handleFirestoreError(err, OperationType.WRITE, `profiles/${p.id}`)
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

        // Keep activeProfileId valid
        setActiveProfileId((curr) => {
          if (remoteProfiles.some((p) => p.id === curr)) return curr;
          return remoteProfiles[0]?.id ?? DEFAULT_PROFILE.id;
        });
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'profiles');
      }
    );

    return () => unsubscribe();
  }, [currentUser]);

  // Persist activeProfileId to local storage
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
        const docPath = `profiles/${newId}`;
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
      setProfiles((prev) => {
        const next = prev.map((p) =>
          p.id === profileId ? { ...p, ...patch, updatedAt: now } : p
        );
        try {
          localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // Ignore
        }
        return next;
      });

      if (currentUser) {
        const docPath = `profiles/${profileId}`;
        try {
          const target = profiles.find((p) => p.id === profileId);
          if (target) {
            const merged = { ...target, ...patch, updatedAt: now };
            await setDoc(
              doc(db, docPath),
              {
                name: merged.name,
                avatar: merged.avatar,
                color: merged.color,
                defaultAudio: merged.defaultAudio,
                isKid: Boolean(merged.isKid),
                updatedAt: new Date(now).toISOString(),
              },
              { merge: true }
            );
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, docPath);
        }
      }
    },
    [currentUser, profiles]
  );

  const deleteProfile = useCallback(
    async (profileId: string) => {
      if (profiles.length <= 1) {
        // At least one profile must exist; reset to default
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
        const docPath = `profiles/${profileId}`;
        try {
          await deleteDoc(doc(db, docPath));
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, docPath);
        }
      }
    },
    [profiles, activeProfileId, currentUser, updateProfile]
  );

  return {
    currentUser,
    authLoading,
    profiles,
    activeProfile,
    activeProfileId,
    hasSelectedSessionProfile,
    selectProfile,
    createProfile,
    updateProfile,
    deleteProfile,
  };
}
