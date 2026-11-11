import type { AnimeSeries, Episode } from '../data/animeCatalog';

// L'URL de votre backend (à remplacer par votre IP ou domaine une fois déployé)
const BACKEND_API_URL = 'http://localhost:3000/api/extract-m3u8';

export async function resolveEpisodeVideoUrl(
  anime: AnimeSeries,
  episode: Episode
): Promise<string | null> {
  if (episode.videoUrl) return episode.videoUrl;

  try {
    // ⚠️ IMPORTANT : Adaptez cette URL selon comment vous construisez 
    // les liens de VoirAnime. Ici, je simule avec un slug et un numéro d'épisode.
    // Ex: https://voir-anime.to/anime/beast-king-war-god-dandivine/dandivine-04-vostfr/
    const targetUrl = `https://voir-anime.to/anime/${anime.slug}/${anime.slug}-${String(episode.number).padStart(2, '0')}-vostfr/`;

    const response = await fetch(BACKEND_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: targetUrl }),
    });

    if (!response.ok) {
      throw new Error('Erreur lors de la communication avec le backend');
    }

    const data = await response.json();
    
    if (data.success && data.m3u8Url) {
      return data.m3u8Url; // On retourne le lien trouvé par Puppeteer
    }
    
    return null;
  } catch (error) {
    console.error("Erreur resolveEpisodeVideoUrl:", error);
    return null;
  }
}