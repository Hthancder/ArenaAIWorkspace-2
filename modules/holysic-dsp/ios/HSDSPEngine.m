// HolySic — native real-time DSP (see HSDSPEngine.h).
//
// Real-time rules followed in the process callback: no Objective-C messaging, no allocation, no
// blocking locks (parameters are picked up with os_unfair_lock_trylock; a busy lock just means
// the previous parameters are used for one more buffer).

#import "HSDSPEngine.h"

#import <Accelerate/Accelerate.h>
#import <MediaToolbox/MediaToolbox.h>
#import <math.h>
#import <os/lock.h>
#import <stdatomic.h>
#import <time.h>

#define HS_BANDS 10
#define HS_FILTERS (HS_BANDS + 1) // 10 EQ bands + bass shelf
#define HS_CH 2                   // processed channels (more are passed through)
#define HS_COMBS 4
#define HS_APS 2
#define HS_RING 16384
#define HS_FFT_LOG2 12
#define HS_FFT_N (1 << HS_FFT_LOG2)

static const float kBandHz[HS_BANDS] = {32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000};
static const int kCombLen[HS_COMBS] = {1116, 1188, 1277, 1356}; // Freeverb tunings @ 44.1 kHz
static const int kApLen[HS_APS] = {556, 441};
static const int kSpread = 23;

typedef struct {
  int enabled;
  float preampDb;
  float bands[HS_BANDS];
  float bassDb;
  float reverb; // 0…1
  float width;  // 0…2 (1 = untouched)
  int eightD;
  float eightDPeriod; // seconds per orbit
} HSParams;

typedef struct {
  float b0, b1, b2, a1, a2;
  int on;
} HSBiquad;

typedef struct {
  int64_t tag;
  double sr;
  int channels;
  int interleaved;
  int ok;
  int64_t version;
  HSParams p;
  HSBiquad f[HS_FILTERS];
  float z[HS_FILTERS][HS_CH][2];
  float preamp;     // linear, current (ramped)
  float wet;        // reverb mix, current (ramped)
  float eightDMix;  // 0…1, current (ramped) so 8D fades in/out instead of jumping
  double lfo;
  float *comb[HS_CH][HS_COMBS];
  int combLen[HS_CH][HS_COMBS];
  int combIdx[HS_CH][HS_COMBS];
  float combStore[HS_CH][HS_COMBS];
  float *ap[HS_CH][HS_APS];
  int apLen[HS_CH][HS_APS];
  int apIdx[HS_CH][HS_APS];
} HSTap;

// ── shared state ────────────────────────────────────────────────────────────────────────────
static os_unfair_lock gLock = OS_UNFAIR_LOCK_INIT;
static HSParams gParams = {.enabled = 0, .preampDb = 0, .width = 1, .eightDPeriod = 8};
static _Atomic int64_t gVersion = 1;
static _Atomic int64_t gPrimary = 0;
static _Atomic int gSpectrumOn = 0;
static _Atomic int64_t gFrames = 0;
static _Atomic int gLiveTaps = 0;

static float gRing[HS_RING];
static _Atomic uint64_t gRingCount = 0; // total samples ever written (write index = count % RING)
static _Atomic double gRingSR = 44100;
// AVPlayer hands the tap big chunks (often 4096 frames ≈ 93 ms). The reader slides its FFT window
// through the newest chunk in real time instead of jumping chunk to chunk, so the bars move at
// display rate instead of ~11 steps per second.
static _Atomic uint64_t gChunkStart = 0;
static _Atomic uint64_t gChunkLen = 0;
static _Atomic uint64_t gChunkAtNs = 0;
static uint64_t gReadSeen = 0; // reader side only

