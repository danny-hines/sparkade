import { ClerkProvider } from '@clerk/nextjs';
import type { ReactNode } from 'react';

export default function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <ClerkProvider>{children}</ClerkProvider>;
}
