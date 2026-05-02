'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Btn, PageSpinner } from '@/components/ui';

interface CmaForm {
  formCode: string;
  formName: string;
  formNameSwahili: string;
  jurisdiction: string;
  generatedAt: string;
  dispute: {
    disputeNumber: string;
    type: string;
    status: string;
    raisedAt: string;
    summary: string;
    initialPosition: string | null;
    mediationOutcome: string | null;
    cmaReferenceNumber: string | null;
    cmaArbitrator: string | null;
    cmaHearingDate: string | null;
  };
  employer: { name: string; tin: string | null; brelaRegNumber: string | null; registeredAddress: string | null; postalAddress: string | null };
  employee: {
    employeeCode: string;
    fullName: string;
    nida: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    position: string | null;
    department: string | null;
    hireDate: string | null;
    baseSalary: number | null;
    salaryCurrency: string;
  };
  raisedBy: { fullName: string } | null;
  mediatedBy: { fullName: string } | null;
  disciplinaryHistory: Array<{ actionNumber: string; type: string; issuedAt: string; reason: string; status: string }>;
}

function fmtDate(d?: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
}

export default function CmaReferralPage() {
  const params = useParams();
  const router = useRouter();
  const disputeId = params.disputeId as string;
  const [data, setData] = useState<CmaForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!disputeId) return;
    setLoading(true);
    fetch(`/api/backend/hr/ccm-notices/cma-referral/${disputeId}`)
      .then(r => r.json())
      .then(j => setData(j.data ?? j))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [disputeId]);

  if (loading) return <PageSpinner />;
  if (error || !data) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error || 'Form not found'}</div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .cma-paper, .cma-paper * { visibility: visible; }
          .cma-paper { position: absolute; inset: 0; margin: 0; box-shadow: none; }
          .no-print { display: none !important; }
        }
        .cma-paper { font-family: 'Times New Roman', serif; color: #1a1a1a; background: white; }
        .cma-paper h1 { font-size: 16pt; font-weight: bold; text-align: center; }
        .cma-paper h2 { font-size: 11pt; font-weight: bold; text-transform: uppercase; margin-top: 12pt; }
        .cma-paper .legal { font-size: 10pt; line-height: 1.5; }
        .cma-paper table { width: 100%; border-collapse: collapse; }
        .cma-paper td { padding: 4pt 6pt; vertical-align: top; font-size: 10pt; }
        .cma-paper td.label { font-weight: bold; width: 30%; }
        .cma-paper .signature-line { border-bottom: 1px solid #333; width: 200pt; height: 20pt; }
      `}</style>

      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between no-print">
          <Btn variant="secondary" size="sm" onClick={() => router.back()}>← Back</Btn>
          <Btn variant="primary" size="sm" onClick={() => window.print()}>Print / Save as PDF</Btn>
        </div>

        <div className="cma-paper mx-auto max-w-4xl bg-white shadow-md rounded-lg p-12">
          <div className="text-center mb-6">
            <div className="text-xs text-slate-500 mb-1">Commission for Mediation & Arbitration · Tume ya Usuluhishi na Uamuzi</div>
            <h1>{data.formCode} — Referral of Dispute</h1>
            <div className="text-sm italic mt-1">{data.formNameSwahili}</div>
            <div className="text-xs mt-2 text-slate-500">{data.jurisdiction}</div>
          </div>

          <h2>1. Dispute particulars / Maelezo ya mgogoro</h2>
          <table>
            <tbody>
              <tr><td className="label">Internal dispute #:</td><td>{data.dispute.disputeNumber}</td></tr>
              <tr><td className="label">Type / Aina:</td><td>{data.dispute.type.replace(/_/g, ' ')}</td></tr>
              <tr><td className="label">Status / Hali:</td><td>{data.dispute.status.replace(/_/g, ' ')}</td></tr>
              <tr><td className="label">Raised on / Iliibuliwa:</td><td>{fmtDate(data.dispute.raisedAt)}</td></tr>
              <tr><td className="label">CMA reference #:</td><td>{data.dispute.cmaReferenceNumber ?? '__________________'}</td></tr>
              <tr><td className="label">Arbitrator / Msuluhishi:</td><td>{data.dispute.cmaArbitrator ?? '__________________'}</td></tr>
              <tr><td className="label">Hearing date / Tarehe:</td><td>{fmtDate(data.dispute.cmaHearingDate)}</td></tr>
            </tbody>
          </table>

          <h2>2. Summary / Muhtasari</h2>
          <p className="legal">{data.dispute.summary}</p>
          {data.dispute.initialPosition && (
            <>
              <div className="legal mt-3"><strong>Initial position / Madai ya awali:</strong></div>
              <p className="legal">{data.dispute.initialPosition}</p>
            </>
          )}
          {data.dispute.mediationOutcome && (
            <>
              <div className="legal mt-3"><strong>Internal mediation outcome / Matokeo ya usuluhishi wa ndani:</strong></div>
              <p className="legal">{data.dispute.mediationOutcome}</p>
            </>
          )}

          <h2>3. Employer / Mwajiri</h2>
          <table>
            <tbody>
              <tr><td className="label">Name:</td><td>{data.employer.name}</td></tr>
              <tr><td className="label">TIN:</td><td>{data.employer.tin ?? '—'}</td></tr>
              <tr><td className="label">BRELA reg #:</td><td>{data.employer.brelaRegNumber ?? '—'}</td></tr>
              <tr><td className="label">Registered address:</td><td>{data.employer.registeredAddress ?? '—'}</td></tr>
              <tr><td className="label">Postal address:</td><td>{data.employer.postalAddress ?? '—'}</td></tr>
            </tbody>
          </table>

          <h2>4. Employee / Mfanyakazi</h2>
          <table>
            <tbody>
              <tr><td className="label">Full name:</td><td>{data.employee.fullName}</td></tr>
              <tr><td className="label">Employee code:</td><td>{data.employee.employeeCode}</td></tr>
              <tr><td className="label">NIDA:</td><td>{data.employee.nida ?? '—'}</td></tr>
              <tr><td className="label">Address:</td><td>{data.employee.address ?? '—'}</td></tr>
              <tr><td className="label">Phone:</td><td>{data.employee.phone ?? '—'}</td></tr>
              <tr><td className="label">Email:</td><td>{data.employee.email ?? '—'}</td></tr>
              <tr><td className="label">Position:</td><td>{data.employee.position ?? '—'}</td></tr>
              <tr><td className="label">Department:</td><td>{data.employee.department ?? '—'}</td></tr>
              <tr><td className="label">Hire date:</td><td>{fmtDate(data.employee.hireDate)}</td></tr>
              <tr><td className="label">Salary:</td><td>{data.employee.baseSalary != null ? `${data.employee.salaryCurrency} ${data.employee.baseSalary.toLocaleString('en-TZ')}` : '—'}</td></tr>
            </tbody>
          </table>

          {data.disciplinaryHistory.length > 0 && (
            <>
              <h2>5. Disciplinary history / Historia ya nidhamu</h2>
              <table>
                <thead>
                  <tr style={{ background: '#f3f4f6' }}>
                    <td className="label">Action #</td>
                    <td className="label">Type</td>
                    <td className="label">Date</td>
                    <td className="label">Reason</td>
                  </tr>
                </thead>
                <tbody>
                  {data.disciplinaryHistory.map(d => (
                    <tr key={d.actionNumber}>
                      <td>{d.actionNumber}</td>
                      <td>{d.type.replace(/_/g, ' ')}</td>
                      <td>{fmtDate(d.issuedAt)}</td>
                      <td>{d.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <h2>6. Signatures / Sahihi</h2>
          <table>
            <tbody>
              <tr>
                <td>
                  <div className="text-xs">Filed by / Imewasilishwa na:</div>
                  <div className="signature-line mt-2"></div>
                  <div className="text-xs mt-1">Name, position & date</div>
                </td>
                <td>
                  <div className="text-xs">CMA officer / Afisa wa CMA:</div>
                  <div className="signature-line mt-2"></div>
                  <div className="text-xs mt-1">Name & date</div>
                </td>
              </tr>
            </tbody>
          </table>

          <div className="text-xs text-slate-500 mt-8">
            Filed by {data.raisedBy?.fullName ?? '—'}{data.mediatedBy && ` · Internal mediator: ${data.mediatedBy.fullName}`}
            <br />Generated {new Date(data.generatedAt).toLocaleString('en-GB')}
          </div>
        </div>
      </div>
    </>
  );
}
