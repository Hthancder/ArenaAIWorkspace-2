// HolySic — native General MIDI renderer. A faithful C port of renderMidiToWav() in
// src/services/audio/midiSynth.ts (keep both in step). Plain C; no Objective-C runtime use.

#import "HSMidiSynth.h"

#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define TABLE 2048
#define TMASK (TABLE - 1)
#define SEG 128
#define MAX_VOICES 40
#define PLUCK_MAX 4096
#define NSHAPES 11
#define NBUCKETS 7 /* 1,2,4,...,64 harmonics */

enum { SH_SINE, SH_SAW, SH_SQUARE, SH_TRI, SH_ORGAN, SH_PIANO, SH_BRASS, SH_REED, SH_CHOIR, SH_STRING, SH_FLUTE };
enum { K_TABLE = 0, K_PLUCK = 1, K_FM = 2 };
enum {
  D_KICK, D_SNARE, D_CLAP, D_HATC, D_HATO, D_HATP, D_CRASH, D_RIDE, D_TOML, D_TOMM, D_TOMH,
  D_RIM, D_COWBELL, D_TAMB, D_SHAKER, D_BLOCK, D_CONGA, D_BELL, D_COUNT
};
/* the JS seeds each drum's noise from its id string: id.length * 7919 + id.charCodeAt(0) */
static const char *kDrumNames[D_COUNT] = {"kick", "snare", "clap", "hatC", "hatO", "hatP", "crash", "ride", "tomL",
                                          "tomM", "tomH", "rim", "cowbell", "tamb", "shaker", "block", "conga", "bell"};

typedef struct {
  int kind, shape;
  float a, d, s, r, keyTrack, lp, lpEnv, gain, vib, fmRatio, fmIndex, damp;
} Patch;

typedef struct {
  int on, ch, note, kind, stage, held, age;
  const Patch *patch;
  const float *tbl;
  double ph, inc, baseHz, mph, minc, fmIdx;
  double level, aStep, dMul, rMul, sus, vel;
  double lpY, vibPh;
  float buf[PLUCK_MAX + 1];
  int bi, bLen, hasBuf;
  double damp, apC, apX, apY;
  const float *drum;
  int drumLen;
  double dpos, dinc;
} Voice;

typedef struct {
  int prog, sustain, rpn;
  double vol, expr, pan, bend, bendRange, mod, rev;
  float buf[SEG];
} Channel;

typedef struct {
  int sr;
  float *tables[NSHAPES][NBUCKETS];
  Patch patches[128];
  int patchReady[128];
  float *drums[D_COUNT];
  int drumLen[D_COUNT];
  Voice voices[MAX_VOICES];
  int nVoices;
  int ageCounter;
  Channel ch[16];
} Synth;

static double harm(int shape, int n) {
  switch (shape) {
    case SH_SINE: return n == 1 ? 1 : 0;
    case SH_SAW: return 1.0 / n;
    case SH_SQUARE: return (n % 2) ? 1.0 / n : 0;
    case SH_TRI: return (n % 2) ? ((((n - 1) / 2) % 2) ? -1.0 : 1.0) / ((double)n * n) : 0;
    case SH_ORGAN:
      switch (n) {
        case 1: return 1;
        case 2: return 0.75;
        case 3: return 0.55;
        case 4: return 0.45;
        case 6: return 0.3;
        case 8: return 0.25;
        default: return 0;
      }
    case SH_PIANO: return (n == 7 ? 0.3 : 1.0) / pow(n, 1.45);
    case SH_BRASS: return 1.0 / pow(n, 0.75);
    case SH_REED: return ((n % 2) ? 1.0 : 0.35) / pow(n, 0.9);
    case SH_CHOIR: {
      static const double c[8] = {1, 0.6, 0.45, 0.25, 0.18, 0.08, 0.05, 0.03};
      return n <= 8 ? c[n - 1] : 0;
    }
    case SH_STRING: return 1.0 / pow(n, 0.95);
    case SH_FLUTE: {
      static const double f[4] = {1, 0.25, 0.08, 0.03};
      return n <= 4 ? f[n - 1] : 0;
    }
  }
  return 0;
}

static const float *getTable(Synth *s, int shape, int maxH) {
  int b = 0;
  while ((1 << b) < maxH && b < NBUCKETS - 1) b++;
  if (s->tables[shape][b]) return s->tables[shape][b];
  float *t = (float *)calloc(TABLE + 1, sizeof(float));
  int h = 1 << b;
  double peak = 0;
  for (int i = 0; i < TABLE; i++) {
    double v = 0;
    for (int n = 1; n <= h; n++) {
      double a = harm(shape, n);
      if (a != 0) v += a * sin((2 * M_PI * n * i) / TABLE);
    }
    t[i] = (float)v;
    if (fabs(v) > peak) peak = fabs(v);
  }
  if (peak > 0)
    for (int i = 0; i < TABLE; i++) t[i] = (float)(t[i] / peak);
  t[TABLE] = t[0];
  s->tables[shape][b] = t;
  return t;
}

static Patch mk(int kind, int shape, float a, float d, float s, float r) {
  Patch p;
  memset(&p, 0, sizeof p);
  p.kind = kind;
  p.shape = shape;
  p.a = a;
  p.d = d;
  p.s = s;
  p.r = r;
  p.keyTrack = 0;
  p.lp = 8;
  p.lpEnv = 6;
  p.gain = 1;
  return p;
}

