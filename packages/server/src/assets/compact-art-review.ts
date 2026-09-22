/** Keep the scoring and rejection contract while removing repeated prose from
 * image reviews. Normalizers already treat absent summaries/rationales as empty.
 * Failure explanations stay in fatalIssues, reason and retryGuidance. */
export function compactArtReview<
  T extends {
    system: string;
    user: string;
    jsonSchema?: Record<string, unknown>;
  },
>(prompt: T): T {
  const prose = new Set(['summary', 'rationale']);
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== 'object') return value;
    const node = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(node).map(([key, child]) => {
        if (key === 'properties' && child && typeof child === 'object')
          return [
            key,
            Object.fromEntries(
              Object.entries(child)
                .filter(([name]) => !prose.has(name))
                .map(([name, schema]) => [name, visit(schema)]),
            ),
          ];
        if (key === 'required' && Array.isArray(child))
          return [key, child.filter((name) => !prose.has(name))];
        return [key, visit(child)];
      }),
    );
  };
  return {
    ...prompt,
    system: `${prompt.system}\nCOMPACT REVIEW OUTPUT: Follow the supplied schema exactly. Omit summary and rationale fields. Keep all required candidate IDs, scores, selections and failure checks. For any score below its acceptance threshold, name the visible defect briefly in fatalIssues or retryGuidance. Successful candidates need no prose. Limit each failure explanation to one short actionable sentence; do not repeat the prompt or describe accepted artwork.`,
    ...(prompt.jsonSchema
      ? { jsonSchema: visit(prompt.jsonSchema) as Record<string, unknown> }
      : {}),
  };
}
