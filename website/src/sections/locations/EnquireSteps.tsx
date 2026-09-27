export type EnquireStep = { title: string; body: string };

/**
 * How an enquiry travels, as numbered steps (the company template's
 * pattern beside its form): a small label, then each step's number in a
 * hairline ring, its title and one line. The caller sets the space above.
 */
export function EnquireSteps({ label, steps, className }: { label: string; steps: readonly EnquireStep[]; className?: string }) {
  return (
    <div className={className}>
      <h3 className="text-eyebrow text-fg-muted">{label}</h3>
      <ol role="list" className="mt-4 space-y-5">
        {steps.map((step, index) => (
          <li key={step.title} className="flex gap-4">
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-full border border-line-strong text-caption font-semibold tabular-nums text-fg"
            >
              {index + 1}
            </span>
            <p className="pt-1 text-body text-fg-muted">
              <span className="font-semibold text-fg">{step.title}.</span> {step.body}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
