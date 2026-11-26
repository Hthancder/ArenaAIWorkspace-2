// Multi-Module Priority Stream Resolver — inspired by Mochy Music's SourceModule pipeline
//
// Produces an ordered queue of playable stream candidates. Every enabled module starts resolving
// concurrently (so total latency ≈ the slowest module instead of the sum of all of them), but
// candidates are handed out strictly in the user's Module Priority order. The player tries each
// candidate and falls through to the next one if AVPlayer / HTML5 Audio cannot start it.

import { MochyPreferences } from '../../constants/preferences';
import { getOrCreateSynthWavUri } from '../../data/curatedCatalog';
import { DiagnosticStep, ModuleServerConfig, ResolvedStream, Track } from '../../types/music';
import { TrackQueryInput } from '../trackMatcher';
import { resolveInnerTubeStream } from './innertubeProvider';
import { searchItunesTracks } from './itunesProvider';
import { resolveJioSaavnStream } from './jiosaavnProvider';
import { resolveMonochromeStream } from './monochromeProvider';

type Candidate = Omit<ResolvedStream, 'diagnostics'>;

export interface StreamCandidateQueue {
  /** Shared, growing diagnostics log for this playback attempt */
  diagnostics: DiagnosticStep[];
  /** Next candidate in priority order, or null when every module is exhausted */
  next(): Promise<ResolvedStream | null>;
}

