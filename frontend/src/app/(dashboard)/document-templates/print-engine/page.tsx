'use client';

import { useState } from 'react';

export default function PrintEnginePage() {
  const [form, setForm] = useState({ templateId: '', entityType: '', entityId: '', data: '{}' });
  const [preview, setPreview] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    setPreview('');

    let parsedData: unknown;
    try {
      parsedData = JSON.parse(form.data);
    } catch {
      setError('Invalid JSON in the data field.');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/backend/print-engine/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: form.templateId,
          entityType: form.entityType,
          entityId: form.entityId,
          data: parsedData,
        }),
      });
      const json = await res.json();
      if (res.ok) {
        setPreview(json.html ?? json.renderedHtml ?? JSON.stringify(json, null, 2));
      } else {
        setError(json.message ?? 'Render failed.');
      }
    } catch {
      setError('An error occurred while rendering.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Print Engine</h1>
        <p className="text-gray-500 mt-1">Render documents using templates and entity data</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4">Render Parameters</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Template ID</label>
              <input
                type="text"
                value={form.templateId}
                onChange={e => setForm(f => ({ ...f, templateId: e.target.value }))}
                placeholder="Enter template ID or code"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Entity Type</label>
              <input
                type="text"
                value={form.entityType}
                onChange={e => setForm(f => ({ ...f, entityType: e.target.value }))}
                placeholder="e.g. INVOICE, PURCHASE_ORDER"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Entity ID</label>
              <input
                type="text"
                value={form.entityId}
                onChange={e => setForm(f => ({ ...f, entityId: e.target.value }))}
                placeholder="Enter entity UUID or ID"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Data (JSON)</label>
              <textarea
                value={form.data}
                onChange={e => setForm(f => ({ ...f, data: e.target.value }))}
                rows={6}
                placeholder='{"key": "value"}'
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-y"
              />
            </div>
            {error && (
              <div className="px-3 py-2 rounded-lg text-sm bg-red-50 border border-red-200 text-red-700">{error}</div>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Rendering…' : 'Render Document'}
            </button>
          </form>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4">Preview</h2>
          {preview ? (
            // P2-07 (XSS hardening): the rendered template is server-generated
            // content that may contain user-supplied substitutions. Rendering
            // it inline via dangerouslySetInnerHTML would execute any embedded
            // <script> tags or event handlers in the dashboard's JS context
            // (full access to httpOnly-cookie-backed proxy). Render through a
            // sandboxed iframe instead — no `allow-scripts` token, so any
            // embedded script is inert; no `allow-same-origin`, so the
            // document cannot read parent cookies/storage even via DOM walking.
            <iframe
              title="Document preview"
              srcDoc={preview}
              sandbox=""
              className="border border-gray-200 rounded-lg w-full bg-white"
              style={{ height: 600 }}
            />
          ) : (
            <div className="flex items-center justify-center h-48 rounded-lg bg-gray-50 border-2 border-dashed border-gray-200 text-sm text-gray-400">
              Rendered document will appear here
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
