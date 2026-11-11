import { useEffect, useRef, useState } from 'react';
import { Loader2, Play, Search, X } from 'lucide-react';
import type { AnimeSeries } from '../data/animeCatalog';
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
            setError('Connexion AniList indisponible — résultats locaux affichés.');
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
      className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm flex items-start justify-center pt-16 sm:pt-24 px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl bg-[#111319] border border-white/12 rounded-2xl overflow-hidden shadow-2xl">
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/10">
          {loading ? (
            <Loader2 className="w-5 h-5 text-[#FF5E1A] animate-spin shrink-0" />
          ) : (
            <Search className="w-5 h-5 text-zinc-400 shrink-0" />
          )}
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un vrai animé (One Piece, Frieren, Solo Leveling, Naruto…)"
            className="w-full bg-transparent text-sm sm:text-base text-white placeholder:text-zinc-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer la recherche"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error ? (
          <div className="px-4 py-2 text-xs text-amber-400 border-b border-white/8">
            {error}
          </div>
        ) : null}

        <div className="max-h-[60vh] overflow-y-auto divide-y divide-white/8">
          {!loading && results.length === 0 ? (
            <div className="py-12 text-center text-sm text-zinc-400">
              Aucun animé trouvé pour « {query} ».
            </div>
          ) : (
            results.map((anime) => (
              <button
                key={anime.id}
                type="button"
                onClick={() => {
                  onSelectAnime(anime);
                  onClose();
                }}
                className="w-full flex items-center gap-4 p-4 text-left hover:bg-white/6 transition-colors cursor-pointer group"
              >
                <div className="w-28 aspect-video rounded-lg overflow-hidden bg-black shrink-0">
                  <ArtworkImage
                    src={anime.keyVisual || anime.posterImage}
                    alt={anime.title}
                    title={anime.title}
                    accentTint={anime.accentTint}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold text-white group-hover:text-[#FF5E1A] transition-colors truncate">
                    {anime.title}
                  </h4>
                  <p className="text-xs text-zinc-400 mt-0.5 truncate">
                    {anime.genres.join(' · ')} · {anime.studio} · {anime.episodesCount} ép. ·{' '}
                    {anime.score}/10
                  </p>
                </div>
                <Play className="w-4 h-4 text-zinc-500 group-hover:text-white shrink-0" />
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
