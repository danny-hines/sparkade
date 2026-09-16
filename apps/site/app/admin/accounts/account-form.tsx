'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { AdminAccount, AccountSearchResult } from '@/lib/admin-account-search';
import { SubmitButton } from '../../components/game-controls';
import { accountAdminAction } from './actions';

function AccountPicker({
  selected,
  onSelect,
}: {
  selected: AdminAccount | null;
  onSelect: (account: AdminAccount | null) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{
    query: string;
    data?: AccountSearchResult;
    error?: string;
  } | null>(null);
  const needle = query.trim();
  const searchable = needle.replace(/^@/, '').length >= 2;
  const current = result?.query === needle ? result : null;
  const accounts = current?.data?.accounts ?? [];
  const expanded = open && !selected && searchable;
  const activeId = expanded && accounts[active] ? `${id}-option-${active}` : undefined;

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  useEffect(() => {
    if (selected || !searchable) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/admin/accounts/search?q=${encodeURIComponent(needle)}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Search failed');
        const data: AccountSearchResult = await response.json();
        if (!controller.signal.aborted) setResult({ query: needle, data });
      } catch {
        if (!controller.signal.aborted)
          setResult({ query: needle, error: 'Could not search accounts. Please try again.' });
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [needle, searchable, selected, retry]);

  function choose(account: AdminAccount) {
    onSelect(account);
    setQuery(`@${account.handle}`);
    setOpen(false);
    setActive(-1);
  }

  return (
    <div className="admin-account-picker">
      <label htmlFor={id}>Account</label>
      <input type="hidden" name="userId" value={selected?.userId ?? ''} />
      <div
        className="admin-account-search"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
        }}
      >
        <input
          ref={input}
          id={id}
          className="arc-input"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={expanded ? `${id}-results` : undefined}
          aria-activedescendant={activeId}
          aria-describedby={`${id}-help`}
          autoComplete="off"
          spellCheck={false}
          placeholder="Search username or email"
          maxLength={254}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            onSelect(null);
            if (event.target.value.trim() !== needle) setResult(null);
            setActive(-1);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setOpen(true);
              setActive((index) => {
                if (!accounts.length) return -1;
                if (event.key === 'ArrowDown') return Math.min(index + 1, accounts.length - 1);
                return index <= 0 ? accounts.length - 1 : index - 1;
              });
            } else if (event.key === 'Enter' && !selected) {
              event.preventDefault();
              if (expanded && accounts[active]) choose(accounts[active]);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              setOpen(false);
              setActive(-1);
            }
          }}
        />
        {expanded && (
          <div className="admin-account-dropdown">
            <ul id={`${id}-results`} role="listbox" aria-label="Matching accounts">
              {accounts.map((account, index) => (
                <li
                  id={`${id}-option-${index}`}
                  key={account.userId}
                  role="option"
                  aria-selected={active === index}
                  className="admin-account-option"
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(account)}
                >
                  <strong>@{account.handle}</strong>
                  <span>{account.email || 'No email address'}</span>
                  <small>
                    {account.balance} credits{account.suspended ? ' · Paused' : ''}
                  </small>
                </li>
              ))}
            </ul>
            <div className="admin-account-status" role="status" aria-live="polite">
              {!current
                ? 'Searching…'
                : current.error
                  ? current.error
                  : !accounts.length
                    ? 'No matching accounts. Try another username or email.'
                    : current.data?.more
                      ? 'Keep typing to narrow the results.'
                      : `${accounts.length} matching account${accounts.length === 1 ? '' : 's'}.`}
            </div>
            {current?.error && (
              <button
                type="button"
                className="arc-text-button admin-account-retry"
                onClick={() => {
                  setResult(null);
                  setRetry((value) => value + 1);
                  input.current?.focus();
                }}
              >
                Try again
              </button>
            )}
          </div>
        )}
      </div>
      <p id={`${id}-help`} className="admin-account-help">
        Type at least 2 characters, then choose an account from the results.
      </p>
      {selected && (
        <div className="admin-account-selected" role="status">
          <div>
            <strong>@{selected.handle}</strong>
            <span>{selected.email || 'No email address'}</span>
            <small>
              {selected.balance} credits{selected.suspended ? ' · Paused' : ''}
            </small>
          </div>
          <button
            type="button"
            className="arc-text-button"
            onClick={() => {
              onSelect(null);
              setQuery('');
              setResult(null);
              setActive(-1);
              input.current?.focus();
            }}
          >
            Change
          </button>
        </div>
      )}
    </div>
  );
}

export function AccountForm({ operationKey }: { operationKey: string }) {
  const [selected, setSelected] = useState<AdminAccount | null>(null);
  return (
    <form action={accountAdminAction} className="arc-admin-form">
      <input type="hidden" name="key" value={operationKey} />
      <AccountPicker selected={selected} onSelect={setSelected} />
      <label>
        Action
        <select className="arc-input" name="action">
          <option value="grant">Grant credits</option>
          <option value="suspend">Pause account & take down games</option>
          <option value="restore">Restore account (games remain taken down)</option>
        </select>
      </label>
      <label>
        Credits to grant
        <input
          className="arc-input"
          type="number"
          name="credits"
          defaultValue={10}
          min={1}
          max={10000}
        />
      </label>
      <label>
        Reason
        <input className="arc-input" name="reason" required maxLength={1000} />
      </label>
      <SubmitButton disabled={!selected}>Update account</SubmitButton>
    </form>
  );
}