export function createStreamCandidateQueue(
  track: Track,
  prefs: MochyPreferences,
  monochromeServers: ModuleServerConfig[],
  offlineUri?: string
): StreamCandidateQueue {
  const diagnostics: DiagnosticStep[] = [];
  const pushStep = (step: DiagnosticStep) => diagnostics.push(step);
  const producers: Promise<Candidate[]>[] = [];

  // 1. Offline downloaded file takes highest priority
  if (offlineUri) {
    pushStep({
      module: 'Offline Storage',
      step: 'Local cache hit',
      ok: true,
      detail: 'Playing directly from device storage',
      latencyMs: 1,
    });
    producers.push(
      Promise.resolve([
        {
          url: offlineUri,
          source: 'offline',
          sourceLabel: 'Offline Cache',
          qualityLabel: track.qualityBadge || 'Offline · Cached',
          codec: 'Local',
          isOffline: true,
        },
      ])
    );
  }

  // 2. Built-in Mochy Sound Lab showcase track (synthesized locally, no network)
  if (track.source === 'synth' || track.synthPreset) {
    producers.push(
      Promise.resolve().then(() => {
        const t0 = Date.now();
        const wavUri = getOrCreateSynthWavUri(track.synthPreset || 'dreamy', track.durationSec || 32);
        pushStep({
          module: 'Mochy Sound Lab',
          step: 'Synthesize stereo PCM',
          ok: true,
          detail: 'PCM 16-bit · 22.05 kHz stereo',
          latencyMs: Date.now() - t0,
        });
        return [
          {
            url: wavUri,
            source: 'synth',
            sourceLabel: 'Mochy Sound Lab',
            qualityLabel: 'PCM 16-bit · Stereo',
            codec: 'WAV',
          } as Candidate,
        ];
      })
    );
    return makeQueue(producers, diagnostics);
  }

  // 3. JioSaavn catalog tracks already carry a direct full-length AAC stream
  if (track.source === 'jiosaavn' && track.streamUrl) {
    pushStep({
      module: 'JioSaavn',
      step: 'Direct catalog stream',
      ok: true,
      detail: track.qualityBadge || 'AAC 320 kbps',
      latencyMs: 2,
    });
    producers.push(
      Promise.resolve([
        {
          url: track.streamUrl,
          source: 'jiosaavn',
          sourceLabel: 'JioSaavn',
          qualityLabel: track.qualityBadge || 'AAC 320 kbps',
          codec: 'AAC',
        },
      ])
    );
  }

  const query: TrackQueryInput = {
    title: track.title,
    artists: track.artists?.length ? track.artists : [track.artist],
    album: track.album,
    durationSec: track.durationSec,
    isrc: track.isrc,
    videoId: track.videoId,
  };

  const safe = (p: Promise<Candidate[]>): Promise<Candidate[]> => p.catch(() => []);

  // 4. Every enabled module starts now (in parallel); results are consumed in priority order
  for (const modId of prefs.moduleOrder) {
    if (!prefs.enabledModules[modId]) continue;

    if (modId === 'monochrome') {
      producers.push(
        safe(
          resolveMonochromeStream(query, monochromeServers, pushStep).then((mono) =>
            mono
              ? [
                  {
                    url: mono.url,
                    source: 'monochrome',
                    sourceLabel: 'Monochrome',
                    qualityLabel: mono.qualityLabel,
                    codec: 'FLAC',
                    sampleRateHz: mono.sampleRateHz,
                  } as Candidate,
                ]
              : []
          )
        )
      );
    }

    if (modId === 'jiosaavn') {
      producers.push(
        safe(
          resolveJioSaavnStream(query, prefs.preferredJioSaavnQuality, pushStep).then((saavn) =>
            saavn
              ? [
                  {
                    url: saavn.url,
                    source: 'jiosaavn',
                    sourceLabel: 'JioSaavn',
                    qualityLabel: saavn.qualityLabel,
                    codec: 'AAC',
                  } as Candidate,
                ]
              : []
          )
        )
      );
    }

    if (modId === 'innertube') {
      producers.push(
        safe(
          resolveInnerTubeStream(query, pushStep).then((list) =>
            list.map(
              (yt) =>
                ({
                  url: yt.url,
                  source: 'innertube',
                  sourceLabel: 'YouTube Music',
                  qualityLabel: yt.qualityLabel,
                  codec: yt.codec,
                  headers: yt.headers,
                }) as Candidate
            )
          )
        )
      );
    }

    if (modId === 'itunes') {
      producers.push(
        safe(
          (async (): Promise<Candidate[]> => {
            if (track.source === 'itunes' && track.streamUrl?.startsWith('http')) {
              pushStep({
                module: 'Apple Preview',
                step: 'Direct CDN AAC',
                ok: true,
                detail: 'AAC · 30s preview',
                latencyMs: 2,
              });
              return [
                {
                  url: track.streamUrl,
                  source: 'itunes',
                  sourceLabel: 'Apple Preview',
                  qualityLabel: 'AAC · 30s preview',
                  codec: 'AAC',
                  isPreview: true,
                },
              ];
            }
            const t0 = Date.now();
            const itunesLookup = await searchItunesTracks(`${track.artist} ${track.title}`, 4, 'VN');
            const hit = itunesLookup.find((c) => c.streamUrl);
            pushStep({
              module: 'Apple Preview',
              step: 'Catalog match',
              ok: !!hit?.streamUrl,
              detail: hit ? `${hit.title} · 30s preview` : 'No preview available',
              latencyMs: Date.now() - t0,
            });
            return hit?.streamUrl
              ? [
                  {
                    url: hit.streamUrl,
                    source: 'itunes',
                    sourceLabel: 'Apple Preview',
                    qualityLabel: 'AAC · 30s preview',
                    codec: 'AAC',
                    isPreview: true,
                  },
                ]
              : [];
          })()
        )
      );
    }
  }

  // 5. Whatever direct URL the catalog item carried (e.g. a Monochrome streamer URL)
  if (track.streamUrl && track.source !== 'jiosaavn') {
    producers.push(
      Promise.resolve([
        {
          url: track.streamUrl,
          source: track.source,
          sourceLabel: 'Direct Stream',
          qualityLabel: track.qualityBadge || 'Direct Stream',
          codec: 'AAC',
          isPreview: track.source === 'itunes',
        },
      ])
    );
  }

  return makeQueue(producers, diagnostics);
}

function makeQueue(producers: Promise<Candidate[]>[], diagnostics: DiagnosticStep[]): StreamCandidateQueue {
  const pending = [...producers];
  const buffer: Candidate[] = [];
  const seen = new Set<string>();

  return {
    diagnostics,
    async next() {
      while (buffer.length === 0 && pending.length > 0) {
        const list = await pending.shift()!;
        for (const c of list) {
          if (!c.url || seen.has(c.url)) continue;
          seen.add(c.url);
          buffer.push(c);
        }
      }
      const c = buffer.shift();
      return c ? { ...c, diagnostics: [...diagnostics] } : null;
    },
  };
}

/**
 * Convenience: first candidate only (used by the offline downloader).
 * Returns null when nothing could be resolved.
 */
export async function resolvePlayableStream(
  track: Track,
  prefs: MochyPreferences,
  monochromeServers: ModuleServerConfig[],
  offlineUri?: string
): Promise<ResolvedStream | null> {
  return createStreamCandidateQueue(track, prefs, monochromeServers, offlineUri).next();
}
