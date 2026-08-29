import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'MentorQA — AI-Powered Code Review & QA',
  description:
    'Connect your GitHub repo and get automated QA, architecture analysis, AI-powered explanations, and PR fixes.',
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-950 via-indigo-950 to-gray-950 flex flex-col items-center justify-center px-4">
      {/* Hero */}
      <div className="max-w-3xl w-full text-center space-y-8">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 text-sm font-medium">
          <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
          AI-Powered QA & Mentorship Platform
        </div>

        {/* Headline */}
        <h1 className="text-5xl md:text-6xl font-bold tracking-tight text-white leading-tight">
          Your GitHub repo&apos;s
          <span className="block bg-gradient-to-r from-indigo-400 via-violet-400 to-purple-400 bg-clip-text text-transparent">
            automated QA team
          </span>
        </h1>

        {/* Sub-headline */}
        <p className="text-lg md:text-xl text-gray-400 max-w-2xl mx-auto leading-relaxed">
          Connect a repo. Get multi-layer test runs, architecture analysis, AI-powered explanations,
          automated PR fixes, and a personalised progress tracker — all in one place.
        </p>

        {/* Feature pills */}
        <div className="flex flex-wrap gap-3 justify-center">
          {[
            '🧪 Multi-layer Testing',
            '🏗️ Architecture Analysis',
            '🤖 Gemini AI Explanations',
            '🔧 Auto PR Fixes',
            '📈 Progress Tracking',
          ].map((feature) => (
            <span
              key={feature}
              className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-gray-300 text-sm"
            >
              {feature}
            </span>
          ))}
        </div>

        {/* CTA */}
        <div className="pt-4">
          <a
            id="github-login-btn"
            href={`${API_URL}/auth/login`}
            className="
              inline-flex items-center gap-3 px-8 py-4 rounded-xl
              bg-white text-gray-900 font-semibold text-lg
              shadow-2xl shadow-white/10
              hover:bg-gray-100 hover:scale-105
              active:scale-95
              transition-all duration-200
            "
          >
            {/* GitHub mark SVG */}
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
              <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
            </svg>
            Login with GitHub
          </a>
        </div>

        {/* Footnote */}
        <p className="text-gray-600 text-sm pt-2">
          No credit card required &bull; Free during beta
        </p>
      </div>

      {/* Bottom gradient fade */}
      <div className="fixed bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-gray-950 to-transparent pointer-events-none" />
    </main>
  );
}
