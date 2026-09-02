'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

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

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [detectedStack, setDetectedStack] = useState<{ languages: string[], frameworks: string[] } | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const refreshAccessToken = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) return null;
      const body = await res.json();
      const newToken = body.data?.accessToken;
      if (newToken) {
        sessionStorage.setItem('access_token', newToken);
        return newToken;
      }
      return null;
    } catch {
      return null;
    }
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

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  useEffect(() => {
    if (user) {
      fetchRepos();
    }
  }, [user, fetchRepos]);

  useEffect(() => {
    if (!activeJobId) return;

    const interval = setInterval(async () => {
      try {
        const res = await authenticatedFetch(`${API_URL}/jobs/${activeJobId}`);
        if (res.ok) {
          const body = await res.json();
          setJobStatus(body.data.status);
          if (body.data.repository?.detectedStack) {
            setDetectedStack(body.data.repository.detectedStack);
          }
          if (body.data.status === 'done' || body.data.status === 'failed') {
            clearInterval(interval);
          }
        }
      } catch (err) {
        console.error(err);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [activeJobId, authenticatedFetch]);

  const handleSelectRepo = async (repoFullName: string) => {
    try {
      setJobStatus('initiating');
      setDetectedStack(null);
      const res = await authenticatedFetch(`${API_URL}/repos/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoFullName, role: 'Developer' }),
      });
      if (!res.ok) throw new Error('Failed to select repo');
      const body = await res.json();
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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center text-white">
        <p>Error: {error}</p>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-950 via-indigo-950 to-gray-950 p-6 md:p-10">
      <header className="max-w-5xl mx-auto flex items-center justify-between mb-12">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold">M</div>
          <span className="text-white font-semibold text-lg">MentorQA</span>
        </div>
        <button onClick={handleLogout} className="px-4 py-2 rounded-lg bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white transition">
          Log out
        </button>
      </header>

      <div className="max-w-5xl mx-auto space-y-8">
        {/* Welcome Section */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-8 flex items-center gap-5">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white text-2xl font-bold">
            {user?.username?.[0]?.toUpperCase()}
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white">@{user?.username}</h1>
            <p className="text-gray-400">{user?.email}</p>
          </div>
        </div>

        {/* Job Status Section */}
        {jobStatus && (
          <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-6 space-y-4">
            <h2 className="text-xl font-semibold text-white flex items-center gap-3">
              {(jobStatus !== 'done' && jobStatus !== 'failed') && (
                <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
              )}
              Pipeline Status: <span className="text-indigo-400 capitalize">{jobStatus}</span>
            </h2>
            
            {detectedStack && (
              <div className="bg-black/20 p-4 rounded-lg border border-white/5">
                <p className="text-sm font-medium text-gray-400 mb-2">Detected Stack:</p>
                <div className="flex flex-wrap gap-2">
                  {[...detectedStack.languages, ...detectedStack.frameworks].map((tech: string) => (
                    <span key={tech} className="px-3 py-1 bg-indigo-600/30 text-indigo-200 text-sm rounded-full border border-indigo-500/30">
                      {tech}
                    </span>
                  ))}
                  {detectedStack.languages.length === 0 && detectedStack.frameworks.length === 0 && (
                    <span className="text-gray-500 italic">No recognizable framework detected</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Repositories Section */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-8">
          <h2 className="text-2xl font-bold text-white mb-6">Your Repositories</h2>
          
          {reposLoading ? (
            <p className="text-gray-400 animate-pulse">Loading repositories...</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {repos.map(repo => (
                <div key={repo.id} className="p-4 rounded-xl border border-white/10 bg-black/20 hover:border-indigo-500/50 transition cursor-pointer group" onClick={() => handleSelectRepo(repo.fullName)}>
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-white font-medium group-hover:text-indigo-400 transition">{repo.name}</h3>
                      <p className="text-xs text-gray-500 mt-1">{repo.private ? 'Private' : 'Public'} • {repo.defaultBranch}</p>
                    </div>
                    <button className="text-xs font-medium px-3 py-1 bg-white/5 hover:bg-indigo-600 text-gray-300 hover:text-white rounded-md transition">
                      Analyze
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
