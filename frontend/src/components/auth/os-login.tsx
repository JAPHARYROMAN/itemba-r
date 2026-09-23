import Image from 'next/image';
import Link from 'next/link';
import { ArrowUpRight, Fuel, Smartphone } from 'lucide-react';
import { SignInForm } from './SignInForm';
import './os-login.css';

export function OsLogin() {
  return (
    <main className="os-login auth-light">
      <header>
        <Link href="/login">
          <Image src="/brand/itemba-group-logo.png" alt="Itemba Group" width={48} height={48} />
          <span>ITEMBA OS</span>
        </Link>
        <span>Your workspace, together.</span>
      </header>
      <div className="os-login-body">
        <section className="os-login-intro">
          <p>WELCOME TO ITEMBA OS</p>
          <h1>
            A clearer way
            <br />
            to work.
          </h1>
          <span>
            One home for your business.
            <br />A little space for everything that comes next.
          </span>
          <div className="os-login-products">
            <span>ITEMBA-R</span>
            <i /> <span>Fuel Grid</span>
            <i /> <span>Your next idea</span>
          </div>
        </section>
        <section className="os-login-panel" aria-label="Sign in to ITEMBA OS">
          <SignInForm defaultTarget="/desktop" />
          <p className="os-login-access">
            New to the workspace? <Link href="/signup">Request access</Link>
          </p>
        </section>
      </div>
      <footer>
        <span>ITEMBA GROUP</span>
        <nav aria-label="Other workspaces">
          <Link href="/fuel-reporting">
            <Fuel size={14} /> Fuel Reporting <ArrowUpRight size={12} />
          </Link>
          <Link href="/westsides/mobile-pos/install">
            <Smartphone size={14} /> Install mobile POS <ArrowUpRight size={12} />
          </Link>
        </nav>
      </footer>
    </main>
  );
}
