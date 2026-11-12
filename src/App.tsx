import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bookmark,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Home,
  Info,
  LayoutGrid,
  Loader2,
  Play,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import {
  formatReleaseDateFr,
  formatRemainingMinutes,
  formatTimecode,
  getAllSeriesEpisodes,
  getLatestReleasedEpisodeAirTime,
  getSeriesSeasons,
  type AnimeSeries,
  type AudioTrack,
  type Episode,
  type SimulcastDay,
  type SimulcastScheduleItem,
} from './data/animeCatalog';
import {
  fetchAllSeasonsForAnime,
  fetchCatalogPage,
  fetchHomeCatalog,
  fetchWeeklySchedule,
  searchRealAnime,
} from './services/anilistApi';
import { useWatchProgress } from './hooks/useWatchProgress';
import { useProfiles } from './hooks/useProfiles';
import { ArtworkImage } from './components/ArtworkImage';
import { VideoPlayerModal } from './components/VideoPlayerModal';
import { AnimeDetailModal } from './components/AnimeDetailModal';
import { SearchModal } from './components/SearchModal';
import { ProfileAvatar } from './components/ProfileAvatar';
import { ProfileSelectModal } from './components/ProfileSelectModal';
import { ProfileEditModal } from './components/ProfileEditModal';
import type { UserProfile } from './types/profile';

type NavSection = 'accueil' | 'catalogue' | 'simulcast' | 'maliste';

const GENRES = [
  'Tout',
  'Action',
  'Aventure',
  'Fantaisie',
  'Sci-Fi',
  'Mystère',
  'Drame',
  'Comédie',
  'Tranche de vie',
] as const;

const DAYS: SimulcastDay[] = [
  'Lundi',
  'Mardi',
  'Mercredi',
  'Jeudi',
  'Vendredi',
  'Samedi',
  'Dimanche',
];

