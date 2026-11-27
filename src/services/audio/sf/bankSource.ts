// Native builds: the sample bank lives in the HolySicDSP pod (HolySicSoundBank.bundle) and is read
// by the C renderer directly, so the JS bundle does not carry it. See bankSource.web.ts.
export function soundBankUrl(): string | null {
  return null;
}
