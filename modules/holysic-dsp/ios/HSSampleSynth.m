// HolySic — native sample-based General MIDI renderer. Line-by-line C port of
// src/services/audio/sf/sampleSynth.ts (the reference) and the bank reader in soundBank.ts.
// Doubles everywhere so both produce the same samples (± libm rounding).

#import "HSSampleSynth.h"

#include <fcntl.h>
#include <math.h>
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#define GEN_COUNT 61
#define REGION_BYTES 152
#define MOD_BYTES 10
#define MAX_VOICES 64
#define SEG 64
#define MASTER 0.6
#define LUT_SIZE (129 * 128)
#define CHO_LEN 2048

enum {
  G_MODLFO_PITCH = 5, G_VIBLFO_PITCH = 6, G_MODENV_PITCH = 7, G_FC = 8, G_Q = 9, G_MODLFO_FC = 10,
  G_MODENV_FC = 11, G_MODLFO_VOL = 13, G_CHORUS = 15, G_REVERB = 16, G_PAN = 17,
  G_MODLFO_DELAY = 21, G_MODLFO_FREQ = 22, G_VIBLFO_DELAY = 23, G_VIBLFO_FREQ = 24,
  G_MODENV_DELAY = 25, G_VOLENV_DELAY = 33, G_ATTEN = 48, G_COARSE = 51, G_FINE = 52,
  G_SCALE = 56, G_EXCL = 57, G_ROOT = 58
};

// ------------------------------------------------------------------------------------- bank

typedef struct {
  int sampleRate;
  const int16_t *pool;
  uint32_t nS, nP, nR, nM;
  uint32_t *sOff;
  float *sRate;
  uint16_t *pBank, *pProg;
  uint32_t *pStart, *pCount;
  int lut[LUT_SIZE];
  uint8_t *rKey;
  uint16_t *rSample, *rModCount;
  uint32_t *rModStart;
  uint8_t *rMode;
  uint32_t *rPos;
  int16_t *rGen;
  uint16_t *mSrc, *mDst, *mAmtSrc, *mTrans;
  int16_t *mAmt;
  void *map;
  size_t mapLen;
} Bank;

static Bank *gBank = NULL;
static char gBankPath[1024];
static pthread_mutex_t gBankLock = PTHREAD_MUTEX_INITIALIZER;

static inline uint32_t rd32(const uint8_t *p) { return p[0] | (p[1] << 8) | (p[2] << 16) | ((uint32_t)p[3] << 24); }
static inline uint16_t rd16(const uint8_t *p) { return (uint16_t)(p[0] | (p[1] << 8)); }

