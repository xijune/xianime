import {
  buildEpisodesForAnime,
  GENRE_MAP_FR,
  GENRE_TO_ANILIST,
  type AnimeSeries,
  type Episode,
  type ParticleTheme,
  type SimulcastDay,
  type SimulcastScheduleItem,
} from '../data/animeCatalog';

const ANILIST_ENDPOINT = 'https://graphql.anilist.co';
const JIKAN_ENDPOINT = 'https://api.jikan.moe/v4';

interface AniListMediaRaw {
  id: number;
  idMal?: number | null;
  title: {
    english?: string | null;
    romaji?: string | null;
    native?: string | null;
  };
  description?: string | null;
  genres?: string[] | null;
  averageScore?: number | null;
  seasonYear?: number | null;
  status?: 'RELEASING' | 'FINISHED' | 'NOT_YET_RELEASED' | 'CANCELLED' | string | null;
  episodes?: number | null;
  duration?: number | null;
  isAdult?: boolean | null;
  bannerImage?: string | null;
  coverImage?: {
    extraLarge?: string | null;
    large?: string | null;
    color?: string | null;
  } | null;
  studios?: {
    nodes?: Array<{ name: string }> | null;
  } | null;
  trailer?: {
    id?: string | null;
    site?: string | null;
  } | null;
  streamingEpisodes?: Array<{
    title?: string | null;
    thumbnail?: string | null;
  }> | null;
  nextAiringEpisode?: {
    airingAt: number;
    episode: number;
  } | null;
}

const DAYS_FR: SimulcastDay[] = [
  'Dimanche',
  'Lundi',
  'Mardi',
  'Mercredi',
  'Jeudi',
  'Vendredi',
  'Samedi',
];

function stripHtml(raw?: string | null): string {
  if (!raw) return 'Synopsis indisponible pour le moment.';
  return raw
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickParticleTheme(genres: string[]): ParticleTheme {
  const joined = genres.join(' ').toLowerCase();
  if (joined.includes('sci-fi')) return 'cyber';
  if (joined.includes('myst') || joined.includes('horror') || joined.includes('surnaturel'))
    return 'lanterns';
  if (joined.includes('tranche') || joined.includes('romance') || joined.includes('comédie'))
    return 'petals';
  if (joined.includes('aventure') || joined.includes('fantaisie')) return 'clouds';
  if (joined.includes('action')) return 'embers';
  return 'rain';
}

function getDayAndTimeFromUnix(unixSeconds?: number | null): {
  day: SimulcastDay;
  time: string;
} {
  if (!unixSeconds) {
    return { day: 'Samedi', time: '18:30' };
  }
  const d = new Date(unixSeconds * 1000);
  const day = DAYS_FR[d.getDay()] ?? 'Samedi';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return { day, time: `${hh}:${mm}` };
}

function mapAniListMedia(raw: AniListMediaRaw, featured = false): AnimeSeries {
  const id = `anilist-${raw.id}`;
  const title = raw.title.english || raw.title.romaji || raw.title.native || 'Animé sans titre';
  const originalTitle = raw.title.native || raw.title.romaji || title;
  const genres = (raw.genres ?? ['Action'])
    .slice(0, 3)
    .map((g) => GENRE_MAP_FR[g] ?? g);
  const studio = raw.studios?.nodes?.[0]?.name || 'Studio d’animation';
  const year = raw.seasonYear || 2025;
  const score = raw.averageScore ? Number((raw.averageScore / 10).toFixed(1)) : 8.5;
  const status =
    raw.status === 'RELEASING'
      ? 'En cours'
      : raw.status === 'NOT_YET_RELEASED'
        ? 'À venir'
        : 'Terminé';

  const { day, time } = getDayAndTimeFromUnix(raw.nextAiringEpisode?.airingAt);
  const posterImage =
    raw.coverImage?.extraLarge || raw.coverImage?.large || raw.bannerImage || '';
  const keyVisual = raw.bannerImage || posterImage;
  const episodesCount =
    raw.episodes ||
    (raw.nextAiringEpisode?.episode ? Math.max(12, raw.nextAiringEpisode.episode) : 12);
  const durationMinutes = raw.duration || 24;

  const trailerYoutubeId =
    raw.trailer?.site === 'youtube' && raw.trailer.id ? raw.trailer.id : undefined;

  const episodes = buildEpisodesForAnime(
    id,
    title,
    episodesCount,
    durationMinutes,
    keyVisual,
    raw.streamingEpisodes ?? undefined
  );

  return {
    id,
    anilistId: raw.id,
    malId: raw.idMal ?? undefined,
    title,
    originalTitle,
    genres,
    studio,
    year,
    rating: raw.isAdult ? '18+' : '14+',
    score,
    status,
    simulcastDay: day,
    simulcastTime: time,
    audioTracks: score >= 8.4 ? ['VOSTFR', 'VF'] : ['VOSTFR'],
    episodesCount,
    synopsis: stripHtml(raw.description),
    keyVisual,
    posterImage,
    trailerYoutubeId,
    accentTint: raw.coverImage?.color || '#FF5E1A',
    particleTheme: pickParticleTheme(genres),
    featured,
    episodes,
  };
}

const MEDIA_FRAGMENT = `
  id
  idMal
  title {
    english
    romaji
    native
  }
  description(asHtml: false)
  genres
  averageScore
  seasonYear
  status
  episodes
  duration
  isAdult
  bannerImage
  coverImage {
    extraLarge
    large
    color
  }
  studios(isMain: true) {
    nodes {
      name
    }
  }
  trailer {
    id
    site
  }
  streamingEpisodes {
    title
    thumbnail
  }
  nextAiringEpisode {
    airingAt
    episode
  }
`;

async function queryAniList<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(ANILIST_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`AniList HTTP ${res.status}`);
  }
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) {
    throw new Error(json.errors[0].message);
  }
  if (!json.data) {
    throw new Error('Réponse AniList vide');
  }
  return json.data;
}