// ── filter design (RBJ Audio EQ Cookbook) ───────────────────────────────────────────────────
static void hs_design(HSBiquad *bq, int type, double fc, double gainDb, double q, double sr) {
  if (fabs(gainDb) < 0.05) {
    bq->on = 0;
    return;
  }
  fc = fmin(fc, sr * 0.45);
  const double A = pow(10.0, gainDb / 40.0);
  const double w0 = 2.0 * M_PI * fc / sr;
  const double cw = cos(w0), sw = sin(w0);
  double b0, b1, b2, a0, a1, a2;
  if (type == 0) { // peaking
    const double alpha = sw / (2.0 * q);
    b0 = 1 + alpha * A;
    b1 = -2 * cw;
    b2 = 1 - alpha * A;
    a0 = 1 + alpha / A;
    a1 = -2 * cw;
    a2 = 1 - alpha / A;
  } else {
    const double alpha = sw / 2.0 * sqrt(2.0); // shelf slope S = 1
    const double sA = 2.0 * sqrt(A) * alpha;
    if (type == 1) { // low shelf
      b0 = A * ((A + 1) - (A - 1) * cw + sA);
      b1 = 2 * A * ((A - 1) - (A + 1) * cw);
      b2 = A * ((A + 1) - (A - 1) * cw - sA);
      a0 = (A + 1) + (A - 1) * cw + sA;
      a1 = -2 * ((A - 1) + (A + 1) * cw);
      a2 = (A + 1) + (A - 1) * cw - sA;
    } else { // high shelf
      b0 = A * ((A + 1) + (A - 1) * cw + sA);
      b1 = -2 * A * ((A - 1) + (A + 1) * cw);
      b2 = A * ((A + 1) + (A - 1) * cw - sA);
      a0 = (A + 1) - (A - 1) * cw + sA;
      a1 = 2 * ((A - 1) - (A + 1) * cw);
      a2 = (A + 1) - (A - 1) * cw - sA;
    }
  }
  bq->b0 = (float)(b0 / a0);
  bq->b1 = (float)(b1 / a0);
  bq->b2 = (float)(b2 / a0);
  bq->a1 = (float)(a1 / a0);
  bq->a2 = (float)(a2 / a0);
  bq->on = 1;
}

static void hs_redesign(HSTap *t) {
  for (int i = 0; i < HS_BANDS; i++) {
    const int type = i == 0 ? 1 : (i == HS_BANDS - 1 ? 2 : 0);
    const int wasOn = t->f[i].on;
    hs_design(&t->f[i], type, kBandHz[i], t->p.bands[i], 1.41, t->sr);
    if (!wasOn && t->f[i].on) memset(t->z[i], 0, sizeof(t->z[i]));
  }
  const int wasOn = t->f[HS_BANDS].on;
  hs_design(&t->f[HS_BANDS], 1, 95, t->p.bassDb, 0.71, t->sr);
  if (!wasOn && t->f[HS_BANDS].on) memset(t->z[HS_BANDS], 0, sizeof(t->z[HS_BANDS]));
}

// ── buffers ─────────────────────────────────────────────────────────────────────────────────
static void hs_free_reverb(HSTap *t) {
  for (int c = 0; c < HS_CH; c++) {
    for (int k = 0; k < HS_COMBS; k++) {
      free(t->comb[c][k]);
      t->comb[c][k] = NULL;
    }
    for (int k = 0; k < HS_APS; k++) {
      free(t->ap[c][k]);
      t->ap[c][k] = NULL;
    }
  }
}

static void hs_alloc_reverb(HSTap *t) {
  hs_free_reverb(t);
  const double s = t->sr / 44100.0;
  for (int c = 0; c < HS_CH; c++) {
    for (int k = 0; k < HS_COMBS; k++) {
      const int n = (int)((kCombLen[k] + (c ? kSpread : 0)) * s) + 1;
      t->comb[c][k] = calloc((size_t)n, sizeof(float));
      t->combLen[c][k] = n;
      t->combIdx[c][k] = 0;
      t->combStore[c][k] = 0;
    }
    for (int k = 0; k < HS_APS; k++) {
      const int n = (int)((kApLen[k] + (c ? kSpread : 0)) * s) + 1;
      t->ap[c][k] = calloc((size_t)n, sizeof(float));
      t->apLen[c][k] = n;
      t->apIdx[c][k] = 0;
    }
  }
}

// ── tap callbacks ───────────────────────────────────────────────────────────────────────────
static void hs_tap_init(MTAudioProcessingTapRef tap, void *clientInfo, void **tapStorageOut) {
  *tapStorageOut = clientInfo; // the HSTap allocated by the installer
}

static void hs_tap_finalize(MTAudioProcessingTapRef tap) {
  HSTap *t = (HSTap *)MTAudioProcessingTapGetStorage(tap);
  if (!t) return;
  hs_free_reverb(t);
  free(t);
}

