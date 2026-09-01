import { MediaItem } from '@discord-stremio/metadata';

const CINEMETA_URL = 'https://v3-cinemeta.strem.io';

export function parseRuntimeMinutes(runtimeStr?: string): number {
  if (!runtimeStr) return 115; // default 1h 55m
  const str = runtimeStr.toLowerCase().trim();

  // Pattern: "2 h 15 min" or "2h 15m" or "2h"
  const hourMinMatch = str.match(/(\d+)\s*h(?:ours?|r)?\s*(\d*)\s*(?:min|m)?/);
  if (hourMinMatch) {
    const hours = parseInt(hourMinMatch[1], 10);
    const mins = hourMinMatch[2] ? parseInt(hourMinMatch[2], 10) : 0;
    return hours * 60 + mins;
  }

  // Pattern: "148 min" or "148m"
  const minMatch = str.match(/(\d+)\s*(?:min|m)/);
  if (minMatch) {
    return parseInt(minMatch[1], 10);
  }

  // Pure digits: "120"
  const num = parseInt(str, 10);
  if (!isNaN(num) && num > 30 && num < 600) {
    return num;
  }

  return 115;
}

export async function fetchMoviesCatalog(genre?: string): Promise<MediaItem[]> {
  try {
    const endpoint = genre && genre.toLowerCase() !== 'all'
      ? `${CINEMETA_URL}/catalog/movie/top/genre=${encodeURIComponent(genre)}.json`
      : `${CINEMETA_URL}/catalog/movie/top.json`;

    const res = await fetch(endpoint, {
      headers: { 'User-Agent': 'DiscordStremioPlayer/1.0' },
      next: { revalidate: 3600 },
    });

    if (!res.ok) return [];
    const data = await res.json();
    if (!data.metas || !Array.isArray(data.metas)) return [];

    return data.metas.map((m: any) => ({
      id: m.id,
      imdbId: m.imdb_id || m.id,
      type: 'movie',
      name: m.name,
      releaseInfo: m.releaseInfo || m.year || '',
      poster: m.poster,
      background: m.background,
      description: m.description,
      genres: m.genres || (m.genre ? [m.genre] : []),
      rating: m.imdbRating || m.rating,
      runtime: m.runtime,
    }));
  } catch (err) {
    console.error('[RandomMovie] Catalog fetch error:', err);
    return [];
  }
}

export function filterCandidates(
  movies: MediaItem[],
  startYear: number = 2015,
  endYear: number = 2025,
  minRating: number = 6.0
): MediaItem[] {
  return movies.filter((m) => {
    const yearMatch = m.releaseInfo ? m.releaseInfo.match(/\b(19\d\d|20\d\d)\b/) : null;
    const year = yearMatch ? parseInt(yearMatch[1], 10) : 0;
    if (year < startYear || year > endYear) return false;

    if (minRating > 0 && m.rating) {
      const ratingNum = parseFloat(m.rating);
      if (!isNaN(ratingNum) && ratingNum < minRating) return false;
    }

    return true;
  });
}

export function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function filterAndPickRandom(
  movies: MediaItem[],
  startYear: number = 2015,
  endYear: number = 2025,
  count: number = 1,
  minRating: number = 6.0
): MediaItem[] {
  const candidates = filterCandidates(movies, startYear, endYear, minRating);
  const shuffled = shuffleArray(candidates);
  return shuffled.slice(0, count);
}

export function filterAndPickByDuration(
  movies: MediaItem[],
  startYear: number = 2015,
  endYear: number = 2025,
  targetDurationMinutes: number = 360, // e.g. 6 hours
  minRating: number = 6.0
): { picked: MediaItem[]; totalMinutes: number; movieCount: number } {
  const candidates = filterCandidates(movies, startYear, endYear, minRating);
  const shuffled = shuffleArray(candidates);

  const picked: MediaItem[] = [];
  let accumulatedMinutes = 0;

  for (const movie of shuffled) {
    const runtimeMins = parseRuntimeMinutes(movie.runtime);
    picked.push(movie);
    accumulatedMinutes += runtimeMins + 2; // runtime + 2 min intermission break

    // Stop once we meet or exceed the target duration so the final movie is fully included
    if (accumulatedMinutes >= targetDurationMinutes) {
      break;
    }
  }

  return {
    picked,
    totalMinutes: accumulatedMinutes,
    movieCount: picked.length,
  };
}
