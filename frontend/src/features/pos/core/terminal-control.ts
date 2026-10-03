/** Exclusive device operation. The activated terminal still validates scope server-side. */
export async function terminalOperation<T>(terminal: string, work: () => Promise<T>): Promise<T> {
  if (!navigator.locks) return work(); // Established legacy offline contract.
  return navigator.locks.request(`itemba-pos-operation:${terminal}`, { mode: 'exclusive' }, work);
}

export function claimTerminalControl(
  terminal: string,
  acquired: (owned: boolean) => void,
): () => void {
  let release: (() => void) | undefined;
  let stopped = false;
  if (!navigator.locks) {
    acquired(false);
    return () => undefined;
  }
  void navigator.locks
    .request(
      `itemba-pos-controller:${terminal}`,
      { mode: 'exclusive', ifAvailable: true },
      async (lock) => {
        if (stopped) return;
        if (!lock) {
          acquired(false);
          return;
        }
        acquired(true);
        await new Promise<void>((resolve) => {
          release = resolve;
          if (stopped) resolve();
        });
        if (!stopped) acquired(false);
      },
    )
    .catch(() => {
      if (!stopped) acquired(false);
    });
  return () => {
    stopped = true;
    acquired(false);
    release?.();
  };
}
