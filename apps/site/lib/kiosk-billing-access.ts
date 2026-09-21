import { requireAdminIdentity } from './admin-auth';

/** Separate billing gate for future scoped admins. Today the allowlist represents
 * global operators; mutations additionally check kiosk/credential ownership. */
export async function requireKioskBillingAdmin() {
  return requireAdminIdentity();
}