static void hs_tap_prepare(MTAudioProcessingTapRef tap, CMItemCount maxFrames,
                           const AudioStreamBasicDescription *fmt) {
  HSTap *t = (HSTap *)MTAudioProcessingTapGetStorage(tap);
  if (!t) return;
  t->sr = fmt->mSampleRate > 0 ? fmt->mSampleRate : 44100;
  t->channels = (int)fmt->mChannelsPerFrame;
  t->interleaved = !(fmt->mFormatFlags & kAudioFormatFlagIsNonInterleaved);
  t->ok = fmt->mFormatID == kAudioFormatLinearPCM && (fmt->mFormatFlags & kAudioFormatFlagIsFloat) &&
          fmt->mBitsPerChannel == 32 && t->channels > 0;
  t->version = 0; // force a redesign at the new rate
  memset(t->z, 0, sizeof(t->z));
  for (int i = 0; i < HS_FILTERS; i++) t->f[i].on = 0;
  hs_alloc_reverb(t);
  atomic_fetch_add(&gLiveTaps, 1);
}

static void hs_tap_unprepare(MTAudioProcessingTapRef tap) {
  HSTap *t = (HSTap *)MTAudioProcessingTapGetStorage(tap);
  if (!t) return;
  hs_free_reverb(t);
  atomic_fetch_sub(&gLiveTaps, 1);
}

static inline float hs_softclip(float x) {
  const float k = 0.92f;
  const float ax = fabsf(x);
  if (ax <= k) return x;
  const float y = k + (1.0f - k) * tanhf((ax - k) / (1.0f - k));
  return x < 0 ? -y : y;
}

