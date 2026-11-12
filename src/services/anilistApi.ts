import {
  buildEpisodesForAnime,
  computeRealisticEpisodeDuration,
  estimateEpisodeAirDate,
  getLatestReleasedEpisodeAirTime,
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

/** Use Vite proxy in the browser so Tailscale / LAN origins don't hit AniList CORS + see 429 as CORS. */
function getAniListEndpoint(): string {
  if (typeof window === 'undefined') return 'https://graphql.anilist.co';
  // Always proxy from the browser during local dev (localhost + Tailscale IP)
  if (import.meta.env.DEV) return '/api/anilist';
  return 'https://graphql.anilist.co';
}
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
  streamingEpisodes?: Array<{
    title?: string | null;
    thumbnail?: string | null;
  }> | null;
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
  popularity?: number | null;
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

function isSameFranchiseTitle(
  titleA?: string | null,
  titleB?: string | null
): boolean {
  if (!titleA || !titleB) return false;
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/gi, ' ')
      .split(/\s+/)
      .filter(
        (w) =>
          w.length >= 3 &&
          ![
            'the',
            'and',
            'for',
            'with',
            'season',
            'saison',
            'part',
            'partie',
            'hen',
            'act',
            'arc',
            'first',
            'second',
            'third',
          ].includes(w)
      );
  const wordsA = new Set(normalize(titleA));
  const wordsB = new Set(normalize(titleB));
  for (const w of wordsA) {
    if (wordsB.has(w)) return true;
  }
  return false;
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

  const rawTitles = [
    raw.title?.romaji,
    raw.title?.english,
    raw.title?.native,
  ].filter(Boolean) as string[];

  for (const edge of edges) {
    if (!edge?.node) continue;
    if (edge.relationType !== 'PREQUEL' && edge.relationType !== 'SEQUEL') continue;
    if (edge.node.type && edge.node.type !== 'ANIME') continue;

    // Single-episode ONA/Special spin-offs (like MONSTERS vs One Piece) must not hijack the main series
    if (
      edge.node.format === 'ONA' ||
      edge.node.format === 'SPECIAL' ||
      edge.node.format === 'MOVIE'
    ) {
      if (edge.node.episodes === 1 && (!raw.episodes || raw.episodes > 1)) {
        continue;
      }
    }

    const nodeTitles = [
      edge.node.title?.romaji,
      edge.node.title?.english,
      edge.node.title?.native,
    ].filter(Boolean) as string[];

    const sameFranchise = rawTitles.some((rt) =>
      nodeTitles.some((nt) => isSameFranchiseTitle(rt, nt))
    );

    // If titles share no meaningful franchise keyword, they are distinct works (e.g. MONSTERS vs ONE PIECE)
    if (!sameFranchise) {
      continue;
    }

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

  // If Season 1 / Episode 1 has not aired yet, 0 episodes are released
  if (
    raw.nextAiringEpisode?.episode === 1 &&
    raw.nextAiringEpisode.airingAt * 1000 > Date.now()
  ) {
    return 0;
  }

  const streamCount = raw.streamingEpisodes?.length ?? 0;
  const declaredEpisodes = raw.episodes ?? 0;

  if (raw.status === 'RELEASING') {
    if (raw.nextAiringEpisode?.episode) {
      const airedAlready = raw.nextAiringEpisode.airingAt * 1000 <= Date.now();
      const currentAiringCount = Math.max(
        0,
        airedAlready
          ? raw.nextAiringEpisode.episode
          : raw.nextAiringEpisode.episode - 1
      );
      // For ongoing series: only already aired episodes or streams, NEVER future declaredEpisodes!
      return Math.max(currentAiringCount, streamCount);
    }
    if (streamCount > 0) {
      return streamCount;
    }
    return declaredEpisodes > 0 ? declaredEpisodes : 1;
  }

  return Math.max(declaredEpisodes, streamCount, 0);
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
    seasonNumber,
    {
      startDate,
      seasonYear: year,
      seasonName: m.season ?? undefined,
      nextAiringEpisode: m.nextAiringEpisode?.episode,
      nextAiringAt: m.nextAiringEpisode?.airingAt,
      status: seasonStatus,
    }
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

    // Pick seed match or the entry with the highest episode count/significance as the root
    const seedMatch = seedIds ? members.find((m) => seedIds.has(m.id)) : undefined;
    const sortedBySignificance = [...members].sort((a, b) => {
      const epA = a.episodes || 0;
      const epB = b.episodes || 0;
      if (Math.abs(epA - epB) >= 10) return epB - epA;
      return (b.popularity || 0) - (a.popularity || 0);
    });
    const rootRaw = seedMatch ?? sortedBySignificance[0] ?? members[0];
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
  popularity
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
        streamingEpisodes {
          title
          thumbnail
        }
      }
    }
  }
