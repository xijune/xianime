import kuroganeImg from '/src/assets/images/anime_kurogane_blade_1794403085791.jpg';
import neoCourierImg from '/src/assets/images/anime_neo_courier_1794403087419.jpg';
import aetherIslandsImg from '/src/assets/images/anime_aether_islands_1794403088040.jpg';
import bibliothecaImg from '/src/assets/images/anime_bibliotheca_noctis_1794403087588.jpg';
import cinderArenaImg from '/src/assets/images/anime_cinder_arena_1794403088455.jpg';
import kyotoMelodyImg from '/src/assets/images/anime_kyoto_melody_1794403087916.jpg';

export type AudioTrack = 'VOSTFR' | 'VF';
export type VideoQuality = 'Auto' | '1080p' | '720p' | '480p';
export type SubtitleLanguage = 'fr' | 'jp' | 'off';

export type ParticleTheme =
  | 'rain'
  | 'cyber'
  | 'clouds'
  | 'lanterns'
  | 'embers'
  | 'petals';

export type SimulcastDay =
  | 'Lundi'
  | 'Mardi'
  | 'Mercredi'
  | 'Jeudi'
  | 'Vendredi'
  | 'Samedi'
  | 'Dimanche';

export interface SubtitleCue {
  start: number;
  end: number;
  fr: string;
  jp: string;
}

export interface Episode {
  id: string;
  animeId: string;
  season: number;
  number: number;
  title: string;
  synopsis: string;
  duration: number; // seconds
  introStart: number;
  introEnd: number;
  endingStart: number;
  thumbnail: string;
  videoUrl?: string;
  cues: SubtitleCue[];
}

export interface AnimeSeries {
  id: string;
  anilistId?: number;
  malId?: number;
  title: string;
  originalTitle: string;
  genres: string[];
  studio: string;
  year: number;
  rating: string;
  score: number;
  status: 'En cours' | 'Terminé' | 'À venir';
  simulcastDay: SimulcastDay;
  simulcastTime: string;
  audioTracks: AudioTrack[];
  episodesCount: number;
  synopsis: string;
  keyVisual: string; // 16:9 banner or high-res cover
  posterImage: string; // cover portrait
  trailerYoutubeId?: string;
  accentTint: string;
  particleTheme: ParticleTheme;
  featured?: boolean;
  episodes: Episode[];
}

export interface SimulcastScheduleItem {
  id: string;
  anime: AnimeSeries;
  episodeNumber: number;
  day: SimulcastDay;
  time: string;
  airingAt: number;
}

export const GENRE_MAP_FR: Record<string, string> = {
  Action: 'Action',
  Adventure: 'Aventure',
  Comedy: 'Comédie',
  Drama: 'Drame',
  Fantasy: 'Fantaisie',
  Horror: 'Horreur',
  Mystery: 'Mystère',
  Psychological: 'Psychologique',
  Romance: 'Romance',
  'Sci-Fi': 'Sci-Fi',
  'Slice of Life': 'Tranche de vie',
  Sports: 'Sport',
  Supernatural: 'Surnaturel',
  Thriller: 'Thriller',
};

export const GENRE_TO_ANILIST: Record<string, string> = {
  Tout: '',
  Action: 'Action',
  Aventure: 'Adventure',
  Fantaisie: 'Fantasy',
  'Sci-Fi': 'Sci-Fi',
  Mystère: 'Mystery',
  Drame: 'Drama',
  Comédie: 'Comedy',
  'Tranche de vie': 'Slice of Life',
};

