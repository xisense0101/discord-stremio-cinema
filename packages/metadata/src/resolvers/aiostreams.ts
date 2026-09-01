import { MediaStream } from '../types.js';
import config from '@discord-stremio/config';

export class AIOStreamsResolver {
  private getBaseUrl(): string {
    let url = config.torbox.aiostreamsUrl || 'https://aiostreams.elfhosted.com/stremio/7ed277cb-23c5-47c7-bed8-422e3095a99f/eyJpIjoicndwc3NHYXF6RFZ3b0YzUXpZY0JEQT09IiwiZSI6ImRiZVpDK21TeHgwVTBjV0REYk5CRmt5cVFkVzBrOWhObGNCNHZhYXBtVHM9IiwidCI6ImEifQ';
    if (url.endsWith('/manifest.json')) {
      url = url.substring(0, url.length - '/manifest.json'.length);
    }
    return url.replace(/\/+$/, '');
  }

  async resolveStreams(
    type: 'movie' | 'series',
    imdbId: string,
    season?: number,
    episode?: number,
    preferredQuality: string = '720p'
  ): Promise<MediaStream[]> {
    const id = type === 'series' && season && episode ? `${imdbId}:${season}:${episode}` : imdbId;
    const streams: MediaStream[] = [];
    const baseUrl = this.getBaseUrl();

    try {
      const url = `${baseUrl}/stream/${type}/${id}.json`;
      console.log(`[AIOStreamsResolver] Fetching streams for ${type} ${id} from AIOStreams: ${url}`);
      
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' },
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        const data = (await res.json()) as { streams?: any[] };
        if (data.streams && Array.isArray(data.streams)) {
          for (const s of data.streams) {
            const parsed = this.parseStream(s);
            if (parsed) {
              streams.push(parsed);
            }
          }
        }
      } else {
        console.warn(`[AIOStreamsResolver] HTTP Error ${res.status} from ${url}`);
      }
    } catch (err) {
      console.warn(`[AIOStreamsResolver] Resolve error:`, (err as Error).message);
    }

