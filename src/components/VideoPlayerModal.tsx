import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronRight,
  FastForward,
  Film,
  Link2,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  Settings,
  SkipForward,
  Square,
  Subtitles,
  Upload,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  formatTimecode,
  type AnimeSeries,
  type AudioTrack,
  type Episode,
  type ParticleTheme,
  type VideoQuality,
} from '../data/animeCatalog';
import Hls from 'hls.js';
import type { EpisodeProgress, PlayerPreferences } from '../hooks/useWatchProgress';
import { resolveEpisodeVideoUrl } from '../services/videoSourceResolver';

type PlayerMode = 'video' | 'trailer' | 'canvas';

function isHlsUrl(url: string): boolean {
  return /\.m3u8(\?.*)?$/i.test(url) || url.toLowerCase().includes('.m3u8');
}

interface VideoPlayerModalProps {
  anime: AnimeSeries;
  episode: Episode;
  initialTime: number;
  initialMode?: PlayerMode;
  preferences: PlayerPreferences;
  progressByEpisode: Record<string, EpisodeProgress>;
  onUpdatePreferences: (patch: Partial<PlayerPreferences>) => void;
  onSaveProgress: (
    anime: AnimeSeries,
    episode: Episode,
    currentTime: number,
    duration: number,
    videoMeta?: { customVideoUrl?: string; customVideoName?: string }
  ) => void;
  onMarkCompleted: (anime: AnimeSeries, episode: Episode, duration: number) => void;
  onSelectEpisode: (episode: Episode, startAt?: number) => void;
  onClose: () => void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  phase: number;
}

function createParticles(theme: ParticleTheme, count: number): Particle[] {
  const list: Particle[] = [];
  for (let i = 0; i < count; i++) {
    list.push({
      x: Math.random(),
      y: Math.random(),
      vx:
        theme === 'rain'
          ? -0.0025
          : theme === 'cyber'
            ? 0.005 + Math.random() * 0.008
            : theme === 'petals'
              ? 0.001 + Math.random() * 0.0015
              : (Math.random() - 0.5) * 0.0008,
      vy:
        theme === 'rain'
          ? 0.018 + Math.random() * 0.015
          : theme === 'embers'
            ? -(0.002 + Math.random() * 0.004)
            : theme === 'lanterns'
              ? -(0.0005 + Math.random() * 0.0009)
              : theme === 'petals'
                ? 0.0015 + Math.random() * 0.002
                : 0.0002,
      size: Math.random() * 3 + 1.2,
      alpha: Math.random() * 0.6 + 0.25,
      phase: Math.random() * Math.PI * 2,
    });
  }
  return list;
}

