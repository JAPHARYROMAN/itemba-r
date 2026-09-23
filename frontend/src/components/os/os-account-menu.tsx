'use client';

import { useRef } from 'react';
import {
  Button,
  Header,
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  Popover,
  Separator,
} from 'react-aria-components';
import { LogOut, Settings2 } from 'lucide-react';

export function OsAccountMenu({
  initials,
  name,
  email,
  onSettings,
  onSignOut,
}: {
  initials: string;
  name?: string;
  email?: string;
  onSettings: (trigger: HTMLButtonElement | null) => void;
  onSignOut: () => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <MenuTrigger>
      <Button ref={triggerRef} className="os-account-trigger" aria-label="Account menu">
        <span className="os-avatar">{initials}</span>
      </Button>
      <Popover className="os-account-popover os-system-layer" placement="bottom end" offset={12}>
        <Menu className="os-account-menu" aria-label="Your account">
          <MenuSection>
            <Header className="os-account-identity">
              <strong>{name || 'Your account'}</strong>
              <span>{email}</span>
            </Header>
            <MenuItem textValue="Appearance" onAction={() => onSettings(triggerRef.current)}>
              <Settings2 size={16} />
              <span>Appearance</span>
            </MenuItem>
          </MenuSection>
          <Separator />
          <MenuItem textValue="Sign out" onAction={onSignOut}>
            <LogOut size={16} />
            <span>Sign out</span>
          </MenuItem>
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}
