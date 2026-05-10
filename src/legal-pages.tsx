import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import "./legal-pages.css";

const CONTACT_EMAIL = "contact@echoo.day";

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
        This policy describes how Echoo (&quot;we&quot;, &quot;us&quot;) processes personal data when
        you use the <strong>Echoo mobile application</strong> (the &quot;App&quot;) and our
        websites or services at <strong>echoo.day</strong> (together with the App, the
        &quot;Services&quot;). Features vary by platform and settings; only the parts you use apply
        to you.
      </p>

      <h3>Contact</h3>
      <p>
        For privacy questions and requests:{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </p>

      <h3>1. Who is responsible?</h3>
      <p>
        The controller for personal data processed through the Services is the operator of Echoo.
        You can reach us at the contact address above.
      </p>

      <h3>2. What we process in the App</h3>
      <p>Depending on how you use Echoo, this may include:</p>
      <ul>
        <li>
          <strong>Account and profile</strong> — for example email address, display name, and
          authentication data needed to sign you in and secure your account.
        </li>
        <li>
          <strong>Journal content</strong> — text, audio recordings, images, video, and other media
          you choose to save, including optional location or calendar-related data if you attach it
          to entries.
        </li>
        <li>
          <strong>Social features</strong> — information needed to connect with other users you
          interact with in the App (for example friendships or tags), as implemented in the product.
        </li>
        <li>
          <strong>AI-assisted features</strong> — where you enable cloud-based assistance (e.g.
          transcription or summaries), content you send for processing may be transmitted to our
          configured AI providers. Where you use on-device processing, more of this stays on your
          phone; details appear in the App settings and prompts.
        </li>
        <li>
          <strong>Diagnostics and product data</strong> — technical information such as app version,
          device type, crash or performance signals, and (where you consent) usage analytics to
          understand how the App is used.
        </li>
      </ul>

      <h3>3. What we process on echoo.day (web)</h3>
      <ul>
        <li>
          <strong>Waitlist and email flows</strong> — email address and related metadata when you
          join the waitlist, confirm your address, or use referral or feedback entry points we host
          on the Site.
        </li>
        <li>
          <strong>Technical data</strong> — data typically sent by your browser (e.g. IP address,
          user agent, timestamps) when you load pages or call our APIs.
        </li>
        <li>
          <strong>Optional analytics on the Site</strong> — if you accept our cookie/analytics
          banner, we may use analytics tools to measure traffic and conversions.
        </li>
      </ul>

      <h3>4. Purposes and legal bases (GDPR)</h3>
      <ul>
        <li>
          Providing the Services, operating accounts, sync, security, and support —{" "}
          <strong>Art. 6(1)(b) GDPR</strong> (contract / steps prior to a contract) and/or{" "}
          <strong>Art. 6(1)(f) GDPR</strong> (legitimate interests in a secure, reliable product).
        </li>
        <li>
          AI processing you explicitly turn on or request in the App — typically{" "}
          <strong>Art. 6(1)(a) GDPR</strong> (consent) and/or <strong>Art. 6(1)(b) GDPR</strong>,
          depending on the feature.
        </li>
        <li>
          Optional analytics (App or Site, where offered) — <strong>Art. 6(1)(a) GDPR</strong>{" "}
          (consent). You can withdraw consent via in-app or browser controls; declining may limit
          measurement only, not core journaling where applicable.
        </li>
        <li>
          Legal compliance and enforcement — <strong>Art. 6(1)(c) GDPR</strong> and/or{" "}
          <strong>Art. 6(1)(f) GDPR</strong>.
        </li>
      </ul>

      <h3>5. Processors and recipients</h3>
      <p>
        We use service providers to host and operate the Services. These commonly include{" "}
        <strong>Supabase</strong> (authentication, database, storage, and edge functions as
        configured), and, depending on your choices, <strong>PostHog</strong> for product analytics
        and <strong>AI infrastructure</strong> (e.g. OpenAI or similar) when you use cloud AI
        features. Providers process data on our instructions under appropriate agreements. Where
        they process data outside the EEA, we rely on suitable transfer mechanisms (such as
        Standard Contractual Clauses) as offered by the provider.
      </p>

      <h3>6. Retention</h3>
      <p>
        We keep data only as long as needed to run the Services, comply with law, resolve disputes,
        and enforce our terms. Journal content and account data are retained until you delete them
        or close your account, subject to backup and legal retention windows. Waitlist records follow
        our operational needs for launch and communication. Specific retention may be described in
        the App (e.g. export or deletion tools).
      </p>

      <h3>7. Your rights</h3>
      <p>
        Depending on your location, you may have the right to access, rectify, erase, restrict or
        object to certain processing, and to data portability. You may lodge a complaint with a
        supervisory authority. To exercise your rights, contact{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. The App may also offer in-product
        controls (e.g. export or deletion) where applicable.
      </p>

      <h3>8. Children</h3>
      <p>
        The Services are not directed at children under the minimum age required in your country
        (typically 16 for the EEA unless local law sets a lower age with consent). Do not use Echoo
        or provide personal data if you do not meet that requirement.
      </p>

      <h3>9. Changes</h3>
      <p>
        We may update this policy from time to time. We will reflect material changes by updating
        the &quot;Last updated&quot; date above and, where appropriate, through the App or Site.
      </p>
    </LegalShell>
  );
}

