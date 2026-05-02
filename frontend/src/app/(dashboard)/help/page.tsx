'use client';
import { useState, useEffect } from 'react';
import { AuroraPage } from '@/components/aurora/layout/AuroraPage';
import { AuroraPageHeader } from '@/components/aurora/layout/AuroraPageHeader';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function HelpCenterPage() {
  const [query, setQuery] = useState('');
  const [summary, setSummary] = useState<any>(null);
  const router = useRouter();

  const categories = [
    { icon: '🚀', label: 'Getting Started', href: '/help/articles?category=GETTING_STARTED' },
    { icon: '💰', label: 'Finance & Accounting', href: '/help/articles?category=FINANCE' },
    { icon: '⛽', label: 'Petroleum Operations', href: '/help/articles?category=PETROLEUM' },
    { icon: '🛒', label: 'Sales & Inventory', href: '/help/articles?category=SALES' },
    { icon: '👥', label: 'HR & Payroll', href: '/help/articles?category=HR' },
    { icon: '🔒', label: 'Security & Admin', href: '/help/articles?category=SECURITY' },
  ];

  const search = () => {
    if (query.trim()) router.push(`/help/search?q=${encodeURIComponent(query.trim())}`);
  };

  useEffect(() => {
    fetch('/api/backend/documentation/summary')
      .then((r) => r.json())
      .then((d) => setSummary(d?.data ?? d))
      .catch(() => {});
  }, []);

  return (
    <AuroraPage>
      <AuroraPageHeader title="Help Center" subtitle="Find answers, guides, and documentation" />
      <div className="p-6 space-y-6">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-xl p-8 text-white">
          <h2 className="text-2xl font-bold mb-2">How can we help you?</h2>
          <p className="text-blue-100 mb-4">Search our help articles, user manuals, and guides</p>
          <div className="flex gap-2 max-w-lg">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && search()}
              placeholder="Search help articles..."
              className="flex-1 px-4 py-2 rounded-lg text-gray-900 bg-white border-0 focus:ring-2 focus:ring-blue-300"
            />
            <button
              onClick={search}
              className="px-4 py-2 bg-white text-blue-700 font-medium rounded-lg hover:bg-blue-50"
            >
              Search
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {categories.map((cat) => (
            <Link
              key={cat.label}
              href={cat.href}
              className="block bg-white dark:bg-gray-800 rounded-lg p-5 border border-gray-200 dark:border-gray-700 hover:border-blue-500 transition-colors"
            >
              <div className="text-2xl mb-2">{cat.icon}</div>
              <h3 className="font-semibold text-gray-900 dark:text-white">{cat.label}</h3>
            </Link>
          ))}
        </div>

        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Published Manuals', value: summary.publishedManuals ?? 0 },
              { label: 'Published Articles', value: summary.publishedArticles ?? 0 },
              { label: 'Active Walkthroughs', value: summary.walkthroughs?.active ?? 0 },
              { label: 'Helpfulness Rate', value: `${summary.articles?.helpfulnessRate ?? 0}%` },
            ].map((card) => (
              <div
                key={card.label}
                className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700"
              >
                <div className="text-2xl font-bold text-gray-900 dark:text-white">{card.value}</div>
                <div className="text-sm text-gray-500 mt-1">{card.label}</div>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-3 gap-4">
          <Link
            href="/help/manuals"
            className="block bg-white dark:bg-gray-800 rounded-lg p-5 border border-gray-200 dark:border-gray-700 hover:border-blue-500 transition-colors text-center"
          >
            <div className="text-3xl mb-2">📚</div>
            <h3 className="font-semibold text-gray-900 dark:text-white">User Manuals</h3>
            <p className="text-xs text-gray-500 mt-1">Complete role-based guides</p>
          </Link>
          <Link
            href="/help/articles"
            className="block bg-white dark:bg-gray-800 rounded-lg p-5 border border-gray-200 dark:border-gray-700 hover:border-blue-500 transition-colors text-center"
          >
            <div className="text-3xl mb-2">📄</div>
            <h3 className="font-semibold text-gray-900 dark:text-white">Help Articles</h3>
            <p className="text-xs text-gray-500 mt-1">Quick answers and how-tos</p>
          </Link>
          <Link
            href="/training"
            className="block bg-white dark:bg-gray-800 rounded-lg p-5 border border-gray-200 dark:border-gray-700 hover:border-blue-500 transition-colors text-center"
          >
            <div className="text-3xl mb-2">🎓</div>
            <h3 className="font-semibold text-gray-900 dark:text-white">Training</h3>
            <p className="text-xs text-gray-500 mt-1">Courses and walkthroughs</p>
          </Link>
        </div>
      </div>
    </AuroraPage>
  );
}