static Patch patchFor(int prog) {
  Patch p;
  int fam = prog >> 3;
  switch (fam) {
    case 0:
      if (prog == 4 || prog == 5) { p = mk(K_FM, SH_SINE, 0.002f, 1.6f, 0, 0.35f); p.fmRatio = 1; p.fmIndex = 1.8f; p.keyTrack = 0.35f; p.gain = 0.75f; return p; }
      if (prog == 6) { p = mk(K_TABLE, SH_SAW, 0.001f, 0.9f, 0, 0.12f); p.keyTrack = 0.3f; p.lp = 10; p.lpEnv = 10; p.gain = 0.7f; return p; }
      if (prog == 7) { p = mk(K_TABLE, SH_SQUARE, 0.001f, 0.8f, 0, 0.12f); p.keyTrack = 0.3f; p.lp = 6; p.lpEnv = 8; p.gain = 0.7f; return p; }
      p = mk(K_TABLE, SH_PIANO, 0.002f, 2.2f, 0, 0.3f); p.keyTrack = 0.45f; p.lp = 3; p.lpEnv = 9; p.gain = 0.75f; return p;
    case 1:
      if (prog == 12 || prog == 13) { p = mk(K_FM, SH_SINE, 0.001f, 0.35f, 0, 0.1f); p.fmRatio = 4; p.fmIndex = 1.2f; p.keyTrack = 0.3f; p.gain = 0.8f; return p; }
      if (prog == 11) { p = mk(K_FM, SH_SINE, 0.002f, 1.8f, 0, 0.6f); p.fmRatio = 4; p.fmIndex = 0.6f; p.gain = 0.9f; p.vib = 0.004f; return p; }
      if (prog == 15) { p = mk(K_PLUCK, SH_SAW, 0.001f, 2, 0, 0.3f); p.damp = 0.996f; p.gain = 0.9f; return p; }
      p = mk(K_FM, SH_SINE, 0.001f, 1.4f, 0, 0.5f); p.fmRatio = 3.5f; p.fmIndex = 1.5f; p.keyTrack = 0.25f; p.gain = 0.8f; return p;
    case 2:
      if (prog == 21 || prog == 22 || prog == 23) { p = mk(K_TABLE, SH_REED, 0.04f, 1, 1, 0.1f); p.lp = 6; p.lpEnv = 0; p.gain = 0.55f; p.vib = 0.003f; return p; }
      p = mk(K_TABLE, SH_ORGAN, 0.008f, 1, 1, 0.06f); p.lp = 20; p.lpEnv = 0; p.gain = 0.5f; return p;
    case 3:
      if (prog == 29 || prog == 30) { p = mk(K_TABLE, SH_SAW, 0.004f, 4, 0.75f, 0.15f); p.lp = 7; p.lpEnv = 3; p.gain = 0.55f; return p; }
      if (prog == 28) { p = mk(K_PLUCK, SH_SAW, 0.001f, 0.25f, 0, 0.05f); p.damp = 0.95f; p.gain = 1; return p; }
      if (prog == 31) { p = mk(K_FM, SH_SINE, 0.001f, 0.8f, 0, 0.2f); p.fmRatio = 2; p.fmIndex = 0.5f; p.gain = 0.8f; return p; }
      p = mk(K_PLUCK, SH_SAW, 0.001f, 3, 0, 0.12f); p.damp = prog == 24 ? 0.993f : 0.996f; p.gain = 1.05f; return p;
    case 4:
      if (prog == 38 || prog == 39) { p = mk(K_TABLE, SH_SAW, 0.003f, 0.6f, 0.55f, 0.08f); p.lp = 3; p.lpEnv = 9; p.gain = 0.8f; return p; }
      if (prog == 37 || prog == 36) { p = mk(K_TABLE, SH_SQUARE, 0.002f, 0.5f, 0.3f, 0.06f); p.lp = 4; p.lpEnv = 6; p.gain = 0.8f; return p; }
      p = mk(K_PLUCK, SH_SAW, 0.001f, 2, 0, 0.08f); p.damp = prog == 32 ? 0.994f : 0.997f; p.gain = 1.3f; return p;
    case 5:
      if (prog == 45) { p = mk(K_PLUCK, SH_SAW, 0.001f, 0.4f, 0, 0.1f); p.damp = 0.985f; p.gain = 1; return p; }
      if (prog == 46) { p = mk(K_PLUCK, SH_SAW, 0.001f, 3, 0, 0.4f); p.damp = 0.998f; p.gain = 1; return p; }
      if (prog == 47) { p = mk(K_TABLE, SH_SINE, 0.002f, 0.7f, 0, 0.3f); p.gain = 0.8f; return p; }
      p = mk(K_TABLE, SH_STRING, 0.08f, 1, 1, 0.25f); p.lp = 4; p.lpEnv = 1; p.gain = 0.45f; p.vib = 0.004f; return p;
    case 6:
      if (prog >= 52 && prog <= 54) { p = mk(K_TABLE, SH_CHOIR, 0.15f, 1, 1, 0.35f); p.lp = 6; p.lpEnv = 0; p.gain = 0.5f; p.vib = 0.005f; return p; }
      if (prog == 55) { p = mk(K_TABLE, SH_BRASS, 0.004f, 0.4f, 0, 0.2f); p.lp = 6; p.lpEnv = 6; p.gain = 0.7f; return p; }
      p = mk(K_TABLE, SH_STRING, 0.18f, 1, 1, 0.4f); p.lp = 3.5f; p.lpEnv = 0.5f; p.gain = 0.4f; p.vib = 0.003f; return p;
    case 7:
      p = mk(K_TABLE, SH_BRASS, 0.03f, 0.6f, 0.8f, 0.1f); p.lp = 3; p.lpEnv = 6; p.gain = 0.45f; p.vib = 0.003f; return p;
    case 8:
      p = mk(K_TABLE, SH_REED, 0.03f, 1, 0.9f, 0.08f); p.lp = 4; p.lpEnv = 3; p.gain = 0.5f; p.vib = 0.004f; return p;
    case 9:
      p = mk(K_TABLE, SH_FLUTE, 0.05f, 1, 0.9f, 0.12f); p.lp = 8; p.lpEnv = 0; p.gain = 0.65f; p.vib = 0.005f; return p;
    case 10:
      p = mk(K_TABLE, prog == 80 ? SH_SQUARE : prog == 82 ? SH_FLUTE : SH_SAW, 0.005f, 1, 0.85f, 0.1f); p.lp = 6; p.lpEnv = 4; p.gain = 0.45f; p.vib = 0.003f; return p;
    case 11:
      p = mk(K_TABLE, prog == 89 ? SH_TRI : SH_STRING, 0.3f, 1, 1, 0.6f); p.lp = 3; p.lpEnv = 0.5f; p.gain = 0.38f; p.vib = 0.002f; return p;
    case 12:
      p = mk(K_TABLE, SH_TRI, 0.2f, 2, 0.6f, 0.8f); p.lp = 4; p.lpEnv = 2; p.gain = 0.35f; return p;
    case 13:
      if (prog == 109 || prog == 111) { p = mk(K_TABLE, SH_REED, 0.03f, 1, 0.9f, 0.1f); p.lp = 5; p.lpEnv = 2; p.gain = 0.45f; return p; }
      if (prog == 110) { p = mk(K_TABLE, SH_STRING, 0.06f, 1, 1, 0.2f); p.lp = 4; p.lpEnv = 1; p.gain = 0.45f; p.vib = 0.005f; return p; }
      if (prog == 108) { p = mk(K_FM, SH_SINE, 0.001f, 0.9f, 0, 0.3f); p.fmRatio = 3; p.fmIndex = 1; p.gain = 0.9f; return p; }
      p = mk(K_PLUCK, SH_SAW, 0.001f, 2, 0, 0.2f); p.damp = 0.995f; p.gain = 1; return p;
    case 14:
      if (prog == 116 || prog == 117 || prog == 118) { p = mk(K_TABLE, SH_SINE, 0.001f, 0.35f, 0, 0.15f); p.gain = 0.8f; return p; }
      if (prog == 115) { p = mk(K_FM, SH_SINE, 0.001f, 0.08f, 0, 0.04f); p.fmRatio = 2.4f; p.fmIndex = 2; p.gain = 0.8f; return p; }
      p = mk(K_FM, SH_SINE, 0.001f, 1.2f, 0, 0.4f); p.fmRatio = 1.41f; p.fmIndex = 2; p.gain = 0.7f; return p;
    default:
      p = mk(K_TABLE, SH_TRI, 0.05f, 1, 0.5f, 0.4f); p.lp = 3; p.lpEnv = 1; p.gain = 0.15f; return p;
  }
}