export function buildEpisodeCues(
  animeTitle: string,
  epNum: number,
  epTitle: string,
  duration: number
): SubtitleCue[] {
  const safeDur = Math.max(240, duration);
  return [
    {
      start: 3,
      end: 14,
      fr: `« ${animeTitle} » — Épisode ${epNum} : ${epTitle}`,
      jp: `「${animeTitle}」 第${epNum}話`,
    },
    {
      start: 16,
      end: 85,
      fr: '♪ Générique d’ouverture — VOSTFR HD ♪',
      jp: '♪ オープニングテーマ ♪',
    },
    {
      start: 92,
      end: 120,
      fr: 'Astuce : chargez un fichier vidéo (.mp4 / .webm) ou lancez la bande-annonce officielle en haut du lecteur.',
      jp: 'ローカル動画ファイルまたは公式トレーラーを再生できます。',
    },
    {
      start: safeDur - 88,
      end: safeDur - 10,
      fr: '♪ Générique de fin ♪',
      jp: '♪ エンディングテーマ ♪',
    },
  ];
}

export function buildEpisodesForAnime(
  animeId: string,
  animeTitle: string,
  totalEpisodes: number,
  durationMinutes: number,
  fallbackThumb: string,
  streamingEpisodes?: Array<{ title?: string | null; thumbnail?: string | null }>
): Episode[] {
  const count = Math.max(1, Math.min(totalEpisodes || 12, 48));
  const durSec = Math.max(12, durationMinutes || 24) * 60;
  const list: Episode[] = [];

  for (let i = 1; i <= count; i++) {
    const streamInfo = streamingEpisodes?.[i - 1];
    const cleanTitle =
      streamInfo?.title?.replace(/^Episode\s+\d+\s*[-–:]\s*/i, '').trim() ||
      `Épisode ${i}`;
    const thumb = streamInfo?.thumbnail || fallbackThumb;

    list.push({
      id: `${animeId}-s1-e${i}`,
      animeId,
      season: 1,
      number: i,
      title: cleanTitle,
      synopsis: `Épisode ${i} de ${animeTitle}. Cliquez sur Lire pour regarder ou reprendre votre progression à la seconde près.`,
      duration: durSec,
      introStart: 15,
      introEnd: 90,
      endingStart: Math.max(120, durSec - 90),
      thumbnail: thumb,
      cues: buildEpisodeCues(animeTitle, i, cleanTitle, durSec),
    });
  }
  return list;
}

