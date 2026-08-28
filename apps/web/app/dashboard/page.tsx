'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface AuthUser {
  id: string;
  username: string;
  email: string | null;
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Attempt a token refresh using the httpOnly refresh cookie. */
  const refreshAccessToken = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include', // sends the refresh_token cookie
      });

      if (!res.ok) return null;
      const body = await res.json();
      const newToken: string = body.data?.accessToken;
      if (newToken) {
        sessionStorage.setItem('access_token', newToken);
        return newToken;
      }
      return null;
    } catch {
      return null;
    }
  }, []);

  /** Fetch the current user profile. Retries once with a refreshed token. */
  const fetchUser = useCallback(async () => {
    let token = sessionStorage.getItem('access_token');

    // If no token in sessionStorage, try a silent refresh (covers page reload)
    if (!token) {
      token = await refreshAccessToken();
    }

    if (!token) {
      router.replace('/');
      return;
    }

    try {
      let res = await fetch(`${API_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });

      if (res.status === 401) {
        // Token may be expired — try to refresh once
        const refreshed = await refreshAccessToken();
        if (!refreshed) {
          router.replace('/');
          return;
        }
        res = await fetch(`${API_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${refreshed}` },
          credentials: 'include',
        });
      }

      if (!res.ok) throw new Error('Failed to fetch user');

      const body = await res.json();
      setUser(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [router, refreshAccessToken]);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const handleLogout = async () => {
    try {
      await fetch(`${API_URL}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } finally {
      sessionStorage.removeItem('access_token');
      router.replace('/');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-white">
          <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400">Loading your dashboard…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-red-400">Something went wrong: {error}</p>
          <button
            onClick={() => router.replace('/')}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
          >
            Go back
          </button>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-950 via-indigo-950 to-gray-950 p-6 md:p-10">
      {/* Header */}
      <header className="max-w-5xl mx-auto flex items-center justify-between mb-12">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
            <span className="text-white font-bold text-sm">M</span>
          </div>
          <span className="text-white font-semibold text-lg">MentorQA</span>
        </div>

        <button
          id="logout-btn"
          onClick={handleLogout}
          className="
            px-4 py-2 rounded-lg border border-white/10 bg-white/5
            text-gray-300 text-sm font-medium
            hover:bg-white/10 hover:text-white
            transition-all duration-200
          "
        >
          Log out
        </button>
      </header>

      {/* Welcome card */}
      <div className="max-w-5xl mx-auto">
        <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-8 md:p-12 space-y-6">
          {/* Avatar placeholder + greeting */}
          <div className="flex items-center gap-5">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white text-2xl font-bold">
              {user?.username?.[0]?.toUpperCase() ?? '?'}
            </div>
            <div>
              <p className="text-gray-400 text-sm">Welcome back</p>
              <h1 className="text-3xl font-bold text-white">
                @{user?.username ?? 'unknown'}
              </h1>
              {user?.email && (
                <p className="text-gray-500 text-sm mt-0.5">{user.email}</p>
              )}
            </div>
          </div>

          {/* Phase indicator */}
          <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-6 space-y-2">
            <div className="flex items-center gap-2 text-indigo-400 font-semibold">
              <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
              Phase 0 — Setup Complete
            </div>
            <p className="text-gray-400 text-sm leading-relaxed">
              Your MentorQA workspace is ready. Repository connection, analysis pipeline, and
              progress tracking will be available in Phase 1+.
            </p>
          </div>

          {/* Placeholder metric cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
            {[
              { label: 'Repositories', value: '—', sub: 'Connect in Phase 1' },
              { label: 'Test Runs', value: '—', sub: 'Available in Phase 2' },
              { label: 'Issues Found', value: '—', sub: 'Available in Phase 2' },
            ].map((card) => (
              <div
                key={card.label}
                className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-1"
              >
                <p className="text-gray-400 text-xs font-medium uppercase tracking-wider">
                  {card.label}
                </p>
                <p className="text-3xl font-bold text-white">{card.value}</p>
                <p className="text-gray-600 text-xs">{card.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
