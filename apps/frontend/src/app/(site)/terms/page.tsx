import Link from 'next/link';
import { Zap } from 'lucide-react';

export const metadata = { title: 'Terms of Service' };

export default function TermsPage() {
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
        <h1 className="text-3xl font-bold text-text-primary mb-2">Terms of Service</h1>
        <p className="text-text-muted mb-8">Last updated: {new Date().toLocaleDateString()}</p>

        <div className="space-y-8 text-text-secondary text-sm leading-relaxed">
          <Section title="1. Acceptance of Terms">
            <p>By accessing or using SocialPilot Pro, you agree to be bound by these Terms of Service.</p>
          </Section>

          <Section title="2. Account Responsibilities">
            <p>Users are responsible for all content posted through SocialPilot PRO. You must not share your account or credentials with others.</p>
          </Section>

          <Section title="3. Acceptable Use & Compliance">
            <p>Unauthorized or illegal use of our services or connected platform APIs is strictly prohibited. You agree to comply with the terms of service of all connected social media platforms, including Meta's Platform Terms and YouTube's Terms of Service.</p>
          </Section>

          <Section title="4. Contact Us">
            <p>For questions about these Terms, contact us at: <a href="mailto:mandlajayesh@gmail.com" className="text-brand-400">mandlajayesh@gmail.com</a></p>
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
      <div className="space-y-3">{children}</div>
    </section>
  );
}