export function formatTimecode(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatRemainingMinutes(currentTime: number, duration: number): string {
  const remainingSec = Math.max(0, duration - currentTime);
  const mins = Math.max(1, Math.ceil(remainingSec / 60));
  return `Il reste ${mins} min`;
}

// Offline/error resilience fallback catalog
export const FALLBACK_ANIME_CATALOG: AnimeSeries[] = [
  {
    id: 'fallback-kurogane',
    title: 'Kurogane : Lame d’Orage',
    originalTitle: '黒鉄の雷刃',
    genres: ['Action', 'Fantaisie'],
    studio: 'Studio Kageyama',
    year: 2026,
    rating: '16+',
    score: 9.4,
    status: 'En cours',
    simulcastDay: 'Samedi',
    simulcastTime: '18:30',
    audioTracks: ['VOSTFR', 'VF'],
    episodesCount: 12,
    featured: true,
    accentTint: '#FF5E1A',
    particleTheme: 'rain',
    keyVisual: kuroganeImg,
    posterImage: kuroganeImg,
    synopsis:
      'Dans une métropole féodale balayée par des orages perpétuels, Renji Kurogane manie une lame forgée dans l’éclair pour traquer les esprits déchus.',
    episodes: buildEpisodesForAnime('fallback-kurogane', 'Kurogane : Lame d’Orage', 12, 24, kuroganeImg),
  },
  {
    id: 'fallback-neo',
    title: 'Néo-Coursier 2099',
    originalTitle: 'ネオ・クーリエ 2099',
    genres: ['Sci-Fi', 'Action'],
    studio: 'Studio Mirai',
    year: 2026,
    rating: '14+',
    score: 9.1,
    status: 'En cours',
    simulcastDay: 'Vendredi',
    simulcastTime: '20:00',
    audioTracks: ['VOSTFR', 'VF'],
    episodesCount: 10,
    featured: true,
    accentTint: '#F59E0B',
    particleTheme: 'cyber',
    keyVisual: neoCourierImg,
    posterImage: neoCourierImg,
    synopsis:
      'Sora transporte des données cryptées interdites à travers les autoroutes suspendues de Néo-Tokyo.',
    episodes: buildEpisodesForAnime('fallback-neo', 'Néo-Coursier 2099', 10, 24, neoCourierImg),
  },
  {
    id: 'fallback-aether',
    title: 'Les Îles d’Éther',
    originalTitle: '蒼穹のエーテル島',
    genres: ['Aventure', 'Fantaisie'],
    studio: 'SoraWorks Animation',
    year: 2025,
    rating: 'Tout public',
    score: 9.3,
    status: 'Terminé',
    simulcastDay: 'Dimanche',
    simulcastTime: '17:00',
    audioTracks: ['VOSTFR', 'VF'],
    episodesCount: 24,
    featured: true,
    accentTint: '#10B981',
    particleTheme: 'clouds',
    keyVisual: aetherIslandsImg,
    posterImage: aetherIslandsImg,
    synopsis:
      'Au-delà d’une mer de nuages dorés flottent des archipels oubliés. À bord de leur dirigeable de cuivre, Lyra et Kaito cartographient les cités célestes.',
    episodes: buildEpisodesForAnime('fallback-aether', 'Les Îles d’Éther', 24, 24, aetherIslandsImg),
  },
  {
    id: 'fallback-bibliotheca',
    title: 'Bibliotheca Noctis',
    originalTitle: '夜想図書館',
    genres: ['Mystère', 'Fantaisie'],
    studio: 'Atelier Yoru',
    year: 2026,
    rating: '14+',
    score: 8.9,
    status: 'En cours',
    simulcastDay: 'Jeudi',
    simulcastTime: '21:15',
    audioTracks: ['VOSTFR'],
    episodesCount: 12,
    accentTint: '#8B5CF6',
    particleTheme: 'lanterns',
    keyVisual: bibliothecaImg,
    posterImage: bibliothecaImg,
    synopsis:
      'Chaque nuit à minuit, une bibliothèque infinie apparaît dans les ruelles anciennes. Son archiviste veille sur des grimoires capables de réécrire les souvenirs.',
    episodes: buildEpisodesForAnime('fallback-bibliotheca', 'Bibliotheca Noctis', 12, 24, bibliothecaImg),
  },
  {
    id: 'fallback-cinder',
    title: 'Arène de Cendre',
    originalTitle: '灰燼の闘技場',
    genres: ['Action', 'Aventure'],
    studio: 'Studio Enma',
    year: 2026,
    rating: '16+',
    score: 9.0,
    status: 'En cours',
    simulcastDay: 'Mardi',
    simulcastTime: '19:30',
    audioTracks: ['VOSTFR', 'VF'],
    episodesCount: 16,
    accentTint: '#EF4444',
    particleTheme: 'embers',
    keyVisual: cinderArenaImg,
    posterImage: cinderArenaImg,
    synopsis:
      'Dans le colisée volcanique d’Obsidia, les combattants canalisent la chaleur de la terre.',
    episodes: buildEpisodesForAnime('fallback-cinder', 'Arène de Cendre', 16, 24, cinderArenaImg),
  },
  {
    id: 'fallback-kyoto',
    title: 'Mélodie de Kamogawa',
    originalTitle: '鴨川のメロディ',
    genres: ['Tranche de vie'],
    studio: 'Studio Kaze',
    year: 2025,
    rating: 'Tout public',
    score: 9.2,
    status: 'Terminé',
    simulcastDay: 'Mercredi',
    simulcastTime: '18:00',
    audioTracks: ['VOSTFR', 'VF'],
    episodesCount: 12,
    accentTint: '#F97316',
    particleTheme: 'petals',
    keyVisual: kyotoMelodyImg,
    posterImage: kyotoMelodyImg,
    synopsis:
      'Entre cours de lycée, répétitions au bord de la rivière Kamo et lanternes d’automne, Hina et Mei composent l’album de leur dernière année à Kyoto.',
    episodes: buildEpisodesForAnime('fallback-kyoto', 'Mélodie de Kamogawa', 12, 24, kyotoMelodyImg),
  },
];