    return this.rankStreams(streams, preferredQuality);
  }

  private parseStream(raw: any): MediaStream | null {
    if (!raw.url) return null;

    const rawName = raw.name || 'AIOStreams';
    const rawTitle = raw.title || '';
    const filename = raw.behaviorHints?.filename || rawTitle || rawName;
    const bingeGroup = raw.behaviorHints?.bingeGroup || '';
    const fullText = `${rawName} ${rawTitle} ${filename} ${bingeGroup}`.toLowerCase();

    // Filter out CAM, TS, Telesync, Screener
    if (
      fullText.includes('cam') ||
      fullText.includes('telesync') ||
      fullText.includes('hdcam') ||
      fullText.includes('hd-ts') ||
      fullText.includes('screener') ||
      fullText.includes('scr')
    ) {
      return null;
    }

    // Parse Quality
    let quality: MediaStream['quality'] = 'other';
    if (/\b(4k|2160p|uhd|ultrahd)\b/i.test(fullText) || fullText.includes('2160p') || fullText.includes('4k')) {
      quality = '4k';
    } else if (/\b(1080p|1080i|1920x1080|fhd|fullhd)\b/i.test(fullText) || fullText.includes('1080p')) {
      quality = '1080p';
    } else if (/\b(720p|1280x720)\b/i.test(fullText) || fullText.includes('720p') || fullText.includes('1280x720') || (/\bhd\b/i.test(fullText) && !/\b(hdr|uhd|fullhd|hdrip)\b/i.test(fullText))) {
      quality = '720p';
    } else if (/\b(480p|576p|dvdrip|sd)\b/i.test(fullText) || fullText.includes('480p')) {
      quality = '480p';
    }

    // Parse Size
    let sizeBytes = raw.behaviorHints?.videoSize || 0;
    if (!sizeBytes || sizeBytes <= 0) {
      const sizeMatch = fullText.match(/([0-9.]+)\s*gb/);
      if (sizeMatch) {
        sizeBytes = Math.round(parseFloat(sizeMatch[1]) * 1024 * 1024 * 1024);
      }
    }

    // Parse Audio
    let audio = 'Stereo';
    if (fullText.includes('atmos') || fullText.includes('truehd') || fullText.includes('dts-hd') || fullText.includes('7.1')) {
      audio = 'Surround 7.1 (Lossless)';
    } else if (fullText.includes('dd+5.1') || fullText.includes('eac3') || fullText.includes('dts') || fullText.includes('5.1')) {
      audio = 'Dolby 5.1 Surround';
    } else if (fullText.includes('aac') || fullText.includes('mp4a') || fullText.includes('stereo') || fullText.includes('2.0')) {
      audio = 'AAC Stereo';
    }

    // Parse Language Score & Tag
    const isMulti = /\b(multi|multisubs|dual[- ]?audio|ita[.-]eng|eng[.-]ita|fre[.-]eng|eng[.-]fre|hindi[.-]english|english[.-]hindi)\b/i.test(fullText);
    const isExplicitEnglish = /\b(english|eng|en)\b/i.test(fullText) || bingeGroup.includes('English');
    const isFrench = /\b(french|truefrench|vff|vf2|vfi|vof|vostfr|genemige)\b/i.test(fullText) || (bingeGroup.includes('French') && !bingeGroup.includes('English'));
    const isItalian = (/\b(italian|ita|corsaronero)\b/i.test(fullText) || bingeGroup.includes('Italian')) && !isExplicitEnglish;
    const isRussian = (/\b(russian|rus|nnnb)\b/i.test(fullText) || /[а-яА-ЯёЁ]/.test(fullText) || bingeGroup.includes('Russian')) && !isExplicitEnglish;
    const isPortuguese = (/\b(portuguese|dublado|pt[- ]?br)\b/i.test(fullText) || bingeGroup.includes('Portuguese')) && !isExplicitEnglish;
    const isSpanish = (/\b(spanish|castellano|latino|espanol|esp)\b/i.test(fullText) || bingeGroup.includes('Spanish')) && !isExplicitEnglish;
    const isGerman = (/\b(german|deutsch|ger)\b/i.test(fullText) || bingeGroup.includes('German')) && !isExplicitEnglish;
    const isHindi = (/\b(hindi|hin)\b/i.test(fullText) || bingeGroup.includes('Hindi')) && !isExplicitEnglish;

    let languageLabel = 'English (Original)';
    let languageScore = 100;

    if (isMulti || (isExplicitEnglish && (isFrench || isItalian || isSpanish || isGerman || isRussian || isHindi))) {
      languageLabel = 'Multi-Audio (ENG+)';
      languageScore = 90;
    } else if (isFrench) {
      languageLabel = 'French (VFF/VF)';
      languageScore = 10;
    } else if (isItalian) {
      languageLabel = 'Italian';
      languageScore = 10;
    } else if (isRussian) {
      languageLabel = 'Russian';
      languageScore = 10;
    } else if (isPortuguese) {
      languageLabel = 'Portuguese (Dublado)';
      languageScore = 10;
    } else if (isSpanish) {
      languageLabel = 'Spanish (Latino/Castellano)';
      languageScore = 10;
    } else if (isGerman) {
      languageLabel = 'German';
      languageScore = 10;
    } else if (isHindi) {
      languageLabel = 'Hindi';
      languageScore = 10;
    }

    const displayTitle = filename.replace(/\.[a-zA-Z0-9]+$/, '') || rawName;

    return {
      id: raw.url || Math.random().toString(36).substring(2, 9),
      name: rawName,
      title: displayTitle,
      quality,
      resolution: quality,
      isCached: true,
      provider: 'AIOStreams [TB+]',
      audio,
      url: raw.url,
      sizeBytes,
      details: `${languageLabel} • ${audio}`,
      languageScore,
    } as MediaStream & { languageScore?: number };
  }

  private rankStreams(streams: MediaStream[], preferredQuality: string = '720p'): MediaStream[] {
    const pref = preferredQuality.toLowerCase().trim();
    let qualityPriority: Record<string, number> = { '720p': 1, '1080p': 2, '480p': 3, '4k': 4, 'other': 5 };

    if (pref === '4k' || pref === '2160p' || pref === 'uhd') {
      qualityPriority = { '4k': 1, '1080p': 2, '720p': 3, '480p': 4, 'other': 5 };
    } else if (pref === '2k' || pref === '1440p' || pref === 'qhd') {
      qualityPriority = { '4k': 1, '1080p': 2, '720p': 3, '480p': 4, 'other': 5 };
    } else if (pref === '1080p' || pref === 'fhd') {
      qualityPriority = { '1080p': 1, '720p': 2, '480p': 3, '4k': 4, 'other': 5 };
    } else if (pref === '720p' || pref === 'hd') {
      qualityPriority = { '720p': 1, '1080p': 2, '480p': 3, '4k': 4, 'other': 5 };
    } else if (pref === '480p' || pref === 'sd') {
      qualityPriority = { '480p': 1, '720p': 2, '1080p': 3, '4k': 4, 'other': 5 };
    }

    return streams.sort((a: any, b: any) => {
      // 1. Language Score Priority (English & Multi-Audio First)
      const langA = a.languageScore || 50;
      const langB = b.languageScore || 50;
      if (langA !== langB) return langB - langA;

      // 2. Preferred Quality Priority
      const rankA = qualityPriority[a.quality] || 99;
      const rankB = qualityPriority[b.quality] || 99;
      if (rankA !== rankB) return rankA - rankB;

      // 3. Optimal File Size Priority (~1.0 GB to 10.0 GB for smooth streaming)
      const sizeA = (a.sizeBytes || 0) / (1024 * 1024 * 1024);
      const sizeB = (b.sizeBytes || 0) / (1024 * 1024 * 1024);
      const isIdealA = sizeA >= 0.8 && sizeA <= 12.0;
      const isIdealB = sizeB >= 0.8 && sizeB <= 12.0;
      if (isIdealA && !isIdealB) return -1;
      if (!isIdealA && isIdealB) return 1;

      return (a.sizeBytes || 0) - (b.sizeBytes || 0);
    });
  }
}

export const aiostreamsResolver = new AIOStreamsResolver();
