import { useCallback, useEffect, useState } from 'react';
import type {
  AnimeSeries,
  AudioTrack,
  Episode,
  SubtitleLanguage,
  VideoQuality,
} from '../data/animeCatalog';
import {
  db,
  doc,
  collection,
  onSnapshot,
  setDoc,
  deleteDoc,
  handleFirestoreError,
  OperationType,
  type User,
} from '../services/firebase';

export interface EpisodeProgress {
  animeId: string;
  episodeId: string;
  currentTime: number;
  duration: number;
  updatedAt: number;
  completed: boolean;
  customVideoUrl?: string;
  customVideoName?: string;
  snapshot?: {
    anime: AnimeSeries;
    episode: Episode;
  };
}

export interface PlayerPreferences {
  quality: VideoQuality;
  audio: AudioTrack;
  subtitleLang: SubtitleLanguage;
  playbackRate: number;
  volume: number;
  muted: boolean;
  autoplayNext: boolean;
}

interface PersistedProfileState {
  progressByEpisode: Record<string, EpisodeProgress>;
  watchlistSeries: AnimeSeries[];
  preferences: PlayerPreferences;
}

const DEFAULT_PREFERENCES: PlayerPreferences = {
  quality: '1080p',
  audio: 'VOSTFR',
  subtitleLang: 'fr',
  playbackRate: 1,
  volume: 0.7,
  muted: false,
  autoplayNext: true,
};

function getProfileStorageKey(profileId: string) {
  return `kurostream_profile_state_${profileId}_v2`;
}

function getInitialProfileState(profileId: string, defaultAudio?: 'VOSTFR' | 'VF'): PersistedProfileState {
  try {
    const raw = localStorage.getItem(getProfileStorageKey(profileId));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedProfileState>;
      return {
        progressByEpisode: parsed.progressByEpisode ?? {},
        watchlistSeries: parsed.watchlistSeries ?? [],
        preferences: {
          ...DEFAULT_PREFERENCES,
          audio: defaultAudio ?? 'VOSTFR',
          ...(parsed.preferences ?? {}),
        },
      };
    }
  } catch {
    // Ignore malformed localStorage
  }

  // Also check legacy storage for the primary profile so user doesn't lose old data
  if (profileId === 'profile-main') {
    try {
      const legacy = localStorage.getItem('kurostream_real_state_v1');
      if (legacy) {
        const parsed = JSON.parse(legacy) as Partial<PersistedProfileState>;
        return {
          progressByEpisode: parsed.progressByEpisode ?? {},
          watchlistSeries: parsed.watchlistSeries ?? [],
          preferences: { ...DEFAULT_PREFERENCES, ...(parsed.preferences ?? {}) },
        };
      }
    } catch {
      // Ignore
    }
  }

  return {
    progressByEpisode: {},
    watchlistSeries: [],
    preferences: {
      ...DEFAULT_PREFERENCES,
      audio: defaultAudio ?? 'VOSTFR',
    },
  };
}

