'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useWorkspaceHistory } from '@/components/workspace/workspace-navigation';
import { MobilePosLite } from '@/components/westsides/mobile-pos-lite/mobile-pos-lite';
import { MobilePosActivation } from '@/components/westsides/mobile-pos-lite/mobile-pos-activation';
import { PosHostContext, type PosHost } from '@/features/pos/core/pos-host-context';

export function DesktopPos() {
  const navigation = useWorkspaceHistory()!;
  const surface = useRef<HTMLDivElement>(null);
  const current = useRef(navigation);
  useLayoutEffect(() => {
    current.current = navigation;
  }, [navigation]);
  const href = useRef(navigation.href);
  const expected = useRef<string | null>(null);
  const listeners = useRef(new Set<() => void>());
  const [transport] = useState<PosHost>(() => {
    const commit = (target: string, replace: boolean) => {
      expected.current = target;
      href.current = target;
      current.current.navigate(target, replace);
    };
    const withHash = (hash: string) => `${href.current.split('#')[0]}${hash}`;
    return {
      basePath: '/pos',
      ownsInput: (target) => {
        const frame = surface.current?.closest('.desktop-window');
        if (!frame) return target instanceof Node && !!surface.current?.contains(target);
        return (
          frame.getAttribute('data-active') === 'true' &&
          frame.getAttribute('aria-hidden') !== 'true' &&
          target instanceof Node &&
          frame.contains(target)
        );
      },
      router: { replace: (target) => commit(target, true) },
      history: {
        hash: () => new URL(href.current, 'http://desktop.local').hash,
        replace: (hash) => commit(withHash(hash), true),
        push: (hash) => commit(withHash(hash), false),
        back: () => current.current.back(),
        listen: (listener) => {
          listeners.current.add(listener);
          return () => {
            listeners.current.delete(listener);
          };
        },
      },
    };
  });
  useEffect(() => {
    const internal = expected.current === navigation.href;
    const changed = href.current !== navigation.href;
    href.current = navigation.href;
    expected.current = null;
    if (!internal && changed) listeners.current.forEach((listener) => listener());
  }, [navigation.href]);
  return (
    <PosHostContext.Provider value={transport}>
      <div className="desktop-pos" ref={surface}>
        {navigation.href.split(/[?#]/)[0] === '/pos/activate' ? (
          <MobilePosActivation />
        ) : (
          <MobilePosLite />
        )}
      </div>
    </PosHostContext.Provider>
  );
}
