// Dev-only sprite pixel editor (http://localhost:5173/?dev=sprite-editor):
// pick a library sprite + frame, paint pixels against the preview palette, and
// either copy the rows blob or Save straight back into the source .ts file
// (POST /api/dev/sprite/save). DEV-gated in app.tsx (tree-shaken from prod).
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { LIBRARY, decodeSprite } from '@sparkade/engine';

// The same Sweetie-16-derived preview palette the gallery/contact-sheet use.
const PALETTE = [
  '#000000', '#1a1c2c', '#29366f', '#3b5dc9', '#41a6f6', '#38b764', '#a7f070', '#ffcd75',
  '#b13e53', '#ef7d57', '#5d275d', '#e04040', '#ffa300', '#ffd75e', '#94b0c2', '#f4f4f4',
];
const CHARS = ['.', ...Array.from({ length: 16 }, (_, i) => i.toString(16))]; // '.', '0'..'f'
const idxOf = (ch: string): number => parseInt(ch, 16);
const colorOf = (ch: string): string | null => (ch === '.' ? null : (PALETTE[idxOf(ch)] ?? '#f0f'));

function categoryOf(id: string): string {
  if (/^(hero_|ship_)/.test(id)) return 'Heroes & ships';
  if (/^(enemy_|foe_)/.test(id)) return 'Enemies & foes';
  if (/^boss_/.test(id)) return 'Bosses';
  if (/^npc_/.test(id)) return 'NPCs';
  if (/^(proj_|pickup_|item_|obj_)/.test(id)) return 'Props';
  return 'Tiles & other';
}

