'use client';

import { useEffect, useId, useState } from 'react';
import type { Tone } from '@/design/tokens';
import { PRINTING_CLASS, preparePrintImages } from '@/lib/print-assets';
import { buttonClasses } from '@/ui/actions';
import { cn } from '@/ui/cn';
import { Icon } from '@/ui/Icon';

export type PrintProfileOption = {
  id: string;
  label: string;
  description: string;
};

const fallbackProfiles: readonly PrintProfileOption[] = [
  {
    id: 'group',
    label: 'Itemba Group Profile',
    description: 'Print the group company profile.',
  },
];

export type PrintProfileButtonProps = {
  profiles?: readonly PrintProfileOption[];
  /** The select's label (src/content/profile printButtonCopy.label). */
  label?: string;
  /** The button's label. */
  actionLabel?: string;
  /** The button's label while the chosen profile's photos load. */
  preparingLabel?: string;
  /**
   * The panel's own tone. Omitted, it takes the alternate surface of the
   * tile it sits on, like a Card.
   */
  tone?: Tone;
  className?: string;
};

/**
 * The company-profile print picker: choose one of the four profiles and
 * print it. Its contract with print.css and scripts/generate-profile-pdfs.mjs
 * is origin/main's:
 * - body[data-print-profile] follows the selection from mount;
 * - `beforeprint` sets it (and `printing-company-profile`) again, and
 *   `afterprint` removes the class; the PDF script registers its own
 *   `beforeprint` listener after this one so its profile wins;
 * - the panel is `print-hidden`.
 *
 * New: before calling window.print(), the button loads the chosen profile's
 * photos (they are lazy so screen visitors never download them) and waits
 * for them to decode, for 4 seconds at most.
 */
export default function PrintProfileButton({
  profiles = fallbackProfiles,
  label = 'Select profile to print',
  actionLabel = 'Print selected profile',
  preparingLabel = 'Preparing profile…',
  tone,
  className,
}: PrintProfileButtonProps) {
  const [selectedProfile, setSelectedProfile] = useState(profiles[0]?.id ?? 'group');
  const [preparing, setPreparing] = useState(false);
  const selectId = useId();
  const descriptionId = useId();

  useEffect(() => {
    document.body.dataset.printProfile = selectedProfile;
  }, [selectedProfile]);

  useEffect(() => {
    const beforePrint = () => {
      document.body.dataset.printProfile = selectedProfile;
      document.body.classList.add(PRINTING_CLASS);
    };
    const afterPrint = () => {
      document.body.classList.remove(PRINTING_CLASS);
    };

    window.addEventListener('beforeprint', beforePrint);
    window.addEventListener('afterprint', afterPrint);

    return () => {
      window.removeEventListener('beforeprint', beforePrint);
      window.removeEventListener('afterprint', afterPrint);
      document.body.classList.remove(PRINTING_CLASS);
      delete document.body.dataset.printProfile;
    };
  }, [selectedProfile]);

  const selected = profiles.find((profile) => profile.id === selectedProfile) ?? profiles[0];

  const handlePrint = async () => {
    if (preparing) return;
    document.body.dataset.printProfile = selectedProfile;
    document.body.classList.add(PRINTING_CLASS);
    setPreparing(true);
    try {
      await preparePrintImages(selectedProfile);
    } finally {
      setPreparing(false);
    }
    window.setTimeout(() => window.print(), 50);
  };

  return (
    <div
      data-tone={tone}
      className={cn(
        'print-hidden w-full max-w-xl rounded-card p-5 text-fg md:p-6',
        // The select takes the other surface of the pair, so it stands off the panel.
        tone ? 'bg-surface [--field:var(--surface-alt)]' : 'bg-surface-alt [--field:var(--surface)]',
        className,
      )}
    >
      <label htmlFor={selectId} className="text-body font-semibold text-fg">
        {label}
      </label>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <select
            id={selectId}
            value={selectedProfile}
            onChange={(event) => setSelectedProfile(event.target.value)}
            aria-describedby={selected ? descriptionId : undefined}
            className="h-11 w-full cursor-pointer appearance-none truncate rounded-input border border-line-strong bg-[rgb(var(--field))] pl-4 pr-11 text-body text-fg transition-[border-color,box-shadow] duration-fast ease-apple focus:border-focus focus:outline-none focus:ring-4 focus:ring-focus/20"
          >
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.label}
              </option>
            ))}
          </select>
          <Icon
            name="chevron-down"
            size="xs"
            strokeWidth={2}
            className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-fg-muted"
          />
        </div>
        <button
          type="button"
          onClick={handlePrint}
          disabled={preparing}
          aria-busy={preparing || undefined}
          className={buttonClasses({ size: 'md' })}
        >
          <Icon name="document" size="sm" />
          <span>{preparing ? preparingLabel : actionLabel}</span>
        </button>
      </div>
      {selected ? (
        <p id={descriptionId} className="mt-3 text-caption text-fg-muted">
          {selected.description}
        </p>
      ) : null}
    </div>
  );
}
