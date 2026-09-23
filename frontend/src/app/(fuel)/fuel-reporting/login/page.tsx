import { ClipboardCheck, Droplets, SunMoon } from 'lucide-react';
import { SignInForm } from '@/components/auth/SignInForm';

export default function FuelLoginPage() {
  return (
    <main className="fp-login">
      <section className="fp-intro" aria-labelledby="fuel-login-title">
        <span className="fp-company">MWANJALISI OIL</span>
        <h1 id="fuel-login-title">
          Every shift. <br />
          Every litre.
          <br />
          <em>All accounted for.</em>
        </h1>
        <p>
          A dedicated workspace for station managers. Turn your paper shift records into a clear
          picture of your branch’s daily performance.
        </p>
        <ul className="fp-features">
          <li>
            <SunMoon aria-hidden="true" />
            <div>
              <strong>Day & night shifts</strong>
              <span>Pump readings, attendants, sales, and expenses.</span>
            </div>
          </li>
          <li>
            <Droplets aria-hidden="true" />
            <div>
              <strong>Fuel received</strong>
              <span>Record deliveries by fuel type and volume.</span>
            </div>
          </li>
          <li>
            <ClipboardCheck aria-hidden="true" />
            <div>
              <strong>Close with confidence</strong>
              <span>Enter tank dips and review discrepancies before closing.</span>
            </div>
          </li>
        </ul>
        <div className="fp-intro-note">One branch report. A complete view of the shift.</div>
      </section>
      <section className="fp-login-card" aria-label="Station sign in">
        <SignInForm defaultTarget="/fuel-reporting" reporting />
        <p className="fp-login-help">
          Need station access? Ask your administrator to assign your branch and Fuel Reporting
          permissions.
        </p>
      </section>
    </main>
  );
}
