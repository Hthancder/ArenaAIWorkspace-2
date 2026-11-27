// Loads the HolySic sample bank for the TypeScript renderer (web preview). Native builds render
// with the C port, which maps the bundled bank itself.
import { soundBankUrl } from './bankSource';
import { parseSoundBank, SoundBank } from './soundBank';

let pending: Promise<SoundBank | null> | null = null;
let loadedBytes = 0;

export function loadSoundBank(): Promise<SoundBank | null> {
  if (!pending) {
    const url = soundBankUrl();
    pending = !url
      ? Promise.resolve(null)
      : fetch(url)
          .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
          .then((b) => {
            const bank = parseSoundBank(b);
            loadedBytes = b.byteLength;
            return bank;
          })
          .catch(() => {
            pending = null; // let a later play try again
            return null;
          });
  }
  return pending;
}

/** bytes the loaded bank holds in memory (0 when not loaded) */
export function soundBankBytes(): number {
  return loadedBytes;
}

/** drop the in-memory bank (Settings › Storage); the next MIDI render loads it again */
export function unloadSoundBank() {
  pending = null;
  loadedBytes = 0;
}
