export type AdminQuery = Record<string, string | string[] | undefined>;

export function queryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function AdminNotice({ query }: { query: AdminQuery }) {
  const notice = queryValue(query.notice);
  if (!notice) return null;
  const error = queryValue(query.tone) === 'error';
  return (
    <p className={`admin-notice ${error ? 'error' : 'success'}`} role={error ? 'alert' : 'status'}>
      {notice}
    </p>
  );
}
