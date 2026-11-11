import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronRight,
  Clock,
  FastForward,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  Settings,
  SkipForward,
  Square,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import Hls from 'hls.js';
import {
  formatAiringDateFr,
  formatTimecode,
  getAllSeriesEpisodes,
  getSeriesSeasons,
  type AnimeSeries,
  type AudioTrack,
  type Episode,
  type VideoQuality,
} from '../data/animeCatalog';
import type { EpisodeProgress, PlayerPreferences } from '../hooks/useWatchProgress';
import { resolveEpisodeVideoUrl } from '../services/videoSourceResolver';

function isHlsUrl(url: string): boolean {
  return /\.m3u8(\?.*)?$/i.test(url) || url.toLowerCase().includes('.m3u8');
}

interface VideoPlayerModalProps {
  anime: AnimeSeries;
  episode: Episode;
  initialTime: number;
  preferences: PlayerPreferences;
  progressByEpisode: Record<string, EpisodeProgress>;
  onUpdatePreferences: (patch: Partial<PlayerPreferences>) => void;
  onSaveProgress: (
    anime: AnimeSeries,
    episode: Episode,
    currentTime: number,
    duration: number
  ) => void;
  onMarkCompleted: (anime: AnimeSeries, episode: Episode, duration: number) => void;
  onSelectEpisode: (episode: Episode, startAt?: number) => void;
  onClose: () => void;
}

