'use client';

import { useEffect, useId, useState } from 'react';

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

export default function PrintProfileButton({
  profiles = fallbackProfiles,
}: {
  profiles?: readonly PrintProfileOption[];
}) {
  const [selectedProfile, setSelectedProfile] = useState(profiles[0]?.id ?? 'group');
  const selectId = useId();

  useEffect(() => {
    document.body.dataset.printProfile = selectedProfile;
  }, [selectedProfile]);

  useEffect(() => {
    const beforePrint = () => {
      document.body.dataset.printProfile = selectedProfile;
      document.body.classList.add('printing-company-profile');
    };
    const afterPrint = () => {
      document.body.classList.remove('printing-company-profile');
    };

    window.addEventListener('beforeprint', beforePrint);
    window.addEventListener('afterprint', afterPrint);

    return () => {
      window.removeEventListener('beforeprint', beforePrint);
      window.removeEventListener('afterprint', afterPrint);
      document.body.classList.remove('printing-company-profile');
      delete document.body.dataset.printProfile;
    };
  }, [selectedProfile]);

  const selected = profiles.find((profile) => profile.id === selectedProfile) ?? profiles[0];

  const handlePrint = () => {
    document.body.dataset.printProfile = selectedProfile;
    document.body.classList.add('printing-company-profile');
    window.setTimeout(() => window.print(), 50);
  };

  return (
    <div className="print-hidden w-full max-w-xl rounded-lg border border-white/15 bg-white/10 p-4 backdrop-blur-sm">
      <label htmlFor={selectId} className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-300">
        Select profile to print
      </label>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
        <select
          id={selectId}
          value={selectedProfile}
          onChange={(event) => setSelectedProfile(event.target.value)}
          className="min-h-12 rounded-md border border-white/20 bg-ink-950 px-4 text-sm font-semibold text-white outline-none ring-gold-400 transition focus:ring-2"
        >
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handlePrint}
          className="btn-primary inline-flex min-h-12 items-center justify-center rounded-md bg-gold-500 px-5 text-sm font-semibold text-white hover:bg-gold-400"
        >
          Print selected profile
        </button>
      </div>
      {selected ? <p className="mt-3 text-xs leading-relaxed text-slate-300">{selected.description}</p> : null}
    </div>
  );
}