static void hs_tap_process(MTAudioProcessingTapRef tap, CMItemCount numberFrames,
                           MTAudioProcessingTapFlags flags, AudioBufferList *bufferListInOut,
                           CMItemCount *numberFramesOut, MTAudioProcessingTapFlags *flagsOut) {
  OSStatus st = MTAudioProcessingTapGetSourceAudio(tap, numberFrames, bufferListInOut, flagsOut,
                                                   NULL, numberFramesOut);
  if (st != noErr) return;
  HSTap *t = (HSTap *)MTAudioProcessingTapGetStorage(tap);
  if (!t || !t->ok) return;
  const int n = (int)*numberFramesOut;
  if (n <= 0) return;

  // channel pointers + stride for both layouts
  float *chp[HS_CH] = {NULL, NULL};
  int stride = 1;
  int nch = 0;
  if (t->interleaved) {
    if (bufferListInOut->mNumberBuffers < 1 || !bufferListInOut->mBuffers[0].mData) return;
    float *base = (float *)bufferListInOut->mBuffers[0].mData;
    stride = (int)bufferListInOut->mBuffers[0].mNumberChannels;
    if (stride < 1) return;
    nch = stride < HS_CH ? stride : HS_CH;
    for (int c = 0; c < nch; c++) chp[c] = base + c;
  } else {
    nch = (int)bufferListInOut->mNumberBuffers < HS_CH ? (int)bufferListInOut->mNumberBuffers : HS_CH;
    for (int c = 0; c < nch; c++) {
      chp[c] = (float *)bufferListInOut->mBuffers[c].mData;
      if (!chp[c]) return;
    }
  }
  if (nch < 1) return;
  atomic_fetch_add(&gFrames, n);

  // pick up new parameters without ever blocking the audio thread
  const int64_t v = atomic_load(&gVersion);
  if (v != t->version && os_unfair_lock_trylock(&gLock)) {
    t->p = gParams;
    os_unfair_lock_unlock(&gLock);
    t->version = v;
    hs_redesign(t);
  }

  const int on = t->p.enabled;
  const float preampTarget = on ? powf(10.0f, t->p.preampDb / 20.0f) : 1.0f;
  const float wetTarget = on ? fmaxf(0.f, fminf(1.f, t->p.reverb)) : 0.f;
  const float eightTarget = on && t->p.eightD && nch == 2 ? 1.f : 0.f;
  const float width = on && nch == 2 ? fmaxf(0.f, fminf(2.f, t->p.width)) : 1.f;

  const int idle = !on && fabsf(t->preamp - 1.f) < 1e-4f && t->wet < 1e-4f && t->eightDMix < 1e-4f;
  if (!idle) {
    // 1. pre-amp (ramped across the buffer) + EQ + bass, per channel
    const float p0 = t->preamp, dp = (preampTarget - p0) / (float)n;
    for (int c = 0; c < nch; c++) {
      float *x = chp[c];
      if (fabsf(dp) > 1e-7f || fabsf(p0 - 1.f) > 1e-6f) {
        float g = p0;
        for (int i = 0; i < n; i++) {
          g += dp;
          x[i * stride] *= g;
        }
      }
      if (on) {
        for (int f = 0; f < HS_FILTERS; f++) {
          const HSBiquad bq = t->f[f];
          if (!bq.on) continue;
          float z1 = t->z[f][c][0], z2 = t->z[f][c][1];
          for (int i = 0; i < n; i++) {
            const float in = x[i * stride];
            const float y = bq.b0 * in + z1;
            z1 = bq.b1 * in - bq.a1 * y + z2;
            z2 = bq.b2 * in - bq.a2 * y;
            x[i * stride] = y;
          }
          // flush denormals
          t->z[f][c][0] = fabsf(z1) < 1e-15f ? 0.f : z1;
          t->z[f][c][1] = fabsf(z2) < 1e-15f ? 0.f : z2;
        }
      }
    }
    t->preamp = preampTarget;

    // 2. stereo stage: width, 8D orbit, reverb, limiter
    if (nch == 2) {
      float *L = chp[0], *R = chp[1];
      const double lfoStep = 2.0 * M_PI / (fmax(3.0, t->p.eightDPeriod) * t->sr);
      const float w0 = t->wet, dw = (wetTarget - w0) / (float)n;
      const float e0 = t->eightDMix, de = (eightTarget - e0) / (float)n;
      float wet = w0, e = e0;
      const int doReverb = wetTarget > 1e-4f || w0 > 1e-4f;
      for (int i = 0; i < n; i++) {
        float l = L[i * stride], r = R[i * stride];
        if (width != 1.f) {
          const float m = 0.5f * (l + r), s = 0.5f * (l - r) * width;
          l = m + s;
          r = m - s;
        }
        e += de;
        if (e > 1e-4f) {
          // the source orbits the head: equal-power pan of the mid signal + a little dry stereo
          const float pan = (float)sin(t->lfo) * 0.92f;
          const float ang = (pan + 1.f) * (float)M_PI_4;
          const float m = 0.5f * (l + r);
          const float ol = 0.3f * l + 0.7f * m * cosf(ang) * 1.4142f;
          const float orr = 0.3f * r + 0.7f * m * sinf(ang) * 1.4142f;
          l = l + (ol - l) * e;
          r = r + (orr - r) * e;
          t->lfo += lfoStep;
          if (t->lfo > 2.0 * M_PI) t->lfo -= 2.0 * M_PI;
        }
        wet += dw;
        if (doReverb && t->comb[0][0]) {
          const float in = (l + r) * 0.03f;
          float outc[HS_CH] = {0, 0};
          for (int c = 0; c < HS_CH; c++) {
            float acc = 0;
            for (int k = 0; k < HS_COMBS; k++) {
              float *buf = t->comb[c][k];
              int idx = t->combIdx[c][k];
              const float o = buf[idx];
              t->combStore[c][k] = o * 0.8f + t->combStore[c][k] * 0.2f; // damping
              buf[idx] = in + t->combStore[c][k] * 0.84f;                 // room size
              if (++idx >= t->combLen[c][k]) idx = 0;
              t->combIdx[c][k] = idx;
              acc += o;
            }
            for (int k = 0; k < HS_APS; k++) {
              float *buf = t->ap[c][k];
              int idx = t->apIdx[c][k];
              const float bo = buf[idx];
              const float o = -acc + bo;
              buf[idx] = acc + bo * 0.5f;
              if (++idx >= t->apLen[c][k]) idx = 0;
              t->apIdx[c][k] = idx;
              acc = o;
            }
            outc[c] = acc;
          }
          l = l * (1.f - 0.3f * wet) + outc[0] * wet * 2.4f;
          r = r * (1.f - 0.3f * wet) + outc[1] * wet * 2.4f;
        }
        L[i * stride] = hs_softclip(l);
        R[i * stride] = hs_softclip(r);
      }
      t->wet = wetTarget;
      t->eightDMix = eightTarget;
      if (!doReverb) {
        for (int c = 0; c < HS_CH; c++)
          for (int k = 0; k < HS_COMBS; k++) t->combStore[c][k] = 0;
      }
    } else if (on) {
      float *x = chp[0];
      for (int i = 0; i < n; i++) x[i * stride] = hs_softclip(x[i * stride]);
    }
  }

  // 3. visualizer: what you actually hear, from the audible player only
  if (atomic_load(&gSpectrumOn) && t->tag == atomic_load(&gPrimary)) {
    uint64_t w = atomic_load(&gRingCount);
    float *L = chp[0], *R = nch > 1 ? chp[1] : chp[0];
    for (int i = 0; i < n; i++) {
      gRing[(w + (uint64_t)i) & (HS_RING - 1)] = 0.5f * (L[i * stride] + R[i * stride]);
    }
    atomic_store(&gRingSR, t->sr);
    atomic_store(&gChunkStart, w);
    atomic_store(&gChunkLen, (uint64_t)n);
    atomic_store(&gChunkAtNs, clock_gettime_nsec_np(CLOCK_UPTIME_RAW));
    atomic_store(&gRingCount, w + (uint64_t)n);
  }
}

