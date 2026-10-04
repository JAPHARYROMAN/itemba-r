import Image from 'next/image';
import Link from 'next/link';
import { ArrowUpRight, Layers3, ShieldCheck } from 'lucide-react';
import { SignInForm } from './SignInForm';
import './os-login.css';

export function OsLogin() {
  return (
    <main className="os-login auth-light">
      <header className="os-login-header">
        <Link href="/login" className="os-login-brand" aria-label="ITEMBA OS home">
          <Image src="/brand/itemba-group-logo.png" alt="Itemba Group" width={44} height={44} />
          <span>
            ITEMBA <b>OS</b>
          </span>
        </Link>
        <a href="https://itembagrouptz.com" target="_blank" rel="noopener noreferrer">
          Itemba Group <ArrowUpRight size={15} aria-hidden="true" />
        </a>
      </header>
      <div className="os-login-body">
        <section className="os-login-intro" aria-labelledby="os-welcome">
          <span className="os-login-eyebrow">
            <Layers3 size={16} aria-hidden="true" /> Your business, connected
          </span>
          <h1 id="os-welcome">
            A place for
            <br />
            your work.
          </h1>
          <p>Open your workspace. Pick up where you left off. Keep everything moving together.</p>
          <div className="os-login-workspaces" aria-label="Connected workspaces">
            <span>
              <i aria-hidden="true" /> Finance &amp; sales
            </span>
            <span>
              <i aria-hidden="true" /> Stock &amp; operations
            </span>
            <span>
              <i aria-hidden="true" /> People &amp; records
            </span>
          </div>
          <div className="os-login-trust">
            <ShieldCheck size={18} aria-hidden="true" />
            <span>Your account. Your authorized workspace.</span>
          </div>
        </section>
        <section className="os-login-panel" aria-label="Sign in to ITEMBA OS">
          <SignInForm defaultTarget="/desktop" />
          <div className="os-login-help">
            <span>For a password reset, contact your administrator.</span>
            <span>
              Need access? <Link href="/signup">Request an account</Link>
            </span>
          </div>
        </section>
      </div>
      <footer className="os-login-footer">
        <span>ITEMBA GROUP</span>
        <span>A workspace that moves with you.</span>
      </footer>
    </main>
  );
}