export function SpriteEditorScreen(): ComponentChildren {
  const ids = useMemo(() => Object.keys(LIBRARY).sort(), []);
  const grouped = useMemo(() => {
    const g: Record<string, string[]> = {};
    for (const id of ids) (g[categoryOf(id)] ??= []).push(id);
    return g;
  }, [ids]);

  const [spriteId, setSpriteId] = useState(ids[0] ?? '');
  const [frameIx, setFrameIx] = useState(0);
  const [working, setWorking] = useState<string[]>([]);
  const [original, setOriginal] = useState<string[]>([]);
  const [active, setActive] = useState('1');
  const [zoom, setZoom] = useState(22);
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [undoStack, setUndoStack] = useState<string[][]>([]);
  const [redoStack, setRedoStack] = useState<string[][]>([]);

  const editRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const paintRef = useRef<string | null>(null);
  const workingRef = useRef<string[]>([]);
  const strokeStartRef = useRef<string[] | null>(null);
  const undoRef = useRef<() => void>(() => {});
  const redoRef = useRef<() => void>(() => {});
  workingRef.current = working;

  const entry = LIBRARY[spriteId];
  const frame = entry?.frames[frameIx];
  const dirty = working.join('\n') !== original.join('\n');

  // Undo / redo. One stroke (click or drag) = one step: the pre-stroke snapshot
  // is committed on mouse-up only if the stroke actually changed something.
  const doUndo = (): void => {
    if (undoStack.length === 0) return;
    setRedoStack((r) => [...r, workingRef.current]);
    setWorking(undoStack[undoStack.length - 1]!);
    setUndoStack((u) => u.slice(0, -1));
    setMsg('');
  };
  const doRedo = (): void => {
    if (redoStack.length === 0) return;
    setUndoStack((u) => [...u, workingRef.current].slice(-100));
    setWorking(redoStack[redoStack.length - 1]!);
    setRedoStack((r) => r.slice(0, -1));
    setMsg('');
  };
  undoRef.current = doUndo;
  redoRef.current = doRedo;
  const pushUndo = (snapshot: string[]): void => {
    setUndoStack((u) => [...u, snapshot].slice(-100));
    setRedoStack([]);
  };

  useEffect(() => {
    document.documentElement.classList.add('dev-gallery');
    document.body.classList.add('dev-gallery');
    return () => {
      document.documentElement.classList.remove('dev-gallery');
      document.body.classList.remove('dev-gallery');
    };
  }, []);

  // (Re)load the selected frame into the working + original snapshots.
  useEffect(() => {
    const f = LIBRARY[spriteId]?.frames[frameIx];
    if (f) {
      setWorking([...f.rows]);
      setOriginal([...f.rows]);
      setUndoStack([]);
      setRedoStack([]);
      strokeStartRef.current = null;
      setMsg('');
    }
  }, [spriteId, frameIx]);

  // Ctrl/Cmd+Z undo, Ctrl+Y / Ctrl+Shift+Z redo (via refs so one stable listener
  // always runs the latest logic).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoRef.current();
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault();
        redoRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Draw the editable grid.
  useEffect(() => {
    const canvas = editRef.current;
    if (!canvas || working.length === 0) return;
    const h = working.length;
    const w = working[0]?.length ?? 0;
    canvas.width = w * zoom;
    canvas.height = h * zoom;
    const ctx = canvas.getContext('2d')!;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const col = colorOf(working[y]![x] ?? '.');
        if (col) {
          ctx.fillStyle = col;
          ctx.fillRect(x * zoom, y * zoom, zoom, zoom);
        } else {
          // transparent checker
          ctx.fillStyle = (x + y) % 2 ? '#242028' : '#2f2a34';
          ctx.fillRect(x * zoom, y * zoom, zoom, zoom);
        }
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= w; x++) {
      ctx.beginPath();
      ctx.moveTo(x * zoom + 0.5, 0);
      ctx.lineTo(x * zoom + 0.5, h * zoom);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * zoom + 0.5);
      ctx.lineTo(w * zoom, y * zoom + 0.5);
      ctx.stroke();
    }
  }, [working, zoom]);

  // Live 1:1-ish preview of the current frame (decoded like the real engine).
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || working.length === 0) return;
    const h = working.length;
    const w = working[0]?.length ?? 0;
    const scale = 6;
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#12101a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    try {
      const sprite = decodeSprite({ w, h, rows: working }, PALETTE);
      ctx.drawImage(sprite, 0, 0, w * scale, h * scale);
    } catch {
      /* mid-edit invalid — skip */
    }
  }, [working]);

  const paintAt = (e: MouseEvent, ch: string): void => {
    const canvas = editRef.current;
    if (!canvas || working.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const w = working[0]?.length ?? 0;
    const h = working.length;
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * w);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * h);
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    setWorking((rows) => {
      if (rows[y]![x] === ch) return rows;
      const next = [...rows];
      next[y] = next[y]!.slice(0, x) + ch + next[y]!.slice(x + 1);
      return next;
    });
  };

  const endStroke = (): void => {
    paintRef.current = null;
    const start = strokeStartRef.current;
    strokeStartRef.current = null;
    if (start && start.join('\n') !== workingRef.current.join('\n')) pushUndo(start);
  };

  const copyRows = (): void => {
    void navigator.clipboard
      .writeText(working.map((r) => `'${r}',`).join('\n'))
      .then(() => setMsg('rows copied to clipboard'))
      .catch(() => setMsg('copy failed'));
  };

  const save = (): void => {
    setSaving(true);
    setMsg('');
    void fetch('/api/dev/sprite/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ spriteId, originalRows: original, newRows: working }),
    })
      .then((r) => r.json())
      .then((r: { ok?: boolean; file?: string; error?: string }) => {
        setSaving(false);
        if (r.ok) {
          setOriginal([...working]); // the file now holds this; keep future diffs correct
          setMsg(`saved → ${r.file}`);
        } else {
          setMsg(r.error ?? 'save failed');
        }
      })
      .catch((e: Error) => {
        setSaving(false);
        setMsg(e.message);
      });
  };

  const animLabel = (i: number): string => {
    if (!entry) return `${i}`;
    const names = Object.entries(entry.anims)
      .filter(([, list]) => list.includes(i))
      .map(([n]) => n);
    return names.length ? `${i} · ${names.join('/')}` : `${i}`;
  };

  return (
    <div class="sed-page">
      <div class="sed-header">
        <h1>Sprite Editor</h1>
        <span class="sed-sub">dev · edit library pixels → save to source</span>
        <a href="/?dev=assets" class="sed-link">→ asset gallery</a>
      </div>

      <div class="sed-body">
        <div class="sed-side">
          <label class="sed-field">
            <span>Sprite</span>
            <select
              value={spriteId}
              onChange={(e) => {
                setSpriteId((e.target as HTMLSelectElement).value);
                setFrameIx(0);
              }}
            >
              {Object.entries(grouped).map(([cat, list]) => (
                <optgroup key={cat} label={cat}>
                  {list.map((id) => (
                    <option key={id} value={id}>{id}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <div class="sed-field">
            <span>Frame ({entry?.frames.length ?? 0}) — {frame ? `${frame.w}×${frame.h}` : ''}</span>
            <div class="sed-frames">
              {entry?.frames.map((_, i) => (
                <button key={i} class={i === frameIx ? 'on' : ''} onClick={() => setFrameIx(i)} title={animLabel(i)}>
                  {i}
                </button>
              ))}
            </div>
          </div>

          <div class="sed-field">
            <span>Colour (right-click erases)</span>
            <div class="sed-palette">
              {CHARS.map((ch) => (
                <button
                  key={ch}
                  class={`sed-swatch ${ch === active ? 'on' : ''} ${ch === '.' ? 'transparent' : ''}`}
                  style={ch === '.' ? '' : `background:${colorOf(ch)}`}
                  title={ch === '.' ? 'transparent' : `slot ${ch}`}
                  onClick={() => setActive(ch)}
                >
                  {ch}
                </button>
              ))}
            </div>
          </div>

          <label class="sed-field">
            <span>Zoom {zoom}px</span>
            <input type="range" min={10} max={40} value={zoom} onInput={(e) => setZoom(Number((e.target as HTMLInputElement).value))} />
          </label>

          <div class="sed-actions">
            <button disabled={undoStack.length === 0} onClick={doUndo} title="Ctrl+Z">Undo{undoStack.length ? ` (${undoStack.length})` : ''}</button>
            <button disabled={redoStack.length === 0} onClick={doRedo} title="Ctrl+Shift+Z">Redo</button>
            <button disabled={!dirty} onClick={() => { pushUndo([...working]); setWorking([...original]); }}>Revert all</button>
            <button onClick={copyRows}>Copy rows</button>
            <button class="primary" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : 'Save to source'}</button>
          </div>
          {msg && <div class="sed-msg">{msg}</div>}
          {dirty && <div class="sed-dirty">unsaved edits</div>}
        </div>

        <div class="sed-main">
          <canvas
            ref={editRef}
            class="sed-canvas"
            onContextMenu={(e) => e.preventDefault()}
            onMouseDown={(e) => {
              e.preventDefault();
              const ch = (e as MouseEvent).button === 2 ? '.' : active;
              strokeStartRef.current = [...working];
              paintRef.current = ch;
              paintAt(e as MouseEvent, ch);
            }}
            onMouseMove={(e) => {
              if (paintRef.current !== null) paintAt(e as MouseEvent, paintRef.current);
            }}
            onMouseUp={endStroke}
            onMouseLeave={endStroke}
          />
          <div class="sed-preview">
            <div class="sed-preview-title">preview</div>
            <canvas ref={previewRef} class="sed-pixel" />
          </div>
        </div>
      </div>
    </div>
  );
}