// ── spectrum (reader thread) ────────────────────────────────────────────────────────────────
static FFTSetup gFFT = NULL;
static float gWindow[HS_FFT_N];

@implementation HSDSPEngine

+ (void)initialize {
  if (self == [HSDSPEngine class]) {
    gFFT = vDSP_create_fftsetup(HS_FFT_LOG2, kFFTRadix2);
    vDSP_hann_window(gWindow, HS_FFT_N, vDSP_HANN_DENORM);
  }
}

+ (BOOL)installOnItem:(AVPlayerItem *)item track:(AVAssetTrack *)track tag:(int64_t)tag {
  HSTap *t = calloc(1, sizeof(HSTap));
  if (!t) return NO;
  t->tag = tag;
  t->preamp = 1.f;
  t->sr = 44100;

  MTAudioProcessingTapCallbacks cb;
  cb.version = kMTAudioProcessingTapCallbacksVersion_0;
  cb.clientInfo = t;
  cb.init = hs_tap_init;
  cb.finalize = hs_tap_finalize;
  cb.prepare = hs_tap_prepare;
  cb.unprepare = hs_tap_unprepare;
  cb.process = hs_tap_process;

  MTAudioProcessingTapRef tap = NULL;
  // PostEffects: after AVPlayer's own rate / pitch processing, so speed changes keep the EQ
  OSStatus st = MTAudioProcessingTapCreate(kCFAllocatorDefault, &cb,
                                           kMTAudioProcessingTapCreationFlag_PostEffects, &tap);
  if (st != noErr || !tap) {
    free(t);
    return NO;
  }
  AVMutableAudioMixInputParameters *params =
      [AVMutableAudioMixInputParameters audioMixInputParametersWithTrack:track];
  params.audioTapProcessor = tap;
  AVMutableAudioMix *mix = [AVMutableAudioMix audioMix];
  mix.inputParameters = @[ params ];
  item.audioMix = mix;
  CFRelease(tap); // the input parameters keep it alive; finalize frees the HSTap
  return YES;
}

+ (void)removeFromItem:(AVPlayerItem *)item {
  item.audioMix = nil;
}

+ (void)setEnabled:(BOOL)enabled
          preampDb:(float)preampDb
             bands:(NSArray<NSNumber *> *)bands
            bassDb:(float)bassDb
            reverb:(float)reverb
             width:(float)width
            eightD:(BOOL)eightD
      eightDPeriod:(float)eightDPeriod {
  HSParams p = {0};
  p.enabled = enabled ? 1 : 0;
  p.preampDb = fmaxf(-24.f, fminf(6.f, preampDb));
  for (int i = 0; i < HS_BANDS; i++) {
    const float g = i < (int)bands.count ? bands[i].floatValue : 0.f;
    p.bands[i] = fmaxf(-15.f, fminf(15.f, g));
  }
  p.bassDb = fmaxf(0.f, fminf(15.f, bassDb));
  p.reverb = fmaxf(0.f, fminf(1.f, reverb));
  p.width = fmaxf(0.f, fminf(2.f, width));
  p.eightD = eightD ? 1 : 0;
  p.eightDPeriod = fmaxf(3.f, fminf(30.f, eightDPeriod));
  os_unfair_lock_lock(&gLock);
  gParams = p;
  os_unfair_lock_unlock(&gLock);
  atomic_fetch_add(&gVersion, 1);
}

