import type { Faq } from '@/lib/site';

type FaqListProps = {
  faqs: readonly Faq[];
};

export default function FaqList({ faqs }: FaqListProps) {
  return (
    <div className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
      {faqs.map((faq) => (
        <details key={faq.question} className="group px-5 py-4 open:bg-slate-50">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-sm font-semibold text-ink-900">
            <span>{faq.question}</span>
            <span className="text-gold-500 transition-transform group-open:rotate-45" aria-hidden="true">
              +
            </span>
          </summary>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">{faq.answer}</p>
        </details>
      ))}
    </div>
  );
}
