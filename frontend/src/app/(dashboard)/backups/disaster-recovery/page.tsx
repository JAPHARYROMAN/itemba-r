'use client';

import Link from 'next/link';

const recoveryObjectives = [
  { label: 'Target RTO', value: '< 4 hours', detail: 'Maximum acceptable time to restore core ERP access.' },
  { label: 'Target RPO', value: '< 30 minutes', detail: 'Maximum acceptable production data loss after failover.' },
  { label: 'Critical Services', value: '5', detail: 'Postgres, Redis, backend API, frontend, Caddy edge routing.' },
  { label: 'Evidence Cadence', value: 'Monthly', detail: 'Restore test evidence should be reviewed and retained.' },
];

const runbookSteps = [
  'Freeze non-essential access and confirm the incident owner.',
  'Identify the last successful backup run and validate its storage target.',
  'Restore database to the recovery host and run migration compatibility checks.',
  'Start Redis, backend, frontend, and Caddy in recovery order.',
  'Verify health endpoints, sign-in, sales order creation, reports, and print flows.',
  'Record the recovery timestamp, restored backup ID, validation evidence, and approver.',
];

const readinessChecks = [
  { label: 'Backup jobs active', href: '/backups/jobs', owner: 'Platform admin' },
  { label: 'Recent successful backup run exists', href: '/backups/runs', owner: 'Platform admin' },
  { label: 'Restore test evidence is current', href: '/backups/restore-tests', owner: 'IT operations' },
  { label: 'Critical accounts and permissions reviewed', href: '/security/user-profiles', owner: 'Security admin' },
  { label: 'Cash, sales, purchase, and report smoke checks documented', href: '/reports', owner: 'Business owner' },
];

const contactRows = [
  { role: 'Incident owner', team: 'Group Administrator', action: 'Declare severity and approve recovery.' },
  { role: 'Database owner', team: 'Platform / DBA', action: 'Restore Postgres and validate data consistency.' },
  { role: 'Application owner', team: 'ITEMBA-R support', action: 'Deploy services and run application smoke tests.' },
  { role: 'Business validator', team: 'Finance / Operations', action: 'Confirm sales, purchases, stock, and reports.' },
];

export default function DisasterRecoveryPage() {
  return (
    <div className="p-6">
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Disaster Recovery</h1>
          <p className="mt-1 max-w-3xl text-gray-500">
            Recovery objectives, restart order, validation checks, and evidence links for ITEMBA-R
            production continuity.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/backups/runs"
            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Backup Runs
          </Link>
          <Link
            href="/backups/restore-tests"
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Restore Tests
          </Link>
        </div>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {recoveryObjectives.map((card) => (
          <div key={card.label} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              {card.label}
            </div>
            <div className="mt-2 text-2xl font-bold text-gray-900">{card.value}</div>
            <p className="mt-2 text-sm text-gray-500">{card.detail}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-5 py-4">
            <h2 className="font-semibold text-gray-900">Recovery Runbook</h2>
            <p className="mt-1 text-sm text-gray-500">
              Follow this sequence during a production outage or recovery drill.
            </p>
          </div>
          <ol className="divide-y divide-gray-100">
            {runbookSteps.map((step, index) => (
              <li key={step} className="flex gap-4 px-5 py-4">
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-900 text-sm font-semibold text-white">
                  {index + 1}
                </span>
                <p className="pt-1 text-sm text-gray-700">{step}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-5 py-4">
            <h2 className="font-semibold text-gray-900">Readiness Checklist</h2>
            <p className="mt-1 text-sm text-gray-500">
              Each item should have current evidence before production sign-off.
            </p>
          </div>
          <div className="divide-y divide-gray-100">
            {readinessChecks.map((check) => (
              <Link
                key={check.label}
                href={check.href}
                className="block px-5 py-4 transition-colors hover:bg-gray-50"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-medium text-gray-900">{check.label}</div>
                    <div className="mt-1 text-xs text-gray-500">Owner: {check.owner}</div>
                  </div>
                  <span className="text-xs font-semibold uppercase text-gray-400">Open</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>

      <section className="mt-6 rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-5 py-4">
          <h2 className="font-semibold text-gray-900">Recovery Roles</h2>
          <p className="mt-1 text-sm text-gray-500">
            Use these role assignments to keep recovery decisions, technical work, and business
            validation separate.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <th className="px-5 py-3">Role</th>
                <th className="px-5 py-3">Team</th>
                <th className="px-5 py-3">Recovery Responsibility</th>
              </tr>
            </thead>
            <tbody>
              {contactRows.map((row) => (
                <tr key={row.role} className="border-t border-gray-100">
                  <td className="px-5 py-3 font-medium text-gray-900">{row.role}</td>
                  <td className="px-5 py-3 text-gray-600">{row.team}</td>
                  <td className="px-5 py-3 text-gray-600">{row.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