export function VideoPlayerModal({
  anime,
  episode,
  initialTime,
  initialMode,
  preferences,
  progressByEpisode,
  onUpdatePreferences,
  onSaveProgress,
  onMarkCompleted,
  onSelectEpisode,
  onClose,
}: VideoPlayerModalProps) {
  const savedEpEntry = progressByEpisode[episode.id];
  const initialExternalUrl =
    savedEpEntry?.customVideoUrl ?? episode.videoUrl ?? '';

  const [mode, setMode] = useState<PlayerMode>(() => {
    if (initialMode) return initialMode;
    if (initialExternalUrl) return 'video';
    if (anime.trailerYoutubeId) return 'trailer';
    return 'canvas';
  });

  const [videoSrc, setVideoSrc] = useState<string>(initialExternalUrl);
  const [videoFileName, setVideoFileName] = useState<string>(
    savedEpEntry?.customVideoName ?? ''
  );
  const [urlInputOpen, setUrlInputOpen] = useState(false);
  const [urlDraft, setUrlDraft] = useState(initialExternalUrl);
  const [videoError, setVideoError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const particlesRef = useRef<Particle[]>(createParticles(anime.particleTheme, 90));
  const savedNoticeTimerRef = useRef<number | null>(null);
  const blobUrlRef = useRef<string | null>(null);

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
  const progressMapRef = useRef(progressByEpisode);
  progressMapRef.current = progressByEpisode;

  const nextEpisode = useMemo(() => {
    const idx = anime.episodes.findIndex((e) => e.id === episode.id);
    if (idx >= 0 && idx < anime.episodes.length - 1) {
      return anime.episodes[idx + 1];
    }
    return null;
  }, [anime.episodes, episode.id]);

  // Reset state ONLY when switching to a different episode
  useEffect(() => {
    if (lastEpisodeIdRef.current === episode.id) return;
    lastEpisodeIdRef.current = episode.id;

    const entry = progressMapRef.current[episode.id];
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

    const resolvedDirect = entry?.customVideoUrl ?? episode.videoUrl ?? '';
    if (resolvedDirect) {
      setVideoSrc(resolvedDirect);
      setVideoFileName(entry?.customVideoName ?? '');
      setUrlDraft(resolvedDirect);
      if (!initialMode) setMode('video');
    } else if (!blobUrlRef.current) {
      setVideoSrc('');
      setVideoFileName(entry?.customVideoName ?? '');
      setUrlDraft('');
      if (!initialMode) {
        setMode(anime.trailerYoutubeId ? 'trailer' : 'canvas');
      }
    }
    particlesRef.current = createParticles(anime.particleTheme, 90);
  }, [anime.particleTheme, anime.trailerYoutubeId, episode.duration, episode.id, episode.videoUrl, initialMode, initialTime]);

  // Automatic lookup via central videoSourceResolver.ts
  useEffect(() => {
    if (initialMode === 'trailer') return;
    const entry = progressMapRef.current[episode.id];
    if (entry?.customVideoUrl || blobUrlRef.current) return;

    let cancelled = false;
    void resolveEpisodeVideoUrl(anime, episode).then((url) => {
      if (cancelled || !url) return;
      setVideoSrc(url);
      setUrlDraft(url);
      setMode('video');
      setIsPlaying(true);
      isPlayingRef.current = true;
    });

    return () => {
      cancelled = true;
    };
  }, [anime, episode, initialMode]);

  // Cleanup any created object URL & timer on unmount
  useEffect(() => {
    return () => {
      if (savedNoticeTimerRef.current) {
        window.clearTimeout(savedNoticeTimerRef.current);
      }
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
      }
    };
  }, []);

  // Load key visual for canvas cinema mode (no crossOrigin so CDN images never fail CORS)
  useEffect(() => {
    let cancelled = false;
    const primarySrc = episode.thumbnail || anime.keyVisual || anime.posterImage;
    const fallbackSrc = anime.keyVisual || anime.posterImage;

    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
      if (!cancelled) imageRef.current = img;
    };
    img.onerror = () => {
      if (cancelled || primarySrc === fallbackSrc || !fallbackSrc) return;
      const fb = new Image();
      fb.referrerPolicy = 'no-referrer';
      fb.onload = () => {
        if (!cancelled) imageRef.current = fb;
      };
      fb.src = fallbackSrc;
    };
    img.src = primarySrc;

    return () => {
      cancelled = true;
    };
  }, [episode.thumbnail, anime.keyVisual, anime.posterImage]);

  // Attach video source (supports .m3u8 via hls.js or native Safari HLS, plus .mp4/.webm/blob)
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || mode !== 'video' || !videoSrc) return;

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
    // AJOUT CRUCIAL : On fait croire au CDN qu'on est sur VoirAnime
    xhrSetup: function (xhr, url) {
      xhr.setRequestHeader('Referer', 'https://voir-anime.to/');
      xhr.setRequestHeader('Origin', 'https://voir-anime.to');
    }
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
                'Erreur réseau ou CORS lors du chargement du flux .m3u8. Vérifiez que le serveur autorise la lecture.'
              );
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              hls.recoverMediaError();
              return;
            } else {
              setVideoError(
                'Impossible de décoder ce flux .m3u8. Essayez une autre URL vidéo.'
              );
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
  }, [mode, videoSrc, onUpdatePreferences]);

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
    if (!vid || mode !== 'video' || !videoSrc) return;
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
    mode,
    videoSrc,
    preferences.volume,
    preferences.muted,
    preferences.playbackRate,
  ]);

  // Save progress periodically while playing AND on unmount
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (isPlayingRef.current && mode !== 'trailer') {
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
      if (mode !== 'trailer') {
        onSaveProgress(
          anime,
          episode,
          currentTimeRef.current,
          durationRef.current
        );
      }
    };
  }, [anime, episode, mode, onSaveProgress]);

  // Canvas HD clock & renderer (active in 'canvas' mode)
  useEffect(() => {
    if (mode !== 'canvas') return;

    let rafId = 0;
    let lastTs = performance.now();
    let lastUiSync = currentTimeRef.current;

    const resolutionMap: Record<VideoQuality, { w: number; h: number }> = {
      Auto: { w: 1920, h: 1080 },
      '1080p': { w: 1920, h: 1080 },
      '720p': { w: 1280, h: 720 },
      '480p': { w: 854, h: 480 },
    };

    const renderFrame = (now: number) => {
      const dt = Math.min(0.1, (now - lastTs) / 1000);
      lastTs = now;

      let t = currentTimeRef.current;
      const dur = durationRef.current;
      if (isPlayingRef.current) {
        t = Math.min(dur, t + dt * preferences.playbackRate);
        currentTimeRef.current = t;
        if (Math.abs(t - lastUiSync) >= 0.25 || t >= dur) {
          lastUiSync = t;
          setCurrentTime(t);
        }

        if (t >= dur) {
          isPlayingRef.current = false;
          setIsPlaying(false);
          onMarkCompleted(anime, episode, dur);
        }
      }

      const canvas = canvasRef.current;
      if (canvas) {
        const res = resolutionMap[preferences.quality];
        if (canvas.width !== res.w || canvas.height !== res.h) {
          canvas.width = res.w;
          canvas.height = res.h;
        }
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const w = canvas.width;
          const h = canvas.height;

          ctx.fillStyle = '#07080B';
          ctx.fillRect(0, 0, w, h);

          const img = imageRef.current;
          if (img) {
            const chapter = Math.floor(t / 45);
            const chapterProgress = (t % 45) / 45;
            const zoom =
              chapter % 2 === 0
                ? 1.04 + chapterProgress * 0.08
                : 1.12 - chapterProgress * 0.06;
            const panX = Math.sin(t * 0.09 + chapter) * (w * 0.018);
            const panY = Math.cos(t * 0.07) * (h * 0.012);

            const drawW = w * zoom;
            const drawH = h * zoom;
            const dx = (w - drawW) / 2 + panX;
            const dy = (h - drawH) / 2 + panY;

            ctx.save();
            ctx.filter =
              t >= episode.introStart && t <= episode.introEnd
                ? 'contrast(1.06) saturate(1.12)'
                : 'contrast(1.03) saturate(1.04)';
            ctx.drawImage(img, dx, dy, drawW, drawH);
            ctx.restore();
          }

          const vig = ctx.createRadialGradient(
            w * 0.5,
            h * 0.5,
            w * 0.25,
            w * 0.5,
            h * 0.5,
            w * 0.72
          );
          vig.addColorStop(0, 'rgba(0,0,0,0)');
          vig.addColorStop(1, 'rgba(5,6,9,0.52)');
          ctx.fillStyle = vig;
          ctx.fillRect(0, 0, w, h);

          const particles = particlesRef.current;
          const moveScale = isPlayingRef.current
            ? dt * 60 * preferences.playbackRate
            : 0;
          const theme = anime.particleTheme;

          for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            p.x += p.vx * moveScale;
            p.y += p.vy * moveScale;
            if (theme === 'petals' || theme === 'lanterns') {
              p.x += Math.sin(t * 1.4 + p.phase) * 0.0004 * moveScale;
            }
            if (p.x > 1.05) p.x = -0.05;
            if (p.x < -0.05) p.x = 1.05;
            if (p.y > 1.05) p.y = -0.05;
            if (p.y < -0.05) p.y = 1.05;

            const px = p.x * w;
            const py = p.y * h;
            const scale = w / 1280;

            if (theme === 'rain') {
              ctx.strokeStyle = `rgba(195, 220, 255, ${p.alpha * 0.48})`;
              ctx.lineWidth = 1.2 * scale;
              ctx.beginPath();
              ctx.moveTo(px, py);
              ctx.lineTo(px - 6 * scale, py + 28 * scale);
              ctx.stroke();
            } else if (theme === 'cyber') {
              ctx.fillStyle = `rgba(245, 158, 11, ${p.alpha * 0.55})`;
              ctx.fillRect(px, py, p.size * 9 * scale, 1.5 * scale);
            } else if (theme === 'embers') {
              ctx.fillStyle = `rgba(255, 120, 40, ${p.alpha * 0.8})`;
              ctx.beginPath();
              ctx.arc(px, py, p.size * 1.1 * scale, 0, Math.PI * 2);
              ctx.fill();
            } else if (theme === 'lanterns') {
              ctx.fillStyle = `rgba(255, 210, 120, ${p.alpha * 0.55})`;
              ctx.beginPath();
              ctx.arc(px, py, p.size * 2 * scale, 0, Math.PI * 2);
              ctx.fill();
            } else if (theme === 'petals') {
              ctx.fillStyle = `rgba(255, 196, 175, ${p.alpha * 0.65})`;
              ctx.beginPath();
              ctx.ellipse(
                px,
                py,
                p.size * 1.8 * scale,
                p.size * 0.9 * scale,
                p.phase + t * 0.8,
                0,
                Math.PI * 2
              );
              ctx.fill();
            } else {
              ctx.fillStyle = `rgba(255, 248, 220, ${p.alpha * 0.4})`;
              ctx.beginPath();
              ctx.arc(px, py, p.size * 1.6 * scale, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
      }

      rafId = window.requestAnimationFrame(renderFrame);
    };

    rafId = window.requestAnimationFrame(renderFrame);
    return () => window.cancelAnimationFrame(rafId);
  }, [
    anime,
    episode,
    mode,
    onMarkCompleted,
    preferences.playbackRate,
    preferences.quality,
  ]);

  // Auto-countdown to next episode near end
  useEffect(() => {
    if (mode === 'trailer' || !nextEpisode || !preferences.autoplayNext) {
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
    mode,
    nextEpisode,
    onSelectEpisode,
    preferences.autoplayNext,
  ]);

  // Controls auto-hide timer
  useEffect(() => {
    if (!isPlaying || showSettings || showEpisodesDrawer || mode === 'trailer') {
      setShowControls(true);
      return;
    }
    if (!showControls) return;
    const timer = window.setTimeout(() => setShowControls(false), 3200);
    return () => window.clearTimeout(timer);
  }, [isPlaying, mode, showControls, showSettings, showEpisodesDrawer]);

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
    if (mode === 'trailer') return;
    const next = !isPlayingRef.current;
    isPlayingRef.current = next;
    setIsPlaying(next);

    if (!next) {
      onSaveProgress(anime, episode, currentTimeRef.current, durationRef.current);
      showSavedToast(currentTimeRef.current);
    }
  }, [anime, episode, mode, onSaveProgress, showSavedToast]);

  const handleStopAndExit = useCallback(() => {
    isPlayingRef.current = false;
    setIsPlaying(false);
    if (mode !== 'trailer') {
      onSaveProgress(anime, episode, currentTimeRef.current, durationRef.current);
    }
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
    onClose();
  }, [anime, episode, mode, onClose, onSaveProgress]);

  const seekTo = useCallback(
    (target: number) => {
      const clamped = Math.max(0, Math.min(target, durationRef.current));
      currentTimeRef.current = clamped;
      setCurrentTime(clamped);
      if (mode === 'video' && videoRef.current) {
        videoRef.current.currentTime = clamped;
      }
      onSaveProgress(anime, episode, clamped, durationRef.current);
    },
    [anime, episode, mode, onSaveProgress]
  );

  const handleLocalFilePicked = (file: File) => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
    }
    const objUrl = URL.createObjectURL(file);
    blobUrlRef.current = objUrl;
    setVideoSrc(objUrl);
    setVideoFileName(file.name);
    setVideoError(null);
    setMode('video');
    setIsPlaying(true);
    isPlayingRef.current = true;
    onSaveProgress(anime, episode, currentTimeRef.current, durationRef.current, {
      customVideoName: file.name,
    });
  };

  const handleApplyDirectUrl = () => {
    const clean = urlDraft.trim();
    if (!clean) return;
    setVideoSrc(clean);
    setVideoFileName('Flux vidéo externe');
    setVideoError(null);
    setUrlInputOpen(false);
    setMode('video');
    setIsPlaying(true);
    isPlayingRef.current = true;
    onSaveProgress(anime, episode, currentTimeRef.current, durationRef.current, {
      customVideoUrl: clean,
      customVideoName: 'Flux vidéo externe',
    });
  };

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      void containerRef.current.requestFullscreen().catch(() => {});
    } else {
      void document.exitFullscreen().catch(() => {});
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
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
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
        if (showSettings || showEpisodesDrawer || urlInputOpen) {
          setShowSettings(false);
          setShowEpisodesDrawer(false);
          setUrlInputOpen(false);
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
    urlInputOpen,
  ]);

  const activeSubtitle = useMemo(() => {
    if (preferences.subtitleLang === 'off' || mode === 'trailer') return null;
    const cue = episode.cues.find(
      (c) => currentTime >= c.start && currentTime <= c.end
    );
    if (!cue) return null;
    return preferences.subtitleLang === 'jp' ? cue.jp : cue.fr;
  }, [currentTime, episode.cues, mode, preferences.subtitleLang]);

  const inIntro =
    mode !== 'trailer' &&
    currentTime >= episode.introStart &&
    currentTime <= episode.introEnd;
  const progressPct =
    duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div
      ref={containerRef}
      onMouseMove={() => setShowControls(true)}
      className="fixed inset-0 z-50 bg-black flex flex-col justify-center items-center select-none overflow-hidden"
    >
      {/* Hidden local video file picker */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,.mp4,.webm,.mkv,.mov"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleLocalFilePicked(file);
        }}
      />

      {/* Main Cinema Stage */}
      <div
        className="relative w-full h-full flex items-center justify-center bg-black"
        onClick={(e) => {
          const tag = (e.target as HTMLElement).tagName;
          if (e.target === e.currentTarget || tag === 'CANVAS' || tag === 'VIDEO') {
            setShowSettings(false);
            setShowEpisodesDrawer(false);
            handlePauseAndSave();
          }
        }}
      >
        {mode === 'trailer' && anime.trailerYoutubeId ? (
          <div className="w-full h-full pt-16 pb-6 px-2 sm:px-8 flex flex-col items-center justify-center gap-3">
            <iframe
              title={`Bande-annonce — ${anime.title}`}
              src={`https://www.youtube.com/embed/${anime.trailerYoutubeId}?rel=0&playsinline=1`}
              referrerPolicy="strict-origin-when-cross-origin"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="w-full max-w-6xl aspect-video rounded-xl border border-white/10 bg-black"
            />
            <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-zinc-400 text-center">
              <span>
                Bande-annonce officielle (AniList ne fournit pas les épisodes complets sous licence).
              </span>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-white hover:text-[#FF5E1A] underline font-medium cursor-pointer"
              >
                Charger un fichier vidéo (.mp4 / .webm)
              </button>
              <a
                href={`https://www.youtube.com/watch?v=${anime.trailerYoutubeId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#FF5E1A] hover:underline font-medium"
              >
                Ouvrir sur YouTube
              </a>
            </div>
          </div>
        ) : mode === 'video' && videoSrc ? (
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
              setVideoError(
                'Impossible de lire ce flux vidéo. Vérifiez le format (.mp4 / .webm) ou importez un fichier local.'
              );
              isPlayingRef.current = false;
              setIsPlaying(false);
            }}
            className="max-w-full max-h-full w-full h-full object-contain cursor-pointer"
          />
        ) : (
          <>
            <canvas
              ref={canvasRef}
              className="max-w-full max-h-full w-full h-full object-contain cursor-pointer"
            />
            {showControls ? (
              <div className="absolute left-5 bottom-28 z-20 max-w-md rounded-xl bg-black/80 backdrop-blur-sm border border-white/12 px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
                <p className="text-xs text-zinc-300 leading-snug">
                  Mode Aperçu · Chargez un fichier <strong className="text-white">.mp4 / .webm</strong> pour lire votre épisode en HD.
                </p>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                  className="px-3 py-1.5 rounded-lg bg-[#FF5E1A] hover:bg-[#e85112] text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Charger un fichier
                </button>
              </div>
            ) : null}
          </>
        )}

        {/* Top Cinema Bar */}
        <div
          className={`absolute inset-x-0 top-0 z-20 flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-3.5 bg-gradient-to-b from-black/95 via-black/70 to-transparent transition-opacity duration-200 ${
            showControls || mode === 'trailer'
              ? 'opacity-100'
              : 'opacity-0 pointer-events-none'
          }`}
        >
          <div className="min-w-0 max-w-md">
            <p className="text-xs font-medium text-zinc-300 truncate">
              {anime.title} · S{episode.season} E{episode.number} · {preferences.quality} HD
            </p>
            <h2 className="text-sm sm:text-base font-display font-semibold text-white truncate">
              {episode.title}
            </h2>
          </div>

          {/* Source & Mode Switcher */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="flex items-center gap-1 p-1 rounded-lg bg-white/10">
              {anime.trailerYoutubeId ? (
                <button
                  type="button"
                  onClick={() => setMode('trailer')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    mode === 'trailer'
                      ? 'bg-[#FF5E1A] text-white'
                      : 'text-zinc-200 hover:text-white'
                  }`}
                >
                  Bande-annonce
                </button>
              ) : null}

              <button
                type="button"
                onClick={() => {
                  if (videoSrc) {
                    setMode('video');
                  } else {
                    fileInputRef.current?.click();
                  }
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  mode === 'video'
                    ? 'bg-[#FF5E1A] text-white'
                    : 'text-zinc-200 hover:text-white'
                }`}
              >
                <Upload className="w-3 h-3" />
                <span>{videoSrc ? 'Fichier vidéo' : 'Charger .mp4'}</span>
              </button>

              <button
                type="button"
                onClick={() => setMode('canvas')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  mode === 'canvas'
                    ? 'bg-[#FF5E1A] text-white'
                    : 'text-zinc-200 hover:text-white'
                }`}
              >
                <Film className="w-3 h-3" />
                <span>Aperçu</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setUrlInputOpen((prev) => !prev)}
              title="Lire une URL vidéo (.m3u8, .mp4, .webm)"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition-colors whitespace-nowrap cursor-pointer"
            >
              <Link2 className="w-3.5 h-3.5" />
              <span className="hidden md:inline">URL / M3U8</span>
            </button>

            <button
              type="button"
              onClick={handleStopAndExit}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-[#FF5E1A] text-white text-xs font-medium transition-colors whitespace-nowrap cursor-pointer"
            >
              <Square className="w-3 h-3 fill-current" />
              <span>Arrêter et sauvegarder</span>
            </button>

            <button
              type="button"
              onClick={() => setShowEpisodesDrawer((prev) => !prev)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition-colors whitespace-nowrap cursor-pointer"
            >
              <span>Épisodes</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={handleStopAndExit}
              aria-label="Fermer le lecteur"
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Direct MP4/WebM URL Bar */}
        {urlInputOpen ? (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 w-full max-w-lg px-4">
            <div className="rounded-xl bg-[#13151B] border border-white/15 p-3 shadow-2xl flex items-center gap-2">
              <input
                type="url"
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleApplyDirectUrl();
                }}
                placeholder="https://exemple.com/flux.m3u8 ou episode.mp4"
                className="flex-1 bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#FF5E1A]"
              />
              <button
                type="button"
                onClick={handleApplyDirectUrl}
                className="px-3.5 py-2 rounded-lg bg-[#FF5E1A] hover:bg-[#e85112] text-white text-xs font-semibold whitespace-nowrap cursor-pointer"
              >
                Lire
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-medium whitespace-nowrap cursor-pointer"
              >
                Fichier local
              </button>
            </div>
          </div>
        ) : null}

        {/* Saved notice toast */}
        {savedNotice ? (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded-lg bg-black/85 border border-white/15 text-xs font-medium text-white flex items-center gap-2">
            <Check className="w-3.5 h-3.5 text-[#FF5E1A]" />
            <span className="tabular-nums">{savedNotice}</span>
          </div>
        ) : null}

        {/* Video Error Banner */}
        {videoError && mode === 'video' ? (
          <div className="absolute z-20 max-w-md mx-4 rounded-xl bg-[#13151B]/95 border border-red-500/35 p-5 text-center">
            <p className="text-sm text-zinc-200 mb-4">{videoError}</p>
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 rounded-lg bg-[#FF5E1A] text-white text-xs font-semibold cursor-pointer"
              >
                Choisir un fichier vidéo
              </button>
              <button
                type="button"
                onClick={() => {
                  setVideoError(null);
                  setMode('canvas');
                }}
                className="px-4 py-2 rounded-lg bg-white/10 text-zinc-200 text-xs font-medium cursor-pointer"
              >
                Mode Aperçu
              </button>
            </div>
          </div>
        ) : null}

        {/* Prompt to re-select local file if resuming a previously uploaded local file */}
        {mode !== 'trailer' &&
        !videoSrc &&
        videoFileName &&
        !isPlaying ? (
          <div className="absolute top-20 right-6 z-20 max-w-xs rounded-xl bg-[#13151B]/95 border border-white/15 p-3.5">
            <p className="text-xs text-zinc-300 mb-2">
              Fichier précédemment utilisé : <strong className="text-white">{videoFileName}</strong>. Sélectionnez-le à nouveau pour reprendre la vidéo à {formatTimecode(currentTime)}.
            </p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1.5 rounded-lg bg-[#FF5E1A] text-white text-xs font-semibold cursor-pointer"
            >
              Recharger le fichier
            </button>
          </div>
        ) : null}

        {/* Paused Overlay */}
        {!isPlaying && mode !== 'trailer' && !showEpisodesDrawer && !videoError ? (
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
            className="absolute right-6 bottom-28 z-20 inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-black/80 hover:bg-[#FF5E1A] border border-white/20 text-white text-xs font-semibold transition-colors cursor-pointer"
          >
            <span>Passer l’intro</span>
            <FastForward className="w-3.5 h-3.5" />
          </button>
        ) : null}

        {/* Next Episode Prompt */}
        {nextCountdown !== null && nextEpisode ? (
          <div className="absolute right-6 bottom-28 z-20 flex items-center gap-3 px-4 py-3 rounded-xl bg-[#13151B]/95 border border-white/15">
            <div className="text-left">
              <p className="text-xs text-zinc-400 tabular-nums">
                Épisode suivant dans {nextCountdown}s
              </p>
              <p className="text-sm font-medium text-white">
                E{nextEpisode.number} · {nextEpisode.title}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onSelectEpisode(nextEpisode, 0)}
              className="px-3.5 py-2 rounded-lg bg-[#FF5E1A] hover:bg-[#e85112] text-white text-xs font-semibold whitespace-nowrap cursor-pointer"
            >
              Lancer maintenant
            </button>
          </div>
        ) : null}

        {/* Synchronized Subtitles */}
        {activeSubtitle ? (
          <div
            className={`absolute inset-x-0 z-10 flex justify-center px-6 pointer-events-none transition-all duration-200 ${
              showControls ? 'bottom-28' : 'bottom-10'
            }`}
          >
            <p className="px-4 py-1.5 rounded-md bg-black/75 text-white text-sm sm:text-base md:text-lg font-medium text-center max-w-3xl leading-snug shadow-sm">
              {activeSubtitle}
            </p>
          </div>
        ) : null}

        {/* Bottom Cinema Controls (hidden in YouTube trailer mode since YT has native controls) */}
        {mode !== 'trailer' ? (
          <div
            className={`absolute inset-x-0 bottom-0 z-20 px-5 pb-4 pt-12 bg-gradient-to-t from-black/95 via-black/70 to-transparent transition-opacity duration-200 ${
              showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          >
            {/* Timeline Scrubber */}
            <div
              className="relative group mb-3 py-1.5"
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
                className="kuro-range absolute inset-0 w-full h-full opacity-0 group-hover:opacity-100"
              />
            </div>

            {/* Controls Row */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 sm:gap-3">
                <button
                  type="button"
                  onClick={handlePauseAndSave}
                  aria-label={isPlaying ? 'Mettre en pause' : 'Lire'}
                  className="p-2 rounded-lg text-white hover:bg-white/10 transition-colors cursor-pointer"
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
                  className="px-2 py-1.5 rounded-lg text-xs font-mono tabular-nums text-zinc-200 hover:bg-white/10 transition-colors cursor-pointer"
                >
                  -10s
                </button>

                <button
                  type="button"
                  onClick={() => seekTo(currentTime + 10)}
                  aria-label="Avancer de 10 secondes"
                  className="px-2 py-1.5 rounded-lg text-xs font-mono tabular-nums text-zinc-200 hover:bg-white/10 transition-colors cursor-pointer"
                >
                  +10s
                </button>

                {nextEpisode ? (
                  <button
                    type="button"
                    onClick={() => onSelectEpisode(nextEpisode, 0)}
                    aria-label="Épisode suivant"
                    className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-zinc-200 hover:bg-white/10 transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <SkipForward className="w-4 h-4" />
                    <span>Suivant</span>
                  </button>
                ) : null}

                <div className="hidden md:flex items-center gap-2 ml-1">
                  <button
                    type="button"
                    onClick={() =>
                      onUpdatePreferences({ muted: !preferences.muted })
                    }
                    aria-label={
                      preferences.muted ? 'Activer le son' : 'Couper le son'
                    }
                    className="p-1.5 rounded-lg text-zinc-200 hover:bg-white/10 transition-colors cursor-pointer"
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
                    className="kuro-range w-20 h-1 bg-white/25 rounded-full"
                  />
                </div>

                <span className="ml-2 text-xs font-mono tabular-nums text-zinc-200 whitespace-nowrap">
                  {formatTimecode(currentTime)}{' '}
                  <span className="text-zinc-500">
                    / {formatTimecode(duration)}
                  </span>
                </span>
              </div>

              <div className="flex items-center gap-2 relative">
                <button
                  type="button"
                  onClick={() =>
                    onUpdatePreferences({
                      subtitleLang:
                        preferences.subtitleLang === 'fr'
                          ? 'jp'
                          : preferences.subtitleLang === 'jp'
                            ? 'off'
                            : 'fr',
                    })
                  }
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-zinc-200 hover:bg-white/10 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Subtitles className="w-4 h-4" />
                  <span>
                    {preferences.subtitleLang === 'fr'
                      ? 'ST: FR'
                      : preferences.subtitleLang === 'jp'
                        ? 'ST: JP'
                        : 'ST: Off'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowSettings((prev) => !prev)}
                  aria-label="Paramètres vidéo"
                  className={`p-2 rounded-lg transition-colors cursor-pointer ${
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
                  className="p-2 rounded-lg text-zinc-200 hover:bg-white/10 transition-colors cursor-pointer"
                >
                  {isFullscreen ? (
                    <Minimize className="w-4 h-4" />
                  ) : (
                    <Maximize className="w-4 h-4" />
                  )}
                </button>

                {showSettings ? (
                  <div className="absolute right-0 bottom-12 w-72 rounded-xl bg-[#13151B] border border-white/12 p-4 shadow-2xl space-y-4">
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
        <aside className="absolute top-0 right-0 bottom-0 z-30 w-full max-w-sm bg-[#111319]/96 backdrop-blur-md border-l border-white/10 flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
            <div>
              <p className="text-xs text-zinc-400">{anime.title}</p>
              <h3 className="text-sm font-display font-semibold text-white">
                Liste des épisodes ({anime.episodes.length})
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setShowEpisodesDrawer(false)}
              className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-white/8">
            {anime.episodes.map((ep) => {
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
          </div>
        </aside>
      ) : null}
    </div>
  );
}
