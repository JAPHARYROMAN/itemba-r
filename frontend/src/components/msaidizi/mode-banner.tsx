/**
 * What the panel says about itself.
 *
 * Three facts a user cannot discover any other way, and each of them is a lie
 * waiting to happen if it is written into the markup instead of read from
 * `GET /msaidizi/capabilities`:
 *
 *   1. WHICH MODE the deployment is in. The standing line today is "Msaidizi can
 *      read what you can read. It cannot change anything." — true under
 *      `read-only`, and false the morning someone sets MSAIDIZI_WRITE_MODE=amber.
 *      Nobody edits a frontend file when they change an environment variable, so
 *      the sentence has to change itself. `writeMode` drives it; hardcoding it is
 *      the single easiest way to ship a lie later.
 *
 *   2. WHETHER NARROWING IS ACTIVE. A caller whose permitted set exceeds the
 *      per-run tool budget is served a subset chosen by relevance to the words
 *      they used — and a run emits no signal at all that this happened. That
 *      silence is the mechanism behind the worst failure in the design: answering
 *      confidently out of a set that never contained the tool holding the answer.
 *      A manager wondering why it "did not think of" something deserves to be
 *      told, rather than left to conclude the assistant is stupid or the data is
 *      missing.
 *
 *   3. WHETHER IT IS SWITCHED OFF AT ALL. The capabilities endpoint is
 *      deliberately not gated on `enabled` — it answers while the module is off,
 *      which is the whole point of it. So the off state is renderable, and a user
 *      should read it here rather than discover it by firing a question into a
 *      503.
 *
 * The second standing line — that reads are not audited — is not derived from
 * anything, because there is nothing to derive it from: `api_request_logs` exists
 * and nothing in the system writes to it. It is uncomfortable and it is true, and
 * a UI that implies otherwise is lying about the one property the whole design
 * was built to have. It is a constant here so that the day the interceptor lands,
 * one string changes.
 *
 * Everything rendered here is server-derived text and numbers. Nothing from a
 * model turn reaches this component, but the rule holds anyway: text, never
 * markup, and no `dangerouslySetInnerHTML` anywhere in this feature.
 */

import React from 'react';
import type {
  MsaidiziCapabilities,
  MsaidiziWriteMode,
  ReversibilityTier,
} from '@/lib/msaidizi-types';

/**
 * The second standing line of the plan's §2.9, kept as a constant so the day
 * `api_request_logs` is populated there is exactly one string to change.
 */
export const MSAIDIZI_AUDIT_NOTE =
  'What Msaidizi read is not recorded in the audit log. Changes are; reads are not, yet.';

export type MsaidiziModeTone = 'unknown' | 'off' | 'read' | 'write' | 'irreversible';

export interface MsaidiziModeDescription {
  tone: MsaidiziModeTone;
  /** Short glanceable label for the chip: "Read-only", "Off", … */
  label: string;
  /** The standing sentence. Driven by `writeMode`, never written into markup. */
  headline: string;
  /** The sentence under it, or null when the headline says everything. */
  detail: string | null;
}

/**
 * The mode the deployment is actually in.
 *
 * `writeMode` is the field to trust — the backend derives `allowedTiers` from it
 * by a fixed table. The tier fallback exists only so that a mode string this
 * build has never heard of degrades to the closest honest sentence rather than
 * to "read-only", which is the dangerous direction to guess in: a UI that
 * under-reports what the assistant may do is how somebody is surprised by a
 * write.
 */
export function effectiveWriteMode(capabilities: MsaidiziCapabilities): MsaidiziWriteMode {
  const declared = capabilities.writeMode;
  if (declared === 'read-only' || declared === 'amber' || declared === 'red') return declared;

  const tiers: ReversibilityTier[] = capabilities.allowedTiers ?? [];
  if (tiers.includes('red')) return 'red';
  if (tiers.includes('amber')) return 'amber';
  return 'read-only';
}

