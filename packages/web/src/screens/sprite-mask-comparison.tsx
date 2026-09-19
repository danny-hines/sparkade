import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { SpriteMaskComparison, SpriteMaskStrategy } from '@sparkade/shared';

const ROOT = '/api/dev/platformer-poses/mask-comparisons';
const LABELS = {
  chroma: 'Current chroma key',
  sam: 'SAM silhouette',
  'sam-despill': 'SAM + edge cleanup',
  'sam-hybrid': 'SAM + chroma boundary',
};

async function responseJson(response: Response): Promise<SpriteMaskComparison> {
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Mask comparison failed');
  return result as SpriteMaskComparison;
}

export function SpriteMaskComparisonPanel(props: {
  sources: Array<{ id: string; label: string; rawUrl: string }>;
}): ComponentChildren {
  const [file, setFile] = useState<File | null>(null);
  const [savedSource, setSavedSource] = useState('');
  const [concept, setConcept] = useState('person');
  const [run, setRun] = useState<SpriteMaskComparison | null>(null);
  const [runId, setRunId] = useState(
    () => new URLSearchParams(location.search).get('maskRun') ?? '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [background, setBackground] = useState('checker');
  const [view, setView] = useState<'sprite' | 'cutout' | 'mask'>('sprite');
  const [preferred, setPreferred] = useState<SpriteMaskStrategy | 'none'>('none');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const running = busy || run?.status === 'running';

  useEffect(() => {
    if (!runId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async (): Promise<void> => {
      try {
        const result = await responseJson(
          await fetch(`${ROOT}/${encodeURIComponent(runId)}`, { signal: controller.signal }),
        );
        if (controller.signal.aborted) return;
        setRun(result);
        setConcept(result.concept);
        if (result.verdict) {
          setPreferred(result.verdict.preferred);
          setNotes(result.verdict.notes);
        }
        if (result.status === 'running') timer = setTimeout(() => void poll(), 1000);
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'Could not load comparison');
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [runId]);

  const start = async (reuse = false): Promise<void> => {
    if (running || (reuse ? !run : !file && !savedSource)) return;
    setBusy(true);
    setError('');
    try {
      let result: SpriteMaskComparison;
      if (reuse) {
        result = await responseJson(
          await fetch(`${ROOT}/${run!.id}/reprocess`, { method: 'POST' }),
        );
      } else {
        let input: Blob | null = file;
        if (savedSource) {
          const source = props.sources.find((item) => item.id === savedSource);
          if (!source) throw new Error('Select a saved raw sprite');
          const response = await fetch(source.rawUrl);
          if (!response.ok) throw new Error('Could not load the saved raw sprite');
          input = await response.blob();
        }
        const form = new FormData();
        form.append('image', input!, file?.name ?? `${savedSource}.png`);
        form.append('concept', concept);
        result = await responseJson(await fetch(ROOT, { method: 'POST', body: form }));
      }
      setRun(result);
      setRunId(result.id);
      setPreferred('none');
      setNotes('');
      const url = new URL(location.href);
      url.searchParams.set('maskRun', result.id);
      history.replaceState(null, '', url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start comparison');
    } finally {
      setBusy(false);
    }
  };

  const saveVerdict = async (): Promise<void> => {
    if (!run || saving) return;
    setSaving(true);
    setError('');
    try {
      setRun(
        await responseJson(
          await fetch(`${ROOT}/${run.id}/verdict`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ preferred, notes }),
          }),
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save review');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section class="smc-panel" aria-label="Sprite background comparison">
      <h2>Compare background removal</h2>
      <p>
        Use one raw sprite to compare the current cleanup with SAM. Try curls, frizzy hair, gaps
        between strands, and green costume details. No new character images are generated.
      </p>
      <div class="smc-controls">
        <label>
          Raw sprite
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={running}
            onChange={(event) => {
              setFile(event.currentTarget.files?.[0] ?? null);
              setSavedSource('');
            }}
          />
        </label>
        {props.sources.length > 0 && (
          <label>
            Or a candidate from this pose run
            <select
              value={savedSource}
              disabled={running}
              onChange={(event) => {
                setSavedSource(event.currentTarget.value);
                setFile(null);
              }}
            >
              <option value="">Choose a raw candidate</option>
              {props.sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Subject to keep
          <input
            value={concept}
            maxLength={160}
            disabled={running}
            onInput={(event) => setConcept(event.currentTarget.value)}
            placeholder="person, knight, spaceship…"
          />
        </label>
        <button
          type="button"
          disabled={running || (!file && !savedSource) || !concept.trim()}
          onClick={() => void start()}
        >
          {running ? 'Comparing…' : 'Compare masks'}
        </button>
      </div>
      <p class="smc-note">
        One SAM image call, approximately $0.0025. Production sprite generation keeps its current
        behavior.
      </p>
      {error && (
        <p role="alert">
          {error}
          {run?.status === 'running' && (
            <button type="button" onClick={() => location.reload()}>
              Reload comparison
            </button>
          )}
        </p>
      )}
      {run && (
        <>
          <div class="smc-controls">
            <label>
              View
              <select
                value={view}
                onChange={(event) => setView(event.currentTarget.value as typeof view)}
              >
                <option value="sprite">Game-sized sprite</option>
                <option value="cutout">Source-resolution cutout</option>
                <option value="mask">Alpha mask</option>
              </select>
            </label>
            <label>
              Background
              <select
                value={background}
                onChange={(event) => setBackground(event.currentTarget.value)}
              >
                <option value="checker">Checkerboard</option>
                <option value="light">White</option>
                <option value="dark">Dark</option>
                <option value="pink">Pink</option>
              </select>
            </label>
            <a href={run.sourceUrl} target="_blank" rel="noreferrer">
              Open original sprite
            </a>
            <button
              type="button"
              disabled={running || !run.responseId}
              onClick={() => void start(true)}
            >
              Rerun saved mask (no API call)
            </button>
          </div>
          <p class="smc-note">
            The hybrid protects SAM’s interior and keys green only near its boundary. It can recover
            clipped hair, but green details touching the boundary may still be removed.
          </p>
          <div class="smc-grid">
            {(['chroma', 'sam', 'sam-despill', 'sam-hybrid'] as const).map((strategy) => {
              const variant = run.variants.find((item) => item.strategy === strategy);
              const imageUrl =
                view === 'sprite'
                  ? variant?.spriteUrl
                  : view === 'cutout'
                    ? variant?.cutoutUrl
                    : variant?.maskUrl;
              return (
                <article key={strategy}>
                  <h3>{LABELS[strategy]}</h3>
                  <div class={`smc-image smc-${background}`}>
                    {imageUrl ? (
                      <a href={imageUrl} target="_blank" rel="noreferrer">
                        <img src={imageUrl} alt={`${LABELS[strategy]} ${view}`} />
                      </a>
                    ) : (
                      <p>
                        {variant?.error ??
                          (run.status === 'running'
                            ? 'Processing…'
                            : 'Not included in this saved run')}
                      </p>
                    )}
                  </div>
                  {variant?.error && imageUrl && <p role="status">{variant.error}</p>}
                  {variant && (
                    <small>
                      {variant.status} · {variant.elapsedMs} ms processing
                      {strategy === 'sam-despill' &&
                        ` · ${variant.changedPixels ?? 0} edge pixels recolored`}
                      {variant.hybrid &&
                        ` · ${variant.hybrid.radius}px source boundary · ${variant.hybrid.removedPixels} removed · ${variant.hybrid.restoredPixels} restored · ${variant.hybrid.despilledPixels ?? 0} recolored · ${variant.hybrid.protectedGreenPixels} interior green pixels kept`}
                    </small>
                  )}
                </article>
              );
            })}
          </div>
          <p class="smc-note">
            {run.status} · {run.segmentationCalls} SAM calls · {run.segmentationMs ?? '…'} ms
            segmentation
            {' · '}
            {run.estimatedCostUsd === null
              ? 'Cost unknown'
              : `Estimated $${run.estimatedCostUsd.toFixed(4)}`}
            {' · '}Saved comparison {run.id}
            {run.reusedFrom && ` · Reused mask from ${run.reusedFrom}`}
          </p>
          {run.error && <p role="alert">{run.error}</p>}
          {run.status !== 'running' && (
            <div class="smc-controls">
              <label>
                Preferred result
                <select
                  value={preferred}
                  onChange={(event) => setPreferred(event.currentTarget.value as typeof preferred)}
                >
                  <option value="none">None — needs more work</option>
                  {run.variants
                    .filter((variant) => variant.status === 'complete')
                    .map((variant) => (
                      <option key={variant.strategy} value={variant.strategy}>
                        {LABELS[variant.strategy]}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Review notes
                <textarea
                  value={notes}
                  maxLength={2000}
                  placeholder="Hair retained? Green halos? Missing curls or costume details?"
                  onInput={(event) => setNotes(event.currentTarget.value)}
                />
              </label>
              <button type="button" disabled={saving} onClick={() => void saveVerdict()}>
                {saving ? 'Saving…' : 'Save review'}
              </button>
              {run.verdict && <span role="status">Review saved</span>}
            </div>
          )}
        </>
      )}
    </section>
  );
}
