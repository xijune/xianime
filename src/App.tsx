import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Film,
  Info,
  Loader2,
  Play,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import {
  FALLBACK_ANIME_CATALOG,
  formatRemainingMinutes,
  formatTimecode,
  type AnimeSeries,
  type AudioTrack,
  type Episode,
  type SimulcastDay,
  type SimulcastScheduleItem,
} from './data/animeCatalog';
import {
  fetchHomeCatalog,
  fetchWeeklySchedule,
  searchRealAnime,
} from './services/anilistApi';
import { useWatchProgress } from './hooks/useWatchProgress';
import { ArtworkImage } from './components/ArtworkImage';
import { VideoPlayerModal } from './components/VideoPlayerModal';
import { AnimeDetailModal } from './components/AnimeDetailModal';
import { SearchModal } from './components/SearchModal';

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
    progressByEpisode,
    continueWatchingList,
    watchlistSeries,
    watchlistIds,
    preferences,
    saveEpisodeProgress,
    removeEpisodeProgress,
    markEpisodeCompleted,
    toggleWatchlist,
    updatePreferences,
    getLatestProgressForAnime,
  } = useWatchProgress();

  const [activeNav, setActiveNav] = useState<NavSection>('accueil');
  const [heroIndex, setHeroIndex] = useState(0);
  const [selectedGenre, setSelectedGenre] = useState<string>('Tout');
  const [selectedAudio, setSelectedAudio] = useState<'Tous' | AudioTrack>('Tous');
  const [catalogSort, setCatalogSort] = useState<'POPULARITY_DESC' | 'SCORE_DESC' | 'START_DATE_DESC'>('POPULARITY_DESC');
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

  // Live AniList Catalog State
  const [featuredSeries, setFeaturedSeries] = useState<AnimeSeries[]>(
    FALLBACK_ANIME_CATALOG.slice(0, 3)
  );
  const [trendingSeries, setTrendingSeries] = useState<AnimeSeries[]>(FALLBACK_ANIME_CATALOG);
  const [catalogSeries, setCatalogSeries] = useState<AnimeSeries[]>(FALLBACK_ANIME_CATALOG);
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
    mode?: 'video' | 'trailer' | 'canvas';
  } | null>(null);

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
        setApiNotice('Mode hors-ligne actif (catalogue de secours affiché).');
        setLoadingHome(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch filtered real anime when genre or sort changes
  useEffect(() => {
    let cancelled = false;
    if (selectedGenre === 'Tout' && catalogSort === 'POPULARITY_DESC' && trendingSeries.length > 6) {
      return;
    }

    setLoadingCatalog(true);
    void searchRealAnime({
      genreFr: selectedGenre,
      sort: catalogSort,
      perPage: 18,
    })
      .then((items) => {
        if (cancelled) return;
        if (items.length > 0) {
          setCatalogSeries(items);
        }
        setLoadingCatalog(false);
      })
      .catch(() => {
        if (!cancelled) setLoadingCatalog(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedGenre, catalogSort, trendingSeries.length]);

  const activeHero = featuredSeries[heroIndex % featuredSeries.length] ?? featuredSeries[0];

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
      episode: Episode,
      startAt = 0,
      mode?: 'video' | 'trailer' | 'canvas'
    ) => {
      setDetailAnime(null);
      setPlayerState({ anime, episode, startAt, mode });
    },
    []
  );

  const getPrimaryActionForAnime = useCallback(
    (anime: AnimeSeries) => {
      const latest = getLatestProgressForAnime(anime.id);
      if (latest && !latest.completed && latest.currentTime > 3) {
        const ep =
          anime.episodes.find((e) => e.id === latest.episodeId) ??
          latest.snapshot?.episode;
        if (ep) {
          return {
            episode: ep,
            startAt: latest.currentTime,
            isResuming: true,
          };
        }
      }
      return {
        episode: anime.episodes[0],
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
    return catalogSeries.filter(
      (a) => selectedAudio === 'Tous' || a.audioTracks.includes(selectedAudio)
    );
  }, [catalogSeries, selectedAudio]);

  const heroAction = getPrimaryActionForAnime(activeHero);
  const heroInWatchlist = watchlistIds.includes(activeHero.id);

  return (
    <div className="min-h-screen bg-[#0B0C10] text-[#F3F4F6] flex flex-col">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="sticky top-0 z-30 bg-[#0B0C10]/92 backdrop-blur-md border-b border-white/8">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single-element Brand Wordmark */}
          <button
            type="button"
            onClick={() => setActiveNav('accueil')}
            className="text-xl font-display font-bold tracking-tight text-white whitespace-nowrap shrink-0 cursor-pointer"
          >
            KuroStream
          </button>

          {/* Zone 2: 4 single-line navigation links */}
          <nav
            aria-label="Navigation principale"
            className="flex items-center gap-5 sm:gap-7 overflow-x-auto"
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

          {/* Zone 3: 1 Primary Action */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#181B24] hover:bg-[#222633] border border-white/10 text-xs sm:text-sm font-medium text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Search className="w-4 h-4 text-zinc-300" />
              <span className="hidden sm:inline">Rechercher</span>
            </button>
          </div>
        </div>
      </header>

      {apiNotice ? (
        <div className="bg-[#181B24] border-b border-white/8 px-4 py-2 text-center text-xs text-amber-300">
          {apiNotice}
        </div>
      ) : null}

      <main className="flex-1">
        {activeNav === 'accueil' ? (
          <>
            {/* Hero Spotlight */}
            <section className="relative w-full border-b border-white/8 overflow-hidden">
              <div className="relative max-w-[1400px] mx-auto aspect-[16/10] sm:aspect-[16/7] min-h-[380px] max-h-[560px]">
                <ArtworkImage
                  src={activeHero.keyVisual || activeHero.posterImage}
                  alt={activeHero.title}
                  title={activeHero.title}
                  accentTint={activeHero.accentTint}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-r from-[#0B0C10] via-[#0B0C10]/82 to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0B0C10] via-transparent to-[#0B0C10]/35" />

                <div className="absolute inset-0 flex items-end sm:items-center px-5 sm:px-10 pb-8 sm:pb-0">
                  <div className="max-w-xl">
                    <p className="text-xs sm:text-sm text-zinc-300 mb-2.5">
                      {activeHero.genres.join(' · ')} · {activeHero.year} ·{' '}
                      {activeHero.studio} · {activeHero.episodesCount} ép. ·{' '}
                      {activeHero.score}/10
                    </p>

                    <h1
                      className="font-display font-bold text-white tracking-tight leading-[1.08] mb-3.5"
                      style={{
                        fontSize: 'clamp(2rem, 4vw, 3.3rem)',
                        textWrap: 'balance',
                      }}
                    >
                      {activeHero.title}
                    </h1>

                    <p className="text-sm sm:text-base text-zinc-300 leading-relaxed line-clamp-3 mb-6">
                      {activeHero.synopsis}
                    </p>

                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          openPlayer(
                            activeHero,
                            heroAction.episode,
                            heroAction.startAt
                          )
                        }
                        className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-[#FF5E1A] hover:bg-[#e85112] text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Play className="w-4 h-4 fill-current" />
                        <span>
                          {heroAction.isResuming
                            ? `Reprendre E${heroAction.episode.number} · ${formatTimecode(heroAction.startAt)}`
                            : `Regarder Épisode ${heroAction.episode.number}`}
                        </span>
                      </button>

                      {activeHero.trailerYoutubeId ? (
                        <button
                          type="button"
                          onClick={() =>
                            openPlayer(
                              activeHero,
                              heroAction.episode,
                              0,
                              'trailer'
                            )
                          }
                          className="inline-flex items-center gap-2 px-4 py-3 rounded-lg bg-white/12 hover:bg-white/20 text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <Film className="w-4 h-4" />
                          <span>Bande-annonce</span>
                        </button>
                      ) : null}

                      <button
                        type="button"
                        onClick={() => setDetailAnime(activeHero)}
                        className="inline-flex items-center gap-2 px-4 py-3 rounded-lg bg-white/10 hover:bg-white/16 text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Info className="w-4 h-4" />
                        <span>Épisodes</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => toggleWatchlist(activeHero)}
                        aria-label={
                          heroInWatchlist
                            ? 'Retirer de ma liste'
                            : 'Ajouter à ma liste'
                        }
                        className="inline-flex items-center gap-2 px-4 py-3 rounded-lg bg-black/45 hover:bg-white/12 border border-white/15 text-zinc-200 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        {heroInWatchlist ? (
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

                {/* Clean Hero Slide Switcher */}
                <div className="absolute right-5 bottom-6 flex items-center gap-2">
                  <span className="text-xs font-mono tabular-nums text-zinc-400 mr-1">
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
                    className="p-2 rounded-lg bg-black/60 hover:bg-black/85 border border-white/15 text-white transition-colors cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Animé suivant"
                    onClick={() =>
                      setHeroIndex((prev) => (prev + 1) % featuredSeries.length)
                    }
                    className="p-2 rounded-lg bg-black/60 hover:bg-black/85 border border-white/15 text-white transition-colors cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
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
                    Lancez un animé ci-dessous, chargez un fichier vidéo ou testez l’aperçu puis mettez en pause pour sauvegarder votre position.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {continueWatchingList.map((entry) => {
                    const anime =
                      entry.snapshot?.anime ??
                      trendingSeries.find((a) => a.id === entry.animeId) ??
                      catalogSeries.find((a) => a.id === entry.animeId);
                    const episode =
                      entry.snapshot?.episode ??
                      anime?.episodes.find((e) => e.id === entry.episodeId);
                    if (!anime || !episode) return null;

                    const pct =
                      entry.duration > 0
                        ? Math.min(100, (entry.currentTime / entry.duration) * 100)
                        : 0;

                    return (
                      <article
                        key={entry.episodeId}
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
                            onClick={() => removeEpisodeProgress(entry.episodeId)}
                            title="Retirer de la reprise"
                            aria-label="Retirer cet épisode de la liste de reprise"
                            className="absolute top-2.5 right-2.5 p-1.5 rounded-lg bg-black/70 hover:bg-black text-zinc-300 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
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
                      Catalogue officiel en direct · Bandes-annonces HD et lecture vidéo locale.
                    </p>
                  </div>
                  {loadingHome || loadingCatalog ? (
                    <Loader2 className="w-4 h-4 text-[#FF5E1A] animate-spin shrink-0" />
                  ) : null}
                </div>

                <div className="flex items-center gap-1 p-1 bg-[#13151B] border border-white/8 rounded-lg overflow-x-auto">
                  {GENRES.map((genre) => (
                    <button
                      key={genre}
                      type="button"
                      onClick={() => setSelectedGenre(genre)}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
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
                {displayedHomeSeries.slice(0, 9).map((anime) => {
                  const action = getPrimaryActionForAnime(anime);
                  const inList = watchlistIds.includes(anime.id);

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
                          {anime.score} / 10 · {anime.episodesCount} ép. · {anime.year}
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
                          <button
                            type="button"
                            onClick={() =>
                              openPlayer(anime, action.episode, action.startAt)
                            }
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white/8 hover:bg-[#FF5E1A] text-white text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>
                              {action.isResuming
                                ? `Reprendre E${action.episode.number} · ${formatTimecode(action.startAt)}`
                                : `Regarder E${action.episode.number}`}
                            </span>
                          </button>

                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setDetailAnime(anime)}
                              className="px-3 py-2 rounded-lg text-xs font-medium text-zinc-300 hover:text-white hover:bg-white/8 transition-colors whitespace-nowrap cursor-pointer"
                            >
                              Détails
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleWatchlist(anime)}
                              aria-label={
                                inList ? 'Retirer de ma liste' : 'Ajouter à ma liste'
                              }
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

                <div className="flex items-center gap-1 p-1 bg-[#13151B] border border-white/8 rounded-lg overflow-x-auto">
                  {DAYS.map((day) => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => setSelectedSimulcastDay(day)}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
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
                                Épisode {item.episodeNumber} · {item.anime.genres.join(' · ')}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() =>
                                openPlayer(
                                  item.anime,
                                  action.episode,
                                  action.startAt
                                )
                              }
                              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/8 hover:bg-[#FF5E1A] text-white text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
                            >
                              <Play className="w-3.5 h-3.5 fill-current" />
                              <span>
                                {action.isResuming
                                  ? `Reprendre (${formatTimecode(action.startAt)})`
                                  : 'Regarder'}
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setDetailAnime(item.anime)}
                              className="px-3 py-2 rounded-lg text-xs text-zinc-300 hover:text-white hover:bg-white/8 transition-colors whitespace-nowrap cursor-pointer"
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
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-8 border-b border-white/8 mb-8">
              <div>
                <h1 className="text-3xl font-display font-bold text-white tracking-tight">
                  Catalogue AniList complet
                </h1>
                <p className="text-sm text-zinc-400 mt-1.5">
                  Parcourez les vrais animés par genre, classement ou nouveautés.
                </p>
              </div>

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
            </div>

            <div className="flex items-center gap-1 p-1 bg-[#13151B] border border-white/8 rounded-lg overflow-x-auto mb-8 w-fit max-w-full">
              {GENRES.map((genre) => (
                <button
                  key={genre}
                  type="button"
                  onClick={() => setSelectedGenre(genre)}
                  className={`px-3.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
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
                        {anime.score} / 10 · {anime.year} · {anime.status}
                      </span>
                    </button>

                    <div className="p-5 flex-1 flex flex-col justify-between gap-4">
                      <div>
                        <p className="text-xs text-zinc-400 mb-1 truncate">
                          {anime.genres.join(' · ')} · {anime.studio}
                        </p>
                        <h3 className="text-lg font-display font-semibold text-white line-clamp-1">
                          {anime.title}
                        </h3>
                        <p className="text-sm text-zinc-400 line-clamp-2 mt-1.5">
                          {anime.synopsis}
                        </p>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-3 border-t border-white/8">
                        <button
                          type="button"
                          onClick={() =>
                            openPlayer(anime, action.episode, action.startAt)
                          }
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#FF5E1A] hover:bg-[#e85112] text-white text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                          <span>
                            {action.isResuming
                              ? `Reprendre · ${formatTimecode(action.startAt)}`
                              : `Regarder E${action.episode.number}`}
                          </span>
                        </button>

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
                Diffusions officielles de la semaine en cours (source AniList en direct).
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
                                    Épisode {item.episodeNumber} · {item.anime.genres.join(' · ')}
                                  </p>
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={() =>
                                  openPlayer(
                                    item.anime,
                                    action.episode,
                                    action.startAt
                                  )
                                }
                                className="px-3 py-1.5 rounded-lg bg-white/8 hover:bg-[#FF5E1A] text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                {action.isResuming ? 'Reprendre' : 'Regarder'}
                              </button>
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
                            {anime.genres.join(' · ')} · {anime.episodesCount} ép.
                          </p>
                          <h3 className="text-lg font-display font-semibold text-white">
                            {anime.title}
                          </h3>
                        </div>

                        <div className="flex items-center justify-between gap-2 pt-3 border-t border-white/8">
                          <button
                            type="button"
                            onClick={() =>
                              openPlayer(anime, action.episode, action.startAt)
                            }
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#FF5E1A] hover:bg-[#e85112] text-white text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>
                              {action.isResuming
                                ? `Reprendre · ${formatTimecode(action.startAt)}`
                                : 'Regarder'}
                            </span>
                          </button>

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

      {/* Quiet Editorial Footer */}
      <footer className="border-t border-white/8 bg-[#0B0C10]">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-8 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <span className="text-base font-display font-bold text-white">
              KuroStream
            </span>
            <p className="text-xs text-zinc-500 mt-1">
              Catalogue temps réel AniList & Jikan · Lecteur HD avec reprise à la seconde près
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-5 text-xs text-zinc-400">
            <button
              type="button"
              onClick={() => setActiveNav('accueil')}
              className="hover:text-white transition-colors cursor-pointer"
            >
              Accueil
            </button>
            <button
              type="button"
              onClick={() => setActiveNav('catalogue')}
              className="hover:text-white transition-colors cursor-pointer"
            >
              Catalogue
            </button>
            <button
              type="button"
              onClick={() => setActiveNav('simulcast')}
              className="hover:text-white transition-colors cursor-pointer"
            >
              Simulcast
            </button>
            <button
              type="button"
              onClick={() => setActiveNav('maliste')}
              className="hover:text-white transition-colors cursor-pointer"
            >
              Ma Liste
            </button>
          </div>
        </div>
      </footer>

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

      {/* Hybrid HD Video Player Modal */}
      {playerState ? (
        <VideoPlayerModal
          anime={playerState.anime}
          episode={playerState.episode}
          initialTime={playerState.startAt}
          initialMode={playerState.mode}
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
    </div>
  );
}
