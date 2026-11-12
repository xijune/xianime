import type { AnimeSeries, Episode } from '../data/animeCatalog';

const VIDEO_API_URL = (import.meta.env.VITE_VIDEO_API_URL as string | undefined)?.trim() || '';

function isBlockedMixedContent(url: string): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.protocol === 'https:' && /^http:\/\//i.test(url);
}

/**
 * Resolve a playable video/HLS URL for an episode via the external video API
 * (xianime-video-api → VoirAnime / Anime-Sama / demo).
 */
export async function resolveEpisodeVideoUrl(
  anime: AnimeSeries,
  episode: Episode
): Promise<string | null> {
  if (episode.videoUrl) return episode.videoUrl;

  if (!VIDEO_API_URL) {
    console.warn('[video] VITE_VIDEO_API_URL manquant');
    return null;
  }
  if (isBlockedMixedContent(VIDEO_API_URL)) {
    console.warn('[video] mixed content bloque', VIDEO_API_URL);
    return null;
  }

  try {
    const payload = {
      animeId: anime.id,
      slug: anime.slug,
      title: anime.title,
      episodeNumber: episode.number,
      season: episode.season ?? 1,
      audio: 'VOSTFR' as const,
    };
    console.log('[video] resolve request', VIDEO_API_URL, payload);

    const response = await fetch(VIDEO_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      videoUrl?: string;
      m3u8Url?: string;
      error?: string;
      provider?: string;
    };

    console.log('[video] resolve response', response.status, data);

    if (!response.ok) {
      console.warn('[video] API error', data.error || response.status);
      return null;
    }

    const url = data.m3u8Url || data.videoUrl || null;
    if (!url) {
      console.warn('[video] pas d URL dans la reponse', data);
      return null;
    }
    return url;
  } catch (err) {
    console.error('[video] fetch failed', err);
    return null;
  }
}