export function describeMsaidiziMode(
  capabilities: MsaidiziCapabilities | null,
): MsaidiziModeDescription {
  if (!capabilities) {
    return {
      tone: 'unknown',
      label: 'Checking',
      headline: 'Checking what Msaidizi can do here.',
      detail: null,
    };
  }

  if (!capabilities.enabled) {
    // Not a fault and not a permission problem: the route exists and it is
    // switched off. Saying which is the difference between "ask an administrator
    // to turn this on" and "something is broken".
    return {
      tone: 'off',
      label: 'Off',
      headline: 'Msaidizi is switched off in this deployment.',
      detail:
        'Nothing can be asked of it until someone turns it back on. This is a configuration ' +
        'choice rather than a fault, and it is not about your permissions.',
    };
  }

  switch (effectiveWriteMode(capabilities)) {
    case 'amber':
      return {
        tone: 'write',
        label: 'Can make changes',
        headline: 'Msaidizi can read what you can read, and can make changes you could undo.',
        detail:
          'Anything irreversible is out of its reach in this deployment. Every change is made ' +
          'with your permissions and lands in the audit log under your name.',
      };
    case 'red':
      return {
        tone: 'irreversible',
        label: 'Can make irreversible changes',
        headline: 'Msaidizi can read what you can read, and can make changes on your behalf.',
        detail:
          'Irreversible actions stop and ask you first — nothing at that tier happens without ' +
          'your explicit approval. Everything it changes lands in the audit log under your ' +
          'name, and there is no undo.',
      };
    default:
      return {
        tone: 'read',
        label: 'Read-only',
        headline: 'Msaidizi can read what you can read. It cannot change anything.',
        detail:
          'It acts with your permissions and no one else’s, so it sees exactly what you would ' +
          'see and nothing you would not.',
      };
  }
}

export interface MsaidiziNarrowingDescription {
  active: boolean;
  headline: string;
  detail: string | null;
}

/**
 * Whether this caller's tool set is being cut down before the model ever sees it.
 *
 * Three states, and the third is the one an implementer forgets: a caller who
 * holds `msaidizi.use` and nothing else reaches zero capabilities. The assistant
 * is enabled, it answers, and it can look nothing up — which reads exactly like a
 * broken deployment unless it is said out loud.
 */
export function describeMsaidiziNarrowing(
  capabilities: MsaidiziCapabilities | null,
): MsaidiziNarrowingDescription | null {
  if (!capabilities || !capabilities.enabled) return null;

  const narrowing = capabilities.narrowing;
  if (!narrowing) return null;

  const permitted = narrowing.permitted;
  const perRun = narrowing.perRun;

  if (permitted === 0) {
    return {
      active: false,
      headline: 'Msaidizi can reach nothing on your behalf.',
      detail:
        'You hold permission to talk to it, but none of the permissions it would need to look ' +
        'anything up. It will not be able to answer questions about your records.',
    };
  }

  if (!narrowing.active) {
    return {
      active: false,
      headline: `All ${permitted} tools you can reach are offered on every question.`,
      detail: null,
    };
  }

  return {
    active: true,
    headline: `Msaidizi sees ${perRun} of the ${permitted} tools you can reach on any one question.`,
    detail:
      'Which ones it sees is chosen by how well they match the words you used, so the same ' +
      'question phrased differently reaches different tools. If it did not think of something, ' +
      'name that thing and ask again.',
  };
}

export interface MsaidiziAvailability {
  /** Whether firing a run is worth attempting at all. */
  canAsk: boolean;
  /** Why not, in a sentence fit to put on screen. Null when it can. */
  reason: string | null;
}

/**
 * The gate the composer should consult before sending anything.
 *
 * Its whole job is to stop the user learning that the module is off by watching a
 * question fail. `canAsk` is false while capabilities are still unknown too —
 * optimistically firing into an unknown deployment is the same mistake one beat
 * earlier.
 *
 * `error` is the second argument because null capabilities is TWO facts, and on
 * its own this function cannot tell them apart: the check has not answered yet,
 * or it answered with a failure. Without it the confident reading is "still
 * checking", which on the failure path describes a request that will never
 * arrive and leaves the reader waiting for it. Callers that do not track the
 * failure may omit it and get the old answer; callers that do should pass it.
 */
export function msaidiziAvailability(
  capabilities: MsaidiziCapabilities | null,
  error?: string | null,
): MsaidiziAvailability {
  if (!capabilities) {
    return {
      canAsk: false,
      reason: error
        ? 'Msaidizi could not be asked what it is allowed to do here, so nothing can be sent yet.'
        : 'Still checking whether Msaidizi is available here.',
    };
  }
  if (!capabilities.enabled) {
    return { canAsk: false, reason: 'Msaidizi is switched off in this deployment.' };
  }
  return { canAsk: true, reason: null };
}

