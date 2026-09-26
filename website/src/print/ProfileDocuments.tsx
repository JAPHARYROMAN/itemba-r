/* eslint-disable @next/next/no-img-element -- the PDF script needs plain <img src="/images/…"> in these documents. */
import { contact } from '@/content/contact';
import { legalCompanyProfiles, printableProfiles, printCopy, type PrintSection } from '@/content/profile';
import { site } from '@/content/site';

/**
 * The four print documents (group + one per company) rendered, hidden on
 * screen, at the end of /company-profile. Print CSS shows the selected one
 * (body[data-print-profile]); scripts/generate-profile-pdfs.mjs prints each to
 * public/downloads.
 *
 * Contract with the frozen PDF script and print.css: the class names, the
 * `article.print-profile-document[data-profile=<id>]` elements and plain
 * <img src="/images/..."> photos are load-bearing. Keep them.
 */
export default function ProfileDocuments() {
  return (
    <div className="print-document-root" aria-hidden="true">
      {printableProfiles.map((profile) => (
        <article key={profile.id} className="print-profile-document" data-profile={profile.id}>
          <header className="print-letterhead">
            <div className="print-letterhead-brand">
              <div className="print-logo-mark">
                <img src="/logo-print.png" alt={printCopy.logoAlt} />
                <span>{printCopy.established}</span>
              </div>
              <div>
                <p className="print-letterhead-title">{printCopy.letterheadTitle}</p>
                <p className="print-letterhead-subtitle">{printCopy.letterheadSubtitle}</p>
              </div>
            </div>
            <div className="print-letterhead-contact">
              <p>{contact.headOffice}</p>
              <p>{contact.postal}</p>
              <p>{contact.primaryPhoneDisplay} / {contact.secondaryPhoneDisplay}</p>
              <p>{contact.email} | {site.domain}</p>
            </div>
          </header>

          <section className="print-cover-panel">
            <div>
              <div className="print-cover-identity">
                <div className="print-cover-logo">
                  <img src="/logo-print.png" alt={printCopy.logoAlt} />
                  <span>{printCopy.established}</span>
                </div>
                <span>{site.domain}</span>
              </div>
              <p className="print-kicker">{printCopy.kicker}</p>
              <h1>{profile.title}</h1>
              <p className="print-subtitle">{profile.subtitle}</p>
            </div>
            <img src={profile.coverImage.src} alt={profile.coverImage.alt} />
          </section>

          <section className="print-section print-section-tight">
            <h2>{printCopy.factsHeading}</h2>
            <dl className="print-fact-grid">
              {profile.facts.map((fact) => (
                <div key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          {profile.id === 'group' ? (
            <section className="print-section">
              <h2>{printCopy.legalCompaniesHeading}</h2>
              <table className="print-table">
                <thead>
                  <tr>
                    {printCopy.legalTableHeads.map((head) => (
                      <th key={head}>{head}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {legalCompanyProfiles.map((company) => (
                    <tr key={company.id}>
                      <td>{company.name}</td>
                      <td>{company.tin}</td>
                      <td>{company.incorporationDate}; {printCopy.numberPrefix} {company.incorporationNumber}</td>
                      <td>{company.directors.join('; ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          {profile.directors ? (
            <section className="print-section print-section-tight">
              <h2>{printCopy.directorsHeading}</h2>
              <ul className="print-list print-list-columns">
                {profile.directors.map((director) => (
                  <li key={director}>{director}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="print-section print-section-tight">
            <h2>{printCopy.imagesHeading}</h2>
            <div className="print-image-grid">
              {profile.images.map((image) => (
                <figure key={image.src}>
                  <img src={image.src} alt={image.alt} />
                  <figcaption>{image.caption}</figcaption>
                </figure>
              ))}
            </div>
          </section>

          {profile.sections.map((section) => (
            <PrintSectionBlock key={section.title} section={section} />
          ))}

          <footer className="print-document-footer">
            <span>{profile.subject}</span>
            <span>{site.domain}</span>
          </footer>
        </article>
      ))}
    </div>
  );
}

function PrintSectionBlock({ section }: { section: PrintSection }) {
  return (
    <section className={`print-section${section.pageBreakBefore ? ' print-section-page' : ''}`}>
      <h2>{section.title}</h2>
      {section.body ? <p>{section.body}</p> : null}
      {section.points ? (
        <ul className="print-list">
          {section.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      ) : null}
      {section.columns ? (
        <div className="print-column-grid">
          {section.columns.map((column) => (
            <div key={column.title} className="print-mini-card">
              <h3>{column.title}</h3>
              {column.body ? <p>{column.body}</p> : null}
              {column.points ? (
                <ul className="print-list">
                  {column.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
