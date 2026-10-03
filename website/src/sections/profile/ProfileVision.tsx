import { visionMission } from '@/content/profile';
import { keepCompounds } from '@/ui';
import { ReportHeader, ReportSection } from './ReportSection';

/**
 * §3, Vision and Mission: the chapter's one typographic cinema moment near
 * the top of the report. The two statements side by side from `md`, each
 * under its label and a hairline, set large on black.
 */
export function ProfileVision() {
  return (
    <ReportSection id="vision-mission" tone="cinema">
      <ReportHeader id="vision-mission" />
      <div className="mt-12 grid gap-10 md:mt-16 md:grid-cols-2 md:gap-12 lg:gap-16">
        {visionMission.map((item) => (
          <div key={item.title} className="border-t border-line pt-6">
            <h3 className="text-eyebrow text-gold-fg">{item.title}</h3>
            <p className="mt-4 text-lede text-fg">{keepCompounds(item.body)}</p>
          </div>
        ))}
      </div>
    </ReportSection>
  );
}
