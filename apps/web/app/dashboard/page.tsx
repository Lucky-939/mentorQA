/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, no-empty, prefer-const, react-hooks/exhaustive-deps */
'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import ReviewResults from '@/components/ReviewResults';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface AuthUser {
  id: string;
  username: string;
  email: string | null;
}

interface Repo {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  updatedAt: string;
}

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

const SPINNER_CHARS = ['|', '/', '-', '\\'];

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'updated' | 'name'>('updated');
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [detectedStack, setDetectedStack] = useState<{ languages: string[], frameworks: string[] } | null>(null);
  const [jobFindings, setJobFindings] = useState<Finding[] | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeRepoFullName, setActiveRepoFullName] = useState<string | null>(null);
  const [graphData, setGraphData] = useState<{ nodes: any[], edges: any[] } | null>(null);
  const [spinnerFrame, setSpinnerFrame] = useState(0);

  // ASCII spinner tick
  useEffect(() => {
    const t = setInterval(() => setSpinnerFrame(f => (f + 1) % 4), 200);
    return () => clearInterval(t);
  }, []);

  const isTerminal = (s: string | null) =>
    s === 'done' || s === 'failed' || s === 'static analysis failed';

  const filteredAndSortedRepos = useMemo(() => {
    const result = repos.filter(repo =>
      repo.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
    if (sortOrder === 'name') {
      result.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      result.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }
    return result;
  }, [repos, searchQuery, sortOrder]);

  const getTimeAgo = (dateString: string) => {
    const diff = Date.now() - new Date(dateString).getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return 'updated today';
    if (days === 1) return 'updated 1 day ago';
    if (days < 30) return `updated ${days} days ago`;
    const months = Math.floor(days / 30);
    if (months === 1) return 'updated 1 month ago';
    return `updated ${months} months ago`;
  };

  const refreshAccessToken = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', credentials: 'include' });
      if (!res.ok) return null;
      const body = await res.json();
      const newToken = body.data?.accessToken;
      if (newToken) { sessionStorage.setItem('access_token', newToken); return newToken; }
      return null;
    } catch { return null; }
  }, []);

  const authenticatedFetch = useCallback(async (url: string, options: RequestInit = {}) => {
    let token = sessionStorage.getItem('access_token');
    if (!token) {
      token = await refreshAccessToken();
      if (!token) throw new Error('Not authenticated');
    }
    let res = await fetch(url, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${token}` },
      credentials: 'include',
    });
    if (res.status === 401) {
      token = await refreshAccessToken();
      if (!token) throw new Error('Session expired');
      res = await fetch(url, {
        ...options,
        headers: { ...options.headers, Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
    }
    return res;
  }, [refreshAccessToken]);

  const fetchUser = useCallback(async () => {
    try {
      const res = await authenticatedFetch(`${API_URL}/auth/me`);
      if (!res.ok) throw new Error('Failed to fetch user');
      const body = await res.json();
      setUser(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      router.replace('/');
    } finally {
      setLoading(false);
    }
  }, [authenticatedFetch, router]);

  const fetchRepos = useCallback(async () => {
    try {
      setReposLoading(true);
      const res = await authenticatedFetch(`${API_URL}/repos`);
      if (!res.ok) throw new Error('Failed to fetch repos');
      const body = await res.json();
      setRepos(body.data);
    } catch (err) {
      console.error(err);
    } finally {
      setReposLoading(false);
    }
  }, [authenticatedFetch]);

  useEffect(() => { fetchUser(); }, [fetchUser]);
  useEffect(() => { if (user) fetchRepos(); }, [user, fetchRepos]);

  useEffect(() => {
    if (!activeJobId) return;
    const interval = setInterval(async () => {
      try {
        const res = await authenticatedFetch(`${API_URL}/jobs/${activeJobId}`);
        if (res.ok) {
          const body = await res.json();
          setJobStatus(body.data.status);
          if (body.data.repository?.detectedStack) setDetectedStack(body.data.repository.detectedStack);
          if (body.data.review?.findings) setJobFindings(body.data.review.findings);
          if (isTerminal(body.data.status)) {
            clearInterval(interval);
            if (body.data.status === 'done') {
              try {
                const graphRes = await authenticatedFetch(`${API_URL}/jobs/${activeJobId}/graph`);
                if (graphRes.ok) {
                  const graphBody = await graphRes.json();
                  setGraphData(graphBody.data);
                }
              } catch (e) { console.error('Failed to fetch graph data:', e); }
            }
          }
        }
      } catch (err) { console.error(err); }
    }, 2000);
    return () => clearInterval(interval);
  }, [activeJobId, authenticatedFetch]);

  const handleSelectRepo = async (repoFullName: string) => {
    try {
      setJobStatus('initiating');
      setDetectedStack(null);
      setGraphData(null);
      setJobFindings(null);
      const res = await authenticatedFetch(`${API_URL}/repos/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoFullName, role: 'Developer' }),
      });
      if (!res.ok) throw new Error('Failed to select repo');
      const body = await res.json();
      setActiveRepoFullName(repoFullName);
      setActiveJobId(body.data.jobId);
    } catch (err) {
      console.error(err);
      setJobStatus('failed');
    }
  };

  const handleLogout = async () => {
    try {
      await fetch(`${API_URL}/auth/logout`, { method: 'POST', credentials: 'include' });
    } finally {
      sessionStorage.removeItem('access_token');
      router.replace('/');
    }
  };

  const handleReset = () => {
    setJobStatus(null);
    setJobFindings(null);
    setGraphData(null);
    setActiveJobId(null);
    setActiveRepoFullName(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-brutal-bg flex items-center justify-center font-mono text-brutal-primary uppercase tracking-widest">
        [ LOADING... ]
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-brutal-bg flex items-center justify-center font-mono text-red-500 uppercase tracking-widest">
        [ ERROR: {error} ]
      </div>
    );
  }

  const statusBorderColor = jobStatus === 'done' ? 'border-green-500' : jobStatus === 'failed' ? 'border-red-500' : 'border-brutal-border';
  const statusTextColor = jobStatus === 'done' ? 'text-green-500' : jobStatus === 'failed' ? 'text-red-500' : 'text-brutal-primary';

  return (
    <main className="min-h-screen bg-brutal-bg">
      {/* ── Header ── */}
      <header className="border-b border-brutal-border bg-brutal-bg p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-brutal-primary flex items-center justify-center text-black font-bold">M</div>
          <span className="text-brutal-primary font-bold tracking-widest uppercase text-sm">MentorQA</span>
        </div>
        <div className="flex items-center gap-4">
          {user && (
            <div className="hidden sm:flex items-center gap-3 border-r border-brutal-border pr-4">
              <span className="text-brutal-primary font-bold tracking-tight text-sm">@{user.username}</span>
              <div className="w-8 h-8 border border-brutal-border bg-brutal-panel flex items-center justify-center text-brutal-primary font-bold uppercase">
                {user.username?.[0]}
              </div>
            </div>
          )}
          <button
            onClick={handleLogout}
            className="px-4 py-2 border border-brutal-border bg-transparent text-brutal-primary hover:bg-brutal-border focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brutal-primary transition-colors uppercase tracking-widest text-xs font-bold"
          >
            LOGOUT
          </button>
        </div>
      </header>

      {/* ── Pre-terminal content: pipeline status + repo grid ── */}
      {!isTerminal(jobStatus) && (
        <div className="max-w-4xl mx-auto p-6 md:p-10 space-y-10">

          {/* Pipeline status card — only while job is in-progress */}
          {jobStatus && (
            <div className="space-y-4">
              <h2 className="uppercase tracking-widest text-brutal-muted text-xs font-bold">PIPELINE STATUS</h2>
              <div className={`border bg-brutal-panel p-6 ${statusBorderColor}`}>
                <h3 className={`text-xl font-bold uppercase tracking-widest flex items-center gap-3 ${statusTextColor}`}>
                  {jobStatus !== 'failed' && (
                    <span className="font-mono mr-2">[{SPINNER_CHARS[spinnerFrame]}]</span>
                  )}
                  {jobStatus}
                </h3>
                {detectedStack && (
                  <div className="mt-6 border-t border-brutal-border pt-6">
                    <p className="text-xs font-bold uppercase tracking-widest text-brutal-muted mb-3">DETECTED STACK</p>
                    <div className="flex flex-wrap gap-2 font-mono text-sm">
                      {[...detectedStack.languages, ...detectedStack.frameworks].map((tech: string) => (
                        <span key={tech} className="px-3 py-1 bg-transparent border border-brutal-border text-brutal-primary">
                          {tech}
                        </span>
                      ))}
                      {detectedStack.languages.length === 0 && detectedStack.frameworks.length === 0 && (
                        <span className="text-brutal-muted">No recognizable framework detected</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Repository grid — only when no active job */}
          {!jobStatus && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <h2 className="uppercase tracking-widest text-brutal-muted text-xs font-bold">
                  REPOSITORIES{repos.length > 0 && (
                    <span className="text-brutal-secondary font-mono ml-2">
                      ({repos.length === 30 ? 'SHOWING FIRST 30' : repos.length})
                    </span>
                  )}
                </h2>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <select
                    value={sortOrder}
                    onChange={(e) => setSortOrder(e.target.value as 'updated' | 'name')}
                    className="bg-brutal-bg border border-brutal-border px-3 py-2 text-brutal-primary text-xs font-mono focus:outline-none focus:border-brutal-primary cursor-pointer"
                  >
                    <option value="updated">SORT: LAST UPDATED</option>
                    <option value="name">SORT: NAME</option>
                  </select>
                  <input
                    type="text"
                    placeholder="SEARCH..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="bg-brutal-bg border border-brutal-border px-3 py-2 text-brutal-primary text-xs font-mono focus:outline-none focus:border-brutal-primary placeholder:text-brutal-border w-full sm:w-48"
                  />
                </div>
              </div>

              {reposLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="p-4 border border-brutal-border bg-brutal-panel animate-pulse flex flex-col gap-4 h-32">
                      <div className="h-5 w-3/4 bg-brutal-bg border border-brutal-border" />
                      <div className="h-3 w-1/2 bg-brutal-bg border border-brutal-border" />
                      <div className="mt-auto h-8 w-24 bg-brutal-bg border border-brutal-border self-end" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredAndSortedRepos.length === 0 ? (
                    <div className="col-span-full p-6 text-center text-brutal-muted font-mono tracking-widest text-sm uppercase border border-brutal-border">
                      [ NO REPOSITORIES MATCH ]
                    </div>
                  ) : (
                    filteredAndSortedRepos.map(repo => (
                      <div
                        key={repo.id}
                        onClick={() => handleSelectRepo(repo.fullName)}
                        tabIndex={0}
                        role="button"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleSelectRepo(repo.fullName);
                          }
                        }}
                        className="p-4 border border-brutal-border bg-brutal-bg flex flex-col justify-between gap-4 hover:bg-brutal-panel focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brutal-primary transition-colors cursor-pointer group"
                      >
                        <div>
                          <h3 className="text-brutal-primary font-bold text-base line-clamp-1" title={repo.name}>{repo.name}</h3>
                          <p className="text-xs text-brutal-secondary font-mono mt-2">
                            {repo.private ? '[ PRIVATE ]' : '[ PUBLIC ]'}<br />
                            <span className="text-brutal-muted mt-1 inline-block">{repo.defaultBranch} &bull; {getTimeAgo(repo.updatedAt)}</span>
                          </p>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleSelectRepo(repo.fullName); }}
                          tabIndex={-1}
                          className="self-end px-3 py-1.5 border border-brutal-border bg-transparent text-brutal-primary group-hover:bg-brutal-primary group-hover:text-black transition-colors uppercase tracking-widest text-[10px] font-bold"
                        >
                          ANALYZE
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

        </div>
      )}

      {/* ── Full-width results — shown when job reaches terminal state ── */}
      {isTerminal(jobStatus) && jobFindings && (
        <div className="w-full px-6 md:px-10 pb-16 pt-6 flex flex-col gap-6">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div>
              <h2 className="text-brutal-primary font-bold text-xl uppercase tracking-widest">
                ANALYSIS COMPLETE: <span className="text-brutal-secondary">{activeRepoFullName}</span>
              </h2>
              {jobStatus === 'done' && detectedStack && (
                <div className="flex flex-wrap gap-2 font-mono text-[10px] mt-3">
                  {[...detectedStack.languages, ...detectedStack.frameworks].map((tech: string) => (
                    <span key={tech} className="px-2 py-0.5 bg-transparent border border-brutal-border text-brutal-primary tracking-widest uppercase">
                      {tech}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={handleReset}
              className="px-4 py-2 border border-brutal-border bg-transparent text-brutal-primary hover:bg-brutal-panel focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brutal-primary transition-colors uppercase tracking-widest text-xs font-bold whitespace-nowrap self-start sm:self-auto"
            >
              &larr; ANALYZE ANOTHER REPO
            </button>
          </div>
          <ReviewResults findings={jobFindings} graphData={graphData} />
        </div>
      )}
    </main>
  );
}