export function VideoPlayerModal({
  anime,
  episode,
  initialTime,
  preferences,
  progressByEpisode,
  onUpdatePreferences,
  onSaveProgress,
  onMarkCompleted,
  onSelectEpisode,
  onClose,
}: VideoPlayerModalProps) {
  const [videoSrc, setVideoSrc] = useState<string>(episode.videoUrl ?? '');
  const [isLoadingSource, setIsLoadingSource] = useState<boolean>(!episode.videoUrl);
  const [videoError, setVideoError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const savedNoticeTimerRef = useRef<number | null>(null);

  const [isPlaying, setIsPlaying] = useState(true);
  const [duration, setDuration] = useState(episode.duration);
  const [currentTime, setCurrentTime] = useState(() =>
    initialTime > 0 && initialTime < episode.duration - 10 ? initialTime : 0
  );
  const [showControls, setShowControls] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showEpisodesDrawer, setShowEpisodesDrawer] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hoverTime, setHoverTime] = useState<{ time: number; leftPct: number } | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [nextCountdown, setNextCountdown] = useState<number | null>(null);

  const currentTimeRef = useRef(currentTime);
  const durationRef = useRef(duration);
  const isPlayingRef = useRef(isPlaying);
  const lastEpisodeIdRef = useRef<string>(episode.id);

  const seasons = useMemo(() => getSeriesSeasons(anime), [anime]);
  const [drawerSeasonNum, setDrawerSeasonNum] = useState<number>(episode.season || 1);

  useEffect(() => {
    setDrawerSeasonNum(episode.season || 1);
  }, [episode.season]);

  const activeDrawerSeason = useMemo(
    () => seasons.find((s) => s.seasonNumber === drawerSeasonNum),
    [drawerSeasonNum, seasons]
  );

  const drawerEpisodes = useMemo(() => {
    const raw = activeDrawerSeason?.episodes ?? anime.episodes;
    return raw.filter((e) => !e.isUpcoming);
  }, [activeDrawerSeason?.episodes, anime.episodes]);

  const nextEpisode = useMemo(() => {
    const allEps = getAllSeriesEpisodes(anime);
    const idx = allEps.findIndex((e) => e.id === episode.id);
    if (idx >= 0 && idx < allEps.length - 1) {
      return allEps[idx + 1];
    }
    return null;
  }, [anime, episode.id]);

  // Reset state ONLY when switching to a different episode
  useEffect(() => {
    if (lastEpisodeIdRef.current === episode.id) return;
    lastEpisodeIdRef.current = episode.id;

    const startPos =
      initialTime > 0 && initialTime < episode.duration - 10 ? initialTime : 0;
    setCurrentTime(startPos);
    currentTimeRef.current = startPos;
    setDuration(episode.duration);
    durationRef.current = episode.duration;
    setIsPlaying(true);
    isPlayingRef.current = true;
    setNextCountdown(null);
    setVideoError(null);
    setVideoSrc(episode.videoUrl ?? '');
    setIsLoadingSource(!episode.videoUrl);
  }, [episode.duration, episode.id, episode.videoUrl, initialTime]);

  // Fetch video URL via resolveEpisodeVideoUrl
  useEffect(() => {
    if (episode.videoUrl) {
      setVideoSrc(episode.videoUrl);
      setIsLoadingSource(false);
      return;
    }

    let cancelled = false;
    setIsLoadingSource(true);
    setVideoError(null);

    void resolveEpisodeVideoUrl(anime, episode)
      .then((url) => {
        if (cancelled) return;
        setIsLoadingSource(false);
        if (url) {
          setVideoSrc(url);
          setIsPlaying(true);
          isPlayingRef.current = true;
        } else {
          setVideoSrc('');
          setVideoError(
            "Aucune URL vidéo configurée pour cet épisode. Renseignez episode.videoUrl ou configurez VITE_VIDEO_API_URL."
          );
          setIsPlaying(false);
          isPlayingRef.current = false;
        }
      })
      .catch(() => {
        if (cancelled) return;
        setIsLoadingSource(false);
        setVideoSrc('');
        setVideoError("Impossible de récupérer l'URL vidéo de cet épisode.");
        setIsPlaying(false);
        isPlayingRef.current = false;
      });

    return () => {
      cancelled = true;
    };
  }, [anime, episode]);

  useEffect(() => {
    return () => {
      if (savedNoticeTimerRef.current) {
        window.clearTimeout(savedNoticeTimerRef.current);
      }
    };
  }, []);

  // Attach video source (.m3u8 via hls.js or native Safari HLS, plus .mp4/.webm)
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !videoSrc) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const startPlayback = () => {
      if (isPlayingRef.current) {
        void vid.play().catch(() => {
          vid.muted = true;
          onUpdatePreferences({ muted: true });
          void vid.play().catch(() => {
            isPlayingRef.current = false;
            setIsPlaying(false);
          });
        });
      }
    };

    if (isHlsUrl(videoSrc)) {
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
        });
        hlsRef.current = hls;
        hls.loadSource(videoSrc);
        hls.attachMedia(vid);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (currentTimeRef.current > 0) {
            vid.currentTime = currentTimeRef.current;
          }
          startPlayback();
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              setVideoError(
                'Erreur réseau ou CORS lors du chargement du flux .m3u8.'
              );
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              hls.recoverMediaError();
              return;
            } else {
              setVideoError('Impossible de décoder ce flux .m3u8.');
            }
            isPlayingRef.current = false;
            setIsPlaying(false);
          }
        });
      } else if (vid.canPlayType('application/vnd.apple.mpegurl')) {
        vid.src = videoSrc;
        startPlayback();
      } else {
        setVideoError('Votre navigateur ne prend pas en charge les flux .m3u8.');
      }
    } else {
      vid.src = videoSrc;
      startPlayback();
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      vid.removeAttribute('src');
      vid.load();
    };
  }, [videoSrc, onUpdatePreferences]);

  // Map quality selector to HLS levels when available
  useEffect(() => {
    const hls = hlsRef.current;
    if (!hls || !hls.levels || hls.levels.length === 0) return;
    if (preferences.quality === 'Auto') {
      hls.currentLevel = -1;
      return;
    }
    const targetHeight =
      preferences.quality === '1080p'
        ? 1080
        : preferences.quality === '720p'
          ? 720
          : 480;
    let bestIdx = -1;
    let bestDiff = Infinity;
    hls.levels.forEach((lvl, idx) => {
      const diff = Math.abs((lvl.height || 0) - targetHeight);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = idx;
      }
    });
    if (bestIdx >= 0) {
      hls.currentLevel = bestIdx;
    }
  }, [preferences.quality]);

  // Sync HTML5 <video> play/pause, volume, playbackRate
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !videoSrc) return;
    vid.volume = preferences.volume;
    vid.muted = preferences.muted;
    vid.playbackRate = preferences.playbackRate;
    if (isPlaying) {
      void vid.play().catch(() => {});
    } else {
      vid.pause();
    }
  }, [
    isPlaying,
    videoSrc,
    preferences.volume,
    preferences.muted,
    preferences.playbackRate,
  ]);

  // Save progress periodically while playing AND on unmount
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (isPlayingRef.current && videoSrc) {
        onSaveProgress(
          anime,
          episode,
          currentTimeRef.current,
          durationRef.current
        );
      }
    }, 1000);

    return () => {
      window.clearInterval(interval);
      if (videoSrc) {
        onSaveProgress(
          anime,
          episode,
          currentTimeRef.current,
          durationRef.current
        );
      }
    };
  }, [anime, episode, videoSrc, onSaveProgress]);

  // Auto-countdown to next episode near end
  useEffect(() => {
    if (!videoSrc || !nextEpisode || !preferences.autoplayNext) {
      setNextCountdown(null);
      return;
    }
    const remaining = duration - currentTime;
    if (remaining <= 10 && remaining > 0) {
      setNextCountdown(Math.ceil(remaining));
    } else if (remaining <= 0 && !isPlaying && currentTime >= duration - 0.5) {
      onSelectEpisode(nextEpisode, 0);
    } else {
      setNextCountdown(null);
    }
  }, [
    currentTime,
    duration,
    isPlaying,
    nextEpisode,
    onSelectEpisode,
    preferences.autoplayNext,
    videoSrc,
  ]);

  // Controls auto-hide timer
  useEffect(() => {
    if (!isPlaying || showSettings || showEpisodesDrawer || !videoSrc) {
      setShowControls(true);
      return;
    }
    if (!showControls) return;
    const timer = window.setTimeout(() => setShowControls(false), 3200);
    return () => window.clearTimeout(timer);
  }, [isPlaying, showControls, showSettings, showEpisodesDrawer, videoSrc]);

  const showSavedToast = useCallback((timeSec: number) => {
    setSavedNotice(`Progression sauvegardée à ${formatTimecode(timeSec)}`);
    if (savedNoticeTimerRef.current) {
      window.clearTimeout(savedNoticeTimerRef.current);
    }
    savedNoticeTimerRef.current = window.setTimeout(() => {
      setSavedNotice(null);
    }, 2400);
  }, []);

  const handlePauseAndSave = useCallback(() => {
    if (!videoSrc) return;
    const next = !isPlayingRef.current;
    isPlayingRef.current = next;
    setIsPlaying(next);

    if (!next) {
      onSaveProgress(anime, episode, currentTimeRef.current, durationRef.current);
      showSavedToast(currentTimeRef.current);
    }
  }, [anime, episode, onSaveProgress, showSavedToast, videoSrc]);

  const handleStopAndExit = useCallback(() => {
    isPlayingRef.current = false;
    setIsPlaying(false);
    if (videoSrc) {
      onSaveProgress(anime, episode, currentTimeRef.current, durationRef.current);
    }
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
    onClose();
  }, [anime, episode, onClose, onSaveProgress, videoSrc]);

  const seekTo = useCallback(
    (target: number) => {
      const clamped = Math.max(0, Math.min(target, durationRef.current));
      currentTimeRef.current = clamped;
      setCurrentTime(clamped);
      if (videoRef.current) {
        videoRef.current.currentTime = clamped;
      }
      if (videoSrc) {
        onSaveProgress(anime, episode, clamped, durationRef.current);
      }
    },
    [anime, episode, onSaveProgress, videoSrc]
  );

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    const vid = videoRef.current as
      | (HTMLVideoElement & {
          webkitEnterFullscreen?: () => void;
          webkitExitFullscreen?: () => void;
        })
      | null;

    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
      return;
    }

    if (container && typeof container.requestFullscreen === 'function') {
      void container.requestFullscreen().catch(() => {
        vid?.webkitEnterFullscreen?.();
      });
    } else if (vid?.webkitEnterFullscreen) {
      vid.webkitEnterFullscreen();
    }
  }, []);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        handlePauseAndSave();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        seekTo(currentTimeRef.current + 10);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seekTo(currentTimeRef.current - 10);
      } else if (e.key.toLowerCase() === 'm') {
        onUpdatePreferences({ muted: !preferences.muted });
      } else if (e.key.toLowerCase() === 'f') {
        toggleFullscreen();
      } else if (e.key === 'Escape') {
        if (showSettings || showEpisodesDrawer) {
          setShowSettings(false);
          setShowEpisodesDrawer(false);
        } else {
          handleStopAndExit();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    handlePauseAndSave,
    handleStopAndExit,
    onUpdatePreferences,
    preferences.muted,
    seekTo,
    showEpisodesDrawer,
    showSettings,
    toggleFullscreen,
  ]);

  const inIntro =
    Boolean(videoSrc) &&
    currentTime >= episode.introStart &&
    currentTime <= episode.introEnd;
  const progressPct =
    duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div
      ref={containerRef}
      onMouseMove={() => setShowControls(true)}
      className="fixed inset-0 h-[100dvh] w-full z-50 bg-black flex flex-col justify-center items-center select-none overflow-hidden"
    >
      {/* Main Video Stage */}
      <div
        className="relative w-full h-full flex items-center justify-center bg-black"
        onClick={(e) => {
          const tag = (e.target as HTMLElement).tagName;
          if (e.target === e.currentTarget || tag === 'VIDEO') {
            setShowSettings(false);
            setShowEpisodesDrawer(false);
            handlePauseAndSave();
          }
        }}
      >
        {videoSrc ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            onLoadedMetadata={(e) => {
              const vid = e.currentTarget;
              if (Number.isFinite(vid.duration) && vid.duration > 0) {
                setDuration(vid.duration);
                durationRef.current = vid.duration;
                if (
                  currentTimeRef.current > 0 &&
                  currentTimeRef.current < vid.duration - 2
                ) {
                  vid.currentTime = currentTimeRef.current;
                }
              }
            }}
            onCanPlay={(e) => {
              const vid = e.currentTarget;
              if (isPlayingRef.current && vid.paused) {
                void vid.play().catch(() => {
                  vid.muted = true;
                  onUpdatePreferences({ muted: true });
                  void vid.play().catch(() => {
                    isPlayingRef.current = false;
                    setIsPlaying(false);
                  });
                });
              }
            }}
            onPlay={() => {
              isPlayingRef.current = true;
              setIsPlaying(true);
            }}
            onPause={() => {
              isPlayingRef.current = false;
              setIsPlaying(false);
            }}
            onTimeUpdate={(e) => {
              const t = e.currentTarget.currentTime;
              currentTimeRef.current = t;
              setCurrentTime(t);
            }}
            onEnded={() => {
              isPlayingRef.current = false;
              setIsPlaying(false);
              onMarkCompleted(anime, episode, durationRef.current);
            }}
            onError={() => {
              setVideoError('Impossible de lire ce flux vidéo.');
              isPlayingRef.current = false;
              setIsPlaying(false);
            }}
            className="max-w-full max-h-full w-full h-full object-contain cursor-pointer"
          />
        ) : null}

        {/* Loading Stream State */}
        {isLoadingSource ? (
          <div className="flex flex-col items-center justify-center gap-3 text-center px-6">
            <Loader2 className="w-8 h-8 text-[#FF5E1A] animate-spin" />
            <p className="text-sm text-zinc-300">
              Chargement de l’épisode {episode.number}…
            </p>
          </div>
        ) : null}

        {/* Top Bar */}
        <div
          className={`absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-2 sm:gap-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-4 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:px-6 bg-gradient-to-b from-black/95 via-black/70 to-transparent transition-opacity duration-200 ${
            showControls || !videoSrc
              ? 'opacity-100'
              : 'opacity-0 pointer-events-none'
          }`}
        >
          <div className="min-w-0 flex-1">
            <p className="text-[11px] sm:text-xs font-medium text-zinc-300 truncate">
              {anime.title} · S{episode.season} E{episode.number} · {preferences.quality} HD
            </p>
            <h2 className="text-sm sm:text-base font-display font-semibold text-white truncate">
              {episode.title}
            </h2>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={handleStopAndExit}
              className="inline-flex items-center justify-center gap-1.5 px-3 min-h-[40px] sm:min-h-[36px] rounded-lg bg-white/10 hover:bg-[#FF5E1A] text-white text-xs font-medium transition-colors whitespace-nowrap cursor-pointer"
            >
              <Square className="w-3 h-3 fill-current" />
              <span className="sm:hidden">Sauver</span>
              <span className="hidden sm:inline">Arrêter et sauvegarder</span>
            </button>

            <button
              type="button"
              onClick={() => setShowEpisodesDrawer((prev) => !prev)}
              className="inline-flex items-center justify-center gap-1 px-2.5 min-h-[40px] sm:min-h-[36px] rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition-colors whitespace-nowrap cursor-pointer"
            >
              <span>Épisodes</span>
              <ChevronRight className="w-3.5 h-3.5 hidden sm:inline" />
            </button>

            <button
              type="button"
              onClick={handleStopAndExit}
              aria-label="Fermer le lecteur"
              className="min-h-[40px] min-w-[40px] sm:min-h-[36px] sm:min-w-[36px] flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Saved notice toast */}
        {savedNotice ? (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded-lg bg-black/85 border border-white/15 text-xs font-medium text-white flex items-center gap-2">
            <Check className="w-3.5 h-3.5 text-[#FF5E1A]" />
            <span className="tabular-nums">{savedNotice}</span>
          </div>
        ) : null}

        {/* Video Error Banner */}
        {videoError && !isLoadingSource ? (
          <div className="absolute z-20 max-w-md mx-4 rounded-xl bg-[#13151B]/95 border border-white/15 p-6 text-center">
            <p className="text-sm text-zinc-200 mb-4">{videoError}</p>
            <div className="flex items-center justify-center gap-2">
              {nextEpisode ? (
                <button
                  type="button"
                  onClick={() => onSelectEpisode(nextEpisode, 0)}
                  className="px-4 py-2 rounded-lg bg-[#FF5E1A] text-white text-xs font-semibold cursor-pointer"
                >
                  Épisode suivant
                </button>
              ) : null}
              <button
                type="button"
                onClick={handleStopAndExit}
                className="px-4 py-2 rounded-lg bg-white/10 text-zinc-200 text-xs font-medium cursor-pointer"
              >
                Fermer
              </button>
            </div>
          </div>
        ) : null}

        {/* Paused Overlay */}
        {videoSrc && !isPlaying && !showEpisodesDrawer && !videoError && !isLoadingSource ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/45 pointer-events-none">
            <div className="pointer-events-auto flex flex-col items-center text-center px-6 py-5 rounded-xl bg-[#111319]/92 border border-white/12 max-w-md mx-4">
              <span className="text-xs font-mono tabular-nums text-[#FF5E1A] mb-1">
                En pause · Position sauvegardée à {formatTimecode(currentTime)}
              </span>
              <h3 className="text-lg font-display font-semibold text-white mb-4">
                S{episode.season} E{episode.number} — {episode.title}
              </h3>
              <div className="flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={handlePauseAndSave}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#FF5E1A] hover:bg-[#e85112] text-white text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>Reprendre la lecture</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    seekTo(0);
                    isPlayingRef.current = true;
                    setIsPlaying(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-zinc-100 text-sm font-medium transition-colors whitespace-nowrap cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Recommencer</span>
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Skip Intro Button */}
        {inIntro && isPlaying ? (
          <button
            type="button"
            onClick={() => seekTo(episode.introEnd + 1)}
            className="absolute right-4 sm:right-6 bottom-28 z-20 inline-flex items-center gap-2 px-4 min-h-[44px] rounded-lg bg-black/80 hover:bg-[#FF5E1A] border border-white/20 text-white text-xs font-semibold transition-colors cursor-pointer"
          >
            <span>Passer l’intro</span>
            <FastForward className="w-3.5 h-3.5" />
          </button>
        ) : null}

        {/* Next Episode Prompt */}
        {nextCountdown !== null && nextEpisode ? (
          <div className="absolute right-4 sm:right-6 bottom-28 z-20 max-w-[calc(100vw-2rem)] flex items-center gap-3 px-4 py-3 rounded-xl bg-[#13151B]/95 border border-white/15">
            <div className="text-left min-w-0">
              <p className="text-xs text-zinc-400 tabular-nums">
                Épisode suivant dans {nextCountdown}s
              </p>
              <p className="text-sm font-medium text-white truncate">
                E{nextEpisode.number} · {nextEpisode.title}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onSelectEpisode(nextEpisode, 0)}
              className="px-3.5 min-h-[40px] rounded-lg bg-[#FF5E1A] hover:bg-[#e85112] text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
            >
              Lancer
            </button>
          </div>
        ) : null}

        {/* Bottom Controls */}
        {videoSrc ? (
          <div
            className={`absolute inset-x-0 bottom-0 z-20 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-10 bg-gradient-to-t from-black/95 via-black/75 to-transparent transition-opacity duration-200 ${
              showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          >
            {/* Timeline Scrubber */}
            <div
              className="relative group mb-2 sm:mb-3 py-2.5 sm:py-1.5"
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const pct = Math.max(
                  0,
                  Math.min(1, (e.clientX - rect.left) / rect.width)
                );
                setHoverTime({
                  time: pct * duration,
                  leftPct: pct * 100,
                });
              }}
              onMouseLeave={() => setHoverTime(null)}
            >
              {hoverTime ? (
                <div
                  className="absolute -top-7 -translate-x-1/2 px-2 py-0.5 rounded bg-black/90 border border-white/15 text-[11px] font-mono tabular-nums text-white pointer-events-none"
                  style={{ left: `${hoverTime.leftPct}%` }}
                >
                  {formatTimecode(hoverTime.time)}
                </div>
              ) : null}

              <div className="relative h-1.5 w-full rounded-full bg-white/20 overflow-hidden">
                <div
                  className="absolute top-0 bottom-0 bg-white/25"
                  style={{
                    left: `${(episode.introStart / duration) * 100}%`,
                    width: `${((episode.introEnd - episode.introStart) / duration) * 100}%`,
                  }}
                />
                <div
                  className="absolute top-0 bottom-0 left-0 bg-[#FF5E1A]"
                  style={{ width: `${progressPct}%` }}
                />
              </div>

              <input
                type="range"
                aria-label="Barre de progression de l'épisode"
                min={0}
                max={duration}
                step={1}
                value={currentTime}
                onChange={(e) => seekTo(Number(e.target.value))}
                className="kuro-range absolute inset-0 w-full h-full opacity-100 md:opacity-0 md:group-hover:opacity-100"
              />
            </div>

            {/* Controls Row */}
            <div className="flex items-center justify-between gap-2 sm:gap-4">
              <div className="flex items-center gap-1 sm:gap-3 min-w-0">
                <button
                  type="button"
                  onClick={handlePauseAndSave}
                  aria-label={isPlaying ? 'Mettre en pause' : 'Lire'}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
                >
                  {isPlaying ? (
                    <Pause className="w-5 h-5 fill-current" />
                  ) : (
                    <Play className="w-5 h-5 fill-current" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => seekTo(currentTime - 10)}
                  aria-label="Reculer de 10 secondes"
                  className="px-2 min-h-[44px] rounded-lg text-xs font-mono tabular-nums text-zinc-200 hover:bg-white/10 transition-colors cursor-pointer shrink-0"
                >
                  -10s
                </button>

                <button
                  type="button"
                  onClick={() => seekTo(currentTime + 10)}
                  aria-label="Avancer de 10 secondes"
                  className="px-2 min-h-[44px] rounded-lg text-xs font-mono tabular-nums text-zinc-200 hover:bg-white/10 transition-colors cursor-pointer shrink-0"
                >
                  +10s
                </button>

                {nextEpisode ? (
                  <button
                    type="button"
                    onClick={() => onSelectEpisode(nextEpisode, 0)}
                    aria-label="Épisode suivant"
                    className="hidden sm:inline-flex items-center gap-1.5 px-2.5 min-h-[44px] rounded-lg text-xs font-medium text-zinc-200 hover:bg-white/10 transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <SkipForward className="w-4 h-4" />
                    <span>Suivant</span>
                  </button>
                ) : null}

                <div className="flex items-center gap-2 ml-0.5 sm:ml-1 shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      onUpdatePreferences({ muted: !preferences.muted })
                    }
                    aria-label={
                      preferences.muted ? 'Activer le son' : 'Couper le son'
                    }
                    className="min-h-[44px] min-w-[40px] flex items-center justify-center rounded-lg text-zinc-200 hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    {preferences.muted || preferences.volume === 0 ? (
                      <VolumeX className="w-4 h-4" />
                    ) : (
                      <Volume2 className="w-4 h-4" />
                    )}
                  </button>
                  <input
                    type="range"
                    aria-label="Volume"
                    min={0}
                    max={1}
                    step={0.05}
                    value={preferences.muted ? 0 : preferences.volume}
                    onChange={(e) =>
                      onUpdatePreferences({
                        volume: Number(e.target.value),
                        muted: Number(e.target.value) === 0,
                      })
                    }
                    className="kuro-range hidden md:block w-20 h-1 bg-white/25 rounded-full"
                  />
                </div>

                <span className="ml-1 sm:ml-2 text-[11px] sm:text-xs font-mono tabular-nums text-zinc-200 whitespace-nowrap truncate">
                  {formatTimecode(currentTime)}{' '}
                  <span className="text-zinc-500">
                    / {formatTimecode(duration)}
                  </span>
                </span>
              </div>

              <div className="flex items-center gap-1 sm:gap-2 relative shrink-0">
                <button
                  type="button"
                  onClick={() => setShowSettings((prev) => !prev)}
                  aria-label="Paramètres vidéo"
                  className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-colors cursor-pointer ${
                    showSettings
                      ? 'bg-[#FF5E1A] text-white'
                      : 'text-zinc-200 hover:bg-white/10'
                  }`}
                >
                  <Settings className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={toggleFullscreen}
                  aria-label={
                    isFullscreen ? 'Quitter le plein écran' : 'Plein écran'
                  }
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-zinc-200 hover:bg-white/10 transition-colors cursor-pointer"
                >
                  {isFullscreen ? (
                    <Minimize className="w-4 h-4" />
                  ) : (
                    <Maximize className="w-4 h-4" />
                  )}
                </button>

                {showSettings ? (
                  <div className="absolute right-0 bottom-14 w-[calc(100vw-2rem)] sm:w-72 max-h-[58dvh] overflow-y-auto overscroll-contain rounded-xl bg-[#13151B] border border-white/12 p-4 shadow-2xl space-y-4">
                    <div>
                      <p className="text-xs font-medium text-zinc-400 mb-2">
                        Qualité vidéo
                      </p>
                      <div className="grid grid-cols-4 gap-1.5">
                        {(['Auto', '1080p', '720p', '480p'] as VideoQuality[]).map(
                          (q) => (
                            <button
                              key={q}
                              type="button"
                              onClick={() => onUpdatePreferences({ quality: q })}
                              className={`px-2 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                                preferences.quality === q
                                  ? 'bg-[#FF5E1A] text-white'
                                  : 'bg-white/8 text-zinc-300 hover:bg-white/14'
                              }`}
                            >
                              {q}
                            </button>
                          )
                        )}
                      </div>
                    </div>

                    <div>
                      <p className="text-xs font-medium text-zinc-400 mb-2">
                        Piste audio
                      </p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {anime.audioTracks.map((track: AudioTrack) => (
                          <button
                            key={track}
                            type="button"
                            onClick={() => onUpdatePreferences({ audio: track })}
                            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                              preferences.audio === track
                                ? 'bg-[#FF5E1A] text-white'
                                : 'bg-white/8 text-zinc-300 hover:bg-white/14'
                            }`}
                          >
                            {track === 'VOSTFR'
                              ? 'Japonais (VOSTFR)'
                              : 'Français (VF)'}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-xs font-medium text-zinc-400 mb-2">
                        Vitesse de lecture
                      </p>
                      <div className="grid grid-cols-5 gap-1">
                        {[0.75, 1, 1.25, 1.5, 2].map((rate) => (
                          <button
                            key={rate}
                            type="button"
                            onClick={() =>
                              onUpdatePreferences({ playbackRate: rate })
                            }
                            className={`px-1.5 py-1.5 rounded-md text-xs font-mono tabular-nums transition-colors cursor-pointer ${
                              preferences.playbackRate === rate
                                ? 'bg-[#FF5E1A] text-white'
                                : 'bg-white/8 text-zinc-300 hover:bg-white/14'
                            }`}
                          >
                            {rate}x
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-white/10">
                      <span className="text-xs text-zinc-300">
                        Enchaîner l’épisode suivant
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          onUpdatePreferences({
                            autoplayNext: !preferences.autoplayNext,
                          })
                        }
                        className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer ${
                          preferences.autoplayNext
                            ? 'bg-[#FF5E1A] text-white'
                            : 'bg-white/10 text-zinc-400'
                        }`}
                      >
                        {preferences.autoplayNext ? 'Activé' : 'Désactivé'}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Episodes Side Drawer */}
      {showEpisodesDrawer ? (
        <aside className="absolute top-0 right-0 bottom-0 z-30 w-full max-w-sm bg-[#111319]/96 backdrop-blur-md border-l border-white/10 flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
            <div className="min-w-0">
              <p className="text-xs text-zinc-400 truncate">{anime.title}</p>
              <h3 className="text-sm font-display font-semibold text-white">
                Saison {drawerSeasonNum} · {drawerEpisodes.length} épisodes
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setShowEpisodesDrawer(false)}
              aria-label="Fermer la liste des épisodes"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          {seasons.length > 1 ? (
            <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-white/10 overflow-x-auto no-scrollbar shrink-0">
              {seasons.map((s) => {
                const isSeasonUpcoming =
                  s.status === 'À venir' ||
                  s.episodes.filter((e) => !e.isUpcoming).length === 0;
                if (isSeasonUpcoming) {
                  return (
                    <button
                      key={s.id}
                      type="button"
                      disabled
                      className="px-3 min-h-[36px] rounded-lg text-xs font-medium whitespace-nowrap shrink-0 flex items-center gap-1 bg-white/3 text-zinc-500 cursor-not-allowed"
                    >
                      <Clock className="w-3 h-3 text-amber-400/80" />
                      <span>S{s.seasonNumber} · À venir</span>
                    </button>
                  );
                }
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setDrawerSeasonNum(s.seasonNumber)}
                    className={`px-3 min-h-[36px] rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      s.seasonNumber === drawerSeasonNum
                        ? 'bg-[#FF5E1A] text-white'
                        : 'bg-white/6 text-zinc-300 hover:bg-white/12'
                    }`}
                  >
                    Saison {s.seasonNumber}
                  </button>
                );
              })}
            </div>
          ) : null}
          <div className="flex-1 overflow-y-auto divide-y divide-white/8">
            {drawerEpisodes.map((ep) => {
              const prog = progressByEpisode[ep.id];
              const pct =
                prog && ep.duration > 0
                  ? Math.min(100, (prog.currentTime / ep.duration) * 100)
                  : 0;
              const isCurrent = ep.id === episode.id;
              return (
                <button
                  key={ep.id}
                  type="button"
                  onClick={() => {
                    onSelectEpisode(
                      ep,
                      prog && !prog.completed ? prog.currentTime : 0
                    );
                    setShowEpisodesDrawer(false);
                  }}
                  className={`w-full text-left p-4 transition-colors cursor-pointer ${
                    isCurrent ? 'bg-white/8' : 'hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs font-mono tabular-nums text-[#FF5E1A]">
                      S{ep.season} E{ep.number}
                    </span>
                    <span className="text-xs font-mono tabular-nums text-zinc-400">
                      {prog?.completed
                        ? 'Terminé'
                        : prog && prog.currentTime > 3
                          ? `Reprise ${formatTimecode(prog.currentTime)}`
                          : formatTimecode(ep.duration)}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-white mb-1">
                    {ep.title}
                  </p>
                  <p className="text-xs text-zinc-400 line-clamp-2">
                    {ep.synopsis}
                  </p>
                  {pct > 0 ? (
                    <div className="mt-2.5 h-1 w-full bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#FF5E1A]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  ) : null}
                </button>
              );
            })}
            {activeDrawerSeason?.status === 'En cours' &&
            activeDrawerSeason.nextAiringEpisode &&
            activeDrawerSeason.nextAiringEpisode > drawerEpisodes.length ? (
              <div className="p-4 opacity-75 select-none flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-mono tabular-nums text-amber-300">
                    Épisode {activeDrawerSeason.nextAiringEpisode} · À venir
                  </p>
                  <p className="text-xs text-zinc-400 truncate mt-0.5">
                    {formatAiringDateFr(activeDrawerSeason.nextAiringAt)}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400 shrink-0">
                  <Clock className="w-3.5 h-3.5 text-amber-400" />
                  Indisponible
                </span>
              </div>
            ) : null}
          </div>
        </aside>
      ) : null}
    </div>
  );
}