/* ---- drums ---- */

typedef struct {
  uint32_t s;
} Rng;
static inline double rnd(Rng *r) {
  uint32_t s = r->s;
  s ^= s << 13;
  s ^= s >> 17;
  s ^= s << 5;
  r->s = s;
  return ((double)s / 4294967296.0) * 2 - 1;
}

static void hp(float *x, int n, double fc, int sr) {
  double a = exp((-2 * M_PI * fc) / sr), px = 0, py = 0;
  for (int i = 0; i < n; i++) {
    double y = a * (py + x[i] - px);
    px = x[i];
    x[i] = (float)(py = y);
  }
}

static int lenOf(double sec, int sr) {
  int n = (int)lround(sec * sr);
  return n < 1 ? 1 : n;
}

static float *tone(Rng *r, int sr, double sec, double f0, double f1, double drop, double decay, double noise, int *outLen) {
  int n = lenOf(sec, sr);
  float *o = (float *)calloc(n, sizeof(float));
  double ph = 0;
  for (int i = 0; i < n; i++) {
    double t = (double)i / sr;
    double f = f1 + (f0 - f1) * exp(-t / drop);
    ph += (2 * M_PI * f) / sr;
    double nz = noise * rnd(r); /* always draw, like the JS, so both RNG streams match */
    o[i] = (float)((sin(ph) + nz) * exp(-t / decay));
  }
  *outLen = n;
  return o;
}

