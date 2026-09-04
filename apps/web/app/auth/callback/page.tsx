'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function CallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const token = searchParams.get('token');
    const error = searchParams.get('error');

    if (error) {
      // Auth failed — go back to home with error indicator
      router.replace('/?error=auth_failed');
      return;
    }

    if (token) {
      // Store access token in sessionStorage
      // sessionStorage: survives page reload, cleared on tab close — good for Phase 0
      sessionStorage.setItem('access_token', token);
      router.replace('/dashboard');
    } else {
      router.replace('/');
    }
  }, [searchParams, router]);

  return (
    <div className="min-h-screen bg-brutal-bg flex items-center justify-center font-mono text-brutal-primary uppercase tracking-widest">
      [ AUTHENTICATING... ]
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-brutal-bg flex items-center justify-center font-mono text-brutal-primary uppercase tracking-widest">
          [ AUTHENTICATING... ]
        </div>
      }
    >
      <CallbackHandler />
    </Suspense>
  );
}
