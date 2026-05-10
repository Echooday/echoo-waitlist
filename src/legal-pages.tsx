import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import "./legal-pages.css";

function LegalShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="app-container">
      <main className="page">
        <section className="page-section page-section--hero legal-page-section">
          <div className="page-section__inner legal-page-inner">
            <header className="brand legal-page-brand">
              <h1 className="logo">
                <span className="logo-word">ECH</span>
                <span className="logo-flower" aria-hidden="true">
                  <img
                    src="/flower-meadow/logo-128w.png"
                    srcSet="/flower-meadow/logo-64w.png 64w, /flower-meadow/logo-128w.png 128w, /flower-meadow/logo-256w.png 256w"
                    sizes="3.5rem"
                    alt=""
                    width={256}
                    height={256}
                    decoding="async"
                  />
                </span>
                <span className="logo-word">O</span>
              </h1>
              <div className="divider" />
            </header>
            <article className="legal-prose">
              <h2 className="legal-prose__title">{title}</h2>
              <p className="legal-prose__meta">
                Last updated: {new Date().toISOString().slice(0, 10)} ·{" "}
                <Link to="/" className="feature-request-link">
                  Home
                </Link>
                {" · "}
                <Link to="/privacy" className="feature-request-link">
                  Privacy
                </Link>
                {" · "}
                <Link to="/terms" className="feature-request-link">
                  Terms
                </Link>
              </p>
              {children}
            </article>
          </div>
        </section>
      </main>
    </div>
  );
}

export function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy">
      <p>
        This policy describes how we process personal data when you use the Echoo waitlist and
        related pages at <strong>echoo.day</strong> (the &quot;Site&quot;). The Echoo mobile app
        may collect additional categories of data; this document focuses on the waitlist Site. For
        app-specific practices, see the in-app settings and any supplemental notices linked from the
        app stores.
      </p>

      <h3>1. Who is responsible?</h3>
      <p>
        The controller for personal data processed through this Site is the operator of Echoo
        (&quot;we&quot;, &quot;us&quot;). You can contact us regarding privacy at:{" "}
        <a href="mailto:privacy@echoo.day">privacy@echoo.day</a>. If this address changes, we will
        update this page.
      </p>

      <h3>2. What data we process on the waitlist</h3>
      <ul>
        <li>
          <strong>Email address</strong> when you join the waitlist or interact with confirmation /
          referral flows.
        </li>
        <li>
          <strong>Referral and waitlist metadata</strong> (e.g. referral codes, queue position)
          generated when you use those features.
        </li>
        <li>
          <strong>Technical data</strong> typically sent by your browser (e.g. IP address, user
          agent, timestamps) when requests reach our infrastructure providers.
        </li>
      </ul>

      <h3>3. Purposes and legal bases (GDPR)</h3>
      <ul>
        <li>
          Operating the waitlist, sending transactional emails (e.g. confirmation), and preventing
          abuse — <strong>Art. 6(1)(b) GDPR</strong> (steps prior to a contract) and/or{" "}
          <strong>Art. 6(1)(f) GDPR</strong> (legitimate interests in running a fair waitlist).
        </li>
        <li>
          Optional, consent-based analytics on this Site (if you accept the banner) —{" "}
          <strong>Art. 6(1)(a) GDPR</strong>. You can withdraw consent at any time by clearing Site
          storage or using browser controls; declining does not affect core waitlist functionality
          beyond measurement.
        </li>
      </ul>

      <h3>4. Processors and recipients</h3>
      <p>
        We use service providers to host and operate the Site and related backend services,
        including <strong>Supabase</strong> (database, authentication-related APIs, edge functions as
        configured) and, if you opt in, <strong>PostHog</strong> for product analytics. Those
        providers process data on our instructions and under contractual safeguards. Where they
        operate outside the EEA, we rely on appropriate transfer mechanisms (e.g. Standard
        Contractual Clauses) as offered by the providers.
      </p>

      <h3>5. Retention</h3>
      <p>
        We keep waitlist and related records only as long as needed to operate the waitlist,
        comply with law, resolve disputes, and enforce agreements. When data is no longer needed,
        we delete or anonymise it in line with our backend configuration and legal obligations.
      </p>

      <h3>6. Your rights</h3>
      <p>
        Depending on your location, you may have rights to access, rectify, erase, restrict or
        object to certain processing, and to data portability. You may also lodge a complaint with a
        supervisory authority. To exercise rights, contact{" "}
        <a href="mailto:privacy@echoo.day">privacy@echoo.day</a>. The Echoo app also provides
        account-level tools (e.g. export and deletion) where applicable to app accounts.
      </p>

      <h3>7. Children</h3>
      <p>
        The Site is not directed at children under 16 (or the minimum age required in your
        country). Do not provide personal data if you do not meet that age requirement.
      </p>

      <h3>8. Changes</h3>
      <p>
        We may update this policy from time to time. Material changes will be reflected by updating
        the &quot;Last updated&quot; date above.
      </p>
    </LegalShell>
  );
}

