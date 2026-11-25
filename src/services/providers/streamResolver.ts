// Multi-Module Priority Stream Resolver — inspired by Mochy Music's SourceModule pipeline

import { MochyPreferences } from '../../constants/preferences';
import { getOrCreateSynthWavUri } from '../../data/curatedCatalog';
import { DiagnosticStep, ModuleServerConfig, ResolvedStream, Track } from '../../types/music';
import { TrackQueryInput } from '../trackMatcher';
import { resolveInnerTubeStream } from './innertubeProvider';
import { searchItunesTracks } from './itunesProvider';
import { resolveJioSaavnStream } from './jiosaavnProvider';
import { resolveMonochromeStream } from './monochromeProvider';

export async function resolvePlayableStream(
  track: Track,
  prefs: MochyPreferences,
  monochromeServers: ModuleServerConfig[],
  offlineUri?: string
): Promise<ResolvedStream> {
  const diagnostics: DiagnosticStep[] = [];
  const pushStep = (step: DiagnosticStep) => diagnostics.push(step);

  // 1. Offline downloaded file takes highest priority
  if (offlineUri) {
    pushStep({
      module: 'Offline Storage',
      step: 'Local cache hit',
      ok: true,
      detail: 'Playing directly from device storage',
      latencyMs: 1,
    });
    return {
      url: offlineUri,
      source: 'offline',
      sourceLabel: 'Offline Cache',
      qualityLabel: track.qualityBadge || 'Offline · Cached',
      codec: 'Local',
      isOffline: true,
      diagnostics,
    };
  }

  // 2. Built-in synth showcase track
  if (track.source === 'synth' || track.synthPreset) {
    const wavUri = getOrCreateSynthWavUri(track.synthPreset || 'dreamy', track.durationSec || 32);
    pushStep({
      module: 'Mochy Sound Lab',
      step: 'Synthesize stereo PCM',
      ok: true,
      detail: 'PCM 16-bit · 22.05 kHz stereo engine',
      latencyMs: 4,
    });
    return {
      url: wavUri,
      source: 'synth',
      sourceLabel: 'Mochy Sound Lab',
      qualityLabel: 'PCM 16-bit · Stereo',
      codec: 'WAV',
      diagnostics,
    };
  }

  // If track already came from JioSaavn with a direct full-length AAC stream, play immediately!
  if (track.source === 'jiosaavn' && track.streamUrl) {
    pushStep({
      module: 'JioSaavn',
      step: 'Direct catalog stream',
      ok: true,
      detail: track.qualityBadge || 'AAC 320 kbps',
      latencyMs: 2,
    });
    return {
      url: track.streamUrl,
      source: 'jiosaavn',
      sourceLabel: 'JioSaavn',
      qualityLabel: track.qualityBadge || 'AAC 320 kbps',
      codec: 'AAC',
      diagnostics,
    };
  }

  const query: TrackQueryInput = {
    title: track.title,
    artists: track.artists?.length ? track.artists : [track.artist],
    album: track.album,
    durationSec: track.durationSec,
    isrc: track.isrc,
    videoId: track.videoId,
  };

  // 3. Walk user's configured Module Priority Order
  for (const modId of prefs.moduleOrder) {
    if (!prefs.enabledModules[modId]) continue;

    if (modId === 'monochrome') {
      const mono = await resolveMonochromeStream(query, monochromeServers, pushStep);
      if (mono) {
        return {
          url: mono.url,
          source: 'monochrome',
          sourceLabel: 'Monochrome',
          qualityLabel: mono.qualityLabel,
          codec: 'FLAC',
          sampleRateHz: mono.sampleRateHz,
          diagnostics,
        };
      }
    }

    if (modId === 'jiosaavn') {
      const saavn = await resolveJioSaavnStream(query, prefs.preferredJioSaavnQuality, pushStep);
      if (saavn) {
        return {
          url: saavn.url,
          source: 'jiosaavn',
          sourceLabel: 'JioSaavn',
          qualityLabel: saavn.qualityLabel,
          codec: 'AAC',
          diagnostics,
        };
      }
    }

    if (modId === 'innertube') {
      const yt = await resolveInnerTubeStream(query, pushStep);
      if (yt) {
        return {
          url: yt.url,
          source: 'innertube',
          sourceLabel: 'InnerTube',
          qualityLabel: yt.qualityLabel,
          codec: yt.codec,
          diagnostics,
        };
      }
    }

    if (modId === 'itunes') {
      if (track.streamUrl && track.streamUrl.startsWith('http')) {
        pushStep({
          module: 'Apple Stream',
          step: 'Direct CDN AAC',
          ok: true,
          detail: 'AAC 256 kbps · Apple CDN',
          latencyMs: 2,
        });
        return {
          url: track.streamUrl,
          source: 'itunes',
          sourceLabel: 'Apple CDN',
          qualityLabel: 'AAC 256 kbps',
          codec: 'AAC',
          isPreview: true,
          diagnostics,
        };
      }
      const itunesLookup = await searchItunesTracks(`${track.artist} ${track.title}`, 4, 'VN');
      const hit = itunesLookup.find((c) => c.streamUrl);
      if (hit?.streamUrl) {
        pushStep({
          module: 'Apple Stream',
          step: 'Matched CDN AAC',
          ok: true,
          detail: `${hit.title} · AAC 256 kbps`,
        });
        return {
          url: hit.streamUrl,
          source: 'itunes',
          sourceLabel: 'Apple CDN',
          qualityLabel: 'AAC 256 kbps',
          codec: 'AAC',
          isPreview: true,
          diagnostics,
        };
      }
    }
  }

  // 4. Guaranteed playable fallback so playback NEVER errors out even offline
  if (track.streamUrl) {
    return {
      url: track.streamUrl,
      source: track.source,
      sourceLabel: 'Direct Stream',
      qualityLabel: track.qualityBadge || 'AAC Stream',
      codec: 'AAC',
      diagnostics,
    };
  }

  const fallbackWav = getOrCreateSynthWavUri('dreamy', 32);
  pushStep({
    module: 'Mochy Offline Fallback',
    step: 'Synthesize ambient fallback',
    ok: true,
    detail: 'Network unreachable — playing Mochy Ambient Synth',
  });
  return {
    url: fallbackWav,
    source: 'synth',
    sourceLabel: 'Mochy Synth Fallback',
    qualityLabel: 'PCM 16-bit · Offline Synth',
    codec: 'WAV',
    diagnostics,
  };
}