export function TermsPage() {
  return (
    <LegalShell title="Terms of Service">
      <p>
        These Terms of Service (&quot;Terms&quot;) govern your use of the <strong>Echoo mobile</strong>{" "}
        application and related websites or services we operate at <strong>echoo.day</strong>{" "}
        (together, the &quot;Services&quot;). Apple App Store or Google Play may also apply their
        terms where you obtain the App from those platforms.
      </p>

      <h3>Contact</h3>
      <p>
        Questions about these Terms:{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </p>

      <h3>1. The Services</h3>
      <p>
        Echoo is a personal journal product. You can capture entries (including voice and media),
        organise content, optionally use social or discovery features, and use AI-assisted tools
        where available and enabled in your settings. The waitlist and other pages at echoo.day
        provide information, signup, and related flows we publish there.
      </p>

      <h3>2. Eligibility and account</h3>
      <p>
        You must meet the minimum age and capacity requirements for your region. You are
        responsible for your account credentials and for activity under your account. Keep your
        login information confidential.
      </p>

      <h3>3. Your content</h3>
      <p>
        You retain rights to content you create. To run the Services, you grant us a licence to
        host, store, reproduce, process, and display your content as needed to provide features you
        use (including sync, backup, search, sharing you initiate, and AI features you enable). You
        are responsible for having the rights to what you upload and for not infringing others&apos;
        rights.
      </p>

      <h3>4. AI-assisted features</h3>
      <p>
        Optional AI features (e.g. transcription or summaries) produce automated output that may be
        inaccurate or incomplete. They are not professional, medical, or legal advice. You remain
        responsible for how you rely on or publish AI-generated text.
      </p>

      <h3>5. Acceptable use</h3>
      <p>You agree not to:</p>
      <ul>
        <li>use the Services unlawfully or to harm others;</li>
        <li>
          attempt to disrupt, probe, or bypass security, or misuse automation against our systems;
        </li>
        <li>upload malware or content you have no right to share;</li>
        <li>misrepresent your identity or manipulate rankings, referrals, or access in bad faith.</li>
      </ul>
      <p>We may suspend or terminate access if we reasonably believe these rules are violated.</p>

      <h3>6. Third-party services</h3>
      <p>
        The Services may link to or rely on third parties (e.g. map providers, AI APIs). Their
        terms and privacy notices apply to your use of those services where relevant.
      </p>

      <h3>7. Waitlist and web-only features</h3>
      <p>
        Joining a waitlist or using web forms does <strong>not</strong> guarantee a particular
        launch date, feature set, or early access. We may change priorities, timing, or eligibility.
        By signing up, you agree we may send transactional or service-related messages to the email
        you provide. Marketing, if any, follows applicable law and preferences we offer.
      </p>

      <h3>8. Disclaimer</h3>
      <p>
        The Services are provided &quot;as is&quot; to the fullest extent permitted by law. We do
        not warrant uninterrupted or error-free operation or that content will never be lost;
        please use export or backup options when we provide them.
      </p>

      <h3>9. Limitation of liability</h3>
      <p>
        To the extent permitted by law, we are not liable for indirect, incidental, special,
        consequential, or punitive damages, or for loss of profits, data, or goodwill, arising from
        your use of the Services. Our aggregate liability for claims relating to the Services is
        limited to EUR 100 unless mandatory law requires otherwise.
      </p>

      <h3>10. Governing law</h3>
      <p>
        These Terms are governed by the laws of the Federal Republic of Germany, excluding its
        conflict-of-law rules, without prejudice to mandatory consumer protections where you live.
        For business users, courts in Germany have jurisdiction; for consumers, statutory
        jurisdiction may apply.
      </p>

      <h3>11. Changes</h3>
      <p>
        We may update these Terms. If we post revised Terms, continued use of the Services after the
        effective date may constitute acceptance, to the extent permitted by law. Material changes
        may be communicated through the App or Site where appropriate.
      </p>
    </LegalShell>
  );
}