export function TermsPage() {
  return (
    <LegalShell title="Terms of Service">
      <p>
        These Terms of Service (&quot;Terms&quot;) govern your use of the Echoo waitlist and
        related pages at <strong>echoo.day</strong> (the &quot;Site&quot;). The Echoo mobile
        application is governed by separate terms presented in the app or app stores where
        required.
      </p>

      <h3>1. The Site</h3>
      <p>
        The Site provides information about Echoo and lets you join a waitlist, confirm your email,
        and use related features (such as referral or feedback entry points) as made available.
      </p>

      <h3>2. No guarantee of access</h3>
      <p>
        Joining the waitlist does <strong>not</strong> guarantee early access, a particular launch
        date, or any specific feature set. We may change priorities, timing, or eligibility
        criteria at any time.
      </p>

      <h3>3. Acceptable use</h3>
      <p>You agree not to:</p>
      <ul>
        <li>misuse the Site (e.g. automated abuse, attempting to disrupt or probe our systems);</li>
        <li>submit false or misleading information;</li>
        <li>use the Site in violation of applicable law.</li>
      </ul>
      <p>We may suspend or remove access where we reasonably believe these rules are violated.</p>

      <h3>4. Communications</h3>
      <p>
        By joining the waitlist, you agree that we may send you transactional or service-related
        emails (e.g. confirmation, queue updates) at the address you provide. Marketing emails, if
        any, will be handled according to applicable law and any preferences we offer.
      </p>

      <h3>5. Disclaimer</h3>
      <p>
        The Site is provided &quot;as is&quot; without warranties of any kind, to the fullest extent
        permitted by law. We do not warrant uninterrupted or error-free operation.
      </p>

      <h3>6. Limitation of liability</h3>
      <p>
        To the extent permitted by law, we are not liable for indirect, incidental, special,
        consequential, or punitive damages, or for loss of profits, data, or goodwill, arising out
        of or in connection with your use of the Site. Our aggregate liability for any claim arising
        from the Site is limited to EUR 100 unless mandatory law requires otherwise.
      </p>

      <h3>7. Governing law</h3>
      <p>
        These Terms are governed by the laws of the Federal Republic of Germany, excluding its
        conflict-of-law rules, unless mandatory consumer protections in your country say otherwise.
        Courts in Germany shall have jurisdiction for business users; for consumers, statutory
        jurisdiction may apply.
      </p>

      <h3>8. Changes</h3>
      <p>
        We may update these Terms. Continued use of the Site after changes become effective
        constitutes acceptance of the revised Terms, to the extent permitted by law.
      </p>

      <h3>9. Contact</h3>
      <p>
        Questions about these Terms: <a href="mailto:legal@echoo.day">legal@echoo.day</a> (if
        unavailable, use <a href="mailto:privacy@echoo.day">privacy@echoo.day</a>).
      </p>
    </LegalShell>
  );
}