const TONE_STYLE: Record<
  MsaidiziModeTone,
  { background: string; border: string; accent: string; chipText: string }
> = {
  unknown: {
    background: 'var(--aurora-bg-subtle)',
    border: 'var(--aurora-border)',
    accent: 'var(--aurora-text-muted)',
    chipText: 'var(--aurora-text-secondary)',
  },
  off: {
    background: 'var(--aurora-bg-muted)',
    border: 'var(--aurora-border-strong)',
    accent: 'var(--aurora-text-muted)',
    chipText: 'var(--aurora-text-secondary)',
  },
  read: {
    background: 'var(--aurora-info-bg)',
    border: 'var(--aurora-border)',
    accent: 'var(--aurora-info)',
    chipText: 'var(--aurora-info-text)',
  },
  write: {
    background: 'var(--aurora-warning-bg)',
    border: 'var(--aurora-warning)',
    accent: 'var(--aurora-warning)',
    chipText: 'var(--aurora-warning-text)',
  },
  irreversible: {
    background: 'var(--aurora-danger-bg)',
    border: 'var(--aurora-danger)',
    accent: 'var(--aurora-danger)',
    chipText: 'var(--aurora-danger-text)',
  },
};

export interface MsaidiziModeBannerProps {
  capabilities: MsaidiziCapabilities | null;
  /** Message from a failed capabilities fetch. Rendered instead of guessing. */
  error?: string | null;
  className?: string;
}

/**
 * The standing statement at the top of the page.
 *
 * Four lines at most, all load-bearing: what it can do, how much of the system it
 * can see, that its reads leave no trail, and — when it is off — that it is off.
 * None of them are decoration, and none of them are hardcoded except the audit
 * note, which has nothing to derive from.
 */
export function MsaidiziModeBanner({
  capabilities,
  error = null,
  className = '',
}: MsaidiziModeBannerProps) {
  const mode = describeMsaidiziMode(capabilities);
  const narrowing = describeMsaidiziNarrowing(capabilities);
  const enabled = Boolean(capabilities && capabilities.enabled);
  const tone = TONE_STYLE[mode.tone];

  // A failed capabilities call is not a licence to fall back to the read-only
  // sentence. Not knowing is its own state and is stated as one.
  if (error) {
    return (
      <section
        aria-label="What Msaidizi can do"
        className={`rounded-xl px-4 py-3 ${className}`}
        style={{
          background: 'var(--aurora-bg-muted)',
          border: '1px solid var(--aurora-border-strong)',
        }}
      >
        <p className="text-[13px] font-medium" style={{ color: 'var(--aurora-text)' }}>
          Could not check what Msaidizi can do here.
        </p>
        <p className="mt-1 text-[12px]" style={{ color: 'var(--aurora-text-muted)' }}>
          {error}
        </p>
        <p className="mt-1 text-[12px]" style={{ color: 'var(--aurora-text-muted)' }}>
          Until that answers, this page cannot honestly say what the assistant is allowed to do, so
          it says nothing rather than guessing.
        </p>
      </section>
    );
  }

  return (
    <section
      aria-label="What Msaidizi can do"
      className={`rounded-xl px-4 py-3 ${className}`}
      style={{ background: tone.background, border: `1px solid ${tone.border}` }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase"
          style={{ background: 'var(--aurora-card)', color: tone.chipText }}
        >
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: tone.accent }}
          />
          {mode.label}
        </span>
        <p className="text-[13px] font-medium" style={{ color: 'var(--aurora-text)' }}>
          {mode.headline}
        </p>
      </div>

      {mode.detail && (
        <p className="mt-1.5 text-[12px]" style={{ color: 'var(--aurora-text-secondary)' }}>
          {mode.detail}
        </p>
      )}

      {narrowing && (
        <div className="mt-2.5">
          <p
            className="text-[12px] font-medium"
            style={{ color: narrowing.active ? 'var(--aurora-text)' : 'var(--aurora-text-muted)' }}
          >
            {narrowing.headline}
          </p>
          {narrowing.detail && (
            <p className="mt-1 text-[12px]" style={{ color: 'var(--aurora-text-muted)' }}>
              {narrowing.detail}
            </p>
          )}
        </div>
      )}

      {enabled && (
        <p className="mt-2.5 text-[12px]" style={{ color: 'var(--aurora-text-muted)' }}>
          {MSAIDIZI_AUDIT_NOTE}
        </p>
      )}
    </section>
  );
}
