'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Btn, PageSpinner } from '@/components/ui';

/**
 * Bilingual A4-printable Tanzania Form 1 — Notice of Termination of Employment.
 * Uses CSS print styles; operator hits "Print / Save as PDF" via the browser.
 */

interface Form1Payload {
  formCode: string;
  formName: string;
  formNameSwahili: string;
  jurisdiction: string;
  generatedAt: string;
  employer: { name: string; tin: string | null; brelaRegNumber: string | null; registeredAddress: string | null; postalAddress: string | null };
  employee: {
    employeeCode: string;
    fullName: string;
    nida: string | null;
    passport: string | null;
    nationality: string | null;
    gender: string;
    dateOfBirth: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
  };
  employment: {
    position: string | null;
    department: string | null;
    branch: string | null;
    location: string | null;
    hireDate: string | null;
    tenureMonths: number | null;
    contractType: string | null;
    baseSalary: number | null;
    salaryCurrency: string;
  };
  disciplinaryHistory: Array<{ actionNumber: string; type: string; issuedAt: string; reason: string; status: string }>;
  operatorFields: string[];
}

function fmtDate(d?: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
}

export default function Form1Page() {
  const params = useParams();
  const router = useRouter();
  const employeeId = params.employeeId as string;
  const [data, setData] = useState<Form1Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!employeeId) return;
    setLoading(true);
    fetch(`/api/backend/hr/ccm-notices/termination/${employeeId}`)
      .then(r => r.json())
      .then(j => setData(j.data ?? j))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [employeeId]);

  if (loading) return <PageSpinner />;
  if (error || !data) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error || 'Notice not found'}</div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .form1-paper, .form1-paper * { visibility: visible; }
          .form1-paper { position: absolute; inset: 0; margin: 0; box-shadow: none; }
          .no-print { display: none !important; }
        }
        .form1-paper { font-family: 'Times New Roman', serif; color: #1a1a1a; background: white; }
        .form1-paper h1 { font-size: 16pt; font-weight: bold; text-align: center; }
        .form1-paper h2 { font-size: 11pt; font-weight: bold; text-transform: uppercase; margin-top: 12pt; }
        .form1-paper .legal { font-size: 10pt; line-height: 1.5; }
        .form1-paper table { width: 100%; border-collapse: collapse; }
        .form1-paper td { padding: 4pt 6pt; vertical-align: top; font-size: 10pt; }
        .form1-paper td.label { font-weight: bold; width: 30%; }
        .form1-paper .signature-line { border-bottom: 1px solid #333; width: 200pt; height: 20pt; }
      `}</style>

      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between no-print">
          <Btn variant="secondary" size="sm" onClick={() => router.back()}>← Back</Btn>
          <Btn variant="primary" size="sm" onClick={() => window.print()}>Print / Save as PDF</Btn>
        </div>

        <div className="form1-paper mx-auto max-w-4xl bg-white shadow-md rounded-lg p-12">
          <div className="text-center mb-6">
            <div className="text-xs text-slate-500 mb-1">United Republic of Tanzania · Jamhuri ya Muungano wa Tanzania</div>
            <h1>{data.formCode} — Notice of Termination of Employment</h1>
            <div className="text-sm italic mt-1">{data.formNameSwahili}</div>
            <div className="text-xs mt-2 text-slate-500">{data.jurisdiction}</div>
          </div>

          <h2>1. Employer / Mwajiri</h2>
          <table>
            <tbody>
              <tr><td className="label">Name / Jina:</td><td>{data.employer.name}</td></tr>
              <tr><td className="label">TIN:</td><td>{data.employer.tin ?? '—'}</td></tr>
              <tr><td className="label">BRELA reg #:</td><td>{data.employer.brelaRegNumber ?? '—'}</td></tr>
              <tr><td className="label">Registered address / Anwani:</td><td>{data.employer.registeredAddress ?? '—'}</td></tr>
              <tr><td className="label">Postal address:</td><td>{data.employer.postalAddress ?? '—'}</td></tr>
            </tbody>
          </table>

          <h2>2. Employee / Mfanyakazi</h2>
          <table>
            <tbody>
              <tr><td className="label">Full name / Jina kamili:</td><td>{data.employee.fullName}</td></tr>
              <tr><td className="label">Employee code:</td><td>{data.employee.employeeCode}</td></tr>
              <tr><td className="label">NIDA:</td><td>{data.employee.nida ?? '—'}</td></tr>
              {data.employee.passport && <tr><td className="label">Passport:</td><td>{data.employee.passport}</td></tr>}
              <tr><td className="label">Nationality / Uraia:</td><td>{data.employee.nationality ?? '—'}</td></tr>
              <tr><td className="label">Gender / Jinsia:</td><td>{data.employee.gender}</td></tr>
              <tr><td className="label">Date of birth:</td><td>{fmtDate(data.employee.dateOfBirth)}</td></tr>
              <tr><td className="label">Address / Anwani:</td><td>{data.employee.address ?? '—'}</td></tr>
              <tr><td className="label">Phone:</td><td>{data.employee.phone ?? '—'}</td></tr>
              <tr><td className="label">Email:</td><td>{data.employee.email ?? '—'}</td></tr>
            </tbody>
          </table>

          <h2>3. Employment particulars / Maelezo ya ajira</h2>
          <table>
            <tbody>
              <tr><td className="label">Position / Cheo:</td><td>{data.employment.position ?? '—'}</td></tr>
              <tr><td className="label">Department / Idara:</td><td>{data.employment.department ?? '—'}</td></tr>
              <tr><td className="label">Branch / Tawi:</td><td>{data.employment.branch ?? '—'}{data.employment.location && ` · ${data.employment.location}`}</td></tr>
              <tr><td className="label">Hire date / Tarehe ya kuajiriwa:</td><td>{fmtDate(data.employment.hireDate)}</td></tr>
              <tr><td className="label">Tenure / Muda wa ajira:</td><td>{data.employment.tenureMonths != null ? `${data.employment.tenureMonths} months` : '—'}</td></tr>
              <tr><td className="label">Contract type / Aina ya mkataba:</td><td>{data.employment.contractType ?? '—'}</td></tr>
              <tr><td className="label">Base salary / Mshahara:</td><td>{data.employment.baseSalary != null ? `${data.employment.salaryCurrency} ${data.employment.baseSalary.toLocaleString('en-TZ')}` : '—'}</td></tr>
            </tbody>
          </table>

          {data.disciplinaryHistory.length > 0 && (
            <>
              <h2>4. Disciplinary history / Historia ya nidhamu</h2>
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

          <h2>5. Notice of termination / Notisi ya kusitisha ajira</h2>
          <p className="legal">
            In accordance with the Employment & Labour Relations Act, 2004, this is to formally notify the employee
            named above that their employment with the employer is being terminated. Particulars to be completed below.
          </p>
          <p className="legal italic mt-2">
            Kulingana na Sheria ya Ajira na Mahusiano Kazini, 2004, hii ni notisi rasmi ya kumjulisha mfanyakazi
            aliyetajwa hapo juu kuwa ajira yake na mwajiri inasitishwa. Maelezo yajazwe hapa chini.
          </p>

          <table className="mt-3">
            <tbody>
              {data.operatorFields.map(f => (
                <tr key={f}>
                  <td className="label" style={{ width: '40%' }}>{f}:</td>
                  <td><div style={{ borderBottom: '1px dotted #333', height: '18pt' }} /></td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2>6. Signatures / Sahihi</h2>
          <table>
            <tbody>
              <tr>
                <td>
                  <div className="text-xs">Employer representative / Mwakilishi wa mwajiri:</div>
                  <div className="signature-line mt-2"></div>
                  <div className="text-xs mt-1">Name & date / Jina na tarehe</div>
                </td>
                <td>
                  <div className="text-xs">Employee acknowledgement / Uthibitisho wa mfanyakazi:</div>
                  <div className="signature-line mt-2"></div>
                  <div className="text-xs mt-1">Name & date / Jina na tarehe</div>
                </td>
              </tr>
              <tr>
                <td>
                  <div className="text-xs">Witness / Shahidi:</div>
                  <div className="signature-line mt-2"></div>
                  <div className="text-xs mt-1">Name & date / Jina na tarehe</div>
                </td>
                <td></td>
              </tr>
            </tbody>
          </table>

          <div className="text-xs text-slate-500 mt-8">
            Generated {new Date(data.generatedAt).toLocaleString('en-GB')} · This is a system-generated draft.
            <br />Imetengenezwa na mfumo · Hii ni rasimu inayohitaji kuhakikiwa.
          </div>
        </div>
      </div>
    </>
  );
}
