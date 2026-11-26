// Scrobbling to Last.fm and ListenBrainz — the feature list comes from Cog (both services) and
// Spotube (ScrobbleManager). Rules follow the Last.fm spec: the track is longer than 30 s and was
// played for half its length or 4 minutes, whichever comes first. Failed submissions wait in a
// small offline queue and are retried on the next successful scrobble.
// Credentials stay on the device. Last.fm only keeps the session key, never the password.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Track } from '../../types/music';
import { md5 } from './md5';

const KEY = '@holysic/scrobble_v1';

export interface ScrobbleSettings {
  listenBrainzToken: string;
  listenBrainzUser: string;
  lastfmApiKey: string;
  lastfmSecret: string;
  lastfmSessionKey: string;
  lastfmUser: string;
  enabled: boolean;
}

interface PendingScrobble {
  artist: string;
  title: string;
  album?: string;
  durationSec: number;
  startedAt: number; // unix seconds
  targets: ('lastfm' | 'listenbrainz')[];
}

const DEFAULTS: ScrobbleSettings = {
  listenBrainzToken: '',
  listenBrainzUser: '',
  lastfmApiKey: '',
  lastfmSecret: '',
  lastfmSessionKey: '',
  lastfmUser: '',
  enabled: true,
};

let settings: ScrobbleSettings = { ...DEFAULTS };
let pending: PendingScrobble[] = [];
let loaded = false;

async function persist(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify({ settings, pending: pending.slice(-100) }));
  } catch {
    // ignore
  }
}

