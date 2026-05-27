import Link from 'next/link';
import { Zap } from 'lucide-react';

export const metadata = { title: 'Privacy Policy' };

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-surface-border px-6 py-4 flex items-center gap-3">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center">
            <Zap size={16} className="text-white" />
          </div>
          <span className="font-bold text-text-primary">SocialPilot Pro</span>
        </Link>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold text-text-primary mb-2">Privacy Policy</h1>
        <p className="text-text-muted mb-8">Last updated: {new Date().toLocaleDateString()}</p>

        <div className="prose prose-invert max-w-none space-y-8 text-text-secondary">
          <Section title="1. Information We Collect">
            <p>We collect account information required for social media integrations and analytics, including when you connect your accounts via official OAuth flows.</p>
            <ul>
              <li><strong>Account information:</strong> Name, email address, password</li>
              <li><strong>Social media data:</strong> Access tokens, profile information, post metrics (fetched via official APIs)</li>
            </ul>
          </Section>

          <Section title="2. Data Sharing">
            <p>We do not sell user data. All access tokens and sensitive metrics are encrypted at rest and in transit.</p>
          </Section>

          <Section title="3. Contact Us">
            <p>If you have questions about this Privacy Policy or requests regarding your data, please contact us at: <a href="mailto:mandlajayesh@gmail.com" className="text-brand-400">mandlajayesh@gmail.com</a></p>
          </Section>
        </div>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-text-primary mb-3">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed">{children}</div>
    </section>
  );
}