export async function fetchHomeCatalog(): Promise<{
  featured: AnimeSeries[];
  trending: AnimeSeries[];
  popular: AnimeSeries[];
}> {
  const query = `
    query HomeCatalog {
      trending: Page(page: 1, perPage: 12) {
        media(type: ANIME, sort: TRENDING_DESC, isAdult: false) {
          ${MEDIA_FRAGMENT}
        }
      }
      popular: Page(page: 1, perPage: 12) {
        media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) {
          ${MEDIA_FRAGMENT}
        }
      }
    }
  `;

  const data = await queryAniList<{
    trending: { media: AniListMediaRaw[] };
    popular: { media: AniListMediaRaw[] };
  }>(query, {});

  const trending = data.trending.media
    .filter((m) => m.coverImage?.extraLarge || m.bannerImage)
    .map((m, idx) => mapAniListMedia(m, idx < 4));

  const popular = data.popular.media
    .filter((m) => m.coverImage?.extraLarge || m.bannerImage)
    .map((m) => mapAniListMedia(m, false));

  // Prefer series with crisp widescreen bannerImage for Hero spotlight
  const withBanners = trending.filter((a) => a.keyVisual && a.keyVisual !== a.posterImage);
  const featured = (withBanners.length >= 3 ? withBanners : trending).slice(0, 4);

  return { featured, trending, popular };
}

export async function searchRealAnime(options: {
  query?: string;
  genreFr?: string;
  sort?: 'POPULARITY_DESC' | 'SCORE_DESC' | 'TRENDING_DESC' | 'START_DATE_DESC';
  page?: number;
  perPage?: number;
}): Promise<AnimeSeries[]> {
  const aniGenre = options.genreFr ? GENRE_TO_ANILIST[options.genreFr] || undefined : undefined;
  const searchStr = options.query?.trim() || undefined;
  const sort = options.sort || 'POPULARITY_DESC';

  const query = `
    query SearchAnime($search: String, $genre: String, $sort: [MediaSort], $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(type: ANIME, search: $search, genre: $genre, sort: $sort, isAdult: false) {
          ${MEDIA_FRAGMENT}
        }
      }
    }
  `;

  const data = await queryAniList<{
    Page: { media: AniListMediaRaw[] };
  }>(query, {
    search: searchStr,
    genre: aniGenre,
    sort: [sort],
    page: options.page ?? 1,
    perPage: options.perPage ?? 18,
  });

  return data.Page.media
    .filter((m) => m.coverImage?.extraLarge || m.bannerImage)
    .map((m) => mapAniListMedia(m, false));
}

export async function fetchWeeklySchedule(): Promise<SimulcastScheduleItem[]> {
  const nowSec = Math.floor(Date.now() / 1000);
  const startOfWindow = nowSec - 86400 * 2;
  const endOfWindow = nowSec + 86400 * 6;

  const query = `
    query WeeklySchedule($start: Int, $end: Int) {
      Page(page: 1, perPage: 36) {
        airingSchedules(airingAt_greater: $start, airingAt_lesser: $end, sort: TIME) {
          id
          airingAt
          episode
          media {
            ${MEDIA_FRAGMENT}
          }
        }
      }
    }
  `;

  const data = await queryAniList<{
    Page: {
      airingSchedules: Array<{
        id: number;
        airingAt: number;
        episode: number;
        media: AniListMediaRaw | null;
      }>;
    };
  }>(query, { start: startOfWindow, end: endOfWindow });

  const seenAnime = new Set<string>();
  const items: SimulcastScheduleItem[] = [];

  for (const row of data.Page.airingSchedules) {
    if (!row.media || row.media.isAdult) continue;
    const anime = mapAniListMedia(row.media, false);
    if (seenAnime.has(anime.id)) continue;
    seenAnime.add(anime.id);

    const { day, time } = getDayAndTimeFromUnix(row.airingAt);
    items.push({
      id: `sched-${row.id}`,
      anime,
      episodeNumber: row.episode,
      day,
      time,
      airingAt: row.airingAt,
    });
  }

  return items;
}

interface JikanEpisodeRaw {
  mal_id: number;
  title?: string | null;
  title_japanese?: string | null;
  aired?: string | null;
  filler?: boolean;
  recap?: boolean;
}

export async function enrichAnimeEpisodesFromJikan(anime: AnimeSeries): Promise<Episode[]> {
  if (!anime.malId) return anime.episodes;

  try {
    const res = await fetch(`${JIKAN_ENDPOINT}/anime/${anime.malId}/episodes?page=1`);
    if (!res.ok) return anime.episodes;
    const json = (await res.json()) as { data?: JikanEpisodeRaw[] };
    const jikanEps = json.data;
    if (!jikanEps || jikanEps.length === 0) return anime.episodes;

    const merged = [...anime.episodes];
    jikanEps.forEach((jep, idx) => {
      const epNum = jep.mal_id || idx + 1;
      const existing = merged.find((e) => e.number === epNum);
      const niceTitle = jep.title?.trim();
      if (existing && niceTitle) {
        existing.title = niceTitle;
        if (jep.aired) {
          const dateLabel = new Date(jep.aired).toLocaleDateString('fr-FR', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          });
          existing.synopsis = `Diffusé le ${dateLabel}${jep.filler ? ' · Épisode hors-série' : ''}. Cliquez pour lancer ou reprendre l'épisode.`;
        }
      }
    });

    return merged;
  } catch {
    return anime.episodes;
  }
}
