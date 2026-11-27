// HolySic — native sample-based General MIDI renderer (C port of
// src/services/audio/sf/sampleSynth.ts + soundBank.ts).
//
// Plays the JS-parsed MIDI event list through the HolySic sample bank (GeneralUser GS, flattened
// to 22 kHz regions by scripts/soundbank/build_bank.py, split into downloadable packs by
// split_bank.py) and writes a 16-bit stereo WAV. The bank is assembled from the downloaded packs
// once and shared by every render until the set of downloads changes. The TypeScript version is the
// reference: every formula, constant and evaluation order must stay in step.

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Maps the bank at `path` (idempotent; cached after the first call). Returns 0 on success.
int HSBankLoad(const char *path);

/// Builds the bank from its downloadable parts (scripts/soundbank/split_bank.py): the index
/// (.hsi) and sample packs (.hsp). Samples of packs not given stay silent. Cached by the path
/// list, so calling it again with the same downloads is free. Returns 0 on success.
int HSBankLoadParts(const char *indexPath, const char *_Nonnull const *_Nonnull packPaths, int nPacks);

/// `events`: [t, kind, ch, a, b] × count (kind: 0 off, 1 on, 2 cc, 3 program, 4 bend).
/// `pianoBank` / `pianoProgram` replace GM program 0 (−1 = keep). Returns 0 on success.
/// free an assembled bank (HSBankLoadParts) when no render uses it any more
void HSBankRelease(void);

int HSSampleRender(const double *events, int count, double durationSec, int sampleRate,
                   const char *path, int pianoBank, int pianoProgram,
                   volatile int *_Nullable cancel);

NS_ASSUME_NONNULL_END
