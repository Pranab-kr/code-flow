import Link from 'next/link';

/** Ft5 Statement: one closing sentence, then wordmark, minimal links, ©. */
export function Footer() {
  return (
    <footer className="foot-stmt">
      <p className="foot-stmt__line">Read the shape of your code.</p>
      <div className="foot-stmt__meta">
        <span className="foot-stmt__wordmark">code-flow</span>
        <nav className="foot-stmt__links" aria-label="Footer">
          <Link href="/demo">Demo</Link>
          <Link href="/login">Sign in</Link>
          <Link href="/signup">Get started</Link>
        </nav>
        <span className="foot-stmt__copy">© 2026</span>
      </div>
    </footer>
  );
}
