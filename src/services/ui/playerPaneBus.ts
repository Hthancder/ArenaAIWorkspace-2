// Ask the full player to open a pane from outside it (widget deep links: holysic://widget/lyrics).

export type RequestedPane = 'lyrics' | 'queue';

let pending: RequestedPane | null = null;
const subs = new Set<(p: RequestedPane) => void>();

export const PlayerPaneBus = {
  request(p: RequestedPane) {
    pending = p;
    subs.forEach((f) => f(p));
  },
  /** Listen for requests; a request made before the player mounted is delivered right away */
  subscribe(f: (p: RequestedPane) => void): () => void {
    subs.add(f);
    if (pending) f(pending);
    return () => {
      subs.delete(f);
    };
  },
  consume() {
    pending = null;
  },
};