+ (void)setPrimaryTag:(int64_t)tag {
  atomic_store(&gPrimary, tag);
}

+ (void)setSpectrumEnabled:(BOOL)on {
  atomic_store(&gSpectrumOn, on ? 1 : 0);
}

+ (BOOL)readSpectrum:(float *)outBands count:(int)count sampleRate:(double *)sampleRate {
  if (count < 1 || count > 64 || !gFFT) return NO;
  const uint64_t w = atomic_load(&gRingCount);
  const uint64_t cs = atomic_load(&gChunkStart);
  const uint64_t cl = atomic_load(&gChunkLen);
  const uint64_t at = atomic_load(&gChunkAtNs);
  const double sr = atomic_load(&gRingSR);
  const uint64_t nowNs = clock_gettime_nsec_np(CLOCK_UPTIME_RAW);
  const double elapsed = nowNs > at ? (double)(nowNs - at) / 1e9 : 0;
  if (elapsed > 0.5) return NO; // nothing rendered for half a second: paused / stalled
  uint64_t into = (uint64_t)(elapsed * sr);
  if (into > cl) into = cl;
  uint64_t end = cs + into;
  if (end > w) end = w;
  if (end < HS_FFT_N || end == gReadSeen) return NO;
  gReadSeen = end;
  *sampleRate = sr;

  static float buf[HS_FFT_N];
  static float re[HS_FFT_N / 2], im[HS_FFT_N / 2], mag[HS_FFT_N / 2];
  const uint64_t start = end - HS_FFT_N;
  for (int i = 0; i < HS_FFT_N; i++) buf[i] = gRing[(start + (uint64_t)i) & (HS_RING - 1)];
  vDSP_vmul(buf, 1, gWindow, 1, buf, 1, HS_FFT_N);
  DSPSplitComplex sc = {re, im};
  vDSP_ctoz((const DSPComplex *)buf, 2, &sc, 1, HS_FFT_N / 2);
  vDSP_fft_zrip(gFFT, &sc, 1, HS_FFT_LOG2, kFFTDirection_Forward);
  vDSP_zvmags(&sc, 1, mag, 1, HS_FFT_N / 2);
  mag[0] = 0; // DC / packed Nyquist

  // vDSP's real FFT is scaled ×2 and a Hann window halves a sine: full scale peaks at N/2
  const float norm = 1.0f / ((HS_FFT_N / 2.0f) * (HS_FFT_N / 2.0f));
  const double lo = 40.0, hi = fmin(16000.0, sr / 2.0 - 100.0);
  for (int b = 0; b < count; b++) {
    const double f0 = lo * pow(hi / lo, (double)b / count);
    const double f1 = lo * pow(hi / lo, (double)(b + 1) / count);
    int k0 = (int)floor(f0 * HS_FFT_N / sr);
    if (k0 < 1) k0 = 1;
    int k1 = (int)ceil(f1 * HS_FFT_N / sr) - 1;
    if (k1 > HS_FFT_N / 2 - 1) k1 = HS_FFT_N / 2 - 1;
    if (k1 < k0) k1 = k0;
    float pw = 0;
    for (int k = k0; k <= k1; k++)
      if (mag[k] > pw) pw = mag[k];
    const double fc = lo * pow(hi / lo, (b + 0.5) / count);
    // +3 dB/octave tilt around 1 kHz so the highs are visible next to the bass
    const double db = 10.0 * log10(pw * norm + 1e-12) + 3.0 * log2(fc / 1000.0);
    double v = (db + 64.0) / 56.0;
    outBands[b] = (float)(v < 0 ? 0 : v > 1 ? 1 : v);
  }
  return YES;
}

+ (int64_t)processedFrames {
  return atomic_load(&gFrames);
}

+ (int)liveTaps {
  return atomic_load(&gLiveTaps);
}

+ (double)lastSampleRate {
  return atomic_load(&gRingSR);
}

@end
