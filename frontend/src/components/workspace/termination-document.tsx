'use client';
import { CcmHistory } from './ccm-history';
import { splitHistoryForPrint, terminationPreambleMm } from './ccm-page-budget';

export interface Form1Payload {
  formCode: string;
  formName: string;
  formNameSwahili: string;
  jurisdiction: string;
  generatedAt: string;
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
  disciplinaryHistoryIncluded?: boolean;
  disciplinaryHistory: Array<{
    actionNumber: string;
    type: string;
    issuedAt: string;
    reason: string;
    status: string;
  }>;
  operatorFields: string[];
}

function fmtDate(d?: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

export function TerminationDocument({ data }: { data: Form1Payload }) {
  const history = data.disciplinaryHistoryIncluded === false ? [] : data.disciplinaryHistory;
  const { firstPageItems, overflowItems } = splitHistoryForPrint(
    history,
    terminationPreambleMm(Boolean(data.employee.passport)),
  );
  const tail = <TerminationTail data={data} />;

  return (
    <>
      <div className="ccm-paper ccm-sheet" data-ccm-sheet="1" aria-label="Termination notice draft">
        <div className="text-center mb-6">
          <div className="text-xs text-slate-500 mb-1">
            United Republic of Tanzania · Jamhuri ya Muungano wa Tanzania
          </div>
          <h2 className="ccm-document-title">
            {data.formCode} — Notice of Termination of Employment
          </h2>
          <div className="text-sm italic mt-1">{data.formNameSwahili}</div>
          <div className="text-xs mt-2 text-slate-500">{data.jurisdiction}</div>
        </div>

        <h3>1. Employer / Mwajiri</h3>
        <table>
          <tbody>
            <tr>
              <td className="label">Name / Jina:</td>
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
              <td className="label">Registered address / Anwani:</td>
              <td>{data.employer.registeredAddress ?? '—'}</td>
            </tr>
            <tr>
              <td className="label">Postal address:</td>
              <td>{data.employer.postalAddress ?? '—'}</td>
            </tr>
          </tbody>
        </table>

        <h3>2. Employee / Mfanyakazi</h3>
        <table>
          <tbody>
            <tr>
              <td className="label">Full name / Jina kamili:</td>
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
            {data.employee.passport && (
              <tr>
                <td className="label">Passport:</td>
                <td>{data.employee.passport}</td>
              </tr>
            )}
            <tr>
              <td className="label">Nationality / Uraia:</td>
              <td>{data.employee.nationality ?? '—'}</td>
            </tr>
            <tr>
              <td className="label">Gender / Jinsia:</td>
              <td>{data.employee.gender}</td>
            </tr>
            <tr>
              <td className="label">Date of birth:</td>
              <td>{fmtDate(data.employee.dateOfBirth)}</td>
            </tr>
            <tr>
              <td className="label">Address / Anwani:</td>
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
          </tbody>
        </table>

        <h3>3. Employment particulars / Maelezo ya ajira</h3>
        <table>
          <tbody>
            <tr>
              <td className="label">Position / Cheo:</td>
              <td>{data.employment.position ?? '—'}</td>
            </tr>
            <tr>
              <td className="label">Department / Idara:</td>
              <td>{data.employment.department ?? '—'}</td>
            </tr>
            <tr>
              <td className="label">Branch / Tawi:</td>
              <td>
                {data.employment.branch ?? '—'}
                {data.employment.location && ` · ${data.employment.location}`}
              </td>
            </tr>
            <tr>
              <td className="label">Hire date / Tarehe ya kuajiriwa:</td>
              <td>{fmtDate(data.employment.hireDate)}</td>
            </tr>
            <tr>
              <td className="label">Tenure / Muda wa ajira:</td>
              <td>
                {data.employment.tenureMonths != null
                  ? `${data.employment.tenureMonths} months`
                  : '—'}
              </td>
            </tr>
            <tr>
              <td className="label">Contract type / Aina ya mkataba:</td>
              <td>{data.employment.contractType ?? '—'}</td>
            </tr>
            <tr>
              <td className="label">Base salary / Mshahara:</td>
              <td>
                {data.employment.baseSalary != null
                  ? `${data.employment.salaryCurrency} ${data.employment.baseSalary.toLocaleString('en-TZ')}`
                  : '—'}
              </td>
            </tr>
          </tbody>
        </table>

        <CcmHistory
          heading="4. Disciplinary history / Historia ya nidhamu"
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
          aria-label="Termination notice continuation"
        >
          <CcmHistory
            heading="4. Disciplinary history / Historia ya nidhamu (continued)"
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

function TerminationTail({ data }: { data: Form1Payload }) {
  return (
    <>
      <h3>5. Notice of termination / Notisi ya kusitisha ajira</h3>
      <p className="legal">
        In accordance with the Employment & Labour Relations Act, 2004, this is to formally notify
        the employee named above that their employment with the employer is being terminated.
        Particulars to be completed below.
      </p>
      <p className="legal italic mt-2">
        Kulingana na Sheria ya Ajira na Mahusiano Kazini, 2004, hii ni notisi rasmi ya kumjulisha
        mfanyakazi aliyetajwa hapo juu kuwa ajira yake na mwajiri inasitishwa. Maelezo yajazwe hapa
        chini.
      </p>

      <table className="mt-3">
        <tbody>
          {data.operatorFields.map((f) => (
            <tr key={f}>
              <td className="label" style={{ width: '40%' }}>
                {f}:
              </td>
              <td>
                <div style={{ borderBottom: '1px dotted #333', height: '18pt' }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>6. Signatures / Sahihi</h3>
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
        Generated {new Date(data.generatedAt).toLocaleString('en-GB')} · This is a system-generated
        draft.
        <br />
        Imetengenezwa na mfumo · Hii ni rasimu inayohitaji kuhakikiwa.
      </div>
    </>
  );
}