export default function App() {
  const {
    currentUser,
    profiles,
    activeProfile,
    activeProfileId,
    hasSelectedSessionProfile,
    selectProfile,
    createProfile,
    updateProfile,
    deleteProfile,
  } = useProfiles();

  const {
    progressByEpisode,
    continueWatchingList,
    watchlistSeries,
    watchlistIds,
    preferences,
    saveEpisodeProgress,
    removeAnimeProgress,
    markEpisodeCompleted,
    toggleWatchlist,
    updatePreferences,
    getLatestProgressForAnime,
  } = useWatchProgress(
    activeProfileId,
    activeProfile.defaultAudio,
    undefined,
    currentUser
  );

  const [profileSelectOpen, setProfileSelectOpen] = useState(false);
  const [profileEditModalOpen, setProfileEditModalOpen] = useState(false);
  const [profileToEdit, setProfileToEdit] = useState<UserProfile | null>(null);

  const [activeNav, setActiveNav] = useState<NavSection>('accueil');
  const [heroIndex, setHeroIndex] = useState(0);
  const [selectedGenre, setSelectedGenre] = useState<string>('Tout');
  const [selectedAudio, setSelectedAudio] = useState<'Tous' | AudioTrack>('Tous');
  const [catalogSort, setCatalogSort] = useState<'POPULARITY_DESC' | 'SCORE_DESC' | 'START_DATE_DESC'>('POPULARITY_DESC');
  const [catalogPage, setCatalogPage] = useState<number>(1);
  const [catalogSearchQuery, setCatalogSearchQuery] = useState<string>('');
  const [catalogPageInfo, setCatalogPageInfo] = useState<{
    total: number;
    currentPage: number;
    lastPage: number;
    hasNextPage: boolean;
  }>({
    total: 0,
    currentPage: 1,
    lastPage: 1,
    hasNextPage: false,
  });
  const [selectedSimulcastDay, setSelectedSimulcastDay] = useState<SimulcastDay>(() => {
    const jsDays: SimulcastDay[] = [
      'Dimanche',
      'Lundi',
      'Mardi',
      'Mercredi',
      'Jeudi',
      'Vendredi',
      'Samedi',
    ];
    return jsDays[new Date().getDay()] ?? 'Samedi';
  });

  // Live AniList Catalog State (empty until live fetch completes; fallback only on offline/error)
  const [featuredSeries, setFeaturedSeries] = useState<AnimeSeries[]>([]);
  const [trendingSeries, setTrendingSeries] = useState<AnimeSeries[]>([]);
  const [catalogSeries, setCatalogSeries] = useState<AnimeSeries[]>([]);
  const [simulcastSchedule, setSimulcastSchedule] = useState<SimulcastScheduleItem[]>([]);
  const [loadingHome, setLoadingHome] = useState(true);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [apiNotice, setApiNotice] = useState<string | null>(null);

  const [detailAnime, setDetailAnime] = useState<AnimeSeries | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [playerState, setPlayerState] = useState<{
    anime: AnimeSeries;
    episode: Episode;
    startAt: number;
  } | null>(null);

  const loadHomeCatalog = useCallback(() => {
    setLoadingHome(true);
    setApiNotice(null);
    return Promise.all([fetchHomeCatalog(), fetchWeeklySchedule()])
      .then(([homeData, schedData]) => {
        if (homeData.featured.length > 0) setFeaturedSeries(homeData.featured);
        if (homeData.trending.length > 0) {
          setTrendingSeries(homeData.trending);
          setCatalogSeries(homeData.popular.length > 0 ? homeData.popular : homeData.trending);
        }
        setSimulcastSchedule(schedData);
        setApiNotice(null);
        setLoadingHome(false);
      })
      .catch(() => {
        setApiNotice('Impossible de charger le catalogue pour le moment.');
        setLoadingHome(false);
      });
  }, []);

  // Initial real anime fetch from AniList
  useEffect(() => {
    let cancelled = false;
    setLoadingHome(true);

    void Promise.all([fetchHomeCatalog(), fetchWeeklySchedule()])
      .then(([homeData, schedData]) => {
        if (cancelled) return;
        if (homeData.featured.length > 0) setFeaturedSeries(homeData.featured);
        if (homeData.trending.length > 0) {
          setTrendingSeries(homeData.trending);
          setCatalogSeries(homeData.popular.length > 0 ? homeData.popular : homeData.trending);
        }
        setSimulcastSchedule(schedData);
        setApiNotice(null);
        setLoadingHome(false);
      })
      .catch(() => {
        if (cancelled) return;
        setApiNotice('Impossible de charger le catalogue pour le moment.');
        setLoadingHome(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Reset page when genre, sort or search filter changes
  useEffect(() => {
    setCatalogPage(1);
  }, [selectedGenre, catalogSort, catalogSearchQuery]);

  // Fetch full catalog with real pagination from AniList
  useEffect(() => {
    let cancelled = false;
    setLoadingCatalog(true);

    const timer = window.setTimeout(
      () => {
        void fetchCatalogPage({
          page: catalogPage,
          perPage: 24,
          query: catalogSearchQuery.trim() || undefined,
          genreFr: selectedGenre,
          sort: catalogSort,
        })
          .then((res) => {
            if (cancelled) return;
            setCatalogSeries(res.items);
            setCatalogPageInfo(res.pageInfo);
            setLoadingCatalog(false);
          })
          .catch(() => {
            if (!cancelled) setLoadingCatalog(false);
          });
      },
      catalogSearchQuery.trim() ? 350 : 0
    );

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [catalogPage, selectedGenre, catalogSort, catalogSearchQuery]);

  const activeHero: AnimeSeries | undefined =
    featuredSeries.length > 0
      ? featuredSeries[heroIndex % featuredSeries.length] ?? featuredSeries[0]
      : undefined;

  // Keyboard shortcut Cmd/Ctrl + K for Search
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const openPlayer = useCallback(
    (
      anime: AnimeSeries,
      episode?: Episode,
      startAt = 0
    ) => {
      const isUpcomingEp =
        !episode ||
        episode.isUpcoming ||
        (Boolean(episode.airingAt) && episode.airingAt! * 1000 > Date.now()) ||
        anime.status === 'À venir';
      if (isUpcomingEp) return;
      setDetailAnime(null);

      // If an older localStorage item wasn't hydrated with all franchise seasons yet, resolve Season 1 first
      if (anime.anilistId && (!anime.seasons || anime.seasons.length <= 1)) {
        void fetchAllSeasonsForAnime(anime)
          .then((resolved) => {
            const resolvedSeasons = getSeriesSeasons(resolved);
            const targetSeason =
              resolvedSeasons.find((s) => s.seasonNumber === episode.season) ??
              resolvedSeasons[0];
            const targetEp =
              targetSeason?.episodes.find(
                (e) =>
                  e.number === episode.number &&
                  !e.isUpcoming &&
                  (!e.airingAt || e.airingAt * 1000 <= Date.now())
              ) ?? episode;
            if (
              targetEp.isUpcoming ||
              (targetEp.airingAt && targetEp.airingAt * 1000 > Date.now())
            ) {
              return;
            }
            setPlayerState({ anime: resolved, episode: targetEp, startAt });
          })
          .catch(() => {
            setPlayerState({ anime, episode, startAt });
          });
        return;
      }

      setPlayerState({ anime, episode, startAt });
    },
    []
  );

  const getPrimaryActionForAnime = useCallback(
    (
      anime: AnimeSeries
    ): { episode: Episode | undefined; startAt: number; isResuming: boolean } => {
      const isAnimeUpcoming =
        anime.status === 'À venir' ||
        (anime.nextAiringEpisode === 1 &&
          Boolean(anime.nextAiringAt && anime.nextAiringAt * 1000 > Date.now()));

      if (isAnimeUpcoming) {
        return {
          episode: undefined,
          startAt: 0,
          isResuming: false,
        };
      }

      const allEps = getAllSeriesEpisodes(anime);
      const playableEps = allEps.filter(
        (e) =>
          !e.isUpcoming &&
          (!e.airingAt || e.airingAt * 1000 <= Date.now())
      );

      if (playableEps.length === 0) {
        return {
          episode: undefined,
          startAt: 0,
          isResuming: false,
        };
      }

      const latest = getLatestProgressForAnime(anime.id);
      if (latest && !latest.completed && latest.currentTime > 3) {
        const ep = playableEps.find((e) => e.id === latest.episodeId);
        if (ep) {
          return {
            episode: ep,
            startAt: latest.currentTime,
            isResuming: true,
          };
        }
      }

      return {
        episode: playableEps[0],
        startAt: 0,
        isResuming: false,
      };
    },
    [getLatestProgressForAnime]
  );

  const displayedHomeSeries = useMemo(() => {
    const base = selectedGenre === 'Tout' ? trendingSeries : catalogSeries;
    return base.filter(
      (a) => selectedAudio === 'Tous' || a.audioTracks.includes(selectedAudio)
    );
  }, [catalogSeries, selectedAudio, selectedGenre, trendingSeries]);

  const displayedCatalogue = useMemo(() => {
    const filtered = catalogSeries.filter(
      (a) => selectedAudio === 'Tous' || a.audioTracks.includes(selectedAudio)
    );

    if (catalogSort === 'START_DATE_DESC') {
      return [...filtered].sort((a, b) => {
        const isAUpcoming = a.status === 'À venir' || a.episodesCount === 0;
        const isBUpcoming = b.status === 'À venir' || b.episodesCount === 0;
        if (isAUpcoming && !isBUpcoming) return 1;
        if (!isAUpcoming && isBUpcoming) return -1;

        const timeA = getLatestReleasedEpisodeAirTime(a);
        const timeB = getLatestReleasedEpisodeAirTime(b);
        return timeB - timeA;
      });
    }

    if (catalogSort === 'SCORE_DESC') {
      return [...filtered].sort((a, b) => {
        const scoreA = typeof a.score === 'number' ? a.score : -1;
        const scoreB = typeof b.score === 'number' ? b.score : -1;
        return scoreB - scoreA;
      });
    }

    return filtered;
  }, [catalogSeries, catalogSort, selectedAudio]);

  const heroAction = activeHero ? getPrimaryActionForAnime(activeHero) : null;
  const heroInWatchlist = activeHero ? watchlistIds.includes(activeHero.id) : false;

  return (
    <div className="min-h-screen bg-[#0B0C10] text-[#F3F4F6] flex flex-col">
      {/* Top Bar Contract: 3 zones on desktop; compact wordmark + search on iPhone */}
      <header className="md:sticky md:top-0 z-30 bg-[#0B0C10]/92 backdrop-blur-md border-b border-white/8 pt-[env(safe-area-inset-top)]">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-8 h-14 md:h-16 flex items-center justify-between gap-4 md:gap-8">
          {/* Zone 1: Single-element Brand Wordmark */}
          <button
            type="button"
            onClick={() => setActiveNav('accueil')}
            className="text-xl font-display font-bold tracking-tight text-white whitespace-nowrap shrink-0 cursor-pointer min-h-[44px] flex items-center"
          >
            KuroStream
          </button>

          {/* Zone 2: 4 single-line navigation links (desktop; mobile uses bottom tab bar) */}
          <nav
            aria-label="Navigation principale"
            className="hidden md:flex items-center gap-7"
          >
            {(
              [
                { id: 'accueil', label: 'Accueil' },
                { id: 'catalogue', label: 'Catalogue' },
                { id: 'simulcast', label: 'Simulcast' },
                { id: 'maliste', label: 'Ma Liste' },
              ] as Array<{ id: NavSection; label: string }>
            ).map((item) => {
              const active = activeNav === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveNav(item.id)}
                  className={`relative py-1 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active ? 'text-white' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {item.label}
                  {active ? (
                    <span className="absolute inset-x-0 -bottom-[1px] h-0.5 bg-[#FF5E1A]" />
                  ) : null}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Actions (Recherche + Profils) */}
          <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label="Rechercher un animé"
              className="inline-flex items-center justify-center gap-2 px-3 sm:px-3.5 min-h-[44px] min-w-[44px] rounded-lg bg-[#181B24] hover:bg-[#222633] border border-white/10 text-xs sm:text-sm font-medium text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Search className="w-4 h-4 text-[#FF5E1A]" />
              <span className="hidden sm:inline">Rechercher</span>
              <kbd className="hidden lg:inline-block text-[10px] font-mono text-zinc-400 bg-white/6 px-1.5 py-0.5 rounded border border-white/10 ml-0.5">
                ⌘K
              </kbd>
            </button>

            {/* Profile Switcher Trigger (Seul endroit où voir et changer le profil) */}
            <button
              type="button"
              onClick={() => setProfileSelectOpen(true)}
              aria-label={`Profil actif : ${activeProfile.name}. Cliquer pour changer de profil.`}
              title={`Profil actif : ${activeProfile.name}`}
              className="inline-flex items-center gap-2 sm:gap-2.5 px-2.5 sm:px-3 py-1.5 min-h-[44px] rounded-xl bg-[#181B24] hover:bg-[#222633] border border-white/10 hover:border-white/20 text-xs sm:text-sm font-medium text-white transition-all shrink-0 cursor-pointer group"
            >
              <ProfileAvatar avatar={activeProfile.avatar} color={activeProfile.color} size="sm" />
              <div className="flex flex-col text-left leading-tight">
                <span className="text-xs sm:text-sm font-semibold text-white group-hover:text-[#FF5E1A] transition-colors truncate max-w-[85px] sm:max-w-[120px]">
                  {activeProfile.name}
                </span>
                <span className="text-[10px] text-zinc-400 group-hover:text-zinc-300 transition-colors">
                  Changer
                </span>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-zinc-400 group-hover:text-white transition-colors shrink-0 ml-0.5" />
            </button>
          </div>
        </div>
      </header>

      {apiNotice ? (
        <div className="bg-[#181B24] border-b border-white/8 px-4 py-2.5 flex items-center justify-center gap-3 text-xs text-amber-300">
          <span>{apiNotice}</span>
          <button
            type="button"
            onClick={() => void loadHomeCatalog()}
            className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 text-white font-medium cursor-pointer"
          >
            Réessayer
          </button>
        </div>
      ) : null}

      <main className="flex-1">
        {activeNav === 'accueil' ? (
          <>
            {/* Hero Spotlight */}
            <section className="relative w-full border-b border-white/8 overflow-hidden">
              {!activeHero || !heroAction ? (
                <div className="relative max-w-[1400px] mx-auto min-h-[420px] sm:min-h-[440px] sm:aspect-[16/7] sm:max-h-[560px] bg-[#111319] flex items-end sm:items-center px-4 sm:px-10 py-8">
                  <div className="max-w-xl w-full space-y-4 animate-pulse">
                    <div className="h-3.5 w-48 rounded bg-white/10" />
                    <div className="h-10 w-3/4 rounded-lg bg-white/12" />
                    <div className="h-4 w-full rounded bg-white/8" />
                    <div className="h-4 w-5/6 rounded bg-white/8" />
                    <div className="flex gap-3 pt-2">
                      <div className="h-11 w-44 rounded-lg bg-[#FF5E1A]/40" />
                      <div className="h-11 w-28 rounded-lg bg-white/10" />
                    </div>
                  </div>
                </div>
              ) : (
              <div className="relative max-w-[1400px] mx-auto min-h-[420px] sm:min-h-[440px] sm:aspect-[16/7] sm:max-h-[560px] flex flex-col justify-end sm:block">
                <ArtworkImage
                  src={activeHero.keyVisual || activeHero.posterImage}
                  alt={activeHero.title}
                  title={activeHero.title}
                  accentTint={activeHero.accentTint}
                  className="absolute inset-0 w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-r from-[#0B0C10] via-[#0B0C10]/85 to-[#0B0C10]/30 sm:to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0B0C10] via-[#0B0C10]/45 to-[#0B0C10]/35" />

                <div className="relative sm:absolute sm:inset-0 flex items-end sm:items-center px-4 sm:px-10 pt-16 pb-6 sm:py-0">
                  <div className="max-w-xl w-full">
                    <p className="text-xs sm:text-sm text-zinc-300 mb-2 line-clamp-1">
                      {activeHero.genres.join(' · ')}
                      {activeHero.year ? ` · ${activeHero.year}` : ''} ·{' '}
                      {activeHero.studio} ·{' '}
                      {activeHero.episodesCount === 0 || activeHero.status === 'À venir'
                        ? `À venir (${formatReleaseDateFr({
                            nextAiringAt: activeHero.nextAiringAt,
                            startDate: activeHero.startDate,
                            seasonName: activeHero.seasonName,
                            year: activeHero.year,
                            isUpcoming: true,
                          })})`
                        : `${activeHero.episodesCount} ép.`}
                      {typeof activeHero.score === 'number'
                        ? ` · ${activeHero.score}/10`
                        : ''}
                    </p>

                    <h1
                      className="font-display font-bold text-white tracking-tight leading-[1.08] mb-3"
                      style={{
                        fontSize: 'clamp(1.75rem, 4vw, 3.3rem)',
                        textWrap: 'balance',
                      }}
                    >
                      {activeHero.title}
                    </h1>

                    <p className="text-sm sm:text-base text-zinc-300 leading-relaxed line-clamp-2 sm:line-clamp-3 mb-5 sm:mb-6">
                      {activeHero.synopsis}
                    </p>

                    <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
                      {heroAction.episode ? (
                        <button
                          type="button"
                          onClick={() =>
                            openPlayer(
                              activeHero,
                              heroAction.episode,
                              heroAction.startAt
                            )
                          }
                          className="inline-flex items-center justify-center gap-2 px-4 sm:px-5 min-h-[44px] rounded-lg bg-[#FF5E1A] hover:bg-[#e85112] text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer flex-1 sm:flex-initial"
                        >
                          <Play className="w-4 h-4 fill-current" />
                          <span>
                            {heroAction.isResuming
                              ? `Reprendre S${heroAction.episode.season} E${heroAction.episode.number} · ${formatTimecode(heroAction.startAt)}`
                              : `Regarder Épisode ${heroAction.episode.number}`}
                          </span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled
                          className="inline-flex items-center justify-center gap-2 px-4 sm:px-5 min-h-[44px] rounded-lg bg-white/8 border border-white/15 text-zinc-300 text-sm font-medium whitespace-nowrap shrink-0 cursor-not-allowed flex-1 sm:flex-initial"
                        >
                          <Clock className="w-4 h-4 text-amber-400" />
                          <span>
                            À venir ·{' '}
                            {formatReleaseDateFr({
                              nextAiringAt: activeHero.nextAiringAt,
                              startDate: activeHero.startDate,
                              seasonName: activeHero.seasonName,
                              year: activeHero.year,
                              isUpcoming: true,
                            })}
                          </span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => setDetailAnime(activeHero)}
                        className="inline-flex items-center justify-center gap-2 px-4 min-h-[44px] rounded-lg bg-white/10 hover:bg-white/16 text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Info className="w-4 h-4" />
                        <span>{heroAction.episode ? 'Épisodes' : 'Détails'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => toggleWatchlist(activeHero)}
                        aria-label={
                          heroInWatchlist
                            ? 'Retirer de ma liste'
                            : 'Ajouter à ma liste'
                        }
                        className="inline-flex items-center justify-center gap-2 px-3.5 sm:px-4 min-h-[44px] rounded-lg bg-black/45 hover:bg-white/12 border border-white/15 text-zinc-200 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        {heroInWatchlist ? (
                          <>
                            <Check className="w-4 h-4 text-[#FF5E1A]" />
                            <span className="hidden sm:inline">Dans ma liste</span>
                          </>
                        ) : (
                          <>
                            <Bookmark className="w-4 h-4" />
                            <span className="hidden sm:inline">Ma liste</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Clean Hero Slide Switcher (top-right on mobile so it never overlaps CTAs) */}
                <div className="absolute top-3.5 right-4 sm:top-auto sm:right-5 sm:bottom-6 flex items-center gap-1.5 sm:gap-2">
                  <span className="text-xs font-mono tabular-nums text-zinc-300 mr-1">
                    0{(heroIndex % featuredSeries.length) + 1} / 0
                    {featuredSeries.length}
                  </span>
                  <button
                    type="button"
                    aria-label="Animé précédent"
                    onClick={() =>
                      setHeroIndex(
                        (prev) =>
                          (prev - 1 + featuredSeries.length) %
                          featuredSeries.length
                      )
                    }
                    className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg bg-black/60 hover:bg-black/85 border border-white/15 text-white transition-colors cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Animé suivant"
                    onClick={() =>
                      setHeroIndex((prev) => (prev + 1) % featuredSeries.length)
                    }
                    className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg bg-black/60 hover:bg-black/85 border border-white/15 text-white transition-colors cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
              )}
            </section>

            {/* Section 1: Reprendre le visionnage */}
            <section className="max-w-[1400px] mx-auto px-4 sm:px-8 pt-10 pb-10 border-b border-white/8">
              <div className="flex flex-wrap items-baseline justify-between gap-4 mb-6">
                <div>
                  <h2 className="text-xl sm:text-2xl font-display font-semibold text-white tracking-tight">
                    Reprendre le visionnage
                  </h2>
                  <p className="text-sm text-zinc-400 mt-1">
                    Reprenez vos épisodes en cours exactement là où vous les avez arrêtés.
                  </p>
                </div>
                {continueWatchingList.length > 0 ? (
                  <span className="text-xs font-mono tabular-nums text-zinc-400">
                    {continueWatchingList.length} épisode
                    {continueWatchingList.length > 1 ? 's' : ''} en cours
                  </span>
                ) : null}
              </div>

              {continueWatchingList.length === 0 ? (
                <div className="rounded-xl bg-[#13151B] border border-white/8 p-8 text-center">
                  <p className="text-sm text-zinc-300 mb-1.5">
                    Aucun épisode en cours de lecture pour le moment.
                  </p>
                  <p className="text-xs text-zinc-500">
                    Lancez un épisode puis mettez en pause pour sauvegarder votre position à la seconde près.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {continueWatchingList.map((entry) => {
                    const liveAnime =
                      trendingSeries.find((a) => a.id === entry.animeId) ??
                      catalogSeries.find((a) => a.id === entry.animeId);
                    const anime = liveAnime ?? entry.snapshot?.anime;
                    const episode =
                      (anime
                        ? getAllSeriesEpisodes(anime).find(
                            (e) => e.id === entry.episodeId
                          )
                        : undefined) ?? entry.snapshot?.episode;
                    if (!anime || !episode) return null;

                    const pct =
                      entry.duration > 0
                        ? Math.min(100, (entry.currentTime / entry.duration) * 100)
                        : 0;

                    return (
                      <article
                        key={entry.animeId}
                        className="group rounded-xl bg-[#13151B] border border-white/8 overflow-hidden flex flex-col"
                      >
                        <div className="relative aspect-video bg-black overflow-hidden">
                          <button
                            type="button"
                            onClick={() =>
                              openPlayer(anime, episode, entry.currentTime)
                            }
                            className="w-full h-full block cursor-pointer"
                          >
                            <ArtworkImage
                              src={episode.thumbnail || anime.keyVisual || anime.posterImage}
                              alt={`${anime.title} — ${episode.title}`}
                              title={anime.title}
                              accentTint={anime.accentTint}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />
                            <div className="absolute inset-0 flex items-center justify-center opacity-90 group-hover:opacity-100 transition-opacity">
                              <div className="w-12 h-12 rounded-full bg-black/70 border border-white/25 group-hover:bg-[#FF5E1A] group-hover:border-[#FF5E1A] flex items-center justify-center text-white transition-colors">
                                <Play className="w-5 h-5 fill-current ml-0.5" />
                              </div>
                            </div>
                          </button>

                          <button
                            type="button"
                            onClick={() => removeAnimeProgress(entry.animeId)}
                            title="Retirer de la reprise"
                            aria-label="Retirer cet animé de la liste de reprise"
                            className="absolute top-2.5 right-2.5 min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg bg-black/70 hover:bg-black text-zinc-200 hover:text-white opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>

                          <div className="absolute inset-x-0 bottom-0 h-1.5 bg-white/20">
                            <div
                              className="h-full bg-[#FF5E1A]"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>

                        <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                          <div>
                            <p className="text-xs text-zinc-400 mb-1 truncate">
                              {anime.title} · S{episode.season} E{episode.number}
                              {entry.customVideoName ? ` · ${entry.customVideoName}` : ''}
                            </p>
                            <h3 className="text-base font-medium text-white truncate">
                              {episode.title}
                            </h3>
                          </div>

                          <div className="flex items-center justify-between gap-3 pt-2 border-t border-white/8">
                            <span className="text-xs font-mono tabular-nums text-zinc-400">
                              {formatTimecode(entry.currentTime)} /{' '}
                              {formatTimecode(entry.duration)} ·{' '}
                              {formatRemainingMinutes(
                                entry.currentTime,
                                entry.duration
                              )}
                            </span>

                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => openPlayer(anime, episode, 0)}
                                title="Recommencer à 00:00"
                                aria-label="Recommencer à zéro"
                                className="p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  openPlayer(anime, episode, entry.currentTime)
                                }
                                className="px-3 py-1.5 rounded-md bg-[#FF5E1A] hover:bg-[#e85112] text-white text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
                              >
                                Reprendre
                              </button>
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Section 2: Tendances AniList */}
            <section className="max-w-[1400px] mx-auto px-4 sm:px-8 py-12 border-b border-white/8">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-7">
                <div className="flex items-center gap-3">
                  <div>
                    <h2 className="text-xl sm:text-2xl font-display font-semibold text-white tracking-tight">
                      Animés populaires du moment
                    </h2>
                    <p className="text-sm text-zinc-400 mt-1">
                      Catalogue officiel en direct · Lecture vidéo directe par URL.
                    </p>
                  </div>
                  {loadingHome || loadingCatalog ? (
                    <Loader2 className="w-4 h-4 text-[#FF5E1A] animate-spin shrink-0" />
                  ) : null}
                </div>

                <div className="flex items-center gap-1 p-1 bg-[#13151B] border border-white/8 rounded-lg overflow-x-auto no-scrollbar max-w-full">
                  {GENRES.map((genre) => (
                    <button
                      key={genre}
                      type="button"
                      onClick={() => setSelectedGenre(genre)}
                      className={`px-3.5 min-h-[38px] rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        selectedGenre === genre
                          ? 'bg-[#FF5E1A] text-white'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      {genre}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {loadingHome && displayedHomeSeries.length === 0
                  ? Array.from({ length: 6 }).map((_, idx) => (
                      <div
                        key={idx}
                        className="rounded-xl bg-[#13151B] border border-white/8 overflow-hidden animate-pulse"
                      >
                        <div className="aspect-video bg-white/6" />
                        <div className="p-5 space-y-3">
                          <div className="h-3 w-32 rounded bg-white/8" />
                          <div className="h-5 w-3/4 rounded bg-white/10" />
                          <div className="h-3.5 w-full rounded bg-white/6" />
                        </div>
                      </div>
                    ))
                  : displayedHomeSeries.slice(0, 9).map((anime) => {
                  const action = getPrimaryActionForAnime(anime);
                  const inList = watchlistIds.includes(anime.id);
                  const availableSeasons = getSeriesSeasons(anime).filter(
                    (s) => s.episodes.length > 0 && s.status !== 'À venir'
                  );

                  return (
                    <article
                      key={anime.id}
                      className="group rounded-xl bg-[#13151B] border border-white/8 overflow-hidden flex flex-col"
                    >
                      <button
                        type="button"
                        onClick={() => setDetailAnime(anime)}
                        className="relative aspect-video bg-black overflow-hidden text-left cursor-pointer"
                      >
                        <ArtworkImage
                          src={anime.keyVisual || anime.posterImage}
                          alt={anime.title}
                          title={anime.title}
                          accentTint={anime.accentTint}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                        <span className="absolute bottom-3 left-3 text-xs font-mono tabular-nums text-zinc-200">
                          {typeof anime.score === 'number'
                            ? `${anime.score} / 10 · `
                            : ''}
                          {anime.episodesCount === 0 || anime.status === 'À venir'
                            ? `À venir · ${formatReleaseDateFr({
                                nextAiringAt: anime.nextAiringAt,
                                startDate: anime.startDate,
                                seasonName: anime.seasonName,
                                year: anime.year,
                                isUpcoming: true,
                              })}`
                            : `${
                                availableSeasons.length > 1
                                  ? `${availableSeasons.length} saisons · `
                                  : ''
                              }${anime.episodesCount} ép.${anime.year ? ` · ${anime.year}` : ''}`}
                        </span>
                      </button>

                      <div className="p-5 flex-1 flex flex-col justify-between gap-4">
                        <div>
                          <p className="text-xs text-zinc-400 mb-1.5 truncate">
                            {anime.genres.join(' · ')} · {anime.studio}
                          </p>
                          <button
                            type="button"
                            onClick={() => setDetailAnime(anime)}
                            className="text-left cursor-pointer"
                          >
                            <h3 className="text-lg font-display font-semibold text-white group-hover:text-[#FF5E1A] transition-colors line-clamp-1">
                              {anime.title}
                            </h3>
                          </button>
                          <p className="text-sm text-zinc-400 line-clamp-2 mt-1.5 leading-relaxed">
                            {anime.synopsis}
                          </p>
                        </div>

                        <div className="flex items-center justify-between gap-2 pt-3 border-t border-white/8">
                          {action.episode ? (
                            <button
                              type="button"
                              onClick={() =>
                                openPlayer(anime, action.episode, action.startAt)
                              }
                              className="inline-flex items-center justify-center gap-1.5 px-3.5 min-h-[44px] sm:min-h-[38px] rounded-lg bg-white/8 hover:bg-[#FF5E1A] active:bg-[#FF5E1A] text-white text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
                            >
                              <Play className="w-3.5 h-3.5 fill-current" />
                              <span>
                                {action.isResuming
                                  ? `Reprendre S${action.episode.season} E${action.episode.number} · ${formatTimecode(action.startAt)}`
                                  : `Regarder S${action.episode.season} E${action.episode.number}`}
                              </span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled
                              className="inline-flex items-center justify-center gap-1.5 px-3.5 min-h-[44px] sm:min-h-[38px] rounded-lg bg-white/4 border border-white/10 text-zinc-400 text-xs font-medium whitespace-nowrap cursor-not-allowed"
                            >
                              <Clock className="w-3.5 h-3.5 text-amber-400" />
                              <span>À venir</span>
                            </button>
                          )}

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setDetailAnime(anime)}
                              className="px-3 min-h-[44px] sm:min-h-[38px] rounded-lg text-xs font-medium text-zinc-300 hover:text-white hover:bg-white/8 transition-colors whitespace-nowrap cursor-pointer"
                            >
                              Détails
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleWatchlist(anime)}
                              aria-label={
                                inList ? 'Retirer de ma liste' : 'Ajouter à ma liste'
                              }
                              className="min-h-[44px] min-w-[44px] sm:min-h-[38px] sm:min-w-[38px] flex items-center justify-center rounded-lg text-zinc-300 hover:text-white hover:bg-white/8 transition-colors cursor-pointer"
                            >
                              {inList ? (
                                <Check className="w-4 h-4 text-[#FF5E1A]" />
                              ) : (
                                <Bookmark className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            {/* Section 3: Sorties Simulcast réelles */}
            <section className="max-w-[1400px] mx-auto px-4 sm:px-8 py-12">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                <div>
                  <h2 className="text-xl sm:text-2xl font-display font-semibold text-white tracking-tight">
                    Calendrier Simulcast en direct
                  </h2>
                  <p className="text-sm text-zinc-400 mt-1">
                    Horaires réels de diffusion des séries en cours cette semaine.
                  </p>
                </div>

                <div className="flex items-center gap-1 p-1 bg-[#13151B] border border-white/8 rounded-lg overflow-x-auto no-scrollbar max-w-full">
                  {DAYS.map((day) => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => setSelectedSimulcastDay(day)}
                      className={`px-3.5 min-h-[38px] rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        selectedSimulcastDay === day
                          ? 'bg-[#FF5E1A] text-white'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      {day}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-xl bg-[#13151B] border border-white/8 divide-y divide-white/8">
                {simulcastSchedule.filter((s) => s.day === selectedSimulcastDay)
                  .length === 0 ? (
                  <div className="p-8 text-center text-sm text-zinc-400">
                    Aucune diffusion trouvée pour ce {selectedSimulcastDay.toLowerCase()}. Essayez un autre jour.
                  </div>
                ) : (
                  simulcastSchedule
                    .filter((s) => s.day === selectedSimulcastDay)
                    .map((item) => {
                      const action = getPrimaryActionForAnime(item.anime);
                      const isSlotUpcoming = item.airingAt * 1000 > Date.now();
                      const seasonNum = item.seasonNumber ?? 1;
                      const seasonsList = getSeriesSeasons(item.anime);
                      const slotEpisode = !isSlotUpcoming
                        ? (seasonsList
                            .find((s) => s.seasonNumber === seasonNum)
                            ?.episodes.find(
                              (e) => e.number === item.episodeNumber && !e.isUpcoming
                            ) ?? action.episode)
                        : action.episode;
                      return (
                        <div
                          key={item.id}
                          className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                        >
                          <div className="flex items-center gap-4 min-w-0">
                            <span className="text-sm font-mono tabular-nums text-[#FF5E1A] w-14 shrink-0">
                              {item.time}
                            </span>
                            <div className="w-24 aspect-video rounded-lg overflow-hidden bg-black shrink-0">
                              <ArtworkImage
                                src={item.anime.keyVisual || item.anime.posterImage}
                                alt={item.anime.title}
                                title={item.anime.title}
                                accentTint={item.anime.accentTint}
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <div className="min-w-0">
                              <h3 className="text-base font-medium text-white truncate">
                                {item.anime.title}
                              </h3>
                              <p className="text-xs text-zinc-400 truncate mt-0.5">
                                {seasonsList.length > 1
                                  ? `S${seasonNum} Épisode ${item.episodeNumber}`
                                  : `Épisode ${item.episodeNumber}`}{' '}
                                ·{' '}
                                <span
                                  className={
                                    isSlotUpcoming ? 'text-amber-300' : 'text-emerald-400'
                                  }
                                >
                                  {isSlotUpcoming ? 'À venir' : 'Disponible'}
                                </span>{' '}
                                · {item.anime.genres.join(' · ')}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {!isSlotUpcoming && slotEpisode ? (
                              <button
                                type="button"
                                onClick={() =>
                                  openPlayer(
                                    item.anime,
                                    slotEpisode,
                                    slotEpisode.id === action.episode?.id
                                      ? action.startAt
                                      : 0
                                  )
                                }
                                className="inline-flex items-center justify-center gap-1.5 px-4 min-h-[44px] sm:min-h-[38px] rounded-lg bg-white/8 hover:bg-[#FF5E1A] active:bg-[#FF5E1A] text-white text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer flex-1 sm:flex-initial"
                              >
                                <Play className="w-3.5 h-3.5 fill-current" />
                                <span>
                                  {action.isResuming &&
                                  slotEpisode.id === action.episode?.id
                                    ? `Reprendre (${formatTimecode(action.startAt)})`
                                    : `Regarder S${slotEpisode.season} E${slotEpisode.number}`}
                                </span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled
                                className="inline-flex items-center justify-center gap-1.5 px-4 min-h-[44px] sm:min-h-[38px] rounded-lg bg-white/4 border border-white/10 text-zinc-400 text-xs font-medium whitespace-nowrap cursor-not-allowed flex-1 sm:flex-initial"
                              >
                                <Clock className="w-3.5 h-3.5 text-amber-400" />
                                <span>À venir ({item.time})</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setDetailAnime(item.anime)}
                              className="px-3 min-h-[44px] sm:min-h-[38px] rounded-lg text-xs text-zinc-300 hover:text-white hover:bg-white/8 transition-colors whitespace-nowrap cursor-pointer"
                            >
                              Épisodes
                            </button>
                          </div>
                        </div>
                      );
                    })
                )}
              </div>
            </section>
          </>
        ) : null}

        {/* Full Catalogue Page */}
        {activeNav === 'catalogue' ? (
          <section className="max-w-[1400px] mx-auto px-4 sm:px-8 py-10">
            <div className="flex flex-col gap-6 pb-8 border-b border-white/8 mb-8">
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                  <h1 className="text-3xl font-display font-bold text-white tracking-tight">
                    Catalogue d'animés
                  </h1>
                  <p className="text-sm text-zinc-400 mt-1.5">
                    L'intégralité des animés du catalogue, avec navigation par page et toutes leurs saisons.
                  </p>
                </div>

                {/* Direct anime search in catalogue */}
                <div className="relative w-full md:w-80 shrink-0">
                  <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                  <input
                    type="search"
                    enterKeyHint="search"
                    value={catalogSearchQuery}
                    onChange={(e) => setCatalogSearchQuery(e.target.value)}
                    placeholder="Rechercher un animé (ex: One Piece)..."
                    className="w-full pl-10 pr-9 py-2.5 bg-[#13151B] border border-white/10 rounded-xl text-xs sm:text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-[#FF5E1A] transition-colors"
                  />
                  {catalogSearchQuery ? (
                    <button
                      type="button"
                      onClick={() => setCatalogSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white text-xs px-1 cursor-pointer"
                    >
                      ✕
                    </button>
                  ) : null}
                </div>
              </div>

              {/* Filters row: Audio, Sort & Page summary */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1 p-1 bg-[#13151B] border border-white/8 rounded-lg">
                    {(['Tous', 'VOSTFR', 'VF'] as const).map((aud) => (
                      <button
                        key={aud}
                        type="button"
                        onClick={() => setSelectedAudio(aud)}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                          selectedAudio === aud
                            ? 'bg-[#FF5E1A] text-white'
                            : 'text-zinc-400 hover:text-white'
                        }`}
                      >
                        {aud}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-1 p-1 bg-[#13151B] border border-white/8 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setCatalogSort('POPULARITY_DESC')}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                        catalogSort === 'POPULARITY_DESC'
                          ? 'bg-white/14 text-white'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      Populaires
                    </button>
                    <button
                      type="button"
                      onClick={() => setCatalogSort('SCORE_DESC')}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                        catalogSort === 'SCORE_DESC'
                          ? 'bg-white/14 text-white'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      Mieux notés
                    </button>
                    <button
                      type="button"
                      onClick={() => setCatalogSort('START_DATE_DESC')}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                        catalogSort === 'START_DATE_DESC'
                          ? 'bg-white/14 text-white'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      Récents
                    </button>
                  </div>
                </div>

                {catalogPageInfo.total > 0 ? (
                  <div className="text-xs font-mono tabular-nums text-zinc-400 flex items-center gap-2">
                    {loadingCatalog ? (
                      <Loader2 className="w-3.5 h-3.5 text-[#FF5E1A] animate-spin" />
                    ) : null}
                    <span>
                      Page {catalogPage} sur {catalogPageInfo.lastPage} · {catalogPageInfo.total.toLocaleString('fr-FR')} animés
                    </span>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-1 p-1 bg-[#13151B] border border-white/8 rounded-lg overflow-x-auto no-scrollbar mb-8 w-fit max-w-full">
              {GENRES.map((genre) => (
                <button
                  key={genre}
                  type="button"
                  onClick={() => setSelectedGenre(genre)}
                  className={`px-3.5 min-h-[38px] rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    selectedGenre === genre
                      ? 'bg-[#FF5E1A] text-white'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {genre}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {displayedCatalogue.map((anime) => {
                const action = getPrimaryActionForAnime(anime);
                const inList = watchlistIds.includes(anime.id);
                const availableSeasons = getSeriesSeasons(anime).filter(
                  (s) => s.episodes.length > 0 && s.status !== 'À venir'
                );

                return (
                  <article
                    key={anime.id}
                    className="group rounded-xl bg-[#13151B] border border-white/8 overflow-hidden flex flex-col"
                  >
                    <button
                      type="button"
                      onClick={() => setDetailAnime(anime)}
                      className="relative aspect-video bg-black overflow-hidden cursor-pointer"
                    >
                      <ArtworkImage
                        src={anime.keyVisual || anime.posterImage}
                        alt={anime.title}
                        title={anime.title}
                        accentTint={anime.accentTint}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                      <span className="absolute bottom-3 left-3 text-xs font-mono tabular-nums text-zinc-200">
                        {typeof anime.score === 'number'
                          ? `${anime.score} / 10 · `
                          : ''}
                        {availableSeasons.length > 1
                          ? `${availableSeasons.length} saisons · `
                          : ''}
                        {anime.status === 'À venir'
                          ? `À venir · ${formatReleaseDateFr({
                              nextAiringAt: anime.nextAiringAt,
                              startDate: anime.startDate,
                              seasonName: anime.seasonName,
                              year: anime.year,
                              isUpcoming: true,
                            })}`
                          : `${anime.year ? `${anime.year} · ` : ''}${anime.status}`}
                      </span>
                    </button>

                    <div className="p-5 flex-1 flex flex-col justify-between gap-4">
                      <div>
                        <p className="text-xs text-zinc-400 mb-1 truncate">
                          {anime.genres.join(' · ')} · {anime.studio}
                        </p>
                        <button
                          type="button"
                          onClick={() => setDetailAnime(anime)}
                          className="text-left cursor-pointer"
                        >
                          <h3 className="text-lg font-display font-semibold text-white hover:text-[#FF5E1A] transition-colors line-clamp-1">
                            {anime.title}
                          </h3>
                        </button>
                        <p className="text-sm text-zinc-400 line-clamp-2 mt-1.5">
                          {anime.synopsis}
                        </p>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-3 border-t border-white/8">
                        {action.episode ? (
                          <button
                            type="button"
                            onClick={() =>
                              openPlayer(anime, action.episode, action.startAt)
                            }
                            className="inline-flex items-center gap-1.5 px-3.5 min-h-[44px] sm:min-h-[38px] rounded-lg bg-[#FF5E1A] hover:bg-[#e85112] text-white text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>
                              {action.isResuming
                                ? `Reprendre · ${formatTimecode(action.startAt)}`
                                : `Regarder S${action.episode.season} E${action.episode.number}`}
                            </span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled
                            className="inline-flex items-center gap-1.5 px-3.5 min-h-[44px] sm:min-h-[38px] rounded-lg bg-white/4 border border-white/10 text-zinc-400 text-xs font-medium whitespace-nowrap cursor-not-allowed"
                          >
                            <Clock className="w-3.5 h-3.5 text-amber-400" />
                            <span>À venir</span>
                          </button>
                        )}

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setDetailAnime(anime)}
                            className="px-3 py-2 rounded-lg text-xs font-medium text-zinc-300 hover:text-white hover:bg-white/8 transition-colors cursor-pointer"
                          >
                            Épisodes
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleWatchlist(anime)}
                            aria-label="Basculer dans ma liste"
                            className="p-2 rounded-lg text-zinc-300 hover:text-white hover:bg-white/8 transition-colors cursor-pointer"
                          >
                            {inList ? (
                              <Check className="w-4 h-4 text-[#FF5E1A]" />
                            ) : (
                              <Bookmark className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            {/* Empty state when no anime match filter or search */}
            {!loadingCatalog && displayedCatalogue.length === 0 ? (
              <div className="py-16 px-4 text-center rounded-2xl bg-[#13151B] border border-white/8 max-w-md mx-auto my-6">
                <Search className="w-8 h-8 text-zinc-500 mx-auto mb-3" />
                <h3 className="text-base font-semibold text-white mb-1">
                  Aucun animé trouvé
                </h3>
                <p className="text-xs text-zinc-400 mb-5">
                  {catalogSearchQuery
                    ? `Aucun résultat pour « ${catalogSearchQuery} » dans cette catégorie.`
                    : 'Aucun animé ne correspond aux filtres sélectionnés.'}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setCatalogSearchQuery('');
                    setSelectedGenre('Tout');
                    setSelectedAudio('Tous');
                    setCatalogSort('POPULARITY_DESC');
                    setCatalogPage(1);
                  }}
                  className="px-4 py-2 rounded-lg bg-[#FF5E1A] hover:bg-[#e85112] text-xs font-semibold text-white transition-colors cursor-pointer"
                >
                  Réinitialiser les filtres
                </button>
              </div>
            ) : null}

            {/* Pagination Controls */}
            {catalogPageInfo.lastPage > 1 ? (
              <div className="mt-12 pt-8 border-t border-white/8 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="text-xs font-mono tabular-nums text-zinc-400 order-2 sm:order-1">
                  Page {catalogPage} sur {catalogPageInfo.lastPage} ({catalogPageInfo.total.toLocaleString('fr-FR')} animés au catalogue)
                </div>

                <div className="flex items-center gap-2 order-1 sm:order-2">
                  <button
                    type="button"
                    disabled={catalogPage <= 1 || loadingCatalog}
                    onClick={() => {
                      setCatalogPage((p) => Math.max(1, p - 1));
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 min-h-[40px] rounded-lg bg-[#13151B] border border-white/10 text-xs font-medium text-zinc-300 hover:text-white hover:border-white/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span>Page précédente</span>
                  </button>

                  {/* Page indicator pills */}
                  <div className="hidden sm:flex items-center gap-1">
                    {catalogPage > 2 ? (
                      <button
                        type="button"
                        onClick={() => {
                          setCatalogPage(1);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="w-9 h-9 rounded-lg text-xs font-mono tabular-nums text-zinc-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
                      >
                        1
                      </button>
                    ) : null}
                    {catalogPage > 3 ? (
                      <span className="text-zinc-600 px-1">…</span>
                    ) : null}
                    {catalogPage > 1 ? (
                      <button
                        type="button"
                        onClick={() => {
                          setCatalogPage(catalogPage - 1);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="w-9 h-9 rounded-lg text-xs font-mono tabular-nums text-zinc-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
                      >
                        {catalogPage - 1}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled
                      className="w-9 h-9 rounded-lg text-xs font-mono tabular-nums font-semibold bg-[#FF5E1A] text-white"
                    >
                      {catalogPage}
                    </button>
                    {catalogPage < catalogPageInfo.lastPage ? (
                      <button
                        type="button"
                        onClick={() => {
                          setCatalogPage(catalogPage + 1);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="w-9 h-9 rounded-lg text-xs font-mono tabular-nums text-zinc-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
                      >
                        {catalogPage + 1}
                      </button>
                    ) : null}
                    {catalogPage < catalogPageInfo.lastPage - 2 ? (
                      <span className="text-zinc-600 px-1">…</span>
                    ) : null}
                    {catalogPage < catalogPageInfo.lastPage - 1 ? (
                      <button
                        type="button"
                        onClick={() => {
                          setCatalogPage(catalogPageInfo.lastPage);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="w-9 h-9 rounded-lg text-xs font-mono tabular-nums text-zinc-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
                      >
                        {catalogPageInfo.lastPage}
                      </button>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    disabled={!catalogPageInfo.hasNextPage || loadingCatalog}
                    onClick={() => {
                      setCatalogPage((p) => p + 1);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 min-h-[40px] rounded-lg bg-[#13151B] border border-white/10 text-xs font-medium text-zinc-300 hover:text-white hover:border-white/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  >
                    <span>Page suivante</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        {/* Full Weekly Simulcast View */}
        {activeNav === 'simulcast' ? (
          <section className="max-w-[1400px] mx-auto px-4 sm:px-8 py-10">
            <div className="pb-8 border-b border-white/8 mb-8">
              <h1 className="text-3xl font-display font-bold text-white tracking-tight">
                Programme Simulcast hebdomadaire
              </h1>
              <p className="text-sm text-zinc-400 mt-1.5">
                Diffusions officielles de la semaine en cours.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {DAYS.map((day) => {
                const list = simulcastSchedule.filter((s) => s.day === day);
                return (
                  <div
                    key={day}
                    className="rounded-xl bg-[#13151B] border border-white/8 p-5"
                  >
                    <div className="flex items-center justify-between pb-3 mb-4 border-b border-white/8">
                      <h2 className="text-base font-display font-semibold text-white">
                        {day}
                      </h2>
                      <span className="text-xs font-mono tabular-nums text-zinc-400">
                        {list.length} sortie{list.length > 1 ? 's' : ''}
                      </span>
                    </div>

                    {list.length === 0 ? (
                      <p className="text-xs text-zinc-500 py-3">
                        Aucune diffusion programmée ce jour.
                      </p>
                    ) : (
                      <div className="space-y-4">
                        {list.map((item) => {
                          const action = getPrimaryActionForAnime(item.anime);
                          const isSlotUpcoming = item.airingAt * 1000 > Date.now();
                          const seasonNum = item.seasonNumber ?? 1;
                          const seasonsList = getSeriesSeasons(item.anime);
                          const slotEpisode = !isSlotUpcoming
                            ? (seasonsList
                                .find((s) => s.seasonNumber === seasonNum)
                                ?.episodes.find(
                                  (e) => e.number === item.episodeNumber && !e.isUpcoming
                                ) ?? action.episode)
                            : action.episode;
                          return (
                            <div
                              key={item.id}
                              className="flex items-center justify-between gap-3"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <span className="text-xs font-mono tabular-nums text-[#FF5E1A] shrink-0">
                                  {item.time}
                                </span>
                                <div className="min-w-0">
                                  <button
                                    type="button"
                                    onClick={() => setDetailAnime(item.anime)}
                                    className="text-sm font-medium text-white hover:text-[#FF5E1A] transition-colors truncate block text-left cursor-pointer"
                                  >
                                    {item.anime.title}
                                  </button>
                                  <p className="text-xs text-zinc-400 truncate">
                                    {seasonsList.length > 1
                                      ? `S${seasonNum} Épisode ${item.episodeNumber}`
                                      : `Épisode ${item.episodeNumber}`}{' '}
                                    ·{' '}
                                    <span
                                      className={
                                        isSlotUpcoming ? 'text-amber-300' : 'text-emerald-400'
                                      }
                                    >
                                      {isSlotUpcoming ? 'À venir' : 'Disponible'}
                                    </span>{' '}
                                    · {item.anime.genres.join(' · ')}
                                  </p>
                                </div>
                              </div>

                              {!isSlotUpcoming && slotEpisode ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    openPlayer(
                                      item.anime,
                                      slotEpisode,
                                      slotEpisode.id === action.episode?.id
                                        ? action.startAt
                                        : 0
                                    )
                                  }
                                  className="px-3 min-h-[38px] rounded-lg bg-white/8 hover:bg-[#FF5E1A] text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                                >
                                  {action.isResuming &&
                                  slotEpisode.id === action.episode?.id
                                    ? 'Reprendre'
                                    : `Regarder S${slotEpisode.season} E${slotEpisode.number}`}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled
                                  className="inline-flex items-center gap-1 px-3 min-h-[38px] rounded-lg bg-white/4 border border-white/10 text-zinc-400 text-xs font-medium whitespace-nowrap shrink-0 cursor-not-allowed"
                                >
                                  <Clock className="w-3 h-3 text-amber-400" />
                                  <span>À venir ({item.time})</span>
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {/* Ma Liste View */}
        {activeNav === 'maliste' ? (
          <section className="max-w-[1400px] mx-auto px-4 sm:px-8 py-10">
            <div className="pb-8 border-b border-white/8 mb-8">
              <h1 className="text-3xl font-display font-bold text-white tracking-tight">
                Ma Liste
              </h1>
              <p className="text-sm text-zinc-400 mt-1.5">
                Vos vrais animés enregistrés pour reprendre votre visionnage à tout moment.
              </p>
            </div>

            {watchlistSeries.length === 0 ? (
              <div className="rounded-xl bg-[#13151B] border border-white/8 p-12 text-center">
                <p className="text-base text-zinc-200 mb-2">
                  Votre liste est vide pour le moment.
                </p>
                <p className="text-sm text-zinc-400 mb-6">
                  Ajoutez des animés depuis l’accueil, la recherche ou le catalogue pour les retrouver ici.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveNav('catalogue')}
                  className="px-5 py-2.5 rounded-lg bg-[#FF5E1A] hover:bg-[#e85112] text-white text-sm font-semibold transition-colors cursor-pointer"
                >
                  Explorer le catalogue
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {watchlistSeries.map((anime) => {
                  const action = getPrimaryActionForAnime(anime);
                  return (
                    <article
                      key={anime.id}
                      className="group rounded-xl bg-[#13151B] border border-white/8 overflow-hidden flex flex-col"
                    >
                      <button
                        type="button"
                        onClick={() => setDetailAnime(anime)}
                        className="relative aspect-video bg-black overflow-hidden cursor-pointer"
                      >
                        <ArtworkImage
                          src={anime.keyVisual || anime.posterImage}
                          alt={anime.title}
                          title={anime.title}
                          accentTint={anime.accentTint}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent" />
                      </button>

                      <div className="p-5 flex-1 flex flex-col justify-between gap-4">
                        <div>
                          <p className="text-xs text-zinc-400 mb-1">
                            {anime.genres.join(' · ')} ·{' '}
                            {anime.episodesCount === 0 || anime.status === 'À venir'
                              ? 'À venir'
                              : `${anime.episodesCount} ép.`}
                          </p>
                          <h3 className="text-lg font-display font-semibold text-white">
                            {anime.title}
                          </h3>
                        </div>

                        <div className="flex items-center justify-between gap-2 pt-3 border-t border-white/8">
                          {action.episode ? (
                            <button
                              type="button"
                              onClick={() =>
                                openPlayer(anime, action.episode, action.startAt)
                              }
                              className="inline-flex items-center gap-1.5 px-3.5 min-h-[44px] sm:min-h-[38px] rounded-lg bg-[#FF5E1A] hover:bg-[#e85112] text-white text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
                            >
                              <Play className="w-3.5 h-3.5 fill-current" />
                              <span>
                                {action.isResuming
                                  ? `Reprendre · ${formatTimecode(action.startAt)}`
                                  : 'Regarder'}
                              </span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled
                              className="inline-flex items-center gap-1.5 px-3.5 min-h-[44px] sm:min-h-[38px] rounded-lg bg-white/4 border border-white/10 text-zinc-400 text-xs font-medium whitespace-nowrap cursor-not-allowed"
                            >
                              <Clock className="w-3.5 h-3.5 text-amber-400" />
                              <span>À venir</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => toggleWatchlist(anime)}
                            className="px-3 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-white hover:bg-white/8 transition-colors whitespace-nowrap cursor-pointer"
                          >
                            Retirer
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        ) : null}
      </main>

      {/* Quiet Editorial Footer (extra bottom padding for mobile tab bar + safe area) */}
      <footer className="border-t border-white/8 bg-[#0B0C10] pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-8 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <span className="text-base font-display font-bold text-white">
              KuroStream
            </span>
            <p className="text-xs text-zinc-500 mt-1">
              Plateforme d'animés en haute définition · Reprise de lecture à la seconde près
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-5 text-xs text-zinc-400">
            <button
              type="button"
              onClick={() => setActiveNav('accueil')}
              className="hover:text-white transition-colors cursor-pointer min-h-[36px]"
            >
              Accueil
            </button>
            <button
              type="button"
              onClick={() => setActiveNav('catalogue')}
              className="hover:text-white transition-colors cursor-pointer min-h-[36px]"
            >
              Catalogue
            </button>
            <button
              type="button"
              onClick={() => setActiveNav('simulcast')}
              className="hover:text-white transition-colors cursor-pointer min-h-[36px]"
            >
              Simulcast
            </button>
            <button
              type="button"
              onClick={() => setActiveNav('maliste')}
              className="hover:text-white transition-colors cursor-pointer min-h-[36px]"
            >
              Ma Liste
            </button>
          </div>
        </div>
      </footer>

      {/* iPhone Fixed Bottom Tab Bar (Thumb-Zone Navigation) */}
      <nav
        aria-label="Navigation mobile"
        className="fixed bottom-0 inset-x-0 z-40 md:hidden bg-[#0B0C10]/94 backdrop-blur-md border-t border-white/10 pb-[env(safe-area-inset-bottom)]"
      >
        <div className="grid grid-cols-4 h-14">
          {(
            [
              { id: 'accueil', label: 'Accueil', icon: Home },
              { id: 'catalogue', label: 'Catalogue', icon: LayoutGrid },
              { id: 'simulcast', label: 'Simulcast', icon: CalendarClock },
              { id: 'maliste', label: 'Ma Liste', icon: Bookmark },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const active = activeNav === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActiveNav(tab.id);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className={`flex flex-col items-center justify-center gap-0.5 min-h-[44px] transition-colors cursor-pointer ${
                  active ? 'text-[#FF5E1A]' : 'text-zinc-400 active:text-white'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[11px] font-medium tracking-tight leading-none">
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Live Search Modal */}
      {searchOpen ? (
        <SearchModal
          initialList={trendingSeries}
          onSelectAnime={(anime) => setDetailAnime(anime)}
          onClose={() => setSearchOpen(false)}
        />
      ) : null}

      {/* Series Detail & Episode List Modal */}
      {detailAnime ? (
        <AnimeDetailModal
          anime={detailAnime}
          inWatchlist={watchlistIds.includes(detailAnime.id)}
          progressByEpisode={progressByEpisode}
          latestProgress={getLatestProgressForAnime(detailAnime.id)}
          onToggleWatchlist={toggleWatchlist}
          onPlayEpisode={openPlayer}
          onClose={() => setDetailAnime(null)}
        />
      ) : null}

      {/* HD Video Player Modal */}
      {playerState ? (
        <VideoPlayerModal
          anime={playerState.anime}
          episode={playerState.episode}
          initialTime={playerState.startAt}
          preferences={preferences}
          progressByEpisode={progressByEpisode}
          onUpdatePreferences={updatePreferences}
          onSaveProgress={saveEpisodeProgress}
          onMarkCompleted={markEpisodeCompleted}
          onSelectEpisode={(nextEp, startAt = 0) =>
            setPlayerState({
              anime: playerState.anime,
              episode: nextEp,
              startAt,
            })
          }
          onClose={() => setPlayerState(null)}
        />
      ) : null}

      {/* Profile Selector Screen ("Qui regarde ?") displayed directly on arrival or when clicking profile */}
      {!hasSelectedSessionProfile || profileSelectOpen ? (
        <ProfileSelectModal
          profiles={profiles}
          activeProfileId={activeProfileId}
          canClose={hasSelectedSessionProfile}
          onSelectProfile={(id) => {
            selectProfile(id);
            setProfileSelectOpen(false);
          }}
          onCreateProfile={async (data) => {
            return await createProfile(data);
          }}
          onUpdateProfile={async (id, patch) => {
            await updateProfile(id, patch);
          }}
          onDeleteProfile={async (id) => {
            await deleteProfile(id);
          }}
          onClose={() => setProfileSelectOpen(false)}
        />
      ) : null}

      {/* Profile Edit / Create Modal */}
      {profileEditModalOpen ? (
        <ProfileEditModal
          profileToEdit={profileToEdit}
          canDelete={profiles.length > 1}
          onSave={async (data) => {
            if (profileToEdit) {
              await updateProfile(profileToEdit.id, data);
            } else {
              await createProfile(data);
            }
            setProfileEditModalOpen(false);
            setProfileToEdit(null);
          }}
          onDelete={async (id) => {
            await deleteProfile(id);
            setProfileEditModalOpen(false);
            setProfileToEdit(null);
          }}
          onClose={() => {
            setProfileEditModalOpen(false);
            setProfileToEdit(null);
          }}
        />
      ) : null}
    </div>
  );
}
