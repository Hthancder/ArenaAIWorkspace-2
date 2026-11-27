// Open a section of the Library tab from elsewhere (Settings › Storage → "Đã tải"). "Trên máy"
// has its own screen: LocalLibrary.open().
// The Library screen keeps its section in local state; it listens here and switches when asked.

type Section = 'offline';
let pending: Section | null = null;
const subs = new Set<(s: Section) => void>();

export const LibraryNav = {
  open(s: Section) {
    pending = s;
    subs.forEach((f) => f(s));
  },
  /** the section asked for before the Library screen mounted (read once) */
  take(): Section | null {
    const p = pending;
    pending = null;
    return p;
  },
  subscribe(f: (s: Section) => void) {
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  },
};