`;

async function queryAniList<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(getAniListEndpoint(), {
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
    const seedMedia = allMedia.find((m) => m.id === anime.anilistId);
    const rootRaw = seedMedia ?? allMedia[0];
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

export interface CatalogPageResult {
  items: AnimeSeries[];
  pageInfo: {
    total: number;
    currentPage: number;
    lastPage: number;
    hasNextPage: boolean;
    perPage: number;
  };
}

export async function fetchCatalogPage(options: {
  query?: string;
  genreFr?: string;
  sort?: 'POPULARITY_DESC' | 'SCORE_DESC' | 'TRENDING_DESC' | 'START_DATE_DESC';
  page?: number;
  perPage?: number;
}): Promise<CatalogPageResult> {
  const aniGenre = options.genreFr ? GENRE_TO_ANILIST[options.genreFr] || undefined : undefined;
  const searchStr = options.query?.trim() || undefined;
  const sort = options.sort || 'POPULARITY_DESC';
  const page = options.page ?? 1;
  const perPage = options.perPage ?? 24;

  const now = new Date();
  const todayFuzzy = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();

  // For "Récents", query strictly anime that are currently releasing or already finished
  // and whose broadcast began on or before today, sorted by [START_DATE_DESC]
  const isRecentSort = sort === 'START_DATE_DESC';
  const isScoreSort = sort === 'SCORE_DESC';

  const query = isRecentSort
    ? `
      query SearchAnimeRecent($search: String, $genre: String, $today: FuzzyDateInt, $page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo {
            total
            currentPage
            lastPage
            hasNextPage
            perPage
          }
          media(
            type: ANIME,
            search: $search,
            genre: $genre,
            status_in: [RELEASING, FINISHED],
            startDate_lesser: $today,
            startDate_greater: 19600101,
            sort: [START_DATE_DESC],
            isAdult: false
          ) {
            ${MEDIA_FRAGMENT}
          }
        }
      }
    `
    : `
      query SearchAnime($search: String, $genre: String, $sort: [MediaSort], $statusIn: [MediaStatus], $page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo {
            total
            currentPage
            lastPage
            hasNextPage
            perPage
          }
          media(
            type: ANIME,
            search: $search,
            genre: $genre,
            sort: $sort,
            status_in: $statusIn,
            isAdult: false
          ) {
            ${MEDIA_FRAGMENT}
          }
        }
      }
    `;

  const variables = isRecentSort
    ? {
        search: searchStr,
        genre: aniGenre,
        today: todayFuzzy,
        page,
        perPage,
      }
    : {
        search: searchStr,
        genre: aniGenre,
        sort: [sort],
        statusIn: isScoreSort ? ['RELEASING', 'FINISHED'] : undefined,
        page,
        perPage,
      };

  const data = await queryAniList<{
    Page: {
      pageInfo?: {
        total?: number;
        currentPage?: number;
        lastPage?: number;
        hasNextPage?: boolean;
        perPage?: number;
      };
      media: AniListMediaRaw[];
    };
  }>(query, variables);

  const rawMedia = data.Page.media ?? [];
  const seedIds = new Set(rawMedia.map((m) => m.id));
  const hydrated = await hydrateFranchiseMedia(rawMedia);
  let items = groupFranchiseCatalog(hydrated, 0, seedIds);

  // Apply accurate ordering over the fetched page items:
  if (sort === 'START_DATE_DESC') {
    // Exclude completely unreleased items, then sort by latest released episode air date (newest first)
    items = items.filter((a) => a.status !== 'À venir' && a.episodesCount > 0);
    items.sort((a, b) => {
      const timeA = getLatestReleasedEpisodeAirTime(a);
      const timeB = getLatestReleasedEpisodeAirTime(b);
      return timeB - timeA;
    });
  } else if (sort === 'SCORE_DESC') {
    // Sort by rating from highest to lowest, treating unrated anime as lowest
    items = [...items].sort((a, b) => {
      const scoreA = typeof a.score === 'number' ? a.score : -1;
      const scoreB = typeof b.score === 'number' ? b.score : -1;
      return scoreB - scoreA;
    });
  }

  const total = data.Page.pageInfo?.total ?? items.length;
  const lastPage = data.Page.pageInfo?.lastPage ?? Math.max(1, Math.ceil(total / perPage));
  const hasNextPage = Boolean(data.Page.pageInfo?.hasNextPage ?? page < lastPage);

  return {
    items,
    pageInfo: {
      total,
      currentPage: page,
      lastPage,
      hasNextPage,
      perPage,
    },
  };
}

export async function searchRealAnime(options: {
  query?: string;
  genreFr?: string;
  sort?: 'POPULARITY_DESC' | 'SCORE_DESC' | 'TRENDING_DESC' | 'START_DATE_DESC';
  page?: number;
  perPage?: number;
}): Promise<AnimeSeries[]> {
  const result = await fetchCatalogPage(options);
  return result.items;
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

const KITSU_ENDPOINT = 'https://kitsu.io/api/edge';

interface JikanEpisodeRaw {
  mal_id: number;
  title?: string | null;
  title_japanese?: string | null;
  aired?: string | null;
  filler?: boolean;
  recap?: boolean;
}

interface JikanVideoEpisodeRaw {
  mal_id: number;
  title?: string | null;
  images?: {
    jpg?: {
      image_url?: string | null;
    } | null;
  } | null;
}

interface KitsuEpisodeAttributes {
  canonicalTitle?: string | null;
  titles?: Record<string, string> | null;
  synopsis?: string | null;
  description?: string | null;
  number?: number | null;
  relativeNumber?: number | null;
  airdate?: string | null;
  length?: number | null;
  thumbnail?: {
    large?: string | null;
    medium?: string | null;
    original?: string | null;
    small?: string | null;
  } | null;
}

interface KitsuEpMeta {
  title?: string;
  synopsis?: string;
  durationMin?: number;
  thumbnail?: string;
  airdate?: string;
}

const enrichedSeasonCache = new Map<string, Episode[]>();

async function fetchAniListEpisodeSchedules(
  anilistId?: number
): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (!anilistId) return map;

  try {
    for (let page = 1; page <= 2; page++) {
      const query = `
        query EpisodeSchedules($id: Int, $page: Int) {
          Media(id: $id, type: ANIME) {
            airingSchedule(page: $page, perPage: 50) {
              pageInfo {
                hasNextPage
              }
              nodes {
                episode
                airingAt
              }
            }
          }
        }
      `;
      const data = await queryAniList<{
        Media?: {
          airingSchedule?: {
            pageInfo?: { hasNextPage?: boolean };
            nodes?: Array<{ episode?: number | null; airingAt?: number | null }>;
          } | null;
        } | null;
      }>(query, { id: anilistId, page });

      const nodes = data.Media?.airingSchedule?.nodes ?? [];
      for (const n of nodes) {
        if (typeof n.episode === 'number' && typeof n.airingAt === 'number') {
          map.set(n.episode, n.airingAt);
        }
      }
      if (!data.Media?.airingSchedule?.pageInfo?.hasNextPage) break;
    }
  } catch {
    // Ignore schedule errors
  }
  return map;
}

async function resolveKitsuAnimeId(
  anilistId?: number,
  malId?: number,
  animeTitle?: string,
  seasonNumber?: number
): Promise<string | null> {
  const lookups: Array<{ site: string; id: number }> = [];
  if (anilistId) lookups.push({ site: 'anilist/anime', id: anilistId });
  if (malId) lookups.push({ site: 'myanimelist/anime', id: malId });

  for (const lookup of lookups) {
    try {
      const url = `${KITSU_ENDPOINT}/mappings?filter[externalSite]=${encodeURIComponent(
        lookup.site
      )}&filter[externalId]=${lookup.id}&include=item`;
      const res = await fetch(url, {
        headers: { Accept: 'application/vnd.api+json' },
      });
      if (!res.ok) continue;
      const json = (await res.json()) as {
        data?: Array<{
          relationships?: { item?: { data?: { id?: string; type?: string } } };
        }>;
        included?: Array<{ id?: string; type?: string }>;
      };
      const relId = json.data?.[0]?.relationships?.item?.data?.id;
      const incId = json.included?.find((i) => i.type === 'anime')?.id;
      if (relId || incId) return relId || incId || null;
    } catch {
      // Try next mapping
    }
  }

  // Fallback: search Kitsu by title (especially vital for season 2+, sequels, or unmapped anime)
  if (animeTitle) {
    try {
      const searchTerms: string[] = [];
      if (seasonNumber && seasonNumber > 1) {
        searchTerms.push(`${animeTitle} Season ${seasonNumber}`);
        searchTerms.push(`${animeTitle} ${seasonNumber}`);
      }
      searchTerms.push(animeTitle);

      for (const term of searchTerms) {
        const url = `${KITSU_ENDPOINT}/anime?filter[text]=${encodeURIComponent(
          term
        )}&page[limit]=3`;
        const res = await fetch(url, {
          headers: { Accept: 'application/vnd.api+json' },
        });
        if (!res.ok) continue;
        const json = (await res.json()) as {
          data?: Array<{ id?: string }>;
        };
        if (json.data && json.data.length > 0 && json.data[0].id) {
          return json.data[0].id;
        }
      }
    } catch {
      // Ignore search error
    }
  }

  return null;
}

async function fetchKitsuEpisodesMeta(
  anilistId?: number,
  malId?: number,
  animeTitle?: string,
  seasonNumber?: number,
  expectedCount = 24
): Promise<Map<number, KitsuEpMeta>> {
  const map = new Map<number, KitsuEpMeta>();
  try {
    const kitsuId = await resolveKitsuAnimeId(anilistId, malId, animeTitle, seasonNumber);
    if (!kitsuId) return map;

    const maxPages = Math.min(5, Math.max(1, Math.ceil(expectedCount / 20)));
    const offsets = Array.from({ length: maxPages }, (_, idx) => idx * 20);

    const pages = await Promise.all(
      offsets.map(async (offset) => {
        try {
          const res = await fetch(
            `${KITSU_ENDPOINT}/anime/${kitsuId}/episodes?page[limit]=20&page[offset]=${offset}&sort=number`,
            { headers: { Accept: 'application/vnd.api+json' } }
          );
          if (!res.ok) return [];
          const json = (await res.json()) as {
            data?: Array<{ attributes?: KitsuEpisodeAttributes }>;
          };
          return json.data ?? [];
        } catch {
          return [];
        }
      })
    );

    for (const items of pages) {
      for (const row of items) {
        const attr = row.attributes;
        if (!attr) continue;
        const epNum = attr.relativeNumber ?? attr.number;
        if (!epNum || epNum <= 0) continue;

        const thumb =
          attr.thumbnail?.original ||
          attr.thumbnail?.large ||
          attr.thumbnail?.medium ||
          attr.thumbnail?.small ||
          undefined;
        const rawSynopsis = (attr.synopsis || attr.description || '')
          .replace(/\s*\(Source:[^)]+\)\s*$/i, '')
          .trim();
        const title =
          attr.canonicalTitle ||
          attr.titles?.en ||
          attr.titles?.en_us ||
          attr.titles?.en_jp ||
          undefined;

        const meta: KitsuEpMeta = {
          title: title?.trim() || undefined,
          synopsis: rawSynopsis || undefined,
          durationMin:
            typeof attr.length === 'number' && attr.length > 0
              ? attr.length
              : undefined,
          thumbnail: thumb,
          airdate: attr.airdate || undefined,
        };

        if (!map.has(epNum)) map.set(epNum, meta);
        if (attr.number && !map.has(attr.number)) map.set(attr.number, meta);
      }
    }
  } catch {
    // Ignore Kitsu failure
  }
  return map;
}

async function fetchJikanMeta(malId?: number): Promise<{
  episodes: Map<number, JikanEpisodeRaw>;
  thumbs: Map<number, string>;
}> {
  const episodes = new Map<number, JikanEpisodeRaw>();
  const thumbs = new Map<number, string>();
  if (!malId) return { episodes, thumbs };

  try {
    const [epsRes, vidsRes] = await Promise.allSettled([
      fetch(`${JIKAN_ENDPOINT}/anime/${malId}/episodes?page=1`, {
        signal: AbortSignal.timeout(1800),
      }),
      fetch(`${JIKAN_ENDPOINT}/anime/${malId}/videos/episodes?page=1`, {
        signal: AbortSignal.timeout(1800),
      }),
    ]);

    if (epsRes.status === 'fulfilled' && epsRes.value.ok) {
      try {
        const json = (await epsRes.value.json()) as { data?: JikanEpisodeRaw[] };
        (json.data ?? []).forEach((jep, idx) => {
          episodes.set(jep.mal_id || idx + 1, jep);
        });
      } catch {
        // Ignore parse error
      }
    }

    if (vidsRes.status === 'fulfilled' && vidsRes.value.ok) {
      try {
        const json = (await vidsRes.value.json()) as {
          data?: JikanVideoEpisodeRaw[];
        };
        (json.data ?? []).forEach((v, idx) => {
          const img = v.images?.jpg?.image_url;
          if (img) {
            thumbs.set(v.mal_id || idx + 1, img);
          }
        });
      } catch {
        // Ignore parse error
      }
    }
  } catch {
    // Ignore Jikan failure
  }

  return { episodes, thumbs };
}

export interface EnrichSeasonOptions {
  anilistId?: number;
  malId?: number;
  fallbackThumb?: string;
  animeTitle?: string;
  seasonNumber?: number;
  startDate?: ReleaseFuzzyDate;
  seasonYear?: number;
  seasonName?: AnimeSeasonName;
  nextAiringEpisode?: number;
  nextAiringAt?: number;
}

export async function enrichSeasonEpisodes(
  episodes: Episode[],
  options: EnrichSeasonOptions
): Promise<Episode[]> {
  if (episodes.length === 0) return episodes;
  const cacheKey = `${options.anilistId ?? 0}-${options.malId ?? 0}-${episodes[0]?.season ?? 1}-${episodes.length}`;
  const cached = enrichedSeasonCache.get(cacheKey);
  if (cached) return cached;

  const [scheduleMap, kitsuMap, jikanMeta] = await Promise.all([
    fetchAniListEpisodeSchedules(options.anilistId),
    fetchKitsuEpisodesMeta(
      options.anilistId,
      options.malId,
      options.animeTitle,
      options.seasonNumber ?? episodes[0]?.season,
      episodes.length
    ),
    fetchJikanMeta(options.malId),
  ]);

  const thumbCounts = new Map<string, number>();
  for (const ep of episodes) {
    if (ep.thumbnail) {
      thumbCounts.set(ep.thumbnail, (thumbCounts.get(ep.thumbnail) ?? 0) + 1);
    }
  }

  const merged = episodes.map((ep) => {
    const next = { ...ep };
    const kitsu = kitsuMap.get(ep.number);
    const jikanEp = jikanMeta.episodes.get(ep.number);
    const jikanThumb = jikanMeta.thumbs.get(ep.number);
    const airingAt = scheduleMap.get(ep.number);

    if (airingAt) {
      next.airingAt = airingAt;
    }

    const rawAiredDate = kitsu?.airdate || jikanEp?.aired;
    if (rawAiredDate) {
      next.airedDate = rawAiredDate;
    }

    // Ensure air date is never undefined by computing weekly broadcast if missing
    if (!next.airedDate && !next.airingAt) {
      const estimated = estimateEpisodeAirDate(
        ep.number,
        options.startDate,
        options.seasonYear,
        options.seasonName,
        options.nextAiringEpisode,
        options.nextAiringAt
      );
      if (estimated.airingAt) next.airingAt = estimated.airingAt;
      if (estimated.airedDate) next.airedDate = estimated.airedDate;
    }

    // Authentic duration down to the second
    if (kitsu?.durationMin && kitsu.durationMin > 0) {
      next.duration = computeRealisticEpisodeDuration(
        ep.animeId,
        ep.season,
        ep.number,
        kitsu.durationMin,
        kitsu.durationMin
      );
      next.endingStart = Math.max(120, next.duration - 90);
    } else if (next.duration <= 0 || next.duration % 60 === 0) {
      next.duration = computeRealisticEpisodeDuration(
        ep.animeId,
        ep.season,
        ep.number,
        Math.floor(next.duration / 60) || 24
      );
      next.endingStart = Math.max(120, next.duration - 90);
    }

    // Replace generic or duplicated series/season banner thumbnail with real per-episode image when available
    const isSharedFallback =
      Boolean(next.thumbnail) && (thumbCounts.get(next.thumbnail) ?? 0) > 1;
    const isGenericThumb =
      !next.thumbnail ||
      isSharedFallback ||
      (options.fallbackThumb && next.thumbnail === options.fallbackThumb);

    if (isGenericThumb) {
      if (kitsu?.thumbnail) {
        next.thumbnail = kitsu.thumbnail;
      } else if (jikanThumb) {
        next.thumbnail = jikanThumb;
      }
    } else if (!next.thumbnail) {
      next.thumbnail = kitsu?.thumbnail || jikanThumb || '';
    }

    const isGenericTitle = /^Épisode\s+\d+$/i.test(next.title.trim());
    if (isGenericTitle) {
      const betterTitle = kitsu?.title?.trim() || jikanEp?.title?.trim();
      if (betterTitle) {
        next.title = betterTitle;
      }
    }

    if (kitsu?.synopsis) {
      next.synopsis = kitsu.synopsis;
    } else if (jikanEp?.aired) {
      const dateLabel = new Date(jikanEp.aired).toLocaleDateString('fr-FR', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
      next.synopsis = `Saison ${next.season} · Diffusé le ${dateLabel}${
        jikanEp.filler ? ' · Épisode hors-série' : ''
      }.`;
    }

    return next;
  });

  enrichedSeasonCache.set(cacheKey, merged);
  return merged;
}

export async function enrichSeasonEpisodesFromJikan(
  episodes: Episode[],
  malId?: number
): Promise<Episode[]> {
  return enrichSeasonEpisodes(episodes, { malId });
}

export async function enrichAnimeEpisodesFromJikan(anime: AnimeSeries): Promise<Episode[]> {
  return enrichSeasonEpisodes(anime.episodes, {
    anilistId: anime.anilistId,
    malId: anime.malId,
    fallbackThumb: anime.keyVisual || anime.posterImage,
  });
}
