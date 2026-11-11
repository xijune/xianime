import { useEffect, useMemo, useState } from 'react';
import { Bookmark, Check, Clock, Loader2, Play, RotateCcw, X } from 'lucide-react';
import {
  formatAiringDateFr,
  formatReleaseDateFr,
  formatRemainingMinutes,
  formatTimecode,
  formatUpcomingNoticeFr,
  getSeriesSeasons,
  type AnimeSeries,
  type Episode,
} from '../data/animeCatalog';
import {
  enrichSeasonEpisodesFromJikan,
  fetchAllSeasonsForAnime,
} from '../services/anilistApi';
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
    startAt?: number
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
  const [seriesData, setSeriesData] = useState<AnimeSeries>(anime);
  const [selectedSeasonNum, setSelectedSeasonNum] = useState<number>(() => {
    if (
      latestProgress &&
      !latestProgress.completed &&
      latestProgress.currentTime > 3
    ) {
      return latestProgress.snapshot?.episode?.season || 1;
    }
    return 1;
  });
  const [enrichedBySeason, setEnrichedBySeason] = useState<Record<number, Episode[]>>({});
  const [loadingSeasons, setLoadingSeasons] = useState(false);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);

  // Load all connected seasons for this anime franchise
  useEffect(() => {
    setSeriesData(anime);
    setEnrichedBySeason({});
    let cancelled = false;

    if (anime.anilistId) {
      setLoadingSeasons(true);
      void fetchAllSeasonsForAnime(anime)
        .then((full) => {
          if (cancelled) return;
          setSeriesData(full);
          const availableSeasons = getSeriesSeasons(full);
          const firstPlayable = availableSeasons.find((s) => s.episodes.length > 0);
          const resumeSeason =
            latestProgress &&
            !latestProgress.completed &&
            latestProgress.currentTime > 3
              ? latestProgress.snapshot?.episode?.season
              : undefined;
          if (
            resumeSeason &&
            availableSeasons.some(
              (s) => s.seasonNumber === resumeSeason && s.episodes.length > 0
            )
          ) {
            setSelectedSeasonNum(resumeSeason);
          } else {
            setSelectedSeasonNum(
              firstPlayable?.seasonNumber ?? availableSeasons[0]?.seasonNumber ?? 1
            );
          }
          setLoadingSeasons(false);
        })
        .catch(() => {
          if (!cancelled) setLoadingSeasons(false);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [anime]);

  const seasons = useMemo(() => getSeriesSeasons(seriesData), [seriesData]);

  const activeSeason = useMemo(() => {
    return (
      seasons.find((s) => s.seasonNumber === selectedSeasonNum) ?? seasons[0]
    );
  }, [seasons, selectedSeasonNum]);

  // Enrich episodes of the currently selected season via Jikan
  useEffect(() => {
    if (!activeSeason) return;
    if (enrichedBySeason[activeSeason.seasonNumber]) return;
    if (!activeSeason.malId) return;

    let cancelled = false;
    setLoadingEpisodes(true);
    void enrichSeasonEpisodesFromJikan(
      activeSeason.episodes,
      activeSeason.malId
    )
      .then((enriched) => {
        if (!cancelled) {
          setEnrichedBySeason((prev) => ({
            ...prev,
            [activeSeason.seasonNumber]: enriched,
          }));
          setLoadingEpisodes(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadingEpisodes(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeSeason, enrichedBySeason]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const mergedSeasons = useMemo(() => {
    return seasons.map((s) => {
      const enrichedEps = enrichedBySeason[s.seasonNumber];
      return enrichedEps ? { ...s, episodes: enrichedEps } : s;
    });
  }, [seasons, enrichedBySeason]);

  const episodes = useMemo(() => {
    const match = mergedSeasons.find(
      (s) => s.seasonNumber === activeSeason?.seasonNumber
    );
    return match?.episodes ?? activeSeason?.episodes ?? seriesData.episodes;
  }, [activeSeason?.seasonNumber, activeSeason?.episodes, mergedSeasons, seriesData.episodes]);

  const enrichedAnime = useMemo<AnimeSeries>(
    () => ({
      ...seriesData,
      seasons: mergedSeasons,
      episodes: mergedSeasons[0]?.episodes ?? episodes,
    }),
    [seriesData, mergedSeasons, episodes]
  );

  const primaryEpisode = useMemo(() => {
    if (latestProgress && !latestProgress.completed && latestProgress.currentTime > 3) {
      const matchInActiveSeason = episodes.find(
        (ep) => ep.id === latestProgress.episodeId && !ep.isUpcoming
      );
      if (matchInActiveSeason) {
        return { episode: matchInActiveSeason, startAt: latestProgress.currentTime };
      }
    }
    const firstPlayable =
      episodes.find((ep) => !ep.isUpcoming) ??
      mergedSeasons.flatMap((s) => s.episodes).find((ep) => !ep.isUpcoming);
    return { episode: firstPlayable, startAt: 0 };
  }, [episodes, latestProgress, mergedSeasons]);

  const isResumingPrimary = Boolean(
    primaryEpisode.episode && primaryEpisode.startAt > 3
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-4xl bg-[#111319] border-t sm:border border-white/10 rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-2xl max-h-[92dvh] flex flex-col">
        {/* Top Hero Banner */}
        <div className="relative min-h-[250px] sm:aspect-[16/9] sm:max-h-[340px] w-full shrink-0 overflow-hidden bg-black">
          <ArtworkImage
            src={
              activeSeason?.keyVisual ||
              seriesData.keyVisual ||
              seriesData.posterImage
            }
            alt={seriesData.title}
            title={seriesData.title}
            accentTint={seriesData.accentTint}
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#111319] via-[#111319]/60 to-black/35" />

          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer les détails"
            className="absolute top-3 right-3 sm:top-4 sm:right-4 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-black/65 hover:bg-black/85 text-white transition-colors cursor-pointer z-20"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="relative z-10 flex flex-col justify-end min-h-[250px] sm:min-h-0 sm:h-full p-5 sm:p-8 pt-14">
            <p className="text-xs text-zinc-300 mb-1.5 line-clamp-1">
              {seriesData.genres.join(' · ')}
              {seriesData.year ? ` · ${seriesData.year}` : ''} ·{' '}
              {seriesData.studio} ·{' '}
              {seriesData.episodesCount === 0 || seriesData.status === 'À venir'
                ? formatReleaseDateFr({
                    nextAiringAt: seriesData.nextAiringAt,
                    startDate: seriesData.startDate,
                    seasonName: seriesData.seasonName,
                    year: seriesData.year,
                    isUpcoming: true,
                  })
                : `${
                    seasons.filter((s) => s.episodes.length > 0).length > 1
                      ? `${seasons.filter((s) => s.episodes.length > 0).length} saisons · `
                      : ''
                  }${seriesData.episodesCount} ép.`}{' '}
              · {seriesData.audioTracks.join(' / ')}
            </p>
            <h2 className="text-xl sm:text-4xl font-display font-bold text-white tracking-tight mb-3.5 line-clamp-2">
              {seriesData.title}
            </h2>
            <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
              {primaryEpisode.episode ? (
                <button
                  type="button"
                  onClick={() =>
                    onPlayEpisode(
                      enrichedAnime,
                      primaryEpisode.episode!,
                      primaryEpisode.startAt
                    )
                  }
                  className="inline-flex items-center justify-center gap-2 px-4 sm:px-5 min-h-[44px] rounded-lg bg-[#FF5E1A] hover:bg-[#e85112] text-white text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>
                    {isResumingPrimary
                      ? `Reprendre S${primaryEpisode.episode.season} E${primaryEpisode.episode.number} · ${formatTimecode(primaryEpisode.startAt)}`
                      : `Regarder S${primaryEpisode.episode.season} E${primaryEpisode.episode.number}`}
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  className="inline-flex items-center justify-center gap-2 px-4 sm:px-5 min-h-[44px] rounded-lg bg-white/8 border border-white/12 text-zinc-400 text-sm font-medium whitespace-nowrap cursor-not-allowed"
                >
                  <Clock className="w-4 h-4 text-amber-400" />
                  <span>
                    À venir ·{' '}
                    {formatReleaseDateFr({
                      nextAiringAt:
                        activeSeason?.nextAiringAt ?? seriesData.nextAiringAt,
                      startDate: activeSeason?.startDate ?? seriesData.startDate,
                      seasonName:
                        activeSeason?.seasonName ?? seriesData.seasonName,
                      year: activeSeason?.year ?? seriesData.year,
                      isUpcoming: true,
                    })}
                  </span>
                </button>
              )}

              <button
                type="button"
                onClick={() => onToggleWatchlist(enrichedAnime)}
                className={`inline-flex items-center justify-center gap-2 px-4 min-h-[44px] rounded-lg border text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  inWatchlist
                    ? 'bg-white/12 border-white/25 text-white'
                    : 'bg-black/45 border-white/15 text-zinc-200 hover:bg-white/10'
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
                    <span>Ma liste</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="p-5 sm:p-8 pb-[max(1.5rem,env(safe-area-inset-bottom))] overflow-y-auto overscroll-contain space-y-6 sm:space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <p className="md:col-span-2 text-sm sm:text-base text-zinc-300 leading-relaxed">
              {seriesData.synopsis}
            </p>
            <div className="space-y-2 text-xs text-zinc-400 border-t md:border-t-0 md:border-l border-white/10 pt-4 md:pt-0 md:pl-6">
              <p>
                <span className="text-zinc-500">Titre original :</span>{' '}
                <span className="text-zinc-200">{seriesData.originalTitle}</span>
              </p>
              <p>
                <span className="text-zinc-500">Statut :</span>{' '}
                <span className="text-zinc-200">{seriesData.status}</span>
              </p>
              <p>
                <span className="text-zinc-500">Diffusion :</span>{' '}
                <span className="text-zinc-200 tabular-nums">
                  {seriesData.simulcastDay && seriesData.simulcastTime
                    ? `${seriesData.simulcastDay} à ${seriesData.simulcastTime}`
                    : seriesData.status === 'Terminé'
                      ? 'Série terminée'
                      : 'Non programmée'}
                </span>
              </p>
              <p>
                <span className="text-zinc-500">Note AniList :</span>{' '}
                <span className="text-zinc-200 tabular-nums">
                  {typeof seriesData.score === 'number'
                    ? `${seriesData.score} / 10`
                    : 'Pas encore noté'}
                </span>
              </p>
            </div>
          </div>

          {/* Seasons Selector & Episodes List */}
          <div>
            <div className="flex flex-col gap-3 pb-4 border-b border-white/10 mb-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <h3 className="text-lg font-display font-semibold text-white">
                    {activeSeason?.title || 'Épisodes'} ({episodes.length} ép.)
                  </h3>
                  {loadingSeasons ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-zinc-400">
                      <Loader2 className="w-3.5 h-3.5 text-[#FF5E1A] animate-spin" />
                      <span>Chargement des saisons…</span>
                    </span>
                  ) : null}
                </div>
                {loadingEpisodes ? (
                  <span className="text-xs text-zinc-400">
                    Synchronisation des titres d’épisodes…
                  </span>
                ) : null}
              </div>

              {/* Season Tabs (only released seasons are selectable; upcoming seasons are informational only) */}
              <div className="flex items-center gap-1.5 p-1 bg-[#0B0C10] border border-white/10 rounded-xl overflow-x-auto no-scrollbar max-w-full">
                {mergedSeasons.map((season) => {
                  const isSeasonUpcoming =
                    season.status === 'À venir' || season.episodes.length === 0;
                  const isActive =
                    !isSeasonUpcoming &&
                    season.seasonNumber === activeSeason?.seasonNumber;

                  if (isSeasonUpcoming) {
                    const seasonReleaseLabel = formatReleaseDateFr({
                      nextAiringAt: season.nextAiringAt,
                      startDate: season.startDate,
                      seasonName: season.seasonName,
                      year: season.year,
                      isUpcoming: true,
                    });
                    return (
                      <button
                        key={season.id}
                        type="button"
                        disabled
                        title="Saison à venir — pas encore diffusée"
                        className="px-3.5 min-h-[40px] rounded-lg text-xs font-medium whitespace-nowrap shrink-0 flex items-center gap-1.5 text-zinc-500 bg-white/3 cursor-not-allowed"
                      >
                        <Clock className="w-3.5 h-3.5 text-amber-400/80" />
                        <span>
                          Saison {season.seasonNumber} · À venir
                          {seasonReleaseLabel !== 'Date à confirmer'
                            ? ` (${seasonReleaseLabel})`
                            : ''}
                        </span>
                      </button>
                    );
                  }

                  return (
                    <button
                      key={season.id}
                      type="button"
                      onClick={() => setSelectedSeasonNum(season.seasonNumber)}
                      className={`px-3.5 min-h-[40px] rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1.5 ${
                        isActive
                          ? 'bg-[#FF5E1A] text-white'
                          : 'text-zinc-300 hover:text-white hover:bg-white/6'
                      }`}
                    >
                      <span>Saison {season.seasonNumber}</span>
                      <span
                        className={`text-[11px] font-mono tabular-nums ${
                          isActive ? 'text-white/90' : 'text-zinc-500'
                        }`}
                      >
                        ({season.episodesCount})
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="divide-y divide-white/8">
              {episodes.length === 0 ? (
                <div className="py-10 px-4 text-center rounded-xl bg-white/3 border border-white/8">
                  <div className="inline-flex items-center gap-2 text-sm font-medium text-amber-300 mb-1.5">
                    <Clock className="w-4 h-4" />
                    <span>
                      {activeSeason?.status === 'En cours'
                        ? 'Épisodes indisponibles'
                        : 'Sortie à venir'}
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm text-zinc-400">
                    {activeSeason?.status === 'En cours'
                      ? 'Cette série est marquée en cours sur AniList, mais aucun épisode diffusé n’est encore répertorié.'
                      : `Aucun épisode n’est encore diffusé pour cet animé. ${formatUpcomingNoticeFr({
                          nextAiringAt:
                            activeSeason?.nextAiringAt ?? seriesData.nextAiringAt,
                          startDate:
                            activeSeason?.startDate ?? seriesData.startDate,
                          seasonName:
                            activeSeason?.seasonName ?? seriesData.seasonName,
                          year: activeSeason?.year ?? seriesData.year,
                        })}`}
                  </p>
                </div>
              ) : null}
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
                        className="inline-flex items-center justify-center gap-1.5 px-4 min-h-[44px] rounded-lg bg-white/8 hover:bg-[#FF5E1A] active:bg-[#FF5E1A] text-white text-xs font-medium transition-colors whitespace-nowrap cursor-pointer flex-1 sm:flex-initial"
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
                          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg bg-white/6 hover:bg-white/14 text-zinc-300 transition-colors cursor-pointer"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}

              {episodes.length > 0 &&
              activeSeason?.status === 'En cours' &&
              activeSeason.nextAiringEpisode &&
              activeSeason.nextAiringEpisode > episodes.length ? (
                <div className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 opacity-75 select-none">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-12 h-12 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                      <Clock className="w-5 h-5 text-amber-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-mono tabular-nums text-amber-300 mb-0.5">
                        Épisode {activeSeason.nextAiringEpisode} · À venir
                      </p>
                      <p className="text-sm font-medium text-zinc-200 truncate">
                        Prochaine sortie : {formatAiringDateFr(activeSeason.nextAiringAt)}
                      </p>
                    </div>
                  </div>
                  <span className="inline-flex items-center justify-center gap-1.5 px-3.5 min-h-[38px] rounded-lg bg-white/5 border border-white/10 text-zinc-400 text-xs font-medium whitespace-nowrap shrink-0">
                    Non disponible
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
