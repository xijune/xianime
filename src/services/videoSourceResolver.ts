import type { AnimeSeries, Episode } from '../data/animeCatalog';

// URL optionnelle d'une API vidéo configurée via .env (VITE_VIDEO_API_URL)
const VIDEO_API_URL = (import.meta.env.VITE_VIDEO_API_URL as string | undefined)?.trim() || '';

function isBlockedMixedContent(url: string): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.protocol === 'https:' && /^http:\/\//i.test(url);
}

export async function resolveEpisodeVideoUrl(
  anime: AnimeSeries,
  episode: Episode
): Promise<string | null> {
  if (episode.videoUrl) return episode.videoUrl;

  if (!VIDEO_API_URL || isBlockedMixedContent(VIDEO_API_URL)) {
    return null;
  }

  try {
    const activeSeason = anime.seasons?.find(
      (s) => s.seasonNumber === episode.season
    );
    const response = await fetch(VIDEO_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        animeId: anime.id,
        slug: anime.slug,
        title: anime.title,
        seasonSlug: activeSeason?.slug ?? anime.slug,
        seasonTitle: activeSeason?.title ?? anime.title,
        episodeNumber: episode.number,
        season: episode.season,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      success?: boolean;
      videoUrl?: string;
      m3u8Url?: string;
    };

    if (data.videoUrl) return data.videoUrl;
    if (data.success && data.m3u8Url) return data.m3u8Url;

    return null;
  } catch {
    return null;
  }
}