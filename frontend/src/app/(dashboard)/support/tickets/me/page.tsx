'use client';
import { useState, useEffect } from 'react';
import { AuroraPage } from '@/components/aurora/layout/AuroraPage';
import { AuroraPageHeader } from '@/components/aurora/layout/AuroraPageHeader';
import Link from 'next/link';
import { unwrapList } from '@/lib/unwrap';

const priorityColor: Record<string,string> = { URGENT:'bg-red-100 text-red-800', HIGH:'bg-orange-100 text-orange-800', NORMAL:'bg-blue-100 text-blue-800', LOW:'bg-gray-100 text-gray-600' };
const statusColor: Record<string,string> = { OPEN:'bg-blue-100 text-blue-800', IN_PROGRESS:'bg-yellow-100 text-yellow-800', WAITING_USER:'bg-purple-100 text-purple-800', RESOLVED:'bg-green-100 text-green-800', CLOSED:'bg-gray-100 text-gray-600', CANCELLED:'bg-gray-100 text-gray-400' };

export default function MyTicketsPage() {
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ title:'', description:'', ticketType:'QUESTION', priority:'NORMAL', moduleName:'' });

  const load = () => {
    fetch('/api/backend/support/tickets/me').then(r=>r.json()).then(d=>{ setTickets(unwrapList(d)); setLoading(false); });
  };
  useEffect(()=>{ load(); },[]);

  const create = async () => {
    await fetch('/api/backend/support/tickets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)});
    setShowModal(false); load();
  };

  return (
    <AuroraPage>
      <AuroraPageHeader title="My Tickets" subtitle="Support tickets you have submitted" />
      <div className="p-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
            <span className="font-semibold text-gray-900 dark:text-white">My Tickets ({tickets.length})</span>
            <button onClick={()=>setShowModal(true)} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">+ New Ticket</button>
          </div>
          {loading ? <div className="p-8 text-center text-gray-500">Loading...</div> : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700"><tr>
              {['Ticket #','Title','Type','Priority','Status','Created',''].map(h=>(
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
              ))}
            </tr></thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {tickets.map((t:any)=>(
                <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-4 py-3 font-mono text-xs">{t.ticketNumber}</td>
                  <td className="px-4 py-3 font-medium">{t.title}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{t.ticketType}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 text-xs rounded-full ${priorityColor[t.priority]}`}>{t.priority}</span></td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 text-xs rounded-full ${statusColor[t.status]}`}>{t.status}</span></td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{new Date(t.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3"><Link href={`/support/tickets/${t.id}`} className="text-xs text-blue-600 hover:underline">View</Link></td>
                </tr>
              ))}
              {tickets.length===0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No tickets yet. Click New Ticket to submit one.</td></tr>}
            </tbody>
          </table>
          )}
        </div>

        {showModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-lg space-y-3">
              <h3 className="text-lg font-semibold">New Support Ticket</h3>
              <input placeholder="Title" value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              <textarea placeholder="Description — what is the issue?" rows={3} value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              <select value={form.ticketType} onChange={e=>setForm(f=>({...f,ticketType:e.target.value}))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                {['BUG','QUESTION','TRAINING_REQUEST','ACCESS_REQUEST','OTHER'].map(t=><option key={t}>{t}</option>)}
              </select>
              <select value={form.priority} onChange={e=>setForm(f=>({...f,priority:e.target.value}))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                {['LOW','NORMAL','HIGH','URGENT'].map(p=><option key={p}>{p}</option>)}
              </select>
              <div className="flex gap-2 justify-end">
                <button onClick={()=>setShowModal(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg">Cancel</button>
                <button onClick={create} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg">Submit Ticket</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AuroraPage>
  );
}