static Bank *parseBank(void *map, size_t len) {
  const uint8_t *b = (const uint8_t *)map;
  if (len < 32 || memcmp(b, "HSBK", 4) != 0 || rd32(b + 4) != 1) return NULL;
  Bank *k = (Bank *)calloc(1, sizeof(Bank));
  if (!k) return NULL;
  k->nS = rd32(b + 8);
  k->nP = rd32(b + 12);
  k->nR = rd32(b + 16);
  k->nM = rd32(b + 20);
  uint32_t poolFrames = rd32(b + 24);
  k->sampleRate = (int)rd32(b + 28);
  size_t o = 32;
  size_t need = o + (size_t)k->nS * 16 + (size_t)k->nP * 36 + (size_t)k->nR * REGION_BYTES + (size_t)k->nM * MOD_BYTES;
  need = (need + 3) & ~(size_t)3;
  if (need + (size_t)poolFrames * 2 > len) {
    free(k);
    return NULL;
  }
  k->sOff = (uint32_t *)malloc(sizeof(uint32_t) * k->nS);
  k->sRate = (float *)malloc(sizeof(float) * k->nS);
  for (uint32_t i = 0; i < k->nS; i++, o += 16) {
    k->sOff[i] = rd32(b + o);
    uint32_t fr = rd32(b + o + 8);
    memcpy(&k->sRate[i], &fr, 4);
  }
  for (int i = 0; i < LUT_SIZE; i++) k->lut[i] = -1;
  k->pBank = (uint16_t *)malloc(2 * k->nP);
  k->pProg = (uint16_t *)malloc(2 * k->nP);
  k->pStart = (uint32_t *)malloc(4 * k->nP);
  k->pCount = (uint32_t *)malloc(4 * k->nP);
  for (uint32_t i = 0; i < k->nP; i++, o += 36) {
    k->pBank[i] = rd16(b + o);
    k->pProg[i] = rd16(b + o + 2);
    k->pStart[i] = rd32(b + o + 4);
    k->pCount[i] = rd32(b + o + 8);
    int key = k->pBank[i] * 128 + k->pProg[i];
    if (k->pBank[i] <= 128 && k->pProg[i] < 128 && k->lut[key] < 0) k->lut[key] = (int)i;
  }
  uint32_t nR = k->nR;
  k->rKey = (uint8_t *)malloc(4 * (size_t)nR);
  k->rSample = (uint16_t *)malloc(2 * (size_t)nR);
  k->rModCount = (uint16_t *)malloc(2 * (size_t)nR);
  k->rModStart = (uint32_t *)malloc(4 * (size_t)nR);
  k->rMode = (uint8_t *)malloc(nR);
  k->rPos = (uint32_t *)malloc(16 * (size_t)nR);
  k->rGen = (int16_t *)malloc(2 * GEN_COUNT * (size_t)nR);
  for (uint32_t i = 0; i < nR; i++, o += REGION_BYTES) {
    memcpy(k->rKey + i * 4, b + o, 4);
    k->rSample[i] = rd16(b + o + 4);
    k->rModCount[i] = rd16(b + o + 6);
    k->rModStart[i] = rd32(b + o + 8);
    for (int q = 0; q < 4; q++) k->rPos[i * 4 + q] = rd32(b + o + 12 + q * 4);
    for (int q = 0; q < GEN_COUNT; q++) k->rGen[(size_t)i * GEN_COUNT + q] = (int16_t)rd16(b + o + 28 + q * 2);
    k->rMode[i] = b[o + 150];
  }
  uint32_t nM = k->nM;
  k->mSrc = (uint16_t *)malloc(2 * (size_t)nM);
  k->mDst = (uint16_t *)malloc(2 * (size_t)nM);
  k->mAmt = (int16_t *)malloc(2 * (size_t)nM);
  k->mAmtSrc = (uint16_t *)malloc(2 * (size_t)nM);
  k->mTrans = (uint16_t *)malloc(2 * (size_t)nM);
  for (uint32_t i = 0; i < nM; i++, o += MOD_BYTES) {
    k->mSrc[i] = rd16(b + o);
    k->mDst[i] = rd16(b + o + 2);
    k->mAmt[i] = (int16_t)rd16(b + o + 4);
    k->mAmtSrc[i] = rd16(b + o + 6);
    k->mTrans[i] = rd16(b + o + 8);
  }
  o = (o + 3) & ~(size_t)3;
  k->pool = (const int16_t *)(b + o);
  k->map = map;
  k->mapLen = len;
  return k;
}

int HSBankLoad(const char *path) {
  pthread_mutex_lock(&gBankLock);
  if (gBank && strcmp(gBankPath, path) == 0) {
    pthread_mutex_unlock(&gBankLock);
    return 0;
  }
  int rc = 1;
  int fd = open(path, O_RDONLY);
  if (fd >= 0) {
    struct stat st;
    if (fstat(fd, &st) == 0 && st.st_size > 32) {
      void *map = mmap(NULL, (size_t)st.st_size, PROT_READ, MAP_PRIVATE, fd, 0);
      if (map != MAP_FAILED) {
        Bank *k = parseBank(map, (size_t)st.st_size);
        if (k) {
          // an older bank stays mapped: a render on another thread may still be reading it
          gBank = k;
          strncpy(gBankPath, path, sizeof(gBankPath) - 1);
          rc = 0;
        } else {
          munmap(map, (size_t)st.st_size);
          rc = 3;
        }
      }
    }
    close(fd);
  }
  pthread_mutex_unlock(&gBankLock);
  return rc;
}

// ------------------------------------------------------------------------------------- synth

typedef struct {
  int stage;
  double val, cnt, dl, a, h, d, s, r;
} Env;

typedef struct {
  int on, ch, key, held, mode, first, filt;
  int noteId;
  long age;
  double excl;
  double pos, end, ls, le, ratio, cents0;
  double atten, pan, rev, cho;
  double modEnvPitch, modEnvFc, modLfoPitch, modLfoFc, modLfoVol, vibPitch;
  double fc, qLin, qGain, lastFc, b0, b1, a1, a2, x1, x2, y1, y2;
  Env vol, menv;
  double mlDelay, mlPh, mlInc, vlDelay, vlPh, vlInc, g;
} SVoice;

