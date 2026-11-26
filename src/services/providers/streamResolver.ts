// Multi-Module Priority Stream Resolver — inspired by Mochy Music's SourceModule pipeline
//
// Produces an ordered queue of playable stream candidates. Every enabled module starts resolving
// concurrently and candidates are handed out in priority order — with three speed-ups so a song
// doesn't wait on every module:
//   1. Source Memory: the exact stream / module that played this song before is tried first, and
//      modules on a recent failure streak are tried last (sourceMemory.ts).
//   2. Grace window: if the top-priority module hasn't answered after GRACE_MS, a lower-priority
//      module that already has a stream goes first instead of waiting.
//   3. On iOS, Monochrome FLAC (which needs a one-time download) waits behind instant-start
//      sources unless it is already cached. Apple's 30 s previews are only used when allowed.

import { MochyPreferences } from '../../constants/preferences';
import { getOrCreateSynthWavUri } from '../../data/curatedCatalog';
import { DiagnosticStep, ModuleServerConfig, ResolvedStream, Track } from '../../types/music';
import { TrackQueryInput } from '../trackMatcher';
import { resolveInnerTubeStream } from './innertubeProvider';
import { searchItunesTracks } from './itunesProvider';
import { resolveJioSaavnStream } from './jiosaavnProvider';
import { MONOCHROME_STREAM_HEADERS, resolveMonochromeStream } from './monochromeProvider';
import { SourceMemory } from './sourceMemory';
import { StreamFileCache } from '../audio/streamFileCache';

const GRACE_MS = 1300;

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
        const wavUri = getOrCreateSynthWavUri(
          track.synthPreset || 'dreamy',
          track.durationSec || 32
        );
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
    return makeQueue(producers, diagnostics, prefs);
  }

  // 3. Source Memory — what played this song last time goes first
  if (prefs.rememberSources) {
    const mem = SourceMemory.get(track);
    if (mem?.localUri && StreamFileCache.isLocalUriAlive(mem.localUri)) {
      pushStep({
        module: 'Source Memory',
        step: 'Cached stream file',
        ok: true,
        detail: `${mem.sourceLabel} · ${mem.qualityLabel}`,
        latencyMs: 1,
      });
      producers.push(
        Promise.resolve([
          {
            url: mem.localUri,
            source: mem.module,
            sourceLabel: mem.sourceLabel,
            qualityLabel: mem.qualityLabel,
            codec: mem.codec,
            sampleRateHz: mem.sampleRateHz,
            cacheKey: mem.cacheKey,
            fromMemory: true,
          } as Candidate,
        ])
      );
    } else {
      const reuse = SourceMemory.reusableUrl(track);
      if (reuse?.url) {
        pushStep({
          module: 'Source Memory',
          step: 'Last working source',
          ok: true,
          detail: `${reuse.sourceLabel} · ${reuse.qualityLabel}`,
          latencyMs: 1,
        });
        producers.push(
          Promise.resolve([
            {
              url: reuse.url,
              source: reuse.module,
              sourceLabel: reuse.sourceLabel,
              qualityLabel: reuse.qualityLabel,
              codec: reuse.codec,
              headers: reuse.headers,
              sampleRateHz: reuse.sampleRateHz,
              cacheKey: reuse.cacheKey,
              fromMemory: true,
            } as Candidate,
          ])
        );
      }
    }
  }

  // 4. JioSaavn catalog tracks already carry a direct full-length AAC stream
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

  // 5. Every enabled module starts now (in parallel); results are consumed in priority order
  const order = prefs.rememberSources
    ? SourceMemory.rankModules(prefs.moduleOrder, track)
    : prefs.moduleOrder;
  for (const modId of order) {
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
                    headers: MONOCHROME_STREAM_HEADERS,
                    cacheKey: `mono-${mono.id}`,
                    gainDb: mono.gainDb,
                    peak: mono.peak,
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
                  gainDb: yt.gainDb,
                }) as Candidate
            )
          )
        )
      );
    }

    if (modId === 'itunes') {
      if (!prefs.allowPreviewFallback) {
        pushStep({
          module: 'Apple Preview',
          step: '30s preview fallback',
          ok: null,
          detail: 'Off — only full-length sources are used (Settings → Source modules)',
        });
        continue;
      }
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
            const itunesLookup = await searchItunesTracks(
              `${track.artist} ${track.title}`,
              4,
              'VN'
            );
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

  // 6. Whatever direct URL the catalog item carried (e.g. a Monochrome streamer URL)
  const directIsPreview = track.source === 'itunes';
  if (
    track.streamUrl &&
    track.source !== 'jiosaavn' &&
    (!directIsPreview || prefs.allowPreviewFallback)
  ) {
    producers.push(
      Promise.resolve([
        {
          url: track.streamUrl,
          source: track.source,
          sourceLabel: 'Direct Stream',
          qualityLabel: track.qualityBadge || 'Direct Stream',
          codec: track.source === 'monochrome' ? 'FLAC' : 'AAC',
          isPreview: directIsPreview,
          ...(track.source === 'monochrome'
            ? { headers: MONOCHROME_STREAM_HEADERS, cacheKey: track.id }
            : {}),
        },
      ])
    );
  }

  return makeQueue(producers, diagnostics, prefs);
}

interface Slot {
  promise: Promise<void>;
  done: boolean;
  value: Candidate[];
}

function makeQueue(
  producers: Promise<Candidate[]>[],
  diagnostics: DiagnosticStep[],
  prefs: Pick<MochyPreferences, 'preferInstantStart'>
): StreamCandidateQueue {
  const slots: Slot[] = producers.map((p) => {
    const slot: Slot = { done: false, value: [], promise: Promise.resolve() };
    slot.promise = p
      .then((v) => {
        slot.value = v || [];
      })
      .catch(() => {
        slot.value = [];
      })
      .finally(() => {
        slot.done = true;
      });
    return slot;
  });
  const graceDeadline = Date.now() + GRACE_MS;
  const buffer: Candidate[] = [];
  const deferred: Candidate[] = []; // FLAC that needs a one-time download on iOS
  const previews: Candidate[] = []; // Apple 30 s previews — always last
  const seen = new Set<string>();

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  const consume = (slot: Slot) => {
    slots.splice(slots.indexOf(slot), 1);
    for (const c of slot.value) {
      if (!c.url || seen.has(c.url)) continue;
      seen.add(c.url);
      if (c.isPreview) previews.push(c);
      else if (
        prefs.preferInstantStart &&
        !c.fromMemory &&
        StreamFileCache.needsLocalFile(c.codec, c.url) &&
        !StreamFileCache.cachedUri(c.cacheKey || '')
      )
        deferred.push(c);
      else buffer.push(c);
    }
  };

  return {
    diagnostics,
    async next() {
      while (buffer.length === 0 && slots.length > 0) {
        const head = slots[0];
        if (head.done) {
          consume(head);
          continue;
        }
        const graceLeft = graceDeadline - Date.now();
        if (graceLeft > 0) {
          await Promise.race([head.promise, sleep(graceLeft)]);
          if (head.done) continue;
        }
        // Top priority module is still busy: take a lower-priority module that already has a stream
        const ready = slots.find((sl) => sl.done && sl.value.length > 0);
        if (ready) {
          consume(ready);
          continue;
        }
        // Drop finished-but-empty slots, then wait for whichever module answers next
        slots.filter((sl) => sl.done).forEach((sl) => consume(sl));
        if (slots.length > 0) await Promise.race(slots.map((sl) => sl.promise));
      }
      const c = buffer.shift() || deferred.shift() || previews.shift();
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
