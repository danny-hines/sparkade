'use client';

import { useEffect, useState } from 'react';
import { isoToLocalInputValue, localPartsToIso, parseLocalInputValue } from './invite-datetime';

function fallbackCopy(value: string): boolean {
  const area = document.createElement('textarea');
  area.value = value;
  area.setAttribute('readonly', '');
  area.style.position = 'absolute';
  area.style.left = '-9999px';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(area);
  return ok;
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');
  return (
    <span className="admin-copy-wrap">
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setState('copied');
          } catch {
            setState(fallbackCopy(value) ? 'copied' : 'manual');
          }
          window.setTimeout(
            () => setState((current) => (current === 'manual' ? current : 'idle')),
            2000,
          );
        }}
      >
        {state === 'copied' ? 'Copied' : label}
      </button>
      {state === 'manual' ? (
        <span className="admin-muted">
          Copy failed — select manually:{' '}
          <input readOnly value={value} onFocus={(event) => event.target.select()} />
        </span>
      ) : null}
    </span>
  );
}

export function CopyInviteLinkButton({ code }: { code: string }) {
  const copyAbsoluteLink = async (): Promise<'copied' | 'manual'> => {
    const absolute = `${window.location.origin}/sign-up?invite=${encodeURIComponent(code)}`;
    try {
      await navigator.clipboard.writeText(absolute);
      return 'copied';
    } catch {
      return fallbackCopy(absolute) ? 'copied' : 'manual';
    }
  };
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const absolutePreview = `/sign-up?invite=${encodeURIComponent(code)}`;
  return (
    <span className="admin-copy-wrap">
      <button
        type="button"
        onClick={async () => {
          const result = await copyAbsoluteLink();
          setState(result);
          if (result === 'copied') {
            window.setTimeout(() => setState('idle'), 2000);
          }
        }}
      >
        {state === 'copied' ? 'Copied' : 'Copy signup link'}
      </button>
      {state === 'manual' ? (
        <span className="admin-muted">
          Copy failed — copy this link manually (same origin as this page):{' '}
          <input
            readOnly
            value={`${window.location.origin}${absolutePreview}`}
            onFocus={(event) => event.target.select()}
          />
        </span>
      ) : null}
    </span>
  );
}

/**
 * Expiry editor. The server supplies the current expiry as a canonical ISO
 * instant; the browser renders it in the operator's zone after mount (so the
 * server zone never leaks in) and converts an edited selection back to ISO
 * using that date's own zone rules. An untouched form resubmits the original
 * ISO byte-for-byte, preserving sub-minute precision. Submit stays disabled
 * until the browser has initialized.
 */
export function ExpiryForm({
  action,
  inviteId,
  currentExpiresAtIso,
  submitLabel,
  requireValue,
}: {
  action: (formData: FormData) => void;
  inviteId: string;
  currentExpiresAtIso: string;
  submitLabel: string;
  requireValue?: boolean;
}) {
  const [ready, setReady] = useState(false);
  const [localValue, setLocalValue] = useState('');
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    setLocalValue(isoToLocalInputValue(currentExpiresAtIso) ?? '');
    // An externally refreshed instant clears any in-progress edit so the
    // untouched form resubmits the new ISO byte-for-byte.
    setTouched(false);
    setReady(true);
  }, [currentExpiresAtIso]);

  let submitIso = currentExpiresAtIso;
  let problem: string | null = null;
  if (touched && localValue) {
    const parts = parseLocalInputValue(localValue);
    const iso = parts ? localPartsToIso(parts) : null;
    if (iso) {
      submitIso = iso;
    } else {
      problem =
        'That date and time is not valid where you are (it may fall in a daylight-saving gap).';
    }
  } else if (touched && requireValue) {
    problem = 'Enter an expiry date and time.';
  }
  const canSubmit = ready && !problem && (!requireValue || touched) && !(touched && !localValue);

  return (
    <form action={action} className="admin-inline-form">
      <input type="hidden" name="inviteId" value={inviteId} />
      <input type="hidden" name="expiresAt" value={submitIso} />
      <label>
        Expiry (your local time)
        <input
          type="datetime-local"
          value={localValue}
          onChange={(event) => {
            setLocalValue(event.target.value);
            setTouched(true);
          }}
          aria-invalid={problem ? true : undefined}
        />
      </label>
      <button type="submit" disabled={!canSubmit}>
        {submitLabel}
      </button>
      {problem ? (
        <span className="admin-muted" role="alert">
          {problem}
        </span>
      ) : null}
    </form>
  );
}