static float *metal(Rng *r, int sr, double sec, double decay, double fc, double gain, int *outLen) {
  int n = lenOf(sec, sr);
  float *o = (float *)calloc(n, sizeof(float));
  for (int i = 0; i < n; i++) o[i] = (float)(rnd(r) * exp(-(double)i / sr / decay) * gain);
  hp(o, n, fc, sr);
  *outLen = n;
  return o;
}

static void bakeDrum(Synth *s, int id) {
  int sr = s->sr;
  const char *name = kDrumNames[id];
  uint32_t seed = (uint32_t)(strlen(name) * 7919 + (unsigned char)name[0]);
  Rng r = {seed ? seed : 1};
  float *out = NULL;
  int n = 0, m = 0;
  switch (id) {
    case D_KICK: {
      out = tone(&r, sr, 0.45, 160, 48, 0.035, 0.16, 0, &n);
      int k = lenOf(0.004, sr);
      for (int i = 0; i < k && i < n; i++) out[i] += (float)(rnd(&r) * 0.4 * (1 - (double)i / k));
      break;
    }
    case D_SNARE: {
      out = tone(&r, sr, 0.28, 260, 180, 0.02, 0.07, 0, &n);
      float *nz = metal(&r, sr, 0.28, 0.08, 1200, 0.9, &m);
      for (int i = 0; i < n && i < m; i++) out[i] = out[i] * 0.55f + nz[i];
      free(nz);
      break;
    }
    case D_CLAP: {
      n = lenOf(0.3, sr);
      out = (float *)calloc(n, sizeof(float));
      for (int i = 0; i < n; i++) {
        double t = (double)i / sr;
        double burst = t < 0.03 ? exp(-fmod(t * 1000, 10) / 2.5) : exp(-(t - 0.03) / 0.07);
        out[i] = (float)(rnd(&r) * burst);
      }
      hp(out, n, 900, sr);
      break;
    }
    case D_HATC: out = metal(&r, sr, 0.08, 0.018, 7000, 0.8, &n); break;
    case D_HATP: out = metal(&r, sr, 0.1, 0.03, 6500, 0.6, &n); break;
    case D_HATO: out = metal(&r, sr, 0.5, 0.15, 6500, 0.7, &n); break;
    case D_CRASH: out = metal(&r, sr, 1.8, 0.55, 4500, 0.75, &n); break;
    case D_RIDE: {
      out = metal(&r, sr, 1.4, 0.45, 6000, 0.45, &n);
      float *b = tone(&r, sr, 1.4, 2600, 2600, 1, 0.4, 0, &m);
      for (int i = 0; i < n && i < m; i++) out[i] += b[i] * 0.12f;
      free(b);
      break;
    }
    case D_TOML: out = tone(&r, sr, 0.5, 140, 90, 0.06, 0.18, 0.05, &n); break;
    case D_TOMM: out = tone(&r, sr, 0.45, 200, 130, 0.05, 0.15, 0.05, &n); break;
    case D_TOMH: out = tone(&r, sr, 0.4, 280, 190, 0.04, 0.13, 0.05, &n); break;
    case D_RIM: out = tone(&r, sr, 0.05, 1700, 1700, 1, 0.008, 0.6, &n); break;
    case D_BLOCK: out = tone(&r, sr, 0.08, 1100, 900, 0.01, 0.02, 0, &n); break;
    case D_CONGA: out = tone(&r, sr, 0.3, 330, 260, 0.02, 0.09, 0, &n); break;
    case D_COWBELL: {
      n = lenOf(0.35, sr);
      out = (float *)calloc(n, sizeof(float));
      double a = 0, c = 0;
      for (int i = 0; i < n; i++) {
        a += 540.0 / sr;
        c += 800.0 / sr;
        out[i] = (float)(((fmod(a, 1) < 0.5 ? 1 : -1) + (fmod(c, 1) < 0.5 ? 1 : -1)) * 0.3 * exp(-(double)i / sr / 0.09));
      }
      break;
    }
    case D_BELL: out = tone(&r, sr, 1, 2200, 2200, 1, 0.35, 0, &n); break;
    case D_TAMB: out = metal(&r, sr, 0.25, 0.06, 5000, 0.7, &n); break;
    case D_SHAKER: out = metal(&r, sr, 0.12, 0.035, 5500, 0.5, &n); break;
  }
  s->drums[id] = out;
  s->drumLen[id] = n;
}