async function timedFetch(url: string, init: RequestInit, ms = 9000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function lastfmSign(params: Record<string, string>, secret: string): string {
  const base = Object.keys(params)
    .filter((k) => k !== 'format' && k !== 'callback')
    .sort()
    .map((k) => k + params[k])
    .join('');
  return md5(base + secret);
}

async function lastfmCall(params: Record<string, string>): Promise<any> {
  const signed = { ...params, api_key: settings.lastfmApiKey };
  const body = new URLSearchParams({
    ...signed,
    api_sig: lastfmSign(signed, settings.lastfmSecret),
    format: 'json',
  });
  const res = await timedFetch('https://ws.audioscrobbler.com/2.0/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.error) throw new Error(json?.message || `Last.fm HTTP ${res.status}`);
  return json;
}

async function listenBrainzSubmit(
  type: 'single' | 'playing_now' | 'import',
  items: PendingScrobble[]
): Promise<void> {
  const payload = items.map((s) => ({
    ...(type === 'playing_now' ? {} : { listened_at: s.startedAt }),
    track_metadata: {
      artist_name: s.artist,
      track_name: s.title,
      ...(s.album ? { release_name: s.album } : {}),
      additional_info: {
        duration_ms: Math.round(s.durationSec * 1000),
        media_player: 'HolySic iOS',
        submission_client: 'HolySic iOS',
      },
    },
  }));
  const res = await timedFetch('https://api.listenbrainz.org/1/submit-listens', {
    method: 'POST',
    headers: {
      Authorization: `Token ${settings.listenBrainzToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ listen_type: type, payload }),
  });
  if (!res.ok) throw new Error(`ListenBrainz HTTP ${res.status}`);
}

function primaryArtist(track: Track): string {
  return (track.artists?.[0] || track.artist || '').trim();
}

export const Scrobbler = {
  async load(): Promise<ScrobbleSettings> {
    if (!loaded) {
      loaded = true;
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) {
          const j = JSON.parse(raw);
          settings = { ...DEFAULTS, ...(j?.settings || {}) };
          pending = Array.isArray(j?.pending) ? j.pending : [];
        }
      } catch {
        // defaults
      }
    }
    return { ...settings };
  },

  get(): ScrobbleSettings {
    return { ...settings };
  },

  pendingCount(): number {
    return pending.length;
  },

  lastfmReady(): boolean {
    return !!(settings.lastfmApiKey && settings.lastfmSecret && settings.lastfmSessionKey);
  },

  listenBrainzReady(): boolean {
    return !!settings.listenBrainzToken;
  },

  async update(patch: Partial<ScrobbleSettings>): Promise<ScrobbleSettings> {
    settings = { ...settings, ...patch };
    await persist();
    return { ...settings };
  },

  /** Validates a ListenBrainz user token and stores it */
  async connectListenBrainz(token: string): Promise<string> {
    const res = await timedFetch('https://api.listenbrainz.org/1/validate-token', {
      headers: { Authorization: `Token ${token.trim()}` },
    });
    const j = await res.json().catch(() => null);
    if (!j?.valid) throw new Error(j?.message || 'Token không hợp lệ');
    await Scrobbler.update({
      listenBrainzToken: token.trim(),
      listenBrainzUser: j.user_name || '',
    });
    return j.user_name || '';
  },

  /** auth.getMobileSession: the password is used once and discarded */
  async connectLastfm(
    apiKey: string,
    secret: string,
    username: string,
    password: string
  ): Promise<string> {
    settings = { ...settings, lastfmApiKey: apiKey.trim(), lastfmSecret: secret.trim() };
    const j = await lastfmCall({
      method: 'auth.getMobileSession',
      username: username.trim(),
      password,
    });
    const key = j?.session?.key;
    if (!key) throw new Error('Last.fm không trả về session');
    await Scrobbler.update({
      lastfmSessionKey: key,
      lastfmUser: j.session.name || username.trim(),
    });
    return j.session.name || username.trim();
  },

  async disconnect(service: 'lastfm' | 'listenbrainz'): Promise<void> {
    if (service === 'lastfm') await Scrobbler.update({ lastfmSessionKey: '', lastfmUser: '' });
    else await Scrobbler.update({ listenBrainzToken: '', listenBrainzUser: '' });
  },

  async nowPlaying(track: Track): Promise<void> {
    if (!settings.enabled || track.source === 'synth') return;
    const artist = primaryArtist(track);
    if (!artist || !track.title) return;
    const tasks: Promise<unknown>[] = [];
    if (Scrobbler.lastfmReady()) {
      tasks.push(
        lastfmCall({
          method: 'track.updateNowPlaying',
          artist,
          track: track.title,
          ...(track.album ? { album: track.album } : {}),
          ...(track.durationSec ? { duration: String(Math.round(track.durationSec)) } : {}),
          sk: settings.lastfmSessionKey,
        })
      );
    }
    if (Scrobbler.listenBrainzReady()) {
      tasks.push(
        listenBrainzSubmit('playing_now', [
          {
            artist,
            title: track.title,
            album: track.album,
            durationSec: track.durationSec,
            startedAt: 0,
            targets: [],
          },
        ])
      );
    }
    await Promise.allSettled(tasks);
  },

  /** Whether a play of `listenedSec` counts as a scrobble (Last.fm rule) */
  qualifies(durationSec: number, listenedSec: number): boolean {
    if (durationSec > 0 && durationSec <= 30) return false;
    const half = durationSec > 0 ? durationSec / 2 : 120;
    return listenedSec >= Math.min(half, 240);
  },

  async scrobble(track: Track, startedAtMs: number): Promise<number> {
    if (!settings.enabled || track.source === 'synth') return 0;
    const artist = primaryArtist(track);
    if (!artist || !track.title) return 0;
    const targets: PendingScrobble['targets'] = [];
    if (Scrobbler.lastfmReady()) targets.push('lastfm');
    if (Scrobbler.listenBrainzReady()) targets.push('listenbrainz');
    if (targets.length === 0) return 0;
    pending.push({
      artist,
      title: track.title,
      album: track.album,
      durationSec: Math.round(track.durationSec || 0),
      startedAt: Math.floor(startedAtMs / 1000),
      targets,
    });
    return Scrobbler.flush();
  },

  /** Sends everything waiting; returns how many scrobbles were accepted */
  async flush(): Promise<number> {
    if (pending.length === 0) return 0;
    const batch = pending.slice(0, 50);
    let sent = 0;
    const lf = batch.filter((s) => s.targets.includes('lastfm'));
    const lb = batch.filter((s) => s.targets.includes('listenbrainz'));
    const done = new Set<PendingScrobble>();

    if (lf.length > 0 && Scrobbler.lastfmReady()) {
      try {
        const params: Record<string, string> = {
          method: 'track.scrobble',
          sk: settings.lastfmSessionKey,
        };
        lf.forEach((s, i) => {
          params[`artist[${i}]`] = s.artist;
          params[`track[${i}]`] = s.title;
          params[`timestamp[${i}]`] = String(s.startedAt);
          if (s.album) params[`album[${i}]`] = s.album;
          if (s.durationSec) params[`duration[${i}]`] = String(s.durationSec);
        });
        await lastfmCall(params);
        lf.forEach((s) => (s.targets = s.targets.filter((t) => t !== 'lastfm')));
        sent += lf.length;
      } catch {
        // keep for later
      }
    }
    if (lb.length > 0 && Scrobbler.listenBrainzReady()) {
      try {
        await listenBrainzSubmit(lb.length === 1 ? 'single' : 'import', lb);
        lb.forEach((s) => (s.targets = s.targets.filter((t) => t !== 'listenbrainz')));
        sent += lb.length;
      } catch {
        // keep for later
      }
    }
    for (const s of batch) if (s.targets.length === 0) done.add(s);
    // drop entries whose services were disconnected
    pending = pending.filter(
      (s) =>
        !done.has(s) &&
        s.targets.some((t) =>
          t === 'lastfm' ? Scrobbler.lastfmReady() : Scrobbler.listenBrainzReady()
        )
    );
    await persist();
    return sent;
  },
};
