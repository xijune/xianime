import { useCallback, useEffect, useState } from 'react';
import type {
  AnimeSeries,
  AudioTrack,
  Episode,
  SubtitleLanguage,
  VideoQuality,
} from '../data/animeCatalog';

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

interface PersistedState {
  progressByEpisode: Record<string, EpisodeProgress>;
  watchlistSeries: AnimeSeries[];
  preferences: PlayerPreferences;
}

const STORAGE_KEY = 'kurostream_real_state_v1';

const DEFAULT_PREFERENCES: PlayerPreferences = {
  quality: '1080p',
  audio: 'VOSTFR',
  subtitleLang: 'fr',
  playbackRate: 1,
  volume: 0.7,
  muted: false,
  autoplayNext: true,
};

function getInitialState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      return {
        progressByEpisode: parsed.progressByEpisode ?? {},
        watchlistSeries: parsed.watchlistSeries ?? [],
        preferences: { ...DEFAULT_PREFERENCES, ...(parsed.preferences ?? {}) },
      };
    }
  } catch {
    // Ignore malformed localStorage
  }

  return {
    progressByEpisode: {},
    watchlistSeries: [],
    preferences: DEFAULT_PREFERENCES,
  };
}

export function useWatchProgress() {
  const [state, setState] = useState<PersistedState>(getInitialState);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore quota errors
    }
  }, [state]);

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
      setState((prev) => {
        const existing = prev.progressByEpisode[episode.id];
        return {
          ...prev,
          progressByEpisode: {
            ...prev.progressByEpisode,
            [episode.id]: {
              animeId: anime.id,
              episodeId: episode.id,
              currentTime: clamped,
              duration,
              updatedAt: Date.now(),
              completed,
              customVideoUrl: videoMeta?.customVideoUrl ?? existing?.customVideoUrl,
              customVideoName: videoMeta?.customVideoName ?? existing?.customVideoName,
              snapshot: { anime, episode },
            },
          },
        };
      });
    },
    []
  );

  const removeEpisodeProgress = useCallback((episodeId: string) => {
    setState((prev) => {
      const next = { ...prev.progressByEpisode };
      delete next[episodeId];
      return {
        ...prev,
        progressByEpisode: next,
      };
    });
  }, []);

  const markEpisodeCompleted = useCallback(
    (anime: AnimeSeries, episode: Episode, duration: number) => {
      setState((prev) => {
        const existing = prev.progressByEpisode[episode.id];
        return {
          ...prev,
          progressByEpisode: {
            ...prev.progressByEpisode,
            [episode.id]: {
              animeId: anime.id,
              episodeId: episode.id,
              currentTime: duration,
              duration,
              updatedAt: Date.now(),
              completed: true,
              customVideoUrl: existing?.customVideoUrl,
              customVideoName: existing?.customVideoName,
              snapshot: { anime, episode },
            },
          },
        };
      });
    },
    []
  );

  const toggleWatchlist = useCallback((anime: AnimeSeries) => {
    setState((prev) => {
      const exists = prev.watchlistSeries.some((a) => a.id === anime.id);
      return {
        ...prev,
        watchlistSeries: exists
          ? prev.watchlistSeries.filter((a) => a.id !== anime.id)
          : [anime, ...prev.watchlistSeries],
      };
    });
  }, []);

  const updatePreferences = useCallback((patch: Partial<PlayerPreferences>) => {
    setState((prev) => ({
      ...prev,
      preferences: { ...prev.preferences, ...patch },
    }));
  }, []);

  const continueWatchingList = Object.values(state.progressByEpisode)
    .filter((entry) => !entry.completed && entry.currentTime > 3)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const watchlistIds = state.watchlistSeries.map((a) => a.id);

  const getLatestProgressForAnime = useCallback(
    (animeId: string): EpisodeProgress | undefined => {
      const entries = Object.values(state.progressByEpisode)
        .filter((e) => e.animeId === animeId)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      return entries[0];
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
    markEpisodeCompleted,
    toggleWatchlist,
    updatePreferences,
    getLatestProgressForAnime,
  };
}