/* GM percussion: note → sample, gain, pitch ratio. Returns 0 when the note has no sound. */
static int drumFor(int note, int *id, double *gain, double *pitch) {
  *pitch = 1;
#define D(i, g) do { *id = (i); *gain = (g); return 1; } while (0)
#define DP(i, g, p) do { *id = (i); *gain = (g); *pitch = (p); return 1; } while (0)
  if (note == 35 || note == 36) D(D_KICK, 1.15);
  if (note == 37) D(D_RIM, 0.6);
  if (note == 38 || note == 40) DP(D_SNARE, note == 40 ? 1 : 0.95, note == 40 ? 1.08 : 1);
  if (note == 39) D(D_CLAP, 0.8);
  if (note == 42) D(D_HATC, 0.5);
  if (note == 44) D(D_HATP, 0.45);
  if (note == 46) D(D_HATO, 0.5);
  if (note == 41 || note == 43) DP(D_TOML, 0.9, note == 43 ? 1.12 : 1);
  if (note == 45 || note == 47) DP(D_TOMM, 0.9, note == 47 ? 1.12 : 1);
  if (note == 48 || note == 50) DP(D_TOMH, 0.9, note == 50 ? 1.12 : 1);
  if (note == 49 || note == 57 || note == 52 || note == 55) DP(D_CRASH, note == 55 ? 0.45 : 0.6, note == 55 ? 1.2 : 1);
  if (note == 51 || note == 59 || note == 53) DP(D_RIDE, 0.55, note == 53 ? 1.1 : 1);
  if (note == 54) D(D_TAMB, 0.5);
  if (note == 56) D(D_COWBELL, 0.5);
  if (note >= 60 && note <= 64) DP(D_CONGA, 0.7, 1 + (note - 60) * 0.12);
  if (note == 65 || note == 66) DP(D_TOMH, 0.6, 1.3 + (note - 65) * 0.1);
  if (note == 69 || note == 70 || note == 82) D(D_SHAKER, 0.45);
  if (note == 75 || note == 76 || note == 77) DP(D_BLOCK, 0.6, 1 + (note - 75) * 0.15);
  if (note == 80 || note == 81) DP(D_BELL, 0.3, note == 81 ? 1 : 1.2);
  if (note >= 67 && note <= 74) DP(D_BLOCK, 0.45, 0.8 + (note - 67) * 0.06);
  if (note >= 27 && note <= 34) D(D_RIM, 0.4);
#undef D
#undef DP
  return 0;
}

/* ---- voices ---- */

static const Patch kDrumPatch = {K_TABLE, SH_SINE, 0, 1, 1, 1, 0, 8, 6, 1, 0, 0, 0, 0};

static Voice *freeVoice(Synth *s) {
  for (int i = 0; i < s->nVoices; i++)
    if (!s->voices[i].on) return &s->voices[i];
  if (s->nVoices < MAX_VOICES) {
    Voice *v = &s->voices[s->nVoices++];
    v->on = 0;
    return v;
  }
  Voice *pick = &s->voices[0];
  double best = 1e18;
  for (int i = 0; i < s->nVoices; i++) {
    Voice *v = &s->voices[i];
    double sc = (v->stage == 2 ? 0 : 2) + v->level - (s->ageCounter - v->age) * 1e-6;
    if (sc < best) {
      best = sc;
      pick = v;
    }
  }
  return pick;
}

static void noteOn(Synth *s, int chN, int note, int vel) {
  Channel *ch = &s->ch[chN];
  int sr = s->sr;
  double nyq = sr / 2.0;
  Voice *v = freeVoice(s);
  v->on = 1;
  v->ch = chN;
  v->note = note;
  v->age = ++s->ageCounter;
  v->held = 0;
  v->vel = pow(vel / 127.0, 1.5);
  v->lpY = 0;
  v->vibPh = 0;
  v->level = 0;
  v->stage = 0;
  v->hasBuf = 0;
  v->drum = NULL;
  if (chN == 9) {
    int id;
    double g, pitch;
    if (!drumFor(note, &id, &g, &pitch)) {
      v->on = 0;
      return;
    }
    if (!s->drums[id]) bakeDrum(s, id);
    v->drum = s->drums[id];
    v->drumLen = s->drumLen[id];
    v->dpos = 0;
    v->dinc = pitch;
    v->vel *= g;
    v->kind = K_TABLE;
    v->patch = &kDrumPatch;
    v->level = 1;
    v->stage = 1;
    return;
  }
  for (int i = 0; i < s->nVoices; i++) {
    Voice *o = &s->voices[i];
    if (o != v && o->on && o->ch == chN && o->note == note && o->stage != 2) {
      o->stage = 2;
      o->rMul = exp(-1.0 / (0.03 * sr));
    }
  }
  if (!s->patchReady[ch->prog]) {
    s->patches[ch->prog] = patchFor(ch->prog);
    s->patchReady[ch->prog] = 1;
  }
  const Patch *p = &s->patches[ch->prog];
  v->patch = p;
  v->kind = p->kind;
  double hz = 440 * pow(2, (note - 69 + ch->bend) / 12.0);
  v->baseHz = 440 * pow(2, (note - 69) / 12.0);
  double oct = (note - 60) / 12.0;
  double dSec = fmax(0.05, p->d * pow(2, -oct * p->keyTrack * 2));
  v->aStep = 1.0 / fmax(1, p->a * sr);
  v->dMul = exp(-1.0 / (dSec * sr));
  v->rMul = exp(-1.0 / (fmax(0.01, p->r) * sr));
  v->sus = p->s;
  if (p->kind == K_PLUCK) {
    double period = sr / hz - 0.5;
    int n = (int)floor(period);
    if (n < 2) n = 2;
    if (n > PLUCK_MAX) n = PLUCK_MAX;
    double frac = period - n;
    if (frac < 0) frac = 0;
    v->bLen = n;
    v->hasBuf = 1;
    Rng r = {(uint32_t)(note * 131 + s->ageCounter) ? (uint32_t)(note * 131 + s->ageCounter) : 1};
    double lp = 0, k = 0.25 + 0.7 * v->vel;
    for (int i = 0; i < n; i++) {
      lp += k * (rnd(&r) - lp);
      v->buf[i] = (float)lp;
    }
    v->buf[n] = 0;
    v->bi = 0;
    v->damp = fmin(0.9995, (p->damp > 0 ? p->damp : 0.995) + (60 - note) * 0.00004);
    v->apC = (1 - frac) / (1 + frac);
    v->apX = 0;
    v->apY = 0;
    v->level = 1;
    v->stage = 1;
    v->sus = 0;
    v->dMul = exp(-1.0 / (fmax(0.2, p->d * pow(2, -oct)) * sr));
  } else {
    int maxH = (int)floor((nyq * 0.92) / hz);
    if (maxH < 1) maxH = 1;
    int h = 1;
    while (h * 2 <= maxH && h < 64) h *= 2;
    v->tbl = getTable(s, p->shape, h);
    v->ph = 0;
    v->inc = (hz * TABLE) / sr;
    if (p->kind == K_FM) {
      v->mph = 0;
      v->minc = v->inc * (p->fmRatio > 0 ? p->fmRatio : 1);
      v->fmIdx = (p->fmIndex > 0 ? p->fmIndex : 1) * (0.5 + v->vel) * TABLE * 0.159;
      if (v->minc * 2 > TABLE * 0.45) v->fmIdx *= 0.3;
    }
  }
}