typedef struct {
  int prog, bank, sustain, rpn;
  double bend, bendRange, mod;
  uint8_t cc[128];
} SChan;

typedef struct {
  const Bank *bk;
  int sr;
  int pianoBank, pianoProg;
  SChan ch[16];
  SVoice v[MAX_VOICES];
  int nv;
  long ageCounter;
  int noteCounter;
  double gens[GEN_COUNT];
} SSynth;

static double tcs(double tc, int sr) {
  if (tc <= -12000) return 1;
  double f = sr * pow(2, tc / 1200);
  return f < 1 ? 1 : f;
}

static inline double clampd(double x, double lo, double hi) { return x < lo ? lo : x > hi ? hi : x; }

static double concave(double x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  double v = -(400.0 / 960) * log10(1 - x);
  return v > 1 ? 1 : v;
}

static double convex(double x) { return 1 - concave(1 - x); }

static double curve(int src, double x0) {
  double x = (src >> 8) & 1 ? 1 - x0 : x0;
  int type = src >> 10;
  if (!((src >> 9) & 1)) {
    if (type == 0) return x;
    if (type == 1) return concave(x);
    if (type == 2) return convex(x);
    return x >= 0.5 ? 1 : 0;
  }
  if (type == 0) return 2 * x - 1;
  if (type == 3) return x >= 0.5 ? 1 : -1;
  if (type == 1) return x > 0.5 ? concave(2 * x - 1) : -concave(1 - 2 * x);
  return x > 0.5 ? convex(2 * x - 1) : -convex(1 - 2 * x);
}

static double srcRaw(int src, const SChan *ch, int key, int vel) {
  int idx = src & 127;
  if (src & 128) return ch->cc[idx] / 127.0;
  switch (idx) {
    case 0: return -1;
    case 2: return vel / 127.0;
    case 3: return key / 127.0;
    case 14: return 0.5;
    case 16: return ch->bendRange / 127;
    default: return 0;
  }
}

static double srcValue(int src, const SChan *ch, int key, int vel) {
  double r = srcRaw(src, ch, key, vel);
  return r < 0 ? 1 : curve(src, r);
}

static void envAdvance(Env *e, int n) {
  switch (e->stage) {
    case 0:
      e->cnt -= n;
      if (e->cnt <= 0) e->stage = 1;
      break;
    case 1:
      e->val += n / e->a;
      if (e->val >= 1) {
        e->val = 1;
        e->stage = 2;
        e->cnt = e->h;
      }
      break;
    case 2:
      e->cnt -= n;
      if (e->cnt <= 0) e->stage = 3;
      break;
    case 3:
      e->val -= n / e->d;
      if (e->val <= e->s) {
        e->val = e->s;
        e->stage = 4;
      }
      break;
    case 5:
      e->val -= n / e->r;
      if (e->val <= 0) {
        e->val = 0;
        e->stage = 6;
      }
      break;
  }
}

static inline double volAmp(const Env *e) {
  if (e->stage <= 1) return e->val;
  return e->val <= 0 ? 0 : pow(10, (e->val - 1) * 5);
}

static inline double tri(double p) { return p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4; }

static SVoice *freeVoice(SSynth *s) {
  for (int i = 0; i < s->nv; i++)
    if (!s->v[i].on) return &s->v[i];
  if (s->nv < MAX_VOICES) {
    SVoice *v = &s->v[s->nv++];
    memset(v, 0, sizeof(SVoice));
    return v;
  }
  SVoice *pick = &s->v[0];
  double best = 1e9;
  for (int i = 0; i < s->nv; i++) {
    SVoice *v = &s->v[i];
    double sc = (v->vol.stage >= 5 ? 0 : 2) + v->g * 32768 - v->age * 1e-9;
    if (sc < best) {
      best = sc;
      pick = v;
    }
  }
  return pick;
}

static void releaseV(SVoice *v, double fast) {
  Env *e = &v->vol;
  if (e->stage >= 5) {
    if (fast > 0 && fast < e->r) e->r = fast;
    return;
  }
  if (e->stage <= 1) {
    double amp = e->val;
    e->val = amp > 0.00001 ? 1 + log10(amp) / 5 : 0;
  }
  e->stage = 5;
  if (fast > 0 && fast < e->r) e->r = fast;
  if (v->menv.stage < 5) v->menv.stage = 5;
}

