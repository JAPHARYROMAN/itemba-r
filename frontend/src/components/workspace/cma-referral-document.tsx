'use client';
import { CcmHistory } from './ccm-history';
import { cmaPreambleMm, splitHistoryForPrint } from './ccm-page-budget';

export interface CmaForm {
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
  employer: {
    name: string;
    tin: string | null;
    brelaRegNumber: string | null;
    registeredAddress: string | null;
    postalAddress: string | null;
  };
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
  disciplinaryHistoryIncluded?: boolean;
  disciplinaryHistory: Array<{
    actionNumber: string;
    type: string;
    issuedAt: string;
    reason: string;
    status: string;
  }>;
}

function fmtDate(d?: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

export function CmaReferralDocument({ data }: { data: CmaForm }) {
  const history = data.disciplinaryHistoryIncluded === false ? [] : data.disciplinaryHistory;
  const { firstPageItems, overflowItems } = splitHistoryForPrint(
    history,
    cmaPreambleMm({
      hasInitialPosition: Boolean(data.dispute.initialPosition),
      hasMediationOutcome: Boolean(data.dispute.mediationOutcome),
    }),
  );
  const tail = <CmaTail data={data} />;

  return (
    <>
      <div className="ccm-paper ccm-sheet" data-ccm-sheet="1" aria-label="CMA referral draft">
        <div className="text-center mb-6">
          <div className="text-xs text-slate-500 mb-1">
            Commission for Mediation & Arbitration · Tume ya Usuluhishi na Uamuzi
          </div>
          <h2 className="ccm-document-title">{data.formCode} — Referral of Dispute</h2>
          <div className="text-sm italic mt-1">{data.formNameSwahili}</div>
          <div className="text-xs mt-2 text-slate-500">{data.jurisdiction}</div>
        </div>

        <h3>1. Dispute particulars / Maelezo ya mgogoro</h3>
        <table>
          <tbody>
            <tr>
              <td className="label">Internal dispute #:</td>
              <td>{data.dispute.disputeNumber}</td>
            </tr>
            <tr>
              <td className="label">Type / Aina:</td>
              <td>{data.dispute.type.replace(/_/g, ' ')}</td>
            </tr>
            <tr>
              <td className="label">Status / Hali:</td>
              <td>{data.dispute.status.replace(/_/g, ' ')}</td>
            </tr>
            <tr>
              <td className="label">Raised on / Iliibuliwa:</td>
              <td>{fmtDate(data.dispute.raisedAt)}</td>
            </tr>
            <tr>
              <td className="label">CMA reference #:</td>
              <td>{data.dispute.cmaReferenceNumber ?? '__________________'}</td>
            </tr>
            <tr>
              <td className="label">Arbitrator / Msuluhishi:</td>
              <td>{data.dispute.cmaArbitrator ?? '__________________'}</td>
            </tr>
            <tr>
              <td className="label">Hearing date / Tarehe:</td>
              <td>{fmtDate(data.dispute.cmaHearingDate)}</td>
            </tr>
          </tbody>
        </table>

        <h3>2. Summary / Muhtasari</h3>
        <p className="legal">{data.dispute.summary}</p>
        {data.dispute.initialPosition && (
          <>
            <div className="legal mt-3">
              <strong>Initial position / Madai ya awali:</strong>
            </div>
            <p className="legal">{data.dispute.initialPosition}</p>
          </>
        )}
        {data.dispute.mediationOutcome && (
          <>
            <div className="legal mt-3">
              <strong>Internal mediation outcome / Matokeo ya usuluhishi wa ndani:</strong>
            </div>
            <p className="legal">{data.dispute.mediationOutcome}</p>
          </>
        )}

        <h3>3. Employer / Mwajiri</h3>
        <table>
          <tbody>
            <tr>
              <td className="label">Name:</td>
              <td>{data.employer.name}</td>
            </tr>
            <tr>
              <td className="label">TIN:</td>
              <td>{data.employer.tin ?? '—'}</td>
            </tr>
            <tr>
              <td className="label">BRELA reg #:</td>
              <td>{data.employer.brelaRegNumber ?? '—'}</td>
            </tr>
            <tr>
              <td className="label">Registered address:</td>
              <td>{data.employer.registeredAddress ?? '—'}</td>
            </tr>
            <tr>
              <td className="label">Postal address:</td>
              <td>{data.employer.postalAddress ?? '—'}</td>
            </tr>
          </tbody>
        </table>

        <h3>4. Employee / Mfanyakazi</h3>
        <table>
          <tbody>
            <tr>
              <td className="label">Full name:</td>
              <td>{data.employee.fullName}</td>
            </tr>
            <tr>
              <td className="label">Employee code:</td>
              <td>{data.employee.employeeCode}</td>
            </tr>
            <tr>
              <td className="label">NIDA:</td>
              <td>{data.employee.nida ?? '—'}</td>
            </tr>
            <tr>
              <td className="label">Address:</td>
              <td>{data.employee.address ?? '—'}</td>
            </tr>
            <tr>
              <td className="label">Phone:</td>
              <td>{data.employee.phone ?? '—'}</td>
            </tr>
            <tr>
              <td className="label">Email:</td>
              <td>{data.employee.email ?? '—'}</td>
            </tr>
            <tr>
              <td className="label">Position:</td>
              <td>{data.employee.position ?? '—'}</td>
            </tr>
            <tr>
              <td className="label">Department:</td>
              <td>{data.employee.department ?? '—'}</td>
            </tr>
            <tr>
              <td className="label">Hire date:</td>
              <td>{fmtDate(data.employee.hireDate)}</td>
            </tr>
            <tr>
              <td className="label">Salary:</td>
              <td>
                {data.employee.baseSalary != null
                  ? `${data.employee.salaryCurrency} ${data.employee.baseSalary.toLocaleString('en-TZ')}`
                  : '—'}
              </td>
            </tr>
          </tbody>
        </table>

        <CcmHistory
          heading="5. Disciplinary history / Historia ya nidhamu"
          items={firstPageItems}
          included={data.disciplinaryHistoryIncluded}
          overflowCount={overflowItems.length}
        />

        {overflowItems.length === 0 && tail}
      </div>
      {overflowItems.length > 0 && (
        <div
          className="ccm-paper ccm-sheet"
          data-ccm-sheet="2"
          aria-label="CMA referral continuation"
        >
          <CcmHistory
            heading="5. Disciplinary history / Historia ya nidhamu (continued)"
            items={overflowItems}
            included={data.disciplinaryHistoryIncluded}
            continued
          />
          {tail}
        </div>
      )}
    </>
  );
}

function CmaTail({ data }: { data: CmaForm }) {
  return (
    <>
      <h3>6. Signatures / Sahihi</h3>
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
        Recorded by {data.raisedBy?.fullName ?? '—'}
        {data.mediatedBy && ` · Internal mediator: ${data.mediatedBy.fullName}`}
        <br />
        Generated {new Date(data.generatedAt).toLocaleString('en-GB')} · System-generated draft for
        review.
      </div>
    </>
  );
}