static void noteOff(Synth *s, int chN, int note) {
  if (chN == 9) return;
  Channel *ch = &s->ch[chN];
  for (int i = 0; i < s->nVoices; i++) {
    Voice *v = &s->voices[i];
    if (!v->on || v->ch != chN || v->note != note || v->stage == 2) continue;
    if (ch->sustain) v->held = 1;
    else v->stage = 2;
  }
}

static void allOff(Synth *s, int chN, int hard) {
  for (int i = 0; i < s->nVoices; i++) {
    Voice *v = &s->voices[i];
    if (v->on && v->ch == chN) {
      if (hard) v->on = 0;
      else v->stage = 2;
    }
  }
}

static void control(Synth *s, int chN, int cc, int val) {
  Channel *ch = &s->ch[chN];
  switch (cc) {
    case 1: ch->mod = val / 127.0; break;
    case 7: ch->vol = val / 127.0; break;
    case 10: ch->pan = val / 127.0; break;
    case 11: ch->expr = val / 127.0; break;
    case 64: {
      int down = val >= 64;
      if (ch->sustain && !down)
        for (int i = 0; i < s->nVoices; i++) {
          Voice *v = &s->voices[i];
          if (v->on && v->ch == chN && v->held) {
            v->held = 0;
            v->stage = 2;
          }
        }
      ch->sustain = down;
      break;
    }
    case 91: ch->rev = val / 127.0; break;
    case 101: ch->rpn = (ch->rpn & 0x7f) | (val << 7); break;
    case 100: ch->rpn = (ch->rpn & ~0x7f) | val; break;
    case 6:
      if (ch->rpn == 0) ch->bendRange = fmin(24, fmax(0, val));
      break;
    case 120: allOff(s, chN, 1); break;
    case 121:
      ch->mod = 0;
      ch->expr = 1;
      ch->bend = 0;
      ch->sustain = 0;
      break;
    case 123: allOff(s, chN, 0); break;
  }
}

static void retune(Synth *s, int chN) {
  Channel *ch = &s->ch[chN];
  for (int i = 0; i < s->nVoices; i++) {
    Voice *v = &s->voices[i];
    if (!v->on || v->ch != chN || v->kind == K_PLUCK || v->drum) continue;
    double hz = v->baseHz * pow(2, ch->bend / 12.0);
    v->inc = (hz * TABLE) / s->sr;
    if (v->kind == K_FM) v->minc = v->inc * (v->patch->fmRatio > 0 ? v->patch->fmRatio : 1);
  }
}

static void putLE32(uint8_t *b, uint32_t v) {
  b[0] = v & 255;
  b[1] = (v >> 8) & 255;
  b[2] = (v >> 16) & 255;
  b[3] = (v >> 24) & 255;
}
static void putLE16(uint8_t *b, uint16_t v) {
  b[0] = v & 255;
  b[1] = (v >> 8) & 255;
}

static float *mkDelay(int n, double scale, int *len) {
  int l = (int)lround(n * scale);
  if (l < 8) l = 8;
  *len = l;
  return (float *)calloc(l, sizeof(float));
}

