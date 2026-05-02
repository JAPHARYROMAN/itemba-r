'use client';
import { Suspense, useState, useCallback, useEffect } from 'react';
import { AuroraPage } from '@/components/aurora/layout/AuroraPage';
import { AuroraPageHeader } from '@/components/aurora/layout/AuroraPageHeader';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { unwrapList } from '@/lib/unwrap';

function HelpSearchContent() {
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setLoading(true);
    setSearched(true);
    const res = await fetch(`/api/backend/help/articles/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    setResults(unwrapList(data));
    setLoading(false);
  }, []);

  useEffect(() => {
    const q = searchParams.get('q');
    if (q) search(q);
  }, [searchParams, search]);

  return (
    <AuroraPage>
      <AuroraPageHeader title="Search Help" subtitle="Find articles, manuals, and guides" />
      <div className="p-6 space-y-4">
        <div className="flex gap-2 max-w-2xl">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search(query)}
            placeholder="Search help articles and manuals..."
            className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
          />
          <button onClick={() => search(query)} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">Search</button>
        </div>
        {loading && <div className="text-gray-500">Searching...</div>}
        {searched && !loading && results.length === 0 && (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">🔍</div>
            <p className="text-gray-500">No results found for &ldquo;{query}&rdquo;.</p>
            <p className="text-sm text-gray-400 mt-1">Try different keywords or browse <Link href="/help/articles" className="text-blue-600 hover:underline">all articles</Link>.</p>
          </div>
        )}
        <div className="space-y-3">
          {results.map((r: any) => (
            <div key={r.id} className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white">{r.title}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">{r.articleCategory} {r.moduleName ? `· ${r.moduleName}` : ''}</p>
                </div>
                <span className={`px-2 py-0.5 text-xs rounded-full ml-3 ${r.status === 'PUBLISHED' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>{r.status}</span>
              </div>
              {r.content && <p className="text-sm text-gray-600 dark:text-gray-400 mt-2 line-clamp-2">{r.content.slice(0, 200)}</p>}
              <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                <span>👁 {r.viewCount ?? 0} views</span>
                <span>👍 {r.helpfulCount ?? 0} helpful</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AuroraPage>
  );
}

export default function HelpSearchPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>}>
      <HelpSearchContent />
    </Suspense>
  );
}