export function useWatchProgress(
  activeProfileId = 'profile-main',
  defaultAudioOrUserId?: 'VOSTFR' | 'VF' | string,
  defaultAudioArg?: 'VOSTFR' | 'VF',
  currentUser?: User | null
) {
  const defaultAudio: 'VOSTFR' | 'VF' =
    defaultAudioArg ??
    (defaultAudioOrUserId === 'VF' || defaultAudioOrUserId === 'VOSTFR'
      ? defaultAudioOrUserId
      : 'VOSTFR');

  const [state, setState] = useState<PersistedProfileState>(() =>
    getInitialProfileState(activeProfileId, defaultAudio)
  );

  // When activeProfileId changes, switch local state immediately to that profile's cached state
  useEffect(() => {
    setState(getInitialProfileState(activeProfileId, defaultAudio));
  }, [activeProfileId, defaultAudio]);

  // Persist state to local cache for instant offline responsiveness
  useEffect(() => {
    try {
      localStorage.setItem(getProfileStorageKey(activeProfileId), JSON.stringify(state));
    } catch {
      // Ignore quota errors
    }
  }, [activeProfileId, state]);

  // Real-time Firestore sync for Watchlist of active profile (only when authenticated)
  useEffect(() => {
    if (!currentUser || !activeProfileId) return;

    const path = `profiles/${activeProfileId}/watchlist`;
    const colRef = collection(db, path);

    const unsubscribe = onSnapshot(
      colRef,
      (snapshot) => {
        const cloudWatchlist: AnimeSeries[] = [];
        snapshot.forEach((snap) => {
          const d = snap.data();
          if (d.serializedAnime) {
            try {
              cloudWatchlist.push(JSON.parse(d.serializedAnime));
            } catch {
              // Ignore
            }
          }
        });

        setState((prev) => ({
          ...prev,
          watchlistSeries: cloudWatchlist,
        }));
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, path);
      }
    );

    return () => unsubscribe();
  }, [activeProfileId, currentUser]);

  // Real-time Firestore sync for Progress of active profile (only when authenticated)
  useEffect(() => {
    if (!currentUser || !activeProfileId) return;

    const path = `profiles/${activeProfileId}/progress`;
    const colRef = collection(db, path);

    const unsubscribe = onSnapshot(
      colRef,
      (snapshot) => {
        const cloudProgress: Record<string, EpisodeProgress> = {};
        snapshot.forEach((snap) => {
          const d = snap.data();
          let snapAnime: AnimeSeries | undefined;
          let snapEp: Episode | undefined;
          if (d.serializedSnapshot) {
            try {
              const parsed = JSON.parse(d.serializedSnapshot);
              snapAnime = parsed.anime;
              snapEp = parsed.episode;
            } catch {
              // Ignore
            }
          }

          cloudProgress[snap.id] = {
            animeId: String(d.animeId || ''),
            episodeId: snap.id,
            currentTime: Number(d.currentTime || 0),
            duration: Number(d.duration || 0),
            updatedAt: d.updatedAt ? new Date(d.updatedAt).getTime() : Date.now(),
            completed: Boolean(d.completed),
            customVideoName: d.customVideoName ? String(d.customVideoName) : undefined,
            snapshot:
              snapAnime && snapEp
                ? { anime: snapAnime, episode: snapEp }
                : undefined,
          };
        });

        setState((prev) => ({
          ...prev,
          progressByEpisode: cloudProgress,
        }));
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, path);
      }
    );

    return () => unsubscribe();
  }, [activeProfileId, currentUser]);

  const saveEpisodeProgress = useCallback(
    (
      anime: AnimeSeries,
      episode: Episode,
      currentTime: number,
      duration: number,
      videoMeta?: { customVideoUrl?: string; customVideoName?: string }
    ) => {
      const clamped = Math.max(0, Math.min(currentTime, duration));
      const completed = duration > 0 && clamped >= duration - 15;
      const now = Date.now();

      const newEntry: EpisodeProgress = {
        animeId: anime.id,
        episodeId: episode.id,
        currentTime: clamped,
        duration,
        updatedAt: now,
        completed,
        customVideoUrl: videoMeta?.customVideoUrl,
        customVideoName: videoMeta?.customVideoName,
        snapshot: { anime, episode },
      };

      // Update state locally first (zero latency)
      setState((prev) => ({
        ...prev,
        progressByEpisode: {
          ...prev.progressByEpisode,
          [episode.id]: newEntry,
        },
      }));

      // Async sync to Firestore
      if (activeProfileId) {
        const docPath = `profiles/${activeProfileId}/progress/${episode.id}`;
        void setDoc(doc(db, docPath), {
          animeId: anime.id,
          episodeId: episode.id,
          season: episode.season,
          number: episode.number,
          currentTime: clamped,
          duration,
          completed,
          animeTitle: anime.title.slice(0, 200),
          episodeTitle: episode.title.slice(0, 200),
          thumbnail: episode.thumbnail?.slice(0, 500) || '',
          customVideoName: videoMeta?.customVideoName?.slice(0, 200) || '',
          serializedSnapshot: JSON.stringify({ anime, episode }),
          updatedAt: new Date(now).toISOString(),
        }).catch((err) => {
          handleFirestoreError(err, OperationType.WRITE, docPath);
        });
      }
    },
    [activeProfileId]
  );

  const removeEpisodeProgress = useCallback(
    (episodeId: string) => {
      setState((prev) => {
        const next = { ...prev.progressByEpisode };
        delete next[episodeId];
        return {
          ...prev,
          progressByEpisode: next,
        };
      });

      if (activeProfileId) {
        const docPath = `profiles/${activeProfileId}/progress/${episodeId}`;
        void deleteDoc(doc(db, docPath)).catch((err) =>
          handleFirestoreError(err, OperationType.DELETE, docPath)
        );
      }
    },
    [activeProfileId]
  );

  const removeAnimeProgress = useCallback(
    (animeId: string) => {
      const toDeleteIds: string[] = [];
      setState((prev) => {
        const next: Record<string, EpisodeProgress> = {};
        for (const [epId, entry] of Object.entries(prev.progressByEpisode)) {
          if (entry.animeId !== animeId || entry.completed) {
            next[epId] = entry;
          } else {
            toDeleteIds.push(epId);
          }
        }
        return {
          ...prev,
          progressByEpisode: next,
        };
      });

      if (activeProfileId && toDeleteIds.length > 0) {
        toDeleteIds.forEach((epId) => {
          const docPath = `profiles/${activeProfileId}/progress/${epId}`;
          void deleteDoc(doc(db, docPath)).catch((err) =>
            handleFirestoreError(err, OperationType.DELETE, docPath)
          );
        });
      }
    },
    [activeProfileId]
  );


  const markEpisodeCompleted = useCallback(
    (anime: AnimeSeries, episode: Episode, duration: number) => {
      saveEpisodeProgress(anime, episode, duration, duration);
    },
    [saveEpisodeProgress]
  );

  const toggleWatchlist = useCallback(
    (anime: AnimeSeries) => {
      let isAdding = false;
      setState((prev) => {
        const exists = prev.watchlistSeries.some((a) => a.id === anime.id);
        isAdding = !exists;
        return {
          ...prev,
          watchlistSeries: exists
            ? prev.watchlistSeries.filter((a) => a.id !== anime.id)
            : [anime, ...prev.watchlistSeries],
        };
      });

      if (activeProfileId) {
        const docPath = `profiles/${activeProfileId}/watchlist/${anime.id}`;
        if (isAdding) {
          void setDoc(doc(db, docPath), {
            animeId: anime.id,
            title: anime.title.slice(0, 200),
            posterImage: anime.posterImage?.slice(0, 500) || '',
            keyVisual: anime.keyVisual?.slice(0, 500) || '',
            serializedAnime: JSON.stringify(anime),
            addedAt: new Date().toISOString(),
          }).catch((err) =>
            handleFirestoreError(err, OperationType.WRITE, docPath)
          );
        } else {
          void deleteDoc(doc(db, docPath)).catch((err) =>
            handleFirestoreError(err, OperationType.DELETE, docPath)
          );
        }
      }
    },
    [activeProfileId]
  );

  const updatePreferences = useCallback((patch: Partial<PlayerPreferences>) => {
    setState((prev) => ({
      ...prev,
      preferences: { ...prev.preferences, ...patch },
    }));
  }, []);

  const continueWatchingList = (() => {
    const bestByAnime = new Map<string, EpisodeProgress>();
    for (const entry of Object.values(state.progressByEpisode)) {
      if (entry.completed || entry.currentTime <= 3) continue;
      const existing = bestByAnime.get(entry.animeId);
      if (!existing || isFurtherEpisode(entry, existing)) {
        bestByAnime.set(entry.animeId, entry);
      }
    }
    return Array.from(bestByAnime.values()).sort(
      (a, b) => b.updatedAt - a.updatedAt
    );
  })();

  const watchlistIds = state.watchlistSeries.map((a) => a.id);

  const getLatestProgressForAnime = useCallback(
    (animeId: string): EpisodeProgress | undefined => {
      const entries = Object.values(state.progressByEpisode).filter(
        (e) => e.animeId === animeId
      );
      if (entries.length === 0) return undefined;

      const incomplete = entries.filter(
        (e) => !e.completed && e.currentTime > 3
      );
      const pool = incomplete.length > 0 ? incomplete : entries;
      return pool.reduce((best, curr) =>
        isFurtherEpisode(curr, best) ? curr : best
      );
    },
    [state.progressByEpisode]
  );

  return {
    progressByEpisode: state.progressByEpisode,
    continueWatchingList,
    watchlistSeries: state.watchlistSeries,
    watchlistIds,
    preferences: state.preferences,
    saveEpisodeProgress,
    removeEpisodeProgress,
    removeAnimeProgress,
    markEpisodeCompleted,
    toggleWatchlist,
    updatePreferences,
    getLatestProgressForAnime,
  };
}

function getEpisodeSortKey(entry: EpisodeProgress): {
  season: number;
  number: number;
} {
  const snapEp = entry.snapshot?.episode;
  if (
    snapEp &&
    typeof snapEp.season === 'number' &&
    typeof snapEp.number === 'number'
  ) {
    return { season: snapEp.season, number: snapEp.number };
  }
  const match = /-s(\d+)-e(\d+)$/i.exec(entry.episodeId);
  if (match) {
    return { season: Number(match[1]), number: Number(match[2]) };
  }
  return { season: 1, number: 0 };
}

function isFurtherEpisode(
  candidate: EpisodeProgress,
  currentBest: EpisodeProgress
): boolean {
  const a = getEpisodeSortKey(candidate);
  const b = getEpisodeSortKey(currentBest);
  if (a.season !== b.season) return a.season > b.season;
  if (a.number !== b.number) return a.number > b.number;
  return candidate.updatedAt > currentBest.updatedAt;
}
