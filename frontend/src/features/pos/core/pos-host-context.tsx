'use client';
import { createContext, useContext } from 'react';

/** The terminal's routing transport. Its sale/outbox and activation contracts stay unchanged. */
export type PosHost = {
  basePath: string;
  ownsInput: (target: EventTarget | null) => boolean;
  router: { replace: (href: string) => void };
  history: {
    hash: () => string;
    replace: (hash: string) => void;
    push: (hash: string) => void;
    back: () => void;
    listen: (listener: () => void) => () => void;
  };
};
export const PosHostContext = createContext<PosHost | null>(null);
export const usePosHost = () => useContext(PosHostContext);
