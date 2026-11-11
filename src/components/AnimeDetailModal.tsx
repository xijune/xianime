import { useEffect, useMemo, useState } from 'react';
import { Bookmark, Check, Film, Play, RotateCcw, X } from 'lucide-react';
import {
  formatRemainingMinutes,
  formatTimecode,
  type AnimeSeries,
  type Episode,
} from '../data/animeCatalog';
import { enrichAnimeEpisodesFromJikan } from '../services/anilistApi';
import type { EpisodeProgress } from '../hooks/useWatchProgress';
import { ArtworkImage } from './ArtworkImage';

interface AnimeDetailModalProps {
  anime: AnimeSeries;
  inWatchlist: boolean;
  progressByEpisode: Record<string, EpisodeProgress>;
  latestProgress?: EpisodeProgress;
  onToggleWatchlist: (anime: AnimeSeries) => void;
  onPlayEpisode: (
    anime: AnimeSeries,
    episode: Episode,
    startAt?: number,
    mode?: 'video' | 'trailer' | 'canvas'
  ) => void;
  onClose: () => void;
}

export function AnimeDetailModal({
  anime,
  inWatchlist,
  progressByEpisode,
  latestProgress,
  onToggleWatchlist,
  onPlayEpisode,
  onClose,
}: AnimeDetailModalProps) {
  const [episodes, setEpisodes] = useState<Episode[]>(anime.episodes);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);

  useEffect(() => {
    setEpisodes(anime.episodes);
    let cancelled = false;
    if (anime.malId) {
      setLoadingEpisodes(true);
      void enrichAnimeEpisodesFromJikan(anime).then((enriched) => {
        if (!cancelled) {
          setEpisodes(enriched);
          setLoadingEpisodes(false);
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [anime]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const enrichedAnime = useMemo(
    () => ({ ...anime, episodes }),
    [anime, episodes]
  );

  const primaryEpisode = useMemo(() => {
    if (latestProgress) {
      const match = episodes.find((ep) => ep.id === latestProgress.episodeId);
      if (match && !latestProgress.completed) {
        return { episode: match, startAt: latestProgress.currentTime };
      }
    }
    return { episode: episodes[0], startAt: 0 };
  }, [episodes, latestProgress]);

  const isResumingPrimary = primaryEpisode.startAt > 3;

  return (
    <div
      className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-4xl bg-[#111319] border border-white/10 rounded-2xl overflow-hidden shadow-2xl my-auto max-h-[90vh] flex flex-col">
        {/* Top Hero Banner */}
        <div className="relative aspect-[16/9] max-h-[340px] w-full shrink-0 overflow-hidden bg-black">
          <ArtworkImage
            src={anime.keyVisual || anime.posterImage}
            alt={anime.title}
            title={anime.title}
            accentTint={anime.accentTint}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#111319] via-[#111319]/50 to-black/35" />

          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer les détails"
            className="absolute top-4 right-4 p-2.5 rounded-lg bg-black/65 hover:bg-black/85 text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="absolute inset-x-0 bottom-0 p-6 sm:p-8">
            <p className="text-xs text-zinc-300 mb-2">
              {anime.genres.join(' · ')} · {anime.year} · {anime.studio} ·{' '}
              {anime.episodesCount} ép. · {anime.audioTracks.join(' / ')}
            </p>
            <h2 className="text-2xl sm:text-4xl font-display font-bold text-white tracking-tight mb-4">
              {anime.title}
            </h2>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() =>
                  onPlayEpisode(
                    enrichedAnime,
                    primaryEpisode.episode,
                    primaryEpisode.startAt
                  )
                }
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#FF5E1A] hover:bg-[#e85112] text-white text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>
                  {isResumingPrimary
                    ? `Reprendre S${primaryEpisode.episode.season} E${primaryEpisode.episode.number} · ${formatTimecode(primaryEpisode.startAt)}`
                    : `Regarder S${primaryEpisode.episode.season} E${primaryEpisode.episode.number}`}
                </span>
              </button>

              {anime.trailerYoutubeId ? (
                <button
                  type="button"
                  onClick={() =>
                    onPlayEpisode(
                      enrichedAnime,
                      primaryEpisode.episode,
                      0,
                      'trailer'
                    )
                  }
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white/12 hover:bg-white/20 text-white text-sm font-medium transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Film className="w-4 h-4" />
                  <span>Bande-annonce</span>
                </button>
              ) : null}

              <button
                type="button"
                onClick={() => onToggleWatchlist(enrichedAnime)}
                className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  inWatchlist
                    ? 'bg-white/12 border-white/25 text-white'
                    : 'bg-black/40 border-white/15 text-zinc-200 hover:bg-white/10'
                }`}
              >
                {inWatchlist ? (
                  <>
                    <Check className="w-4 h-4 text-[#FF5E1A]" />
                    <span>Dans ma liste</span>
                  </>
                ) : (
                  <>
                    <Bookmark className="w-4 h-4" />
                    <span>Ajouter à ma liste</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="p-6 sm:p-8 overflow-y-auto space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <p className="md:col-span-2 text-sm sm:text-base text-zinc-300 leading-relaxed">
              {anime.synopsis}
            </p>
            <div className="space-y-2 text-xs text-zinc-400 border-t md:border-t-0 md:border-l border-white/10 pt-4 md:pt-0 md:pl-6">
              <p>
                <span className="text-zinc-500">Titre original :</span>{' '}
                <span className="text-zinc-200">{anime.originalTitle}</span>
              </p>
              <p>
                <span className="text-zinc-500">Statut :</span>{' '}
                <span className="text-zinc-200">{anime.status}</span>
              </p>
              <p>
                <span className="text-zinc-500">Diffusion :</span>{' '}
                <span className="text-zinc-200 tabular-nums">
                  {anime.simulcastDay} à {anime.simulcastTime}
                </span>
              </p>
              <p>
                <span className="text-zinc-500">Note AniList :</span>{' '}
                <span className="text-zinc-200 tabular-nums">{anime.score} / 10</span>
              </p>
            </div>
          </div>

          {/* Episodes List */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/10 mb-4">
              <h3 className="text-lg font-display font-semibold text-white">
                Épisodes ({episodes.length})
              </h3>
              {loadingEpisodes ? (
                <span className="text-xs text-zinc-400">
                  Synchronisation des titres d’épisodes…
                </span>
              ) : null}
            </div>

            <div className="divide-y divide-white/8">
              {episodes.map((ep) => {
                const prog = progressByEpisode[ep.id];
                const hasSavedPos = Boolean(
                  prog && !prog.completed && prog.currentTime > 3
                );
                const pct =
                  prog && ep.duration > 0
                    ? Math.min(100, (prog.currentTime / ep.duration) * 100)
                    : 0;

                return (
                  <div
                    key={ep.id}
                    className="py-4 flex flex-col sm:flex-row sm:items-center gap-4 group"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        onPlayEpisode(
                          enrichedAnime,
                          ep,
                          hasSavedPos ? prog!.currentTime : 0
                        )
                      }
                      className="relative w-full sm:w-44 aspect-video rounded-lg overflow-hidden bg-black shrink-0 cursor-pointer"
                    >
                      <ArtworkImage
                        src={ep.thumbnail || anime.keyVisual || anime.posterImage}
                        alt={ep.title}
                        title={ep.title}
                        accentTint={anime.accentTint}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                      />
                      <div className="absolute inset-0 bg-black/35 group-hover:bg-black/20 flex items-center justify-center transition-colors">
                        <div className="w-10 h-10 rounded-full bg-black/70 border border-white/25 flex items-center justify-center text-white">
                          <Play className="w-4 h-4 fill-current ml-0.5" />
                        </div>
                      </div>
                      {pct > 0 ? (
                        <div className="absolute inset-x-0 bottom-0 h-1 bg-white/25">
                          <div
                            className="h-full bg-[#FF5E1A]"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      ) : null}
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400 mb-1">
                        <span className="font-mono tabular-nums text-zinc-300">
                          Épisode {ep.number}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {formatTimecode(ep.duration)}
                        </span>
                        {hasSavedPos ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums text-[#FF5E1A]">
                              En pause à {formatTimecode(prog!.currentTime)} (
                              {formatRemainingMinutes(
                                prog!.currentTime,
                                ep.duration
                              )}
                              )
                            </span>
                          </>
                        ) : prog?.completed ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-emerald-400">Terminé</span>
                          </>
                        ) : null}
                      </div>

                      <h4 className="text-base font-medium text-white mb-1">
                        {ep.title}
                      </h4>
                      <p className="text-xs sm:text-sm text-zinc-400 line-clamp-2">
                        {ep.synopsis}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          onPlayEpisode(
                            enrichedAnime,
                            ep,
                            hasSavedPos ? prog!.currentTime : 0
                          )
                        }
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white/8 hover:bg-[#FF5E1A] text-white text-xs font-medium transition-colors whitespace-nowrap cursor-pointer"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>
                          {hasSavedPos
                            ? `Reprendre (${formatTimecode(prog!.currentTime)})`
                            : 'Regarder'}
                        </span>
                      </button>

                      {hasSavedPos ? (
                        <button
                          type="button"
                          onClick={() => onPlayEpisode(enrichedAnime, ep, 0)}
                          title="Recommencer depuis le début"
                          aria-label="Recommencer l'épisode depuis le début"
                          className="p-2 rounded-lg bg-white/6 hover:bg-white/14 text-zinc-300 transition-colors cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
