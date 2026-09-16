import { randomUUID } from 'node:crypto';
import { env } from '@/lib/arcade';
import { getAdminPageIdentity } from '../page-access';
import { AdminNotice, type AdminQuery } from '../admin-notice';
import { AccountForm } from './account-form';
export const metadata = { title: 'Admin · Accounts' };
export const dynamic = 'force-dynamic';
export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<AdminQuery>;
}) {
  if (!(await getAdminPageIdentity('/admin/accounts'))) return null;
  const operationKey = randomUUID();
  return (
    <>
      <section className="admin-hero">
        <span className="admin-kicker">Player access · {env()}</span>
        <h1>Accounts</h1>
        <p>
          Grant credits, pause accounts, and restore access. Every change is recorded with your
          reason.
        </p>
      </section>
      <AdminNotice query={await searchParams} />
      <section className="arc-panel arc-section">
        <h2>Accounts & credit grants</h2>
        <AccountForm key={operationKey} operationKey={operationKey} />
      </section>
    </>
  );
}
