import type { KioskMetaCredentialSummary } from '@/lib/kiosk-meta-credentials';
import {
  META_BILLING_TIME_ZONE,
  SHARED_META_KEY,
  type MetaSpendSummary,
} from '@/lib/kiosk-meta-spend';
import {
  assignMetaCredentialAction,
  disableMetaCredentialAction,
  saveMetaCredentialAction,
  useSharedMetaCredentialAction,
  setMetaLimitsAction,
} from './billing-actions';

export function KioskBilling({
  kioskId,
  credentialId,
  credentials,
  disabled,
}: {
  kioskId: string;
  credentialId?: string;
  credentials: KioskMetaCredentialSummary[];
  disabled: boolean;
}) {
  const current = credentials.find((credential) => credential.id === credentialId);
  return (
    <div className="admin-kiosk-copy-form">
      <strong>Meta API billing</strong>
      <p>
        {credentialId
          ? `${current?.label ?? 'Unavailable credential'}${current ? ` · ••••${current.suffix}` : ''}${!current || current.revoked ? ' · Disabled — generation blocked' : ''}`
          : 'Using the shared Sparkade Meta key.'}
      </p>
      <form action={assignMetaCredentialAction} className="admin-inline-form">
        <input type="hidden" name="kioskId" value={kioskId} />
        <label>
          Cloud generation credential
          <select
            name="credentialId"
            defaultValue={credentialId ?? ''}
            required
            disabled={disabled}
          >
            <option value="" disabled>
              Choose a saved credential
            </option>
            {credentials.map((credential) => (
              <option key={credential.id} value={credential.id} disabled={credential.revoked}>
                {credential.label} · ••••{credential.suffix}
                {credential.revoked ? ' (disabled)' : ''}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={disabled || !credentials.some((c) => !c.revoked)}>
          Assign
        </button>
      </form>
      <p>
        Applies to new cloud jobs and voice requests. An unavailable override blocks requests
        instead of using the shared key. Existing jobs keep their assigned credential.
      </p>
      {credentialId && !disabled ? (
        <details className="admin-danger-zone">
          <summary>Return to shared billing</summary>
          <p>
            New requests from this kiosk will use Sparkade&apos;s shared Meta key and its associated
            account.
          </p>
          <form action={useSharedMetaCredentialAction}>
            <input type="hidden" name="kioskId" value={kioskId} />
            <button type="submit">Use shared Meta key</button>
          </form>
        </details>
      ) : null}
    </div>
  );
}

export function MetaCredentials({
  credentials,
  configured,
  spending,
}: {
  credentials: KioskMetaCredentialSummary[];
  configured: boolean;
  spending: Record<string, MetaSpendSummary>;
}) {
  return (
    <section className="admin-section admin-credentials" aria-labelledby="meta-credentials-title">
      <div className="admin-section-heading">
        <div>
          <span>Cloud generation billing</span>
          <h2 id="meta-credentials-title">Meta API credentials</h2>
        </div>
        <p>Save a Meta API key and assign it to one or more kiosks.</p>
      </div>
      <p>
        Keys are encrypted on the server and are never sent to kiosks or shown again. Local
        generation on a Pi uses its local configuration; enable cloud mode to use these overrides.
      </p>
      <p>
        Spend is estimated in USD from Sparkade cloud usage and saved model prices. Reserved amounts
        cover in-flight or uncertain requests and count toward budgets. Usage outside Sparkade and
        before tracking began is not included. Totals update when you reload this page.
      </p>
      {!configured ? (
        <p role="status">
          Credential storage needs server setup before you can save keys. Configure
          SPARKADE_KIOSK_META_SECRET as described in the deployment settings.
        </p>
      ) : null}
      <form action={saveMetaCredentialAction} className="admin-pair-form admin-credential-form">
        <input type="hidden" name="credentialId" value="" />
        <label>
          Credential name
          <input
            name="label"
            placeholder="Kiosk API key"
            maxLength={80}
            required
            disabled={!configured}
          />
        </label>
        <label>
          Meta API key
          <input
            type="password"
            name="apiKey"
            autoComplete="new-password"
            autoCapitalize="none"
            spellCheck={false}
            minLength={20}
            maxLength={4096}
            required
            disabled={!configured}
          />
        </label>
        <button type="submit" disabled={!configured}>
          Save credential
        </button>
      </form>
      <div className="admin-kiosk-grid">
        <article className="admin-kiosk-card admin-shared-billing">
          <strong>Sparkade shared key</strong>
          <p>Website generation, content checks, and cloud kiosks without an override.</p>
          <MetaSpend summary={spending[SHARED_META_KEY]!} />
        </article>
        {credentials.map((credential) => (
          <article className="admin-kiosk-card" key={credential.id}>
            <strong>{credential.label}</strong>
            <p>
              ••••{credential.suffix} · {credential.assignedKiosks} kiosks ·{' '}
              {credential.revoked ? 'Disabled' : 'Saved'}
            </p>
            <MetaSpend summary={spending[credential.id]!} disabled={credential.revoked} />
            {!credential.revoked ? (
              <>
                <details>
                  <summary>Replace key</summary>
                  <form action={saveMetaCredentialAction} className="admin-kiosk-copy-form">
                    <input type="hidden" name="credentialId" value={credential.id} />
                    <label>
                      Credential name
                      <input
                        name="label"
                        defaultValue={credential.label}
                        maxLength={80}
                        required
                        disabled={!configured}
                      />
                    </label>
                    <label>
                      New Meta API key
                      <input
                        name="apiKey"
                        type="password"
                        autoComplete="new-password"
                        autoCapitalize="none"
                        spellCheck={false}
                        minLength={20}
                        maxLength={4096}
                        required
                        disabled={!configured}
                      />
                    </label>
                    <p>
                      All kiosks and unfinished jobs assigned to this credential will use the
                      replacement key on their next request.
                    </p>
                    <button type="submit" disabled={!configured}>
                      Replace key
                    </button>
                  </form>
                </details>
                <details className="admin-danger-zone">
                  <summary>Disable credential</summary>
                  <p>
                    This removes the stored key and blocks requests using it, including unfinished
                    jobs. They will not use the shared key automatically.
                  </p>
                  <form action={disableMetaCredentialAction}>
                    <input type="hidden" name="credentialId" value={credential.id} />
                    <button type="submit">Disable {credential.label}</button>
                  </form>
                </details>
              </>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

const usd = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value);
const resetTime = (value: string) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: META_BILLING_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(value));

function MetaSpend({
  summary,
  disabled = false,
}: {
  summary: MetaSpendSummary;
  disabled?: boolean;
}) {
  const periods = [
    ['daily', 'Today'],
    ['weekly', 'This week'],
    ['monthly', 'This month'],
    ['lifetime', 'Tracked lifetime'],
  ] as const;
  return (
    <>
      <dl className="admin-meta-spend">
        {periods.map(([period, label]) => {
          const total = summary.periods[period];
          const cap =
            period === 'daily'
              ? summary.limits.dailyUsd
              : period === 'weekly'
                ? summary.limits.weeklyUsd
                : null;
          return (
            <div key={period}>
              <dt>{label}</dt>
              <dd>{usd(total.spent)}</dd>
              {total.reserved > 0 ? <small>+ {usd(total.reserved)} reserved</small> : null}
              {cap !== null ? (
                <small>
                  {usd(Math.max(0, cap - total.spent - total.reserved))} remaining of {usd(cap)}
                </small>
              ) : null}
            </div>
          );
        })}
      </dl>
      <p className="admin-meta-help">
        Pacific time · Daily reset {resetTime(summary.nextDailyReset)} · Weekly reset{' '}
        {resetTime(summary.nextWeeklyReset)} (Monday). {summary.activeRequests} active requests
        {summary.limits.concurrency !== null ? ` / ${summary.limits.concurrency} allowed` : ''}.{' '}
        {summary.trackedSince
          ? `Tracked since ${resetTime(summary.trackedSince)}.`
          : 'Tracking starts with the next request.'}
      </p>
      {summary.paused ? (
        <p role="status" className="admin-meta-alert">
          Billing paused: provider usage exceeded its reservation. Review pricing and save limits to
          resume.
        </p>
      ) : null}
      {!disabled ? (
        <details className="admin-meta-limits">
          <summary>Budgets and request limit</summary>
          <form action={setMetaLimitsAction} className="admin-kiosk-copy-form">
            <input type="hidden" name="keyId" value={summary.keyId} />
            <label>
              Daily budget (USD)
              <input
                type="number"
                name="dailyUsd"
                min="0"
                max="1000000000"
                step="0.01"
                placeholder="No cap"
                defaultValue={summary.limits.dailyUsd ?? ''}
              />
            </label>
            <label>
              Weekly budget (USD)
              <input
                type="number"
                name="weeklyUsd"
                min="0"
                max="1000000000"
                step="0.01"
                placeholder="No cap"
                defaultValue={summary.limits.weeklyUsd ?? ''}
              />
            </label>
            <label>
              Concurrent requests
              <input
                type="number"
                name="concurrency"
                min="1"
                max="10000"
                step="1"
                placeholder="System limit"
                defaultValue={summary.limits.concurrency ?? ''}
              />
            </label>
            <p>
              Leave a budget blank for no cap; $0 pauses paid requests. Both budgets apply across
              all uses of this key. Waiting jobs retry automatically. Replacing the key preserves
              limits and spend.
            </p>
            <button type="submit">
              {summary.paused ? 'Save limits and resume' : 'Save limits'}
            </button>
          </form>
        </details>
      ) : null}
    </>
  );
}
