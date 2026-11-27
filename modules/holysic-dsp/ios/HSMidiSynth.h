// HolySic — native General MIDI renderer (C port of src/services/audio/midiSynth.ts).
//
// JS parses the MIDI file (tempo map, tracks, karaoke lyrics) and hands over a flat event list;
// this renders it to a 16-bit stereo WAV file ~50–100× faster than the Hermes fallback, so a
// 4-minute MIDI is ready in well under a second. Same instruments, drums and reverb as the
// TypeScript version — the two must stay in step.

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// `events`: [t, kind, ch, a, b] × count (kind: 0 off, 1 on, 2 cc, 3 program, 4 bend).
/// Writes a complete WAV to `path`. Returns 0 on success, otherwise an error code.
int HSMidiRender(const double *events, int count, double durationSec, int sampleRate,
                 const char *path, volatile int *_Nullable cancel);

NS_ASSUME_NONNULL_END
