'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { AuroraPage } from '@/components/aurora/layout/AuroraPage';
import { AuroraPageHeader } from '@/components/aurora/layout/AuroraPageHeader';
import { unwrapList, unwrapOne } from '@/lib/unwrap';

const statusColor: Record<string, string> = {
  OPEN: 'bg-blue-100 text-blue-800',
  IN_PROGRESS: 'bg-yellow-100 text-yellow-800',
  WAITING_USER: 'bg-purple-100 text-purple-800',
  RESOLVED: 'bg-green-100 text-green-800',
  CLOSED: 'bg-gray-100 text-gray-600',
  CANCELLED: 'bg-gray-100 text-gray-400',
};
const priorityColor: Record<string, string> = {
  URGENT: 'bg-red-100 text-red-800',
  HIGH: 'bg-orange-100 text-orange-800',
  NORMAL: 'bg-blue-100 text-blue-800',
  LOW: 'bg-gray-100 text-gray-600',
};

export default function TicketDetailPage() {
  const params = useParams();
  const [ticket, setTicket] = useState<any>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [comment, setComment] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetch(`/api/backend/support/tickets/${params.id}`)
      .then((r) => r.json())
      .then((d) => {
        setTicket(unwrapOne(d));
        setLoading(false);
      });
    fetch(`/api/backend/support/tickets/${params.id}/comments`)
      .then((r) => r.json())
      .then((d) => setComments(unwrapList(d)));
  }, [params.id]);
  useEffect(() => {
    load();
  }, [load]);

  const addComment = async () => {
    if (!comment.trim()) return;
    await fetch(`/api/backend/support/tickets/${params.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment, internal: isInternal }),
    });
    setComment('');
    load();
  };

  if (loading)
    return (
      <AuroraPage>
        <div className="p-8 text-gray-500">Loading...</div>
      </AuroraPage>
    );
  if (!ticket)
    return (
      <AuroraPage>
        <div className="p-8 text-gray-500">Ticket not found.</div>
      </AuroraPage>
    );

  return (
    <AuroraPage>
      <AuroraPageHeader title={`Ticket: ${ticket.ticketNumber}`} subtitle={ticket.title} />
      <div className="p-6 grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Description</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
              {ticket.description}
            </p>
            {ticket.resolution && (
              <div className="mt-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg">
                <p className="text-xs font-medium text-green-700 dark:text-green-300">Resolution</p>
                <p className="text-sm text-green-600 dark:text-green-400 mt-1">
                  {ticket.resolution}
                </p>
              </div>
            )}
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3">
              Comments ({comments.length})
            </h3>
            <div className="space-y-3">
              {comments.map((c: any) => (
                <div
                  key={c.id}
                  className={`p-3 rounded-lg ${c.internal ? 'bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-700' : 'bg-gray-50 dark:bg-gray-700'}`}
                >
                  {c.internal && (
                    <span className="text-xs font-medium text-orange-600 dark:text-orange-400 block mb-1">
                      🔒 Internal Note
                    </span>
                  )}
                  <p className="text-sm text-gray-700 dark:text-gray-300">{c.comment}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {c.user?.name || c.user?.email || 'System'} ·{' '}
                    {new Date(c.createdAt).toLocaleString()}
                  </p>
                </div>
              ))}
              {comments.length === 0 && <p className="text-sm text-gray-500">No comments yet.</p>}
            </div>
            <div className="mt-4 space-y-2">
              <textarea
                placeholder="Add a comment..."
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              />
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isInternal}
                    onChange={(e) => setIsInternal(e.target.checked)}
                    className="rounded"
                  />
                  Internal note (staff only)
                </label>
                <button
                  onClick={addComment}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Add Comment
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5 space-y-3">
            <h3 className="font-semibold text-gray-900 dark:text-white">Ticket Details</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Status</span>
                <span className={`px-2 py-0.5 text-xs rounded-full ${statusColor[ticket.status]}`}>
                  {ticket.status}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Priority</span>
                <span
                  className={`px-2 py-0.5 text-xs rounded-full ${priorityColor[ticket.priority]}`}
                >
                  {ticket.priority}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Type</span>
                <span className="text-gray-700 dark:text-gray-300">{ticket.ticketType}</span>
              </div>
              {ticket.moduleName && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Module</span>
                  <span className="text-gray-700 dark:text-gray-300">{ticket.moduleName}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500">Reported By</span>
                <span className="text-gray-700 dark:text-gray-300">
                  {ticket.reportedBy?.name || ticket.reportedBy?.email || '—'}
                </span>
              </div>
              {ticket.assignedTo && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Assigned To</span>
                  <span className="text-gray-700 dark:text-gray-300">
                    {ticket.assignedTo?.name || ticket.assignedTo?.email}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500">Created</span>
                <span className="text-gray-700 dark:text-gray-300">
                  {new Date(ticket.createdAt).toLocaleDateString()}
                </span>
              </div>
              {ticket.resolvedAt && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Resolved</span>
                  <span className="text-gray-700 dark:text-gray-300">
                    {new Date(ticket.resolvedAt).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AuroraPage>
  );
}
