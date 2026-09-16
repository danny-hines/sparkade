'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
export function JobRefresh({
  message = 'This page updates automatically. You can safely leave and come back.',
}: { message?: string } = {}) {
  const router = useRouter();
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, 5000);
    return () => clearInterval(interval);
  }, [router]);
  return (
    <p className="arc-fine-print" role="status">
      {message}
    </p>
  );
}
