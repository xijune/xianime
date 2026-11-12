import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Clock, Film, Loader2, Search, X } from 'lucide-react';
import {
  formatReleaseDateFr,
  getSeriesSeasons,
  type AnimeSeries,
} from '../data/animeCatalog';
import { searchRealAnime } from '../services/anilistApi';
import { ArtworkImage } from './ArtworkImage';

interface SearchModalProps {
  initialList: AnimeSeries[];
  onSelectAnime: (anime: AnimeSeries) => void;
  onClose: () => void;
}

export function SearchModal({
  initialList,
  onSelectAnime,
  onClose,
}: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AnimeSeries[]>(initialList);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults(initialList);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const timer = window.setTimeout(() => {
      void searchRealAnime({ query: trimmed, perPage: 16 })
        .then((items) => {
          if (!cancelled) {
            setResults(items);
            setLoading(false);
          }
        })
        .catch(() => {
          if (!cancelled) {
            const localFallback = initialList.filter(
              (a) =>
                a.title.toLowerCase().includes(trimmed.toLowerCase()) ||
                a.originalTitle.toLowerCase().includes(trimmed.toLowerCase())
            );
            setResults(localFallback);
            setError('Résultats issus du catalogue local.');
            setLoading(false);
          }
        });
    }, 320);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, initialList]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-start justify-center pt-[max(1rem,env(safe-area-inset-top))] pb-[env(safe-area-inset-bottom)] px-3 sm:px-4 sm:pt-20"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl max-h-[85dvh] bg-[#111319] border border-white/12 rounded-2xl overflow-hidden shadow-2xl flex flex-col">
        <div className="flex items-center gap-2.5 px-3.5 sm:px-4 py-2.5 sm:py-3 border-b border-white/10 shrink-0">
          {loading ? (
            <Loader2 className="w-5 h-5 text-[#FF5E1A] animate-spin shrink-0" />
          ) : (
            <Search className="w-5 h-5 text-zinc-400 shrink-0" />
          )}
          <input
            ref={inputRef}
            type="search"
            enterKeyHint="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un animé (ex: One Piece, Naruto, Bleach, Frieren…)"
            className="w-full bg-transparent text-base text-white placeholder:text-zinc-500 focus:outline-none min-h-[40px]"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer la recherche"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-4 py-2 bg-white/2 border-b border-white/8 text-[11px] text-zinc-400 flex items-center justify-between shrink-0">
          <span>Recherche de séries et films d’animation</span>
          <span className="font-mono tabular-nums">{results.length} animés</span>
        </div>

        {error ? (
          <div className="px-4 py-2 text-xs text-amber-400 border-b border-white/8 shrink-0">
            {error}
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto overscroll-contain divide-y divide-white/8">
          {!loading && results.length === 0 ? (
            <div className="py-12 px-4 text-center text-sm text-zinc-400">
              Aucun animé trouvé pour « {query} ».
            </div>
          ) : (
            results.map((anime) => {
              const availableSeasons = getSeriesSeasons(anime).filter(
                (s) => s.episodes.length > 0 && s.status !== 'À venir'
              );
              const isUpcoming =
                anime.episodesCount === 0 || anime.status === 'À venir';

              return (
                <button
                  key={anime.id}
                  type="button"
                  onClick={() => {
                    onSelectAnime(anime);
                    onClose();
                  }}
                  className="w-full flex items-center gap-3.5 sm:gap-4 p-3.5 sm:p-4 text-left hover:bg-white/6 active:bg-white/10 transition-colors cursor-pointer group min-h-[72px]"
                >
                  <div className="w-20 sm:w-24 aspect-[16/10] rounded-lg overflow-hidden bg-black shrink-0 relative">
                    <ArtworkImage
                      src={anime.keyVisual || anime.posterImage}
                      alt={anime.title}
                      title={anime.title}
                      accentTint={anime.accentTint}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-white/10 text-zinc-300 uppercase tracking-wider">
                        Série
                      </span>
                      {anime.year ? (
                        <span className="text-xs font-mono text-zinc-500 tabular-nums">
                          {anime.year}
                        </span>
                      ) : null}
                      {typeof anime.score === 'number' ? (
                        <span className="text-xs font-mono text-amber-400 tabular-nums">
                          ★ {anime.score}
                        </span>
                      ) : null}
                    </div>
                    <h4 className="text-sm sm:text-base font-semibold text-white group-hover:text-[#FF5E1A] transition-colors truncate">
                      {anime.title}
                    </h4>
                    <p className="text-xs text-zinc-400 mt-0.5 truncate">
                      {anime.genres.join(' · ')} · {anime.studio} ·{' '}
                      {isUpcoming
                        ? `À venir (${formatReleaseDateFr({
                            nextAiringAt: anime.nextAiringAt,
                            startDate: anime.startDate,
                            seasonName: anime.seasonName,
                            year: anime.year,
                            isUpcoming: true,
                          })})`
                        : availableSeasons.length > 1
                          ? `${availableSeasons.length} saisons · ${anime.episodesCount} épisodes`
                          : `${anime.episodesCount} épisodes`}
                    </p>
                  </div>
                  <div className="shrink-0 flex items-center">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/8 group-hover:bg-[#FF5E1A] text-xs font-semibold text-white transition-colors">
                      <span>Voir la série</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
