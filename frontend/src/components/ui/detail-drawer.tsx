'use client';
import type { ReactNode } from 'react';
import { Modal } from './modal';

interface DetailDrawerProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  width?: 'sm' | 'md' | 'lg';
}

/** Detail panels share the same focus trap, Escape, scroll lock and return focus as forms. */
export function DetailDrawer({ width = 'md', ...props }: DetailDrawerProps) {
  return <Modal {...props} size={width} placement="right" />;
}
