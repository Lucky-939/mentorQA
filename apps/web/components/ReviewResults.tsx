/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, no-empty, prefer-const, react-hooks/exhaustive-deps */
'use client';

import { useState, useMemo, useEffect } from 'react';
import DependencyGraph from './DependencyGraph';
import { Finding } from '@mentorqa/shared-types';

interface ReviewResultsProps {
  findings: Finding[];
  graphData: { nodes: any[]; edges: any[] } | null;
}

const TABS = [
  'OVERVIEW',
  'STATIC ANALYSIS',
  'TEST COVERAGE',
  'API TESTS',
  'SECURITY',
  'PERFORMANCE',
  'ARCHITECTURE'
];

export default function ReviewResults({ findings, graphData }: ReviewResultsProps) {
  const [activeTab, setActiveTab] = useState('OVERVIEW');
  const [activeModalFinding, setActiveModalFinding] = useState<Finding | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveModalFinding(null);
    };
    if (activeModalFinding) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeModalFinding]);

  // Categorize findings
  const categorizedFindings = useMemo(() => {
    const cats: Record<string, Finding[]> = {
      'STATIC ANALYSIS': [],
      'TEST COVERAGE': [],
      'API TESTS': [],
      'SECURITY': [],
      'PERFORMANCE': [],
      'ARCHITECTURE': [],
    };

    findings.forEach(f => {
      const cat = f.category.toLowerCase();
      if (cat.includes('security')) {
        cats['SECURITY'].push(f);
      } else if (cat.includes('performance')) {
        cats['PERFORMANCE'].push(f);
      } else if (cat.includes('test')) {
        cats['TEST COVERAGE'].push(f);
      } else if (cat.includes('api')) {
        cats['API TESTS'].push(f);
      } else if (cat.includes('architecture')) {
        cats['ARCHITECTURE'].push(f);
      } else {
        // Fallback for complexity, style, bug, code-quality, etc.
        cats['STATIC ANALYSIS'].push(f);
      }
    });

    return cats;
  }, [findings]);

  // Aggregate stats
  const stats = useMemo(() => {
    const total = findings.length;
    const critical = findings.filter(f => f.severity === 'critical').length;
    const high = findings.filter(f => f.severity === 'high').length;
    
    // Attempt to derive pass rates if applicable (e.g. from tests)
    const testFindings = categorizedFindings['TEST COVERAGE'];
    const evaluableTests = testFindings.filter(f => !f.ruleId?.includes('skipped'));
    const passedTests = evaluableTests.filter(f => f.severity === 'info' || f.ruleId?.includes('passed')).length;
    const testPassRate = evaluableTests.length > 0 
      ? Math.round((passedTests / evaluableTests.length) * 100) 
      : null;

    const securityFindings = categorizedFindings['SECURITY'].length;
    
    return {
      total,
      critical,
      high,
      testPassRate,
      securityFindings
    };
  }, [findings, categorizedFindings]);

  const topFindings = useMemo(() => {
    const sorted = [...findings].sort((a, b) => {
      const sevMap: Record<string, number> = { 'critical': 4, 'high': 3, 'medium': 2, 'low': 1, 'info': 0 };
      return (sevMap[b.severity] || 0) - (sevMap[a.severity] || 0);
    });
    return sorted.slice(0, 4); // Top 4 highest severity
  }, [findings]);

  const renderFindingCard = (finding: Finding) => {
    const mentor = finding.metadata?.mentor;
    const mentorStatus = finding.metadata?.mentorStatus;

    let statusNote: string | null = null;
    if (!mentor) {
      if (mentorStatus === 'skipped-quota') statusNote = 'AI quota reached';
      else if (mentorStatus === 'skipped-no-key') statusNote = 'AI not configured';
      else if (mentorStatus === 'skipped-cap') statusNote = 'Not explained in this run';
      else if (mentorStatus === 'skipped-unavailable') statusNote = 'AI service unavailable';
      else if (mentorStatus === 'fallback-invalid-json') statusNote = 'AI response invalid';
      else if (mentorStatus === 'dry-run') statusNote = 'Dry run mode (AI generation skipped)';
    }

    return (
      <div key={finding.id} className="p-4 bg-brutal-panel border border-brutal-border flex flex-col md:flex-row md:items-start gap-4 h-full">
        <div className={`w-1 h-auto self-stretch min-h-[40px] shrink-0 ${finding.severity === 'critical' ? 'bg-red-600' : finding.severity === 'high' ? 'bg-red-500' : finding.severity === 'medium' ? 'bg-orange-500' : finding.severity === 'low' ? 'bg-yellow-500' : 'bg-brutal-border'}`}></div>
        <div className="flex-1 space-y-3 w-full">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-brutal-primary font-bold text-sm">{finding.ruleId}</span>
              <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 border border-brutal-border text-brutal-secondary font-mono">{finding.category}</span>
            </div>
            {mentor && (
              <button
                type="button"
                onClick={() => setActiveModalFinding(finding)}
                className="px-2.5 py-1 text-[11px] font-mono font-bold uppercase tracking-widest border border-brutal-border bg-black/40 hover:bg-brutal-primary hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brutal-primary transition-colors text-brutal-primary cursor-pointer flex items-center gap-1.5"
              >
                <span>▶</span> MENTOR
              </button>
            )}
          </div>

          <p className="text-sm text-brutal-secondary leading-relaxed">{finding.message}</p>

          <p className="text-xs text-brutal-muted font-mono pt-2 border-t border-brutal-border border-dashed">
            {finding.file} {finding.lineStart > 0 ? `: L${finding.lineStart}-${finding.lineEnd}` : ''}
          </p>

          {/* Muted note for skip or fallback */}
          {statusNote && (
            <p className="text-xs text-brutal-muted font-mono italic">
              [Note: {statusNote}]
            </p>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="w-full">
      {/* Tabs */}
      <div className="flex flex-wrap border-b border-brutal-border bg-brutal-bg">
        {TABS.map(tab => {
          const isOverview = tab === 'OVERVIEW';
          const isActive = activeTab === tab;
          const count = !isOverview ? categorizedFindings[tab].length : 0;
          
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`
                px-6 py-4 font-mono text-xs font-bold uppercase tracking-widest transition-colors
                focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brutal-primary
                ${isActive 
                  ? 'text-brutal-primary border-b-2 border-brutal-primary bg-brutal-panel' 
                  : 'text-brutal-muted hover:text-brutal-secondary hover:bg-brutal-panel/50 border-b-2 border-transparent'
                }
              `}
            >
              {tab} {!isOverview && <span className="ml-2 px-1.5 py-0.5 bg-black border border-brutal-border text-[10px]">({count})</span>}
            </button>
          );
        })}
      </div>

      <div className="p-6 md:p-10 min-h-[600px] bg-brutal-bg border-x border-b border-brutal-border">
        
        {/* OVERVIEW TAB */}
        {activeTab === 'OVERVIEW' && (
          <div className="space-y-10">
            {/* Stat Cards Row */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
              <div className="bg-brutal-panel border border-brutal-border p-4">
                <p className="text-[10px] text-brutal-muted font-mono uppercase tracking-widest mb-1">Total Findings</p>
                <p className="text-3xl font-bold text-brutal-primary">{stats.total}</p>
              </div>
              <div className="bg-brutal-panel border border-brutal-border p-4">
                <p className="text-[10px] text-red-500 font-mono uppercase tracking-widest mb-1">Critical Issues</p>
                <p className="text-3xl font-bold text-red-500">{stats.critical}</p>
              </div>
              <div className="bg-brutal-panel border border-brutal-border p-4">
                <p className="text-[10px] text-orange-500 font-mono uppercase tracking-widest mb-1">High Severity</p>
                <p className="text-3xl font-bold text-orange-500">{stats.high}</p>
              </div>
              <div className="bg-brutal-panel border border-brutal-border p-4">
                <p className="text-[10px] text-brutal-muted font-mono uppercase tracking-widest mb-1">Security Findings</p>
                <p className="text-3xl font-bold text-brutal-primary">{stats.securityFindings}</p>
              </div>
              <div className="bg-brutal-panel border border-brutal-border p-4">
                <p className="text-[10px] text-brutal-muted font-mono uppercase tracking-widest mb-1">Test Pass Rate</p>
                <p className="text-3xl font-bold text-brutal-primary">{stats.testPassRate !== null ? `${stats.testPassRate}%` : 'N/A'}</p>
              </div>
            </div>

            {/* Top Findings Summary */}
            <div>
              <h3 className="font-bold text-brutal-primary uppercase tracking-widest border-b border-brutal-border pb-2 mb-4">Top Severity Findings</h3>
              {topFindings.length === 0 ? (
                <div className="text-brutal-muted font-mono text-sm uppercase tracking-widest">[ NO FINDINGS RECORDED ]</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                  {topFindings.map(renderFindingCard)}
                </div>
              )}
            </div>
          </div>
        )}

        {/* CATEGORY TABS */}
        {activeTab !== 'OVERVIEW' && activeTab !== 'ARCHITECTURE' && (
          <div className="space-y-6">
            <h3 className="font-bold text-brutal-primary uppercase tracking-widest border-b border-brutal-border pb-2">
              {activeTab} FINDINGS
            </h3>
            {categorizedFindings[activeTab].length === 0 ? (
              <div className="text-brutal-muted font-mono text-sm uppercase tracking-widest py-10 text-center border border-brutal-border border-dashed">
                [ NO {activeTab} FINDINGS DETECTED ]
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {categorizedFindings[activeTab].map(renderFindingCard)}
              </div>
            )}
          </div>
        )}

        {/* ARCHITECTURE TAB */}
        {activeTab === 'ARCHITECTURE' && (
          <div className="h-full w-full">
            <h3 className="font-bold text-brutal-primary uppercase tracking-widest border-b border-brutal-border pb-2 mb-6">
              Architecture Graph & Analysis
            </h3>
            {graphData && graphData.nodes && graphData.nodes.length > 0 ? (
              <div className="w-full">
                <DependencyGraph nodes={graphData.nodes} edges={graphData.edges} findings={findings} />
              </div>
            ) : (
              <div className="text-brutal-muted font-mono text-sm uppercase tracking-widest py-10 text-center border border-brutal-border border-dashed">
                [ NO ARCHITECTURE GRAPH DATA AVAILABLE ]
              </div>
            )}
          </div>
        )}

      </div>

      {/* MENTOR POPUP MODAL WINDOW */}
      {activeModalFinding && activeModalFinding.metadata?.mentor && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
          onClick={() => setActiveModalFinding(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="relative w-full max-w-3xl max-h-[88vh] bg-brutal-panel border-2 border-brutal-border shadow-2xl flex flex-col overflow-hidden text-brutal-primary"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-brutal-border flex items-center justify-between gap-3 bg-black/60">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`text-[10px] font-mono font-bold uppercase px-2 py-0.5 ${
                    activeModalFinding.severity === 'critical'
                      ? 'bg-red-600 text-white'
                      : activeModalFinding.severity === 'high'
                      ? 'bg-red-500 text-white'
                      : activeModalFinding.severity === 'medium'
                      ? 'bg-orange-500 text-black'
                      : activeModalFinding.severity === 'low'
                      ? 'bg-yellow-500 text-black'
                      : 'bg-brutal-border text-white'
                  }`}
                >
                  {activeModalFinding.severity}
                </span>
                <span className="text-brutal-primary font-bold text-base font-mono">
                  {activeModalFinding.ruleId}
                </span>
                <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 border border-brutal-border text-brutal-secondary font-mono">
                  {activeModalFinding.category}
                </span>
                <span className="text-[10px] uppercase font-mono tracking-widest px-2 py-0.5 bg-brutal-primary text-black font-bold">
                  AI MENTOR
                </span>
              </div>

              <button
                type="button"
                onClick={() => setActiveModalFinding(null)}
                className="px-3 py-1 text-xs font-mono font-bold uppercase tracking-widest border border-brutal-border bg-black/40 hover:bg-brutal-primary hover:text-black transition-colors text-brutal-primary cursor-pointer shrink-0"
              >
                ✕ CLOSE
              </button>
            </div>

            {/* Target Location Banner */}
            <div className="px-4 sm:px-5 py-2.5 bg-brutal-bg border-b border-brutal-border border-dashed flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-brutal-muted">
              <span className="text-brutal-primary font-bold">
                {activeModalFinding.file}
                {activeModalFinding.lineStart > 0 ? ` : L${activeModalFinding.lineStart}-${activeModalFinding.lineEnd}` : ''}
              </span>
              <span className="text-xs text-brutal-secondary">{activeModalFinding.message}</span>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 text-brutal-secondary">
              {/* WHAT'S WRONG */}
              <div>
                <h4 className="text-xs font-mono font-bold text-brutal-primary uppercase tracking-widest mb-1.5 flex items-center gap-2">
                  <span className="w-2 h-2 bg-red-500 inline-block"></span>
                  WHAT&apos;S WRONG
                </h4>
                <p className="text-sm leading-relaxed text-brutal-secondary font-sans bg-black/30 p-3.5 border border-brutal-border">
                  {activeModalFinding.metadata.mentor.explanation}
                </p>
              </div>

              {/* WHY IT MATTERS */}
              <div>
                <h4 className="text-xs font-mono font-bold text-brutal-primary uppercase tracking-widest mb-1.5 flex items-center gap-2">
                  <span className="w-2 h-2 bg-orange-500 inline-block"></span>
                  WHY IT MATTERS
                </h4>
                <p className="text-sm leading-relaxed text-brutal-secondary font-sans bg-black/30 p-3.5 border border-brutal-border">
                  {activeModalFinding.metadata.mentor.whyItMatters}
                </p>
              </div>

              {/* HOW TO FIX */}
              <div>
                <h4 className="text-xs font-mono font-bold text-brutal-primary uppercase tracking-widest mb-2 flex items-center gap-2">
                  <span className="w-2 h-2 bg-green-500 inline-block"></span>
                  HOW TO FIX
                </h4>
                <ol className="space-y-2 text-sm text-brutal-secondary bg-black/30 p-3.5 border border-brutal-border">
                  {activeModalFinding.metadata.mentor.howToFix.map((step, idx) => (
                    <li key={idx} className="flex items-start gap-3 font-sans leading-relaxed">
                      <span className="font-mono text-xs font-bold text-brutal-primary bg-brutal-panel border border-brutal-border px-2 py-0.5 shrink-0 mt-0.5">
                        {idx + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>

              {/* BEFORE / AFTER CODE FIX */}
              {activeModalFinding.metadata.mentor.beforeCode && activeModalFinding.metadata.mentor.afterCode && (
                <div>
                  <h4 className="text-xs font-mono font-bold text-brutal-primary uppercase tracking-widest mb-2 flex items-center gap-2">
                    <span className="w-2 h-2 bg-blue-500 inline-block"></span>
                    CODE REMEDIATION (BEFORE / AFTER)
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    <div className="border border-red-900/60 bg-black/50 p-3 flex flex-col">
                      <span className="text-[10px] font-mono text-red-400 font-bold uppercase tracking-wider block mb-2 pb-1 border-b border-red-900/40">
                        ⚠ BEFORE (FLAWED CODE)
                      </span>
                      <pre className="text-xs font-mono text-red-200/90 overflow-x-auto whitespace-pre p-2 bg-black/50 border border-red-950 flex-1">
                        <code>{activeModalFinding.metadata.mentor.beforeCode}</code>
                      </pre>
                    </div>

                    <div className="border border-green-900/60 bg-black/50 p-3 flex flex-col">
                      <span className="text-[10px] font-mono text-green-400 font-bold uppercase tracking-wider block mb-2 pb-1 border-b border-green-900/40">
                        ✓ AFTER (RECOMMENDED FIX)
                      </span>
                      <pre className="text-xs font-mono text-green-200/90 overflow-x-auto whitespace-pre p-2 bg-black/50 border border-green-950 flex-1">
                        <code>{activeModalFinding.metadata.mentor.afterCode}</code>
                      </pre>
                    </div>
                  </div>
                </div>
              )}

              {/* CONCEPT TO LEARN */}
              {activeModalFinding.metadata.mentor.concept && (
                <div className="border border-brutal-border bg-black/30 p-3.5">
                  <h4 className="text-xs font-mono font-bold text-brutal-primary uppercase tracking-widest mb-1 flex items-center gap-2">
                    <span className="w-2 h-2 bg-purple-500 inline-block"></span>
                    CONCEPT TO LEARN: <span className="text-brutal-primary">{activeModalFinding.metadata.mentor.concept.name}</span>
                  </h4>
                  <p className="text-xs text-brutal-secondary leading-relaxed font-sans pt-1">
                    {activeModalFinding.metadata.mentor.concept.summary}
                  </p>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-3 sm:p-4 bg-black/60 border-t border-brutal-border flex items-center justify-between text-xs font-mono text-brutal-muted">
              <span>Press ESC or click outside to close</span>
              <button
                type="button"
                onClick={() => setActiveModalFinding(null)}
                className="px-4 py-1.5 text-xs font-mono font-bold uppercase tracking-widest border border-brutal-border bg-brutal-panel hover:bg-brutal-primary hover:text-black transition-colors text-brutal-primary cursor-pointer"
              >
                CLOSE
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
