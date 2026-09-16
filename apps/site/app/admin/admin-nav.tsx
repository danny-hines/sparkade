'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { adminSections } from './sections';

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="admin-nav admin-shell" aria-label="Admin sections">
      {adminSections.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          aria-current={
            pathname === href || (href !== '/admin' && pathname.startsWith(`${href}/`))
              ? 'page'
              : undefined
          }
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