static int presetFor(SSynth *s, int chN) {
  const Bank *bk = s->bk;
  SChan *ch = &s->ch[chN];
  int idx;
  if (chN == 9) {
    idx = ch->prog < 128 ? bk->lut[128 * 128 + ch->prog] : -1;
    if (idx < 0) idx = bk->lut[128 * 128];
  } else {
    int b = ch->bank, p = ch->prog;
    if (s->pianoBank >= 0 && b == 0 && p == 0) {
      b = s->pianoBank;
      p = s->pianoProg;
    }
    idx = (b <= 128 && p < 128) ? bk->lut[b * 128 + p] : -1;
    if (idx < 0) idx = bk->lut[ch->prog & 127];
  }
  return idx < 0 ? 0 : idx;
}

static void startVoice(SSynth *s, int chN, int key, int vel, uint32_t r, int noteId) {
  const Bank *bk = s->bk;
  SChan *ch = &s->ch[chN];
  double *gens = s->gens;
  int sr = s->sr;
  size_t gb = (size_t)r * GEN_COUNT;
  for (int k = 0; k < GEN_COUNT; k++) gens[k] = bk->rGen[gb + k];
  uint32_t m0 = bk->rModStart[r];
  uint32_t m1 = m0 + bk->rModCount[r];
  for (uint32_t m = m0; m < m1 && m < bk->nM; m++) {
    double a = srcValue(bk->mSrc[m], ch, key, vel);
    if (a == 0) continue;
    int as = bk->mAmtSrc[m];
    double val = bk->mAmt[m] * a * (as == 0 ? 1 : srcValue(as, ch, key, vel));
    if (bk->mTrans[m] == 2 && val < 0) val = -val;
    if (bk->mDst[m] < GEN_COUNT) gens[bk->mDst[m]] += val;
  }
  uint16_t smp = bk->rSample[r];
  double base = bk->sOff[smp];
  double excl = gens[G_EXCL];
  if (excl > 0)
    for (int i = 0; i < s->nv; i++) {
      SVoice *o = &s->v[i];
      if (o->on && o->ch == chN && o->excl == excl && o->noteId != noteId) releaseV(o, 0.004 * sr);
    }
  SVoice *v = freeVoice(s);
  v->on = 1;
  v->ch = chN;
  v->key = key;
  v->noteId = noteId;
  v->age = ++s->ageCounter;
  v->held = 0;
  v->excl = excl;
  v->pos = base + bk->rPos[r * 4];
  v->end = base + bk->rPos[r * 4 + 1];
  v->ls = base + bk->rPos[r * 4 + 2];
  v->le = base + bk->rPos[r * 4 + 3];
  v->mode = bk->rMode[r];
  if (v->le - v->ls < 2) v->mode = 0;
  v->ratio = (double)bk->sRate[smp] / sr;
  v->cents0 = (key - gens[G_ROOT]) * gens[G_SCALE] + gens[G_COARSE] * 100 + gens[G_FINE];
  v->atten = clampd(gens[G_ATTEN], 0, 1440);
  v->pan = clampd(gens[G_PAN] / 500, -1, 1);
  v->rev = clampd(gens[G_REVERB] / 1000, 0, 1);
  v->cho = clampd(gens[G_CHORUS] / 1000, 0, 1);
  v->modEnvPitch = gens[G_MODENV_PITCH];
  v->modEnvFc = gens[G_MODENV_FC];
  v->modLfoPitch = gens[G_MODLFO_PITCH];
  v->modLfoFc = gens[G_MODLFO_FC];
  v->modLfoVol = gens[G_MODLFO_VOL];
  v->vibPitch = gens[G_VIBLFO_PITCH];
  v->fc = gens[G_FC];
  double q = gens[G_Q] > 0 ? gens[G_Q] : 0;
  v->filt = v->fc < 13500 || q > 0 || v->modEnvFc != 0 || v->modLfoFc != 0;
  v->qLin = pow(10, (q / 10 - 3.01) / 20);
  v->qGain = q > 0 ? 1 / sqrt(v->qLin) : 1;
  v->lastFc = -1e9;
  v->b0 = 1;
  v->b1 = 0;
  v->a1 = 0;
  v->a2 = 0;
  v->x1 = v->x2 = v->y1 = v->y2 = 0;
  int kd = 60 - key;
  for (int w = 0; w < 2; w++) {
    Env *e = w == 0 ? &v->vol : &v->menv;
    int g0 = w == 0 ? G_VOLENV_DELAY : G_MODENV_DELAY;
    e->stage = 0;
    e->val = 0;
    e->dl = gens[g0] <= -12000 ? 0 : tcs(gens[g0], sr);
    e->cnt = e->dl;
    e->a = tcs(gens[g0 + 1], sr);
    e->h = gens[g0 + 2] <= -12000 ? 0 : tcs(gens[g0 + 2] + gens[g0 + 6] * kd, sr);
    e->d = tcs(gens[g0 + 3] + gens[g0 + 7] * kd, sr);
    e->s = clampd(1 - gens[g0 + 4] / 1000, 0, 1);
    e->r = tcs(gens[g0 + 5], sr);
    if (e->dl <= 0) e->stage = 1;
  }
  if (v->vol.r < 0.003 * sr) v->vol.r = 0.003 * sr;
  v->mlDelay = gens[G_MODLFO_DELAY] <= -12000 ? 0 : tcs(gens[G_MODLFO_DELAY], sr);
  v->mlPh = 0;
  v->mlInc = (8.176 * pow(2, gens[G_MODLFO_FREQ] / 1200)) / sr;
  v->vlDelay = gens[G_VIBLFO_DELAY] <= -12000 ? 0 : tcs(gens[G_VIBLFO_DELAY], sr);
  v->vlPh = 0;
  v->vlInc = (8.176 * pow(2, gens[G_VIBLFO_FREQ] / 1200)) / sr;
  v->g = 0;
  v->first = 1;
}

