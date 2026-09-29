'use client';

import { useState, useMemo } from 'react';
import DependencyGraph from './DependencyGraph';

interface Finding {
  id: string;
  category: string;
  severity: string;
  file: string;
  lineStart: number;
  lineEnd: number;
  message: string;
  ruleId: string;
}

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

  const renderFindingCard = (finding: Finding) => (
    <div key={finding.id} className="p-4 bg-brutal-panel border border-brutal-border flex flex-col md:flex-row md:items-start gap-4 h-full">
      <div className={`w-1 h-auto self-stretch min-h-[40px] shrink-0 ${finding.severity === 'critical' ? 'bg-red-600' : finding.severity === 'high' ? 'bg-red-500' : finding.severity === 'medium' ? 'bg-orange-500' : finding.severity === 'low' ? 'bg-yellow-500' : 'bg-brutal-border'}`}></div>
      <div className="flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-brutal-primary font-bold text-sm">{finding.ruleId}</span>
          <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 border border-brutal-border text-brutal-secondary font-mono">{finding.category}</span>
        </div>
        <p className="text-sm text-brutal-secondary leading-relaxed line-clamp-3">{finding.message}</p>
        <p className="text-xs text-brutal-muted font-mono mt-auto pt-2 border-t border-brutal-border border-dashed">
          {finding.file} {finding.lineStart > 0 ? `: L${finding.lineStart}-${finding.lineEnd}` : ''}
        </p>
      </div>
    </div>
  );

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
    </div>
  );
}
