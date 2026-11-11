import {
  buildEpisodesForAnime,
  GENRE_MAP_FR,
  GENRE_TO_ANILIST,
  type AnimeSeason,
  type AnimeSeasonName,
  type AnimeSeries,
  type Episode,
  type ParticleTheme,
  type ReleaseFuzzyDate,
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
  season?: AnimeSeasonName | null;
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
  day?: SimulcastDay;
  time?: string;
} {
  if (!unixSeconds) {
    return { day: undefined, time: undefined };
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
    results.push({ relationType: edge.relationType, node: edge.node });
  }
  return results;
}

function mapAniListStatus(
  raw: AniListMediaRaw
): 'En cours' | 'Terminé' | 'À venir' {
  if (raw.status === 'NOT_YET_RELEASED' || raw.status === 'CANCELLED') {
    return 'À venir';
  }
  if (raw.status === 'RELEASING') {
    if (
      raw.nextAiringEpisode?.episode === 1 &&
      raw.nextAiringEpisode.airingAt * 1000 > Date.now()
    ) {
      return 'À venir';
    }
    return 'En cours';
  }
  return 'Terminé';
}

function toReleaseFuzzyDate(d?: AniListFuzzyDate | null): ReleaseFuzzyDate | undefined {
  if (!d) return undefined;
  const year = d.year ?? undefined;
  const month = d.month ?? undefined;
  const day = d.day ?? undefined;
  if (!year && !month && !day) return undefined;
  return { year, month, day };
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
  fallbackYear: number | undefined,
  fallbackPoster: string,
  fallbackVisual: string,
  fallbackSlug?: string
): AnimeSeason {
  const mTitle = getMediaDisplayTitle(m);
  const seasonStatus = mapAniListStatus(m);
  const releasedCount = getReleasedEpisodesCount(m);
  const durMin = m.duration || 24;
  const poster =
    m.coverImage?.extraLarge || m.coverImage?.large || fallbackPoster;
  const thumb = m.bannerImage || poster || fallbackVisual;
  const startDate = toReleaseFuzzyDate(m.startDate);
  const year = m.seasonYear || m.startDate?.year || undefined;

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
    year,
    startDate,
    seasonName: m.season ?? undefined,
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
  const startDate = toReleaseFuzzyDate(raw.startDate);
  const year = raw.seasonYear || raw.startDate?.year || undefined;
  const score = raw.averageScore
    ? Number((raw.averageScore / 10).toFixed(1))
    : undefined;
  const status = mapAniListStatus(raw);

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
    startDate,
    seasonName: raw.season ?? undefined,
    rating: raw.isAdult ? '18+' : '14+',
    score,
    status,
    simulcastDay: day,
    simulcastTime: time,
    nextAiringEpisode: initialSeason.nextAiringEpisode,
    nextAiringAt: initialSeason.nextAiringAt,
    audioTracks: score && score >= 8.4 ? ['VOSTFR', 'VF'] : ['VOSTFR'],
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
 * Orders media belonging to the same franchise strictly from Season 1 -> Season N
 * using PREQUEL/SEQUEL topological edges first, with startDate as tiebreaker.
 */
function sortFranchiseMedia(members: AniListMediaRaw[]): AniListMediaRaw[] {
  if (members.length <= 1) return [...members];

  const byId = new Map<number, AniListMediaRaw>(members.map((m) => [m.id, m]));
  const nextIds = new Map<number, Set<number>>();
  const inDegree = new Map<number, number>();

  for (const m of members) {
    nextIds.set(m.id, new Set());
    inDegree.set(m.id, 0);
  }

  for (const m of members) {
    for (const rel of getRelatedSeasonEdges(m)) {
      if (!byId.has(rel.node.id) || rel.node.id === m.id) continue;
      if (rel.relationType === 'SEQUEL') {
        if (!nextIds.get(m.id)!.has(rel.node.id)) {
          nextIds.get(m.id)!.add(rel.node.id);
          inDegree.set(rel.node.id, (inDegree.get(rel.node.id) ?? 0) + 1);
        }
      } else if (rel.relationType === 'PREQUEL') {
        if (!nextIds.get(rel.node.id)!.has(m.id)) {
          nextIds.get(rel.node.id)!.add(m.id);
          inDegree.set(m.id, (inDegree.get(m.id) ?? 0) + 1);
        }
      }
    }
  }

  const byDate = (a: AniListMediaRaw, b: AniListMediaRaw) =>
    fuzzyDateScore(a.startDate, a.seasonYear) -
    fuzzyDateScore(b.startDate, b.seasonYear);

  const ready = members.filter((m) => (inDegree.get(m.id) ?? 0) === 0).sort(byDate);
  const ordered: AniListMediaRaw[] = [];
  const placed = new Set<number>();

  while (ready.length > 0) {
    const current = ready.shift()!;
    if (placed.has(current.id)) continue;
    placed.add(current.id);
    ordered.push(current);

    for (const succId of nextIds.get(current.id) ?? []) {
      const deg = (inDegree.get(succId) ?? 1) - 1;
      inDegree.set(succId, deg);
      if (deg <= 0 && !placed.has(succId)) {
        const succ = byId.get(succId);
        if (succ) {
          ready.push(succ);
          ready.sort(byDate);
        }
      }
    }
  }

  if (ordered.length < members.length) {
    const remaining = members.filter((m) => !placed.has(m.id)).sort(byDate);
    ordered.push(...remaining);
  }

  return ordered;
}

/**
 * Groups entries belonging to the same anime franchise (via PREQUEL / SEQUEL relations)
 * so catalog and search grids display one card per anime with its grouped seasons,
 * preserving the order of `seedIds` if provided.
 */
function groupFranchiseCatalog(
  rawItems: AniListMediaRaw[],
  featuredCount = 0,
  seedIds?: Set<number>
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

  // Also link items that point to the exact same prequel/sequel ID even if that neighbor isn't in `valid`
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

    if (seedIds && !compIds.some((cid) => seedIds.has(cid))) {
      continue;
    }

    const orderedAll = sortFranchiseMedia(compIds.map((cid) => byId.get(cid)!));
    const tvMembers = orderedAll.filter(
      (m) => !m.format || TV_SEASON_FORMATS.has(m.format)
    );
    const members = tvMembers.length > 0 ? tvMembers : orderedAll;

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
      const ongoingSeason = seasons.find((s) => s.status === 'En cours');
      rootSeries.seasons = seasons;
      rootSeries.episodes = seasons[0].episodes;
      rootSeries.episodesCount = totalAvailable;
      rootSeries.status = ongoingSeason
        ? 'En cours'
        : seasons.every((s) => s.status === 'À venir')
          ? 'À venir'
          : 'Terminé';
      if (ongoingSeason?.nextAiringAt) {
        const sched = getDayAndTimeFromUnix(ongoingSeason.nextAiringAt);
        rootSeries.simulcastDay = sched.day;
        rootSeries.simulcastTime = sched.time;
        rootSeries.nextAiringAt = ongoingSeason.nextAiringAt;
        rootSeries.nextAiringEpisode = ongoingSeason.nextAiringEpisode;
      }
    }

    for (const m of members) {
      franchiseCache.set(m.id, rootSeries);
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
  season
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
const mediaRawCache = new Map<number, AniListMediaRaw>();

/**
 * Batch-fetches connected PREQUEL / SEQUEL TV/ONA seasons for any seed media list
 * so Season 1 is always discovered and ordered properly right from Home, Search, and Simulcast.
 */
async function hydrateFranchiseMedia(
  seedMedia: AniListMediaRaw[],
  maxHops = 3
): Promise<AniListMediaRaw[]> {
  const orderedMap = new Map<number, AniListMediaRaw>();

  for (const item of seedMedia) {
    mediaRawCache.set(item.id, item);
    orderedMap.set(item.id, item);
  }

  try {
    let hop = 0;
    while (hop < maxHops) {
      hop += 1;
      const missingIds = new Set<number>();

      for (const item of orderedMap.values()) {
        for (const rel of getRelatedSeasonEdges(item)) {
          if (orderedMap.has(rel.node.id)) continue;
          const cached = mediaRawCache.get(rel.node.id);
          if (cached) {
            orderedMap.set(cached.id, cached);
          } else {
            missingIds.add(rel.node.id);
          }
        }
      }

      if (missingIds.size === 0) break;

      const allMissing = Array.from(missingIds);
      const chunks: number[][] = [];
      for (let i = 0; i < allMissing.length && chunks.length < 3; i += 50) {
        chunks.push(allMissing.slice(i, i + 50));
      }

      const query = `
        query BatchFranchise($ids: [Int]) {
          Page(page: 1, perPage: 50) {
            media(id_in: $ids, type: ANIME, isAdult: false) {
              ${MEDIA_FRAGMENT}
            }
          }
        }
      `;

      const responses = await Promise.all(
        chunks.map((ids) =>
          queryAniList<{
            Page: { media: AniListMediaRaw[] };
          }>(query, { ids })
        )
      );

      let added = 0;
      for (const data of responses) {
        for (const fetched of data.Page.media) {
          mediaRawCache.set(fetched.id, fetched);
          if (!orderedMap.has(fetched.id)) {
            orderedMap.set(fetched.id, fetched);
            added += 1;
          }
        }
      }

      if (added === 0) break;
    }
  } catch {
    // Keep already-collected items if secondary batch fails
  }

  return Array.from(orderedMap.values());
}

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
      const batch: number[] = [];
      for (const id of frontierIds) {
        if (collected.has(id)) continue;
        const cachedRaw = mediaRawCache.get(id);
        if (cachedRaw) {
          collected.set(id, cachedRaw);
          for (const rel of getRelatedSeasonEdges(cachedRaw)) {
            if (!collected.has(rel.node.id)) {
              frontierIds.push(rel.node.id);
            }
          }
        } else {
          batch.push(id);
        }
      }

      const uniqueBatch = Array.from(new Set(batch)).slice(0, 25);
      if (uniqueBatch.length === 0) break;

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
      }>(query, { ids: uniqueBatch });

      const nextFrontier = new Set<number>();
      for (const item of data.Page.media) {
        mediaRawCache.set(item.id, item);
        collected.set(item.id, item);
        for (const rel of getRelatedSeasonEdges(item)) {
          if (!collected.has(rel.node.id)) {
            nextFrontier.add(rel.node.id);
          }
        }
      }
      frontierIds = Array.from(nextFrontier);
    }

    const orderedAll = sortFranchiseMedia(Array.from(collected.values()));
    const tvMembers = orderedAll.filter(
      (m) => !m.format || TV_SEASON_FORMATS.has(m.format)
    );
    const allMedia = tvMembers.length > 0 ? tvMembers : orderedAll;

    if (allMedia.length <= 1) {
      franchiseCache.set(anime.anilistId, anime);
      return anime;
    }
    const rootRaw = allMedia[0];
    const baseSeries = mapAniListMedia(rootRaw, anime.featured);
    const rootId = baseSeries.id;

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
    const ongoingSeason = seasons.find((s) => s.status === 'En cours');
    const ongoingSched = ongoingSeason?.nextAiringAt
      ? getDayAndTimeFromUnix(ongoingSeason.nextAiringAt)
      : undefined;
    const fullSeries: AnimeSeries = {
      ...baseSeries,
      id: rootId,
      episodes: seasons[0].episodes,
      episodesCount: totalAvailable,
      status: ongoingSeason
        ? 'En cours'
        : seasons.every((s) => s.status === 'À venir')
          ? 'À venir'
          : 'Terminé',
      simulcastDay: ongoingSched?.day ?? baseSeries.simulcastDay,
      simulcastTime: ongoingSched?.time ?? baseSeries.simulcastTime,
      nextAiringAt: ongoingSeason?.nextAiringAt ?? baseSeries.nextAiringAt,
      nextAiringEpisode:
        ongoingSeason?.nextAiringEpisode ?? baseSeries.nextAiringEpisode,
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

  const trendingSeedIds = new Set(data.trending.media.map((m) => m.id));
  const popularSeedIds = new Set(data.popular.media.map((m) => m.id));

  const hydratedAll = await hydrateFranchiseMedia([
    ...data.trending.media,
    ...data.popular.media,
  ]);

  // Preserve trending order first, then popular order
  const byId = new Map(hydratedAll.map((m) => [m.id, m]));
  const trendingPool = [
    ...data.trending.media,
    ...hydratedAll.filter((m) => !trendingSeedIds.has(m.id)),
  ];
  const popularPool = [
    ...data.popular.media,
    ...hydratedAll.filter((m) => !popularSeedIds.has(m.id) && byId.has(m.id)),
  ];

  const trending = groupFranchiseCatalog(trendingPool, 4, trendingSeedIds);
  const popular = groupFranchiseCatalog(popularPool, 0, popularSeedIds);

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

  const seedIds = new Set(data.Page.media.map((m) => m.id));
  const hydrated = await hydrateFranchiseMedia(data.Page.media);
  return groupFranchiseCatalog(hydrated, 0, seedIds);
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

  const validRows = data.Page.airingSchedules.filter(
    (r): r is { id: number; airingAt: number; episode: number; media: AniListMediaRaw } =>
      Boolean(r.media && !r.media.isAdult)
  );
  const seedMedia = validRows.map((r) => r.media);
  const seedIds = new Set(seedMedia.map((m) => m.id));
  const hydrated = await hydrateFranchiseMedia(seedMedia);
  const grouped = groupFranchiseCatalog(hydrated, 0, seedIds);

  const seriesByAnilistId = new Map<number, { series: AnimeSeries; seasonNumber: number }>();
  for (const series of grouped) {
    for (const s of series.seasons ?? []) {
      if (s.anilistId) {
        seriesByAnilistId.set(s.anilistId, {
          series,
          seasonNumber: s.seasonNumber,
        });
      }
    }
    if (series.anilistId && !seriesByAnilistId.has(series.anilistId)) {
      seriesByAnilistId.set(series.anilistId, { series, seasonNumber: 1 });
    }
  }

  const seenAnime = new Set<string>();
  const items: SimulcastScheduleItem[] = [];

  for (const row of validRows) {
    const mapped = seriesByAnilistId.get(row.media.id);
    const anime = mapped?.series ?? mapAniListMedia(row.media, false);
    const seasonNumber = mapped?.seasonNumber ?? 1;
    if (seenAnime.has(anime.id)) continue;
    seenAnime.add(anime.id);

    const { day, time } = getDayAndTimeFromUnix(row.airingAt);
    items.push({
      id: `sched-${row.id}`,
      anime,
      seasonNumber,
      episodeNumber: row.episode,
      day: day ?? 'Samedi',
      time: time ?? '18:30',
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