static void noteOffS(SSynth *s, int chN, int key) {
  SChan *ch = &s->ch[chN];
  for (int i = 0; i < s->nv; i++) {
    SVoice *v = &s->v[i];
    if (!v->on || v->ch != chN || v->key != key || v->vol.stage >= 5) continue;
    if (ch->sustain) v->held = 1;
    else releaseV(v, 0);
  }
}

static void noteOnS(SSynth *s, int chN, int key, int vel) {
  if (vel <= 0) {
    noteOffS(s, chN, key);
    return;
  }
  const Bank *bk = s->bk;
  int noteId = ++s->noteCounter;
  for (int i = 0; i < s->nv; i++) {
    SVoice *o = &s->v[i];
    if (o->on && o->ch == chN && o->key == key && o->vol.stage < 5) releaseV(o, 0);
  }
  int p = presetFor(s, chN);
  uint32_t r0 = bk->pStart[p], r1 = r0 + bk->pCount[p];
  if (r1 > bk->nR) r1 = bk->nR;
  for (uint32_t r = r0; r < r1; r++) {
    const uint8_t *k = bk->rKey + r * 4;
    if (key < k[0] || key > k[1]) continue;
    if (vel < k[2] || vel > k[3]) continue;
    startVoice(s, chN, key, vel, r, noteId);
  }
}

static void controlS(SSynth *s, int chN, int cc, int val) {
  SChan *ch = &s->ch[chN];
  if (cc < 0 || cc > 127) return;
  ch->cc[cc] = (uint8_t)val;
  switch (cc) {
    case 0:
      ch->bank = val;
      break;
    case 1:
      ch->mod = val / 127.0;
      break;
    case 64: {
      int down = val >= 64;
      if (ch->sustain && !down)
        for (int i = 0; i < s->nv; i++) {
          SVoice *v = &s->v[i];
          if (v->on && v->ch == chN && v->held) {
            v->held = 0;
            releaseV(v, 0);
          }
        }
      ch->sustain = down;
      break;
    }
    case 101:
      ch->rpn = (ch->rpn & 0x7f) | (val << 7);
      break;
    case 100:
      ch->rpn = (ch->rpn & ~0x7f) | val;
      break;
    case 6:
      if (ch->rpn == 0) ch->bendRange = clampd(val, 0, 24);
      break;
    case 120:
      for (int i = 0; i < s->nv; i++)
        if (s->v[i].ch == chN) s->v[i].on = 0;
      break;
    case 121:
      ch->mod = 0;
      ch->cc[1] = 0;
      ch->cc[11] = 127;
      ch->bend = 0;
      if (ch->sustain) controlS(s, chN, 64, 0);
      break;
    case 123:
      for (int i = 0; i < s->nv; i++) {
        SVoice *v = &s->v[i];
        if (v->on && v->ch == chN) releaseV(v, 0);
      }
      break;
  }
}

