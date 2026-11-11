import {
  buildEpisodesForAnime,
  GENRE_MAP_FR,
  GENRE_TO_ANILIST,
  type AnimeSeason,
  type AnimeSeries,
  type Episode,
  type ParticleTheme,
  type SimulcastDay,
  type SimulcastScheduleItem,
} from '../data/animeCatalog';

const ANILIST_ENDPOINT = 'https://graphql.anilist.co';
const JIKAN_ENDPOINT = 'https://api.jikan.moe/v4';

const TV_SEASON_FORMATS = new Set(['TV', 'TV_SHORT', 'ONA']);

interface AniListFuzzyDate {
  year?: number | null;
  month?: number | null;
  day?: number | null;
}

interface AniListRelationNodeRaw {
  id: number;
  idMal?: number | null;
  type?: string | null;
  format?: string | null;
  seasonYear?: number | null;
  startDate?: AniListFuzzyDate | null;
  episodes?: number | null;
  duration?: number | null;
  title?: {
    english?: string | null;
    romaji?: string | null;
    native?: string | null;
  } | null;
  coverImage?: {
    extraLarge?: string | null;
    large?: string | null;
  } | null;
  bannerImage?: string | null;
}

interface AniListMediaRaw {
  id: number;
  idMal?: number | null;
  format?: string | null;
  title: {
    english?: string | null;
    romaji?: string | null;
    native?: string | null;
  };
  description?: string | null;
  genres?: string[] | null;
  averageScore?: number | null;
  seasonYear?: number | null;
  startDate?: AniListFuzzyDate | null;
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
  relations?: {
    edges?: Array<{
      relationType?: string | null;
      node?: AniListRelationNodeRaw | null;
    }> | null;
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

function toSlug(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function fuzzyDateScore(d?: AniListFuzzyDate | null, fallbackYear?: number | null): number {
  const y = d?.year || fallbackYear || 9999;
  const m = d?.month || 12;
  const day = d?.day || 31;
  return y * 10000 + m * 100 + day;
}

function formatSeasonTitle(
  seasonNumber: number,
  seasonTitle: string,
  rootTitle: string
): string {
  const cleanSeason = seasonTitle.trim();
  const cleanRoot = rootTitle.trim();
  if (
    !cleanSeason ||
    cleanSeason.toLowerCase() === cleanRoot.toLowerCase() ||
    new RegExp(`^${escapeRegExp(cleanRoot)}\\s*(season|saison)\\s*${seasonNumber}$`, 'i').test(
      cleanSeason
    )
  ) {
    return `Saison ${seasonNumber}`;
  }
  const stripped = cleanSeason
    .replace(new RegExp(`^${escapeRegExp(cleanRoot)}\\s*[:\\-–]?\\s*`, 'i'), '')
    .trim();
  if (!stripped || /^(season|saison)\s*\d+$/i.test(stripped)) {
    return `Saison ${seasonNumber}`;
  }
  return `Saison ${seasonNumber} · ${stripped}`;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getMediaDisplayTitle(raw: {
  title?: { english?: string | null; romaji?: string | null; native?: string | null } | null;
}): string {
  return (
    raw.title?.english ||
    raw.title?.romaji ||
    raw.title?.native ||
    'Animé sans titre'
  );
}

function getRelatedSeasonEdges(raw: AniListMediaRaw): Array<{
  relationType: 'PREQUEL' | 'SEQUEL';
  node: AniListRelationNodeRaw;
}> {
  const edges = raw.relations?.edges ?? [];
  const results: Array<{
    relationType: 'PREQUEL' | 'SEQUEL';
    node: AniListRelationNodeRaw;
  }> = [];

  for (const edge of edges) {
    if (!edge?.node) continue;
    if (edge.relationType !== 'PREQUEL' && edge.relationType !== 'SEQUEL') continue;
    if (edge.node.type && edge.node.type !== 'ANIME') continue;
    if (edge.node.format && !TV_SEASON_FORMATS.has(edge.node.format)) continue;
    results.push({ relationType: edge.relationType, node: edge.node });
  }
  return results;
}

function mapAniListStatus(
  status?: string | null
): 'En cours' | 'Terminé' | 'À venir' {
  if (status === 'RELEASING') return 'En cours';
  if (status === 'NOT_YET_RELEASED' || status === 'CANCELLED') return 'À venir';
  return 'Terminé';
}

function getReleasedEpisodesCount(raw: AniListMediaRaw): number {
  if (raw.status === 'NOT_YET_RELEASED' || raw.status === 'CANCELLED') {
    return 0;
  }
  if (raw.status === 'RELEASING') {
    if (raw.nextAiringEpisode?.episode) {
      const airedAlready = raw.nextAiringEpisode.airingAt * 1000 <= Date.now();
      return Math.max(
        0,
        airedAlready
          ? raw.nextAiringEpisode.episode
          : raw.nextAiringEpisode.episode - 1
      );
    }
    if (raw.streamingEpisodes && raw.streamingEpisodes.length > 0) {
      return raw.streamingEpisodes.length;
    }
    return raw.episodes ?? 0;
  }
  return raw.episodes || raw.streamingEpisodes?.length || 12;
}

function buildSeasonFromMedia(
  rootSeriesId: string,
  seasonNumber: number,
  m: AniListMediaRaw,
  fallbackTitle: string,
  fallbackYear: number,
  fallbackPoster: string,
  fallbackVisual: string,
  fallbackSlug?: string
): AnimeSeason {
  const mTitle = getMediaDisplayTitle(m);
  const seasonStatus = mapAniListStatus(m.status);
  const releasedCount = getReleasedEpisodesCount(m);
  const durMin = m.duration || 24;
  const poster =
    m.coverImage?.extraLarge || m.coverImage?.large || fallbackPoster;
  const thumb = m.bannerImage || poster || fallbackVisual;

  const eps = buildEpisodesForAnime(
    rootSeriesId,
    mTitle,
    releasedCount,
    durMin,
    thumb,
    m.streamingEpisodes ?? undefined,
    seasonNumber
  );

  return {
    id: `${rootSeriesId}-season-${seasonNumber}`,
    seasonNumber,
    anilistId: m.id,
    malId: m.idMal ?? undefined,
    slug: toSlug(m.title.romaji || mTitle) || fallbackSlug,
    title:
      seasonNumber === 1 && mTitle === fallbackTitle
        ? 'Saison 1'
        : formatSeasonTitle(seasonNumber, mTitle, fallbackTitle),
    year: m.seasonYear || m.startDate?.year || fallbackYear,
    status: seasonStatus,
    episodesCount: eps.length,
    nextAiringEpisode:
      m.nextAiringEpisode?.episode ?? (seasonStatus === 'À venir' ? 1 : undefined),
    nextAiringAt: m.nextAiringEpisode?.airingAt,
    posterImage: poster,
    keyVisual: thumb,
    episodes: eps,
  };
}

function mapAniListMedia(raw: AniListMediaRaw, featured = false): AnimeSeries {
  const id = `anilist-${raw.id}`;
  const title = getMediaDisplayTitle(raw);
  const originalTitle = raw.title.native || raw.title.romaji || title;
  const slug = toSlug(raw.title.romaji || title) || id;
  const genres = (raw.genres ?? ['Action'])
    .slice(0, 3)
    .map((g) => GENRE_MAP_FR[g] ?? g);
  const studio = raw.studios?.nodes?.[0]?.name || 'Studio d’animation';
  const year = raw.seasonYear || raw.startDate?.year || 2025;
  const score = raw.averageScore ? Number((raw.averageScore / 10).toFixed(1)) : 8.5;
  const status = mapAniListStatus(raw.status);

  const { day, time } = getDayAndTimeFromUnix(raw.nextAiringEpisode?.airingAt);
  const posterImage =
    raw.coverImage?.extraLarge || raw.coverImage?.large || raw.bannerImage || '';
  const keyVisual = raw.bannerImage || posterImage;

  const trailerYoutubeId =
    raw.trailer?.site === 'youtube' && raw.trailer.id ? raw.trailer.id : undefined;

  const initialSeason = buildSeasonFromMedia(
    id,
    1,
    raw,
    title,
    year,
    posterImage,
    keyVisual,
    slug
  );

  return {
    id,
    slug,
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
    nextAiringEpisode: initialSeason.nextAiringEpisode,
    nextAiringAt: initialSeason.nextAiringAt,
    audioTracks: score >= 8.4 ? ['VOSTFR', 'VF'] : ['VOSTFR'],
    episodesCount: initialSeason.episodesCount,
    synopsis: stripHtml(raw.description),
    keyVisual,
    posterImage,
    trailerYoutubeId,
    accentTint: raw.coverImage?.color || '#FF5E1A',
    particleTheme: pickParticleTheme(genres),
    featured,
    episodes: initialSeason.episodes,
    seasons: [initialSeason],
  };
}

/**
 * Groups entries belonging to the same anime franchise (via PREQUEL / SEQUEL relations)
 * so catalog and search grids display one card per anime with its grouped seasons.
 */
function groupFranchiseCatalog(
  rawItems: AniListMediaRaw[],
  featuredCount = 0
): AnimeSeries[] {
  const valid = rawItems.filter((m) => m.coverImage?.extraLarge || m.bannerImage);
  if (valid.length === 0) return [];

  const byId = new Map<number, AniListMediaRaw>(valid.map((m) => [m.id, m]));
  const adj = new Map<number, Set<number>>();

  for (const item of valid) {
    if (!adj.has(item.id)) adj.set(item.id, new Set());
    for (const rel of getRelatedSeasonEdges(item)) {
      if (byId.has(rel.node.id)) {
        adj.get(item.id)!.add(rel.node.id);
        if (!adj.has(rel.node.id)) adj.set(rel.node.id, new Set());
        adj.get(rel.node.id)!.add(item.id);
      }
    }
  }

  // Also link items that point to the exact same prequel ID even if that prequel isn't in `valid`
  const bySharedNeighbor = new Map<number, number[]>();
  for (const item of valid) {
    for (const rel of getRelatedSeasonEdges(item)) {
      const list = bySharedNeighbor.get(rel.node.id) ?? [];
      list.push(item.id);
      bySharedNeighbor.set(rel.node.id, list);
    }
  }
  for (const groupIds of bySharedNeighbor.values()) {
    for (let i = 1; i < groupIds.length; i++) {
      adj.get(groupIds[0])?.add(groupIds[i]);
      adj.get(groupIds[i])?.add(groupIds[0]);
    }
  }

  const visited = new Set<number>();
  const groupedSeries: AnimeSeries[] = [];

  for (const item of valid) {
    if (visited.has(item.id)) continue;

    // BFS component
    const compIds: number[] = [];
    const queue = [item.id];
    visited.add(item.id);
    while (queue.length > 0) {
      const curr = queue.shift()!;
      compIds.push(curr);
      for (const next of adj.get(curr) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }

    const members = compIds
      .map((cid) => byId.get(cid)!)
      .sort(
        (a, b) =>
          fuzzyDateScore(a.startDate, a.seasonYear) -
          fuzzyDateScore(b.startDate, b.seasonYear)
      );

    const rootRaw = members[0];
    const rootSeries = mapAniListMedia(
      rootRaw,
      groupedSeries.length < featuredCount
    );

    if (members.length > 1) {
      const seasons: AnimeSeason[] = members.map((m, idx) =>
        buildSeasonFromMedia(
          rootSeries.id,
          idx + 1,
          m,
          rootSeries.title,
          rootSeries.year,
          rootSeries.posterImage,
          rootSeries.keyVisual,
          rootSeries.slug
        )
      );
      const totalAvailable = seasons.reduce((acc, s) => acc + s.episodes.length, 0);
      rootSeries.seasons = seasons;
      rootSeries.episodes = seasons[0].episodes;
      rootSeries.episodesCount = totalAvailable;
      rootSeries.status =
        totalAvailable === 0
          ? 'À venir'
          : seasons.some((s) => s.status === 'En cours')
            ? 'En cours'
            : 'Terminé';
    }

    groupedSeries.push(rootSeries);
  }

  return groupedSeries;
}

const MEDIA_FRAGMENT = `
  id
  idMal
  format
  title {
    english
    romaji
    native
  }
  description(asHtml: false)
  genres
  averageScore
  seasonYear
  startDate {
    year
    month
    day
  }
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
  relations {
    edges {
      relationType(version: 2)
      node {
        id
        idMal
        type
        format
        seasonYear
        startDate {
          year
          month
          day
        }
        episodes
        duration
        title {
          english
          romaji
          native
        }
        coverImage {
          extraLarge
          large
        }
        bannerImage
      }
    }
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

const franchiseCache = new Map<number, AnimeSeries>();

/**
 * Fetches all connected TV/ONA seasons (PREQUEL -> SEQUEL chain) for an anime
 * from AniList and groups them cleanly under a single AnimeSeries.
 */
export async function fetchAllSeasonsForAnime(anime: AnimeSeries): Promise<AnimeSeries> {
  if (!anime.anilistId) return anime;
  const cached = franchiseCache.get(anime.anilistId);
  if (cached) return cached;

  try {
    const collected = new Map<number, AniListMediaRaw>();
    let frontierIds: number[] = [anime.anilistId];
    let hops = 0;

    while (frontierIds.length > 0 && hops < 4) {
      hops += 1;
      const batch = frontierIds.filter((id) => !collected.has(id)).slice(0, 20);
      if (batch.length === 0) break;

      const query = `
        query BatchSeasons($ids: [Int]) {
          Page(page: 1, perPage: 25) {
            media(id_in: $ids, type: ANIME, isAdult: false) {
              ${MEDIA_FRAGMENT}
            }
          }
        }
      `;

      const data = await queryAniList<{
        Page: { media: AniListMediaRaw[] };
      }>(query, { ids: batch });

      const nextFrontier = new Set<number>();
      for (const item of data.Page.media) {
        collected.set(item.id, item);
        for (const rel of getRelatedSeasonEdges(item)) {
          if (!collected.has(rel.node.id)) {
            nextFrontier.add(rel.node.id);
          }
        }
      }
      frontierIds = Array.from(nextFrontier);
    }

    const allMedia = Array.from(collected.values()).filter(
      (m) => m.id === anime.anilistId || !m.format || TV_SEASON_FORMATS.has(m.format)
    );

    if (allMedia.length <= 1) {
      franchiseCache.set(anime.anilistId, anime);
      return anime;
    }

    // Order chronologically by start date / seasonYear
    allMedia.sort(
      (a, b) =>
        fuzzyDateScore(a.startDate, a.seasonYear) -
        fuzzyDateScore(b.startDate, b.seasonYear)
    );

    const rootRaw = allMedia[0];
    const baseSeries = mapAniListMedia(rootRaw, anime.featured);
    const rootId = anime.id;

    const seasons: AnimeSeason[] = allMedia.map((m, idx) =>
      buildSeasonFromMedia(
        rootId,
        idx + 1,
        m,
        baseSeries.title,
        baseSeries.year,
        baseSeries.posterImage,
        baseSeries.keyVisual,
        baseSeries.slug
      )
    );

    const totalAvailable = seasons.reduce((sum, s) => sum + s.episodes.length, 0);
    const fullSeries: AnimeSeries = {
      ...baseSeries,
      id: rootId,
      episodes: seasons[0].episodes,
      episodesCount: totalAvailable,
      status:
        totalAvailable === 0
          ? 'À venir'
          : seasons.some((s) => s.status === 'En cours')
            ? 'En cours'
            : 'Terminé',
      seasons,
    };

    for (const m of allMedia) {
      franchiseCache.set(m.id, fullSeries);
    }

    return fullSeries;
  } catch {
    return anime;
  }
}

export async function fetchHomeCatalog(): Promise<{
  featured: AnimeSeries[];
  trending: AnimeSeries[];
  popular: AnimeSeries[];
}> {
  const query = `
    query HomeCatalog {
      trending: Page(page: 1, perPage: 16) {
        media(type: ANIME, sort: TRENDING_DESC, isAdult: false) {
          ${MEDIA_FRAGMENT}
        }
      }
      popular: Page(page: 1, perPage: 16) {
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

  const trending = groupFranchiseCatalog(data.trending.media, 4);
  const popular = groupFranchiseCatalog(data.popular.media, 0);

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
    perPage: options.perPage ?? 24,
  });

  return groupFranchiseCatalog(data.Page.media, 0);
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

export async function enrichSeasonEpisodesFromJikan(
  episodes: Episode[],
  malId?: number
): Promise<Episode[]> {
  if (!malId) return episodes;

  try {
    const res = await fetch(`${JIKAN_ENDPOINT}/anime/${malId}/episodes?page=1`);
    if (!res.ok) return episodes;
    const json = (await res.json()) as { data?: JikanEpisodeRaw[] };
    const jikanEps = json.data;
    if (!jikanEps || jikanEps.length === 0) return episodes;

    const merged = episodes.map((ep) => ({ ...ep }));
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
          existing.synopsis = `Saison ${existing.season} · Diffusé le ${dateLabel}${jep.filler ? ' · Épisode hors-série' : ''}. Cliquez pour lancer ou reprendre l'épisode.`;
        }
      }
    });

    return merged;
  } catch {
    return episodes;
  }
}

export async function enrichAnimeEpisodesFromJikan(anime: AnimeSeries): Promise<Episode[]> {
  return enrichSeasonEpisodesFromJikan(anime.episodes, anime.malId);
}
