// HolySic — native sample-based General MIDI renderer (C port of
// src/services/audio/sf/sampleSynth.ts + soundBank.ts).
//
// Plays the JS-parsed MIDI event list through the bundled HolySic sample bank (GeneralUser GS,
// flattened to 22 kHz regions by scripts/soundbank/build_bank.py) and writes a 16-bit stereo WAV.
// The bank is memory-mapped once and shared by every render. The TypeScript version is the
// reference: every formula, constant and evaluation order must stay in step.

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Maps the bank at `path` (idempotent; cached after the first call). Returns 0 on success.
int HSBankLoad(const char *path);

/// `events`: [t, kind, ch, a, b] × count (kind: 0 off, 1 on, 2 cc, 3 program, 4 bend).
/// `pianoBank` / `pianoProgram` replace GM program 0 (−1 = keep). Returns 0 on success.
int HSSampleRender(const double *events, int count, double durationSec, int sampleRate,
                   const char *path, int pianoBank, int pianoProgram,
                   volatile int *_Nullable cancel);

NS_ASSUME_NONNULL_END
