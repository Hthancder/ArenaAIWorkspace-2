// HolySic — native real-time DSP for AVPlayer.
//
// An MTAudioProcessingTap is installed on the AVPlayerItem that expo-audio plays. Every PCM
// buffer AVPlayer renders passes through C code here, in this order:
//   pre-amp → 10-band EQ (RBJ biquads) → bass shelf → stereo width → 8D orbit → reverb → limiter
// and the post-DSP signal of the "primary" (audible) player feeds a ring buffer that a vDSP FFT
// turns into the 32 spectrum bands the visualizer draws. Nothing crosses the JS bridge per sample.

#import <AVFoundation/AVFoundation.h>
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface HSDSPEngine : NSObject

/// Installs the processing tap on `item` (one audio mix per item). Returns NO if the tap can't be
/// created. `tag` identifies the player (used to pick which player feeds the visualizer).
+ (BOOL)installOnItem:(AVPlayerItem *)item
                track:(AVAssetTrack *)track
                  tag:(int64_t)tag NS_SWIFT_NAME(install(on:track:tag:));

/// Removes HolySic's audio mix from the item (processing stops, the item plays untouched).
+ (void)removeFromItem:(AVPlayerItem *)item NS_SWIFT_NAME(remove(from:));

/// New parameters for every tap (taps pick them up on their next buffer, lock-free for audio).
/// `bands` = 10 gains in dB for 32 Hz … 16 kHz.
+ (void)setEnabled:(BOOL)enabled
          preampDb:(float)preampDb
             bands:(NSArray<NSNumber *> *)bands
            bassDb:(float)bassDb
            reverb:(float)reverb
             width:(float)width
            eightD:(BOOL)eightD
      eightDPeriod:(float)eightDPeriod
    NS_SWIFT_NAME(setParams(enabled:preampDb:bands:bassDb:reverb:width:eightD:eightDPeriod:));

/// The player whose (processed) audio feeds the spectrum.
+ (void)setPrimaryTag:(int64_t)tag NS_SWIFT_NAME(setPrimary(_:));

/// Spectrum capture on/off (off = no ring-buffer writes at all).
+ (void)setSpectrumEnabled:(BOOL)on NS_SWIFT_NAME(setSpectrum(_:));

/// Writes `count` (≤ 64) log-spaced bands in 0…1 into `outBands` from the newest audio. Returns NO
/// when no new audio arrived since the previous call (paused / stalled).
+ (BOOL)readSpectrum:(float *)outBands
               count:(int)count
          sampleRate:(double *)sampleRate NS_SWIFT_NAME(readSpectrum(_:count:sampleRate:));

/// Diagnostics: frames processed by all taps since launch, and the live tap count.
+ (int64_t)processedFrames;
+ (int)liveTaps;
+ (double)lastSampleRate;

@end

NS_ASSUME_NONNULL_END