int HSMidiRender(const double *ev, int count, double durationSec, int sr, const char *path, volatile int *cancel) {
  if (sr <= 0) sr = 22050;
  long frames = (long)ceil(durationSec * sr);
  if (frames < sr) frames = sr;
  FILE *f = fopen(path, "wb");
  if (!f) return 1;

  uint8_t hdr[44];
  uint32_t dataSize = (uint32_t)(frames * 4);
  memcpy(hdr, "RIFF", 4);
  putLE32(hdr + 4, 36 + dataSize);
  memcpy(hdr + 8, "WAVEfmt ", 8);
  putLE32(hdr + 16, 16);
  putLE16(hdr + 20, 1);
  putLE16(hdr + 22, 2);
  putLE32(hdr + 24, (uint32_t)sr);
  putLE32(hdr + 28, (uint32_t)sr * 4);
  putLE16(hdr + 32, 4);
  putLE16(hdr + 34, 16);
  memcpy(hdr + 36, "data", 4);
  putLE32(hdr + 40, dataSize);
  fwrite(hdr, 1, 44, f);

  Synth *s = (Synth *)calloc(1, sizeof(Synth));
  if (!s) {
    fclose(f);
    return 2;
  }
  s->sr = sr;
  for (int c = 0; c < 16; c++) {
    Channel *ch = &s->ch[c];
    ch->prog = 0;
    ch->vol = 100 / 127.0;
    ch->expr = 1;
    ch->pan = 0.5;
    ch->bendRange = 2;
    ch->rev = 40 / 127.0;
    ch->rpn = -1;
  }
  const float *sine = getTable(s, SH_SINE, 1);
  double nyq = sr / 2.0;

  double scale = sr / 44100.0;
  int cl[4], al[2], ar[2];
  float *comb[4] = {mkDelay(1116, scale, &cl[0]), mkDelay(1188, scale, &cl[1]), mkDelay(1277, scale, &cl[2]),
                    mkDelay(1356, scale, &cl[3])};
  float *apL[2] = {mkDelay(556, scale, &al[0]), mkDelay(441, scale, &al[1])};
  float *apR[2] = {mkDelay(579, scale, &ar[0]), mkDelay(464, scale, &ar[1])};
  int ci[4] = {0, 0, 0, 0}, ai[4] = {0, 0, 0, 0};
  double clp[4] = {0, 0, 0, 0};
  const double fb = 0.8, damp = 0.3, undamp = 1 - damp;
  long revTail = 0;
  float revIn[SEG], mixL[SEG], mixR[SEG];
  uint8_t live[16];
  memset(live, 1, sizeof live);
  int16_t pcm[SEG * 2];

  double limiter = 1;
  const double masterGain = 0.32;
  int ei = 0;
  long pos = 0;
  int rc = 0;

  while (pos < frames) {
    if (cancel && *cancel) {
      rc = 3;
      break;
    }
    while (ei < count && lround(ev[ei * 5] * sr) <= pos) {
      const double *e = ev + ei * 5;
      ei++;
      int kind = (int)e[1], chN = ((int)e[2]) & 15, a = (int)e[3], b = (int)e[4];
      if (kind == 1) noteOn(s, chN, a & 127, b & 127);
      else if (kind == 0) noteOff(s, chN, a & 127);
      else if (kind == 2) control(s, chN, a & 127, b & 127);
      else if (kind == 3) s->ch[chN].prog = a & 127;
      else if (kind == 4) {
        s->ch[chN].bend = ((a - 8192) / 8192.0) * s->ch[chN].bendRange;
        retune(s, chN);
      }
    }
    long nextEvt = ei < count ? lround(ev[ei * 5] * sr) : frames;
    long nl = nextEvt - pos;
    if (frames - pos < nl) nl = frames - pos;
    if (nl > SEG) nl = SEG;
    if (nl < 1) nl = 1;
    int n = (int)nl;

    for (int c = 0; c < 16; c++) {
      if (live[c]) memset(s->ch[c].buf, 0, sizeof(float) * n);
      live[c] = 0;
    }

    for (int vi = 0; vi < s->nVoices; vi++) {
      Voice *v = &s->voices[vi];
      if (!v->on) continue;
      Channel *ch = &s->ch[v->ch];
      float *buf = ch->buf;
      double g = v->vel * v->patch->gain;
      live[v->ch] = 1;

      if (v->drum) {
        const float *d = v->drum;
        double p = v->dpos, inc = v->dinc;
        int dl = v->drumLen - 1;
        for (int i = 0; i < n; i++) {
          if (p >= dl) {
            v->on = 0;
            break;
          }
          buf[i] += (float)(d[(int)p] * g);
          p += inc;
        }
        v->dpos = p;
        continue;
      }

      double l0 = v->level, l1 = l0;
      if (v->stage == 0) {
        l1 = l0 + v->aStep * n;
        if (l1 >= 1) {
          l1 = 1;
          v->stage = 1;
        }
      } else if (v->stage == 1) {
        l1 = v->sus + (l0 - v->sus) * pow(v->dMul, n);
      } else {
        l1 = l0 * pow(v->rMul, n);
      }
      v->level = l1;
      if ((v->stage == 2 || v->sus == 0) && l1 < 0.0004 && v->stage != 0) {
        v->on = 0;
        continue;
      }
      double dl = (l1 - l0) / n;
      double lvl = l0 * g, dlg = dl * g;

      if (v->kind == K_PLUCK) {
        float *b = v->buf;
        int len = v->bLen, bi = v->bi;
        double dmp = v->damp * 0.5, C = v->apC, ax = v->apX, ay = v->apY;
        for (int i = 0; i < n; i++) {
          double cur = b[bi];
          int nx = bi + 1 < len ? bi + 1 : 0;
          double avg = (cur + b[nx]) * dmp;
          double y = C * avg + ax - C * ay;
          ax = avg;
          ay = y;
          b[bi] = (float)y;
          bi = nx;
          buf[i] += (float)(cur * lvl * 1.6);
          lvl += dlg;
        }
        v->bi = bi;
        v->apX = ax;
        v->apY = ay;
        continue;
      }

      double inc = v->inc;
      double vib = v->patch->vib + ch->mod * 0.012;
      if (vib > 0) {
        v->vibPh += (5.6 * n) / sr;
        double ramp = fmin(1, v->vibPh / 2);
        inc *= 1 + vib * ramp * sin(2 * M_PI * v->vibPh);
      }
      const Patch *p = v->patch;
      double fc = fmin(nyq * 0.95, v->baseHz * (p->lp + p->lpEnv * l1) * (0.6 + 0.6 * v->vel));
      double a = 1 - exp((-2 * M_PI * fc) / sr);
      double y = v->lpY, ph = v->ph;
      const float *t = v->tbl;

      if (v->kind == K_FM) {
        double mph = v->mph;
        double minc = v->minc * (inc / v->inc);
        double idx = v->fmIdx;
        double gg = g != 0 ? g : 1;
        for (int i = 0; i < n; i++) {
          double m = sine[((long)mph) & TMASK] * idx * (0.3 + 0.7 * (lvl / gg));
          double sm = sine[((long)(ph + m)) & TMASK];
          y += a * (sm - y);
          buf[i] += (float)(y * lvl);
          ph += inc;
          mph += minc;
          lvl += dlg;
        }
        v->mph = fmod(mph, TABLE);
      } else {
        for (int i = 0; i < n; i++) {
          y += a * (t[((long)ph) & TMASK] - y);
          buf[i] += (float)(y * lvl);
          ph += inc;
          lvl += dlg;
        }
      }
      v->ph = fmod(ph, TABLE);
      v->lpY = y;
    }

    memset(mixL, 0, sizeof(float) * n);
    memset(mixR, 0, sizeof(float) * n);
    memset(revIn, 0, sizeof(float) * n);
    for (int c = 0; c < 16; c++) {
      if (!live[c]) continue;
      Channel *ch = &s->ch[c];
      double gain = ch->vol * ch->vol * ch->expr;
      if (gain <= 0) continue;
      double pa = ch->pan * M_PI * 0.5;
      float gl = (float)(cos(pa) * gain * 1.41), gr = (float)(sin(pa) * gain * 1.41);
      float send = (float)(ch->rev * 0.5 * gain);
      const float *b = ch->buf;
      for (int i = 0; i < n; i++) {
        float x = b[i];
        mixL[i] += x * gl;
        mixR[i] += x * gr;
        revIn[i] += x * send;
      }
    }

    int anyRev = 0;
    for (int i = 0; i < n; i++)
      if (revIn[i] != 0) {
        anyRev = 1;
        break;
      }
    if (anyRev) revTail = lround(sr * 4.0);
    int doRev = revTail > 0;
    if (doRev) revTail -= n;

    for (int i = 0; i < n; i++) {
      double L = mixL[i], R = mixR[i];
      if (doRev) {
        double x = revIn[i] * 0.2, sum = 0;
        for (int k = 0; k < 4; k++) {
          float *cb = comb[k];
          double o = cb[ci[k]];
          clp[k] = o * undamp + clp[k] * damp;
          cb[ci[k]] = (float)(x + clp[k] * fb);
          if (++ci[k] >= cl[k]) ci[k] = 0;
          sum += o;
        }
        double rl = sum, rr = sum;
        for (int k = 0; k < 2; k++) {
          float *l = apL[k];
          double bo = l[ai[k]];
          l[ai[k]] = (float)(rl + bo * 0.5);
          rl = bo - rl;
          if (++ai[k] >= al[k]) ai[k] = 0;
          float *r = apR[k];
          double bo2 = r[ai[k + 2]];
          r[ai[k + 2]] = (float)(rr + bo2 * 0.5);
          rr = bo2 - rr;
          if (++ai[k + 2] >= ar[k]) ai[k + 2] = 0;
        }
        L += rl * 1.4;
        R += rr * 1.4;
      }
      L *= masterGain;
      R *= masterGain;
      double pk = fmax(fabs(L), fabs(R)) * limiter;
      if (pk > 0.92) limiter *= 0.92 / pk;
      else if (limiter < 1) limiter = fmin(1, limiter + 0.00015);
      L *= limiter;
      R *= limiter;
      pcm[i * 2] = L >= 1 ? 32767 : L <= -1 ? -32768 : (int16_t)(L * 32767);
      pcm[i * 2 + 1] = R >= 1 ? 32767 : R <= -1 ? -32768 : (int16_t)(R * 32767);
    }
    if (fwrite(pcm, sizeof(int16_t), (size_t)n * 2, f) != (size_t)n * 2) {
      rc = 4;
      break;
    }
    pos += n;
  }

  fclose(f);
  for (int i = 0; i < NSHAPES; i++)
    for (int j = 0; j < NBUCKETS; j++) free(s->tables[i][j]);
  for (int i = 0; i < D_COUNT; i++) free(s->drums[i]);
  for (int k = 0; k < 4; k++) free(comb[k]);
  for (int k = 0; k < 2; k++) {
    free(apL[k]);
    free(apR[k]);
  }
  free(s);
  if (rc != 0) remove(path);
  return rc;
}
