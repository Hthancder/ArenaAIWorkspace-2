// Where the instrument packs (public/soundbank/<version>/) are downloaded from.
//
// The web build serves them itself (Expo copies public/ into the export), so the browser fetches
// them same-origin first. Native builds — and the web as a fallback — read them from GitHub,
// pinned to the commit that added this pack version, so the files never change under a cached
// copy and keep working whatever happens to the branch later. Mirrors are tried in order.

/** commit that contains public/soundbank/gu1 (bump with a new pack version, never edit packs) */
export const PACKS_COMMIT = 'f5e14c54f2314801571333f6153d620051d29349';
const REPO = 'Hthancder/ArenaAIWorkspace-2';

export function packSources(version: string, web: boolean): string[] {
  const path = `public/soundbank/${version}/`;
  const remote = [
    `https://raw.githubusercontent.com/${REPO}/${PACKS_COMMIT}/${path}`,
    `https://cdn.jsdelivr.net/gh/${REPO}@${PACKS_COMMIT}/${path}`,
  ];
  return web ? [`/soundbank/${version}/`, ...remote] : remote;
}
