import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'MentorQA — AI-Powered Code Review & QA',
  description:
    'Connect your GitHub repo and get automated QA, architecture analysis, AI-powered explanations, and PR fixes.',
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 bg-brutal-bg">
      {/* Hero */}
      <div className="max-w-[680px] w-full mx-auto text-center flex flex-col items-center space-y-6">
        {/* Eyebrow Label */}
        <div className="text-type-label">
          AI-POWERED QA & MENTORSHIP PLATFORM
        </div>

        {/* Headline */}
        <h1 className="text-type-h1">
          AUTOMATED CODE REVIEW. ZERO SETUP.
        </h1>

        {/* Sub-headline */}
        <p className="text-type-body">
          Connect a repo. Static analysis, generated tests, security and performance checks, and an architecture graph — with AI explanations for every issue and PR fixes on request.
        </p>

        {/* Feature pills (Monospace) */}
        <div className="grid grid-cols-3 gap-3 pt-4 w-full">
          {[
            'STATIC ANALYSIS',
            'TEST GENERATION',
            'SECURITY SCANS',
            'ARCHITECTURE GRAPH',
            'AUTO PR FIXES',
            'PROGRESS TRACKING',
          ].map((feature) => (
            <span
              key={feature}
              tabIndex={0}
              className="
                px-2 md:px-3 py-2 bg-transparent border border-brutal-border text-brutal-secondary text-type-meta
                hover:bg-brutal-panel hover:text-brutal-primary cursor-default
                focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brutal-primary
                transition-colors duration-200
              "
            >
              [ {feature} ]
            </span>
          ))}
        </div>

        {/* CTA and Footnote Grouped */}
        <div className="pt-6 flex flex-col items-center space-y-3">
          <a
            id="github-login-btn"
            href={`${API_URL}/auth/login`}
            className="
              inline-flex items-center gap-3 px-8 py-4 
              bg-brutal-primary text-black text-type-button
              hover:bg-gray-200 active:bg-gray-300
              focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brutal-primary
              transition-colors duration-200
            "
          >
            {/* GitHub mark SVG */}
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
              <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
            </svg>
            CONNECT GITHUB REPOSITORY
          </a>
          
          <p className="text-brutal-muted text-xs font-mono tracking-widest uppercase">
            NO CREDIT CARD REQUIRED // FREE DURING BETA
          </p>
        </div>
      </div>
    </main>
  );
}