static void putLE32s(uint8_t *b, uint32_t v) {
  b[0] = v & 255;
  b[1] = (v >> 8) & 255;
  b[2] = (v >> 16) & 255;
  b[3] = (v >> 24) & 255;
}

static void putLE16s(uint8_t *b, uint16_t v) {
  b[0] = v & 255;
  b[1] = (v >> 8) & 255;
}

static double *mkLine(int n, double scale, int *len) {
  int l = (int)lround(n * scale);
  if (l < 8) l = 8;
  *len = l;
  return (double *)calloc(l, sizeof(double));
}

int HSSampleRender(const double *ev, int count, double durationSec, int srIn, const char *path,
                   int pianoBank, int pianoProgram, volatile int *cancel) {
  pthread_mutex_lock(&gBankLock);
  const Bank *bk = gBank;
  pthread_mutex_unlock(&gBankLock);
  if (!bk) return 10;
  int sr = srIn > 0 ? srIn : bk->sampleRate;
  long frames = (long)ceil(durationSec * sr);
  if (frames < sr) frames = sr;
  FILE *f = fopen(path, "wb");
  if (!f) return 1;
  uint8_t hdr[44];
  uint32_t dataSize = (uint32_t)(frames * 4);
  memcpy(hdr, "RIFF", 4);
  putLE32s(hdr + 4, 36 + dataSize);
  memcpy(hdr + 8, "WAVEfmt ", 8);
  putLE32s(hdr + 16, 16);
  putLE16s(hdr + 20, 1);
  putLE16s(hdr + 22, 2);
  putLE32s(hdr + 24, (uint32_t)sr);
  putLE32s(hdr + 28, (uint32_t)sr * 4);
  putLE16s(hdr + 32, 4);
  putLE16s(hdr + 34, 16);
  memcpy(hdr + 36, "data", 4);
  putLE32s(hdr + 40, dataSize);
  fwrite(hdr, 1, 44, f);

  SSynth *s = (SSynth *)calloc(1, sizeof(SSynth));
  if (!s) {
    fclose(f);
    return 2;
  }
  s->bk = bk;
  s->sr = sr;
  s->pianoBank = pianoBank >= 0 && pianoProgram >= 0 ? pianoBank : -1;
  s->pianoProg = pianoProgram;
  for (int c = 0; c < 16; c++) {
    SChan *ch = &s->ch[c];
    ch->cc[7] = 100;
    ch->cc[10] = 64;
    ch->cc[11] = 127;
    ch->cc[91] = 40;
    ch->bendRange = 2;
    ch->rpn = -1;
  }
  const int16_t *pool = bk->pool;

  double scale = sr / 44100.0;
  int combLen[4], apLen[4];
  const int combN[4] = {1116, 1188, 1277, 1356};
  const int apN[4] = {556, 441, 579, 464};
  double *combs[4], *aps[4];
  int combIdx[4] = {0, 0, 0, 0}, apIdx[4] = {0, 0, 0, 0};
  double combLp[4] = {0, 0, 0, 0};
  for (int k = 0; k < 4; k++) {
    combs[k] = mkLine(combN[k], scale, &combLen[k]);
    aps[k] = mkLine(apN[k], scale, &apLen[k]);
  }
  const double fb = 0.84, damp = 0.3;
  long revTail = 0;
  double *choBuf = (double *)calloc(CHO_LEN, sizeof(double));
  int choW = 0;
  double choPh = 0;
  const double choInc = 0.36 / sr;
  const double choBase = 0.012 * sr;
  const double choDepth = 0.0036 * sr;
  long choTail = 0;

  double L[SEG], R[SEG], RV[SEG], CH[SEG];
  int16_t pcm[SEG * 2];
  double limiter = 1;
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
      int kind = (int)e[1], c = (int)e[2] & 15, a = (int)e[3], b = (int)e[4];
      if (kind == 1) noteOnS(s, c, a, b);
      else if (kind == 0) noteOffS(s, c, a);
      else if (kind == 2) controlS(s, c, a, b);
      else if (kind == 3) s->ch[c].prog = a;
      else if (kind == 4) s->ch[c].bend = ((a - 8192) / 8192.0) * s->ch[c].bendRange;
    }
    long nextEvt = ei < count ? lround(ev[ei * 5] * sr) : frames;
    long nl = nextEvt - pos;
    if (frames - pos < nl) nl = frames - pos;
    if (nl > SEG) nl = SEG;
    int n = nl < 1 ? 1 : (int)nl;
    for (int i = 0; i < n; i++) L[i] = R[i] = RV[i] = CH[i] = 0;
    int anyRev = 0, anyCho = 0;

    for (int vi = 0; vi < s->nv; vi++) {
      SVoice *v = &s->v[vi];
      if (!v->on) continue;
      SChan *ch = &s->ch[v->ch];
      envAdvance(&v->vol, n);
      envAdvance(&v->menv, n);
      if (v->vol.stage >= 3 && v->vol.val <= 0.15) {
        v->on = 0;
        continue;
      }
      double ml = 0;
      if (v->mlDelay > 0) v->mlDelay -= n;
      else {
        v->mlPh += v->mlInc * n;
        v->mlPh -= floor(v->mlPh);
        ml = tri(v->mlPh);
      }
      double vl = 0;
      if (v->vlDelay > 0) v->vlDelay -= n;
      else {
        v->vlPh += v->vlInc * n;
        v->vlPh -= floor(v->vlPh);
        vl = tri(v->vlPh);
      }
      double me = v->menv.val;
      double cents = v->cents0 + ch->bend * 100 + me * v->modEnvPitch + ml * v->modLfoPitch +
                     vl * (v->vibPitch + ch->mod * 50);
      double inc = v->ratio * pow(2, cents / 1200);

      if (v->filt) {
        double fcC = v->fc + me * v->modEnvFc + ml * v->modLfoFc;
        if (fcC - v->lastFc > 1 || v->lastFc - fcC > 1) {
          v->lastFc = fcC;
          double hz = 8.176 * pow(2, fcC / 1200);
          if (hz > 0.45 * sr) hz = 0.45 * sr;
          if (hz < 5) hz = 5;
          double w = (2 * M_PI * hz) / sr;
          double cs = cos(w);
          double alpha = sin(w) / (2 * v->qLin);
          double a0 = 1 + alpha;
          v->b1 = ((1 - cs) * v->qGain) / a0;
          v->b0 = v->b1 * 0.5;
          v->a1 = (-2 * cs) / a0;
          v->a2 = (1 - alpha) / a0;
        }
      }

      double cv = ch->cc[7] / 127.0;
      double ce = ch->cc[11] / 127.0;
      double target = volAmp(&v->vol) * pow(10, (-v->atten + ml * v->modLfoVol) / 200) *
                      (cv * cv * ce * ce) * (1 / 32768.0);
      if (v->first) {
        v->g = target;
        v->first = 0;
      }
      double g = v->g;
      double dg = (target - g) / n;
      double pa = (clampd(v->pan + (ch->cc[10] - 64) / 64.0, -1, 1) + 1) * (M_PI / 4);
      double pl = cos(pa);
      double pr = sin(pa);
      double rs = v->rev;
      double cso = v->cho;
      if (rs > 0) anyRev = 1;
      if (cso > 0) anyCho = 1;

      int loopOn = v->mode == 1 || (v->mode == 3 && v->vol.stage < 5);
      double lim = loopOn ? v->le : v->end;
      double loopLen = v->le - v->ls;
      double p = v->pos;
      int filt = v->filt;
      double b0 = v->b0, b1 = v->b1, a1 = v->a1, a2 = v->a2;
      double x1 = v->x1, x2 = v->x2, y1 = v->y1, y2 = v->y2;
      int done = 0;
      for (int i = 0; i < n; i++) {
        int ip = (int)p;
        double fr = p - ip;
        double xm = pool[ip - 1];
        double x0 = pool[ip];
        double xa = pool[ip + 1];
        double xb = pool[ip + 2];
        double sm = (((0.5 * (xb - xm) + 1.5 * (x0 - xa)) * fr + (xm - 2.5 * x0 + 2 * xa - 0.5 * xb)) * fr +
                     0.5 * (xa - xm)) *
                        fr +
                    x0;
        if (filt) {
          double y = b0 * sm + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
          x2 = x1;
          x1 = sm;
          y2 = y1;
          y1 = y;
          sm = y;
        }
        double o = sm * g;
        g += dg;
        L[i] += o * pl;
        R[i] += o * pr;
        RV[i] += o * rs;
        CH[i] += o * cso;
        p += inc;
        if (p >= lim) {
          if (loopOn) p -= loopLen;
          else {
            done = 1;
            break;
          }
        }
      }
      if (y1 < 1e-15 && y1 > -1e-15) y1 = 0;
      if (y2 < 1e-15 && y2 > -1e-15) y2 = 0;
      v->x1 = x1;
      v->x2 = x2;
      v->y1 = y1;
      v->y2 = y2;
      v->pos = p;
      v->g = target;
      if (done) v->on = 0;
    }

    if (anyCho) choTail = CHO_LEN;
    if (anyRev) revTail = lround(sr * 4.0);
    int doCho = choTail > 0;
    int doRev = revTail > 0;
    if (doCho) choTail -= n;
    if (doRev) revTail -= n;

    for (int i = 0; i < n; i++) {
      double l = L[i];
      double r = R[i];
      if (doCho) {
        choBuf[choW] = CH[i];
        double ph = 2 * M_PI * choPh;
        double dL = choBase + choDepth * sin(ph);
        double dR = choBase + choDepth * cos(ph);
        choPh += choInc;
        if (choPh >= 1) choPh -= 1;
        double rp = choW - dL;
        if (rp < 0) rp += CHO_LEN;
        int i0 = (int)rp;
        double fr = rp - i0;
        int i1 = i0 + 1 >= CHO_LEN ? 0 : i0 + 1;
        double tl = choBuf[i0] + (choBuf[i1] - choBuf[i0]) * fr;
        rp = choW - dR;
        if (rp < 0) rp += CHO_LEN;
        i0 = (int)rp;
        fr = rp - i0;
        i1 = i0 + 1 >= CHO_LEN ? 0 : i0 + 1;
        double tr = choBuf[i0] + (choBuf[i1] - choBuf[i0]) * fr;
        if (++choW >= CHO_LEN) choW = 0;
        l += tl * 0.55;
        r += tr * 0.55;
      }
      if (doRev) {
        double x = RV[i] * 0.2;
        double sum = 0;
        for (int k = 0; k < 4; k++) {
          double *cb = combs[k];
          int ix = combIdx[k];
          double o = cb[ix];
          combLp[k] = o * (1 - damp) + combLp[k] * damp;
          cb[ix] = x + combLp[k] * fb;
          combIdx[k] = ix + 1 >= combLen[k] ? 0 : ix + 1;
          sum += o;
        }
        double rl = sum, rr = sum;
        for (int k = 0; k < 2; k++) {
          double *ap = aps[k];
          int ix = apIdx[k];
          double bo = ap[ix];
          ap[ix] = rl + bo * 0.5;
          rl = bo - rl;
          apIdx[k] = ix + 1 >= apLen[k] ? 0 : ix + 1;
          ap = aps[k + 2];
          ix = apIdx[k + 2];
          bo = ap[ix];
          ap[ix] = rr + bo * 0.5;
          rr = bo - rr;
          apIdx[k + 2] = ix + 1 >= apLen[k + 2] ? 0 : ix + 1;
        }
        l += rl * 0.9;
        r += rr * 0.9;
      }
      l *= MASTER;
      r *= MASTER;
      double al = l < 0 ? -l : l;
      double ar = r < 0 ? -r : r;
      double pk = (al > ar ? al : ar) * limiter;
      if (pk > 0.92) limiter *= 0.92 / pk;
      else if (limiter < 1) limiter = fmin(1, limiter + 0.00015);
      l *= limiter;
      r *= limiter;
      pcm[i * 2] = l >= 1 ? 32767 : l <= -1 ? -32768 : (int16_t)(int)(l * 32767);
      pcm[i * 2 + 1] = r >= 1 ? 32767 : r <= -1 ? -32768 : (int16_t)(int)(r * 32767);
    }
    if (fwrite(pcm, sizeof(int16_t), (size_t)n * 2, f) != (size_t)n * 2) {
      rc = 4;
      break;
    }
    pos += n;
  }

  for (int k = 0; k < 4; k++) {
    free(combs[k]);
    free(aps[k]);
  }
  free(choBuf);
  free(s);
  fclose(f);
  if (rc) remove(path);
  return rc;
}
