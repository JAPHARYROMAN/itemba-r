'use client';
import { useState, useEffect } from 'react';
import { AuroraPage } from '@/components/aurora/layout/AuroraPage';
import { AuroraPageHeader } from '@/components/aurora/layout/AuroraPageHeader';
import { unwrapList } from '@/lib/unwrap';

export default function TrainingEnvironmentPage() {
  const [configs, setConfigs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', environment: 'TRAINING', seedProfile: 'STANDARD', resetFrequency: 'MANUAL', description: '' });

  const load = () => {
    fetch('/api/backend/training/environments')
      .then(r => r.json()).then(d => { setConfigs(unwrapList(d)); setLoading(false); });
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    await fetch('/api/backend/training/environments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
    });
    setShowModal(false); load();
  };

  const resetDemo = async (id: string) => {
    const res = await fetch(`/api/backend/training/environments/${id}/reset-demo-data`, { method: 'POST' });
    const data = await res.json();
    setShowResetConfirm(null);
    if (!res.ok) alert(data.message || 'Reset failed');
    else { alert('Demo data reset successfully.'); load(); }
  };

  if (loading) return <AuroraPage><div className="p-8 text-gray-500">Loading...</div></AuroraPage>;

  return (
    <AuroraPage>
      <AuroraPageHeader title="Training Environment" subtitle="Configure training and demo environments" />
      <div className="p-6 space-y-4">
        <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg">
          <span className="text-amber-500 text-xl">⚠️</span>
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Training Environment Safety</p>
            <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">Resetting demo data only affects designated TRAINING, DEMO, or SANDBOX environments. Production data is <strong>never</strong> affected. Reset requires the <code>training_environment.reset</code> permission.</p>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="font-semibold text-gray-900 dark:text-white">Environment Configs</h2>
            <button onClick={() => setShowModal(true)} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">+ New Config</button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700"><tr>
              {['Code','Name','Environment','Seed Profile','Reset Frequency','Status','Last Reset','Actions'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
              ))}
            </tr></thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {configs.map((c: any) => (
                <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-4 py-3 font-mono text-xs">{c.configCode}</td>
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{c.name}</td>
                  <td className="px-4 py-3"><span className="px-2 py-1 text-xs bg-purple-100 text-purple-800 rounded-full">{c.environment}</span></td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{c.seedProfile}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{c.resetFrequency}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-1 text-xs rounded-full ${c.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : c.status === 'PAUSED' ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-600'}`}>{c.status}</span></td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{c.lastResetAt ? new Date(c.lastResetAt).toLocaleString() : 'Never'}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => setShowResetConfirm(c.id)} className="text-xs text-orange-600 hover:underline font-medium">Reset Demo Data</button>
                  </td>
                </tr>
              ))}
              {configs.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">No training environments configured.</td></tr>}
            </tbody>
          </table>
        </div>

        {showModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-md space-y-3">
              <h3 className="text-lg font-semibold">New Training Environment</h3>
              <input placeholder="Name" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              <input placeholder="Description" value={form.description} onChange={e => setForm(f => ({...f, description: e.target.value}))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              <select value={form.environment} onChange={e => setForm(f => ({...f, environment: e.target.value}))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                {['TRAINING','DEMO','SANDBOX'].map(v => <option key={v}>{v}</option>)}
              </select>
              <select value={form.seedProfile} onChange={e => setForm(f => ({...f, seedProfile: e.target.value}))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                {['MINIMAL','STANDARD','FULL_DEMO','ROLE_BASED'].map(v => <option key={v}>{v}</option>)}
              </select>
              <select value={form.resetFrequency} onChange={e => setForm(f => ({...f, resetFrequency: e.target.value}))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                {['NEVER','DAILY','WEEKLY','MONTHLY','MANUAL'].map(v => <option key={v}>{v}</option>)}
              </select>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg">Cancel</button>
                <button onClick={save} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg">Save</button>
              </div>
            </div>
          </div>
        )}

        {showResetConfirm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-md space-y-4">
              <h3 className="text-lg font-semibold text-orange-600">⚠️ Confirm Demo Data Reset</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">This will reset the demo/training data for this environment. This only affects TRAINING, DEMO, or SANDBOX environments — never production. Are you sure?</p>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowResetConfirm(null)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg">Cancel</button>
                <button onClick={() => resetDemo(showResetConfirm)} className="px-4 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700">Yes, Reset Demo Data</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AuroraPage>
  );
}

