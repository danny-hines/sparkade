// Dev-only sprite pixel editor (http://localhost:5173/?dev=sprite-editor):
// pick a library sprite, edit any frame's pixels, add/remove frames, wire frames
// into animations, then Save straight back into the source .ts file (pixel-only
// edits swap the rows block; structural edits rewrite the object, round-trip
// checked). DEV-gated in app.tsx (tree-shaken from prod).
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { LIBRARY, decodeSprite } from '@sparkade/engine';

const PALETTE = [
  '#000000', '#1a1c2c', '#29366f', '#3b5dc9', '#41a6f6', '#38b764', '#a7f070', '#ffcd75',
  '#b13e53', '#ef7d57', '#5d275d', '#e04040', '#ffa300', '#ffd75e', '#94b0c2', '#f4f4f4',
];
const CHARS = ['.', ...Array.from({ length: 16 }, (_, i) => i.toString(16))];
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

interface Frame {
  w: number;
  h: number;
  rows: string[];
}
interface Entry {
  frames: Frame[];
  anims: Record<string, number[]>;
  headSlots: { x: number; y: number; size: 12 | 16 }[] | null;
}

function loadEntry(id: string): Entry {
  const e = LIBRARY[id];
  return {
    frames: (e?.frames ?? []).map((f) => ({ w: f.w, h: f.h, rows: [...f.rows] })),
    anims: Object.fromEntries(Object.entries(e?.anims ?? {}).map(([k, v]) => [k, [...v]])),
    headSlots: e?.headSlots ? e.headSlots.map((h) => ({ ...h })) : null,
  };
}
const clone = (e: Entry): Entry => JSON.parse(JSON.stringify(e)) as Entry;
const eq = (a: Entry, b: Entry): boolean => JSON.stringify(a) === JSON.stringify(b);

export function SpriteEditorScreen(): ComponentChildren {
  const ids = useMemo(() => Object.keys(LIBRARY).sort(), []);
  const grouped = useMemo(() => {
    const g: Record<string, string[]> = {};
    for (const id of ids) (g[categoryOf(id)] ??= []).push(id);
    return g;
  }, [ids]);

  const [spriteId, setSpriteId] = useState(ids[0] ?? '');
  const [frameIx, setFrameIx] = useState(0);
  const [entry, setEntry] = useState<Entry>(() => loadEntry(ids[0] ?? ''));
  const [orig, setOrig] = useState<Entry>(() => loadEntry(ids[0] ?? ''));
  const [active, setActive] = useState('1');
  const [zoom, setZoom] = useState(22);
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [undoStack, setUndoStack] = useState<Entry[]>([]);
  const [redoStack, setRedoStack] = useState<Entry[]>([]);
  const [playAnim, setPlayAnim] = useState('');

  const editRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<HTMLCanvasElement>(null);
  const paintRef = useRef<string | null>(null);
  const entryRef = useRef<Entry>(entry);
  const strokeStartRef = useRef<Entry | null>(null);
  const undoRef = useRef<() => void>(() => {});
  const redoRef = useRef<() => void>(() => {});
  entryRef.current = entry;

  const frame = entry.frames[frameIx];
  const working = frame?.rows ?? [];
  const dirty = !eq(entry, orig);

  const pushUndo = (snapshot: Entry): void => {
    setUndoStack((u) => [...u, snapshot].slice(-100));
    setRedoStack([]);
  };
  const doUndo = (): void => {
    if (undoStack.length === 0) return;
    setRedoStack((r) => [...r, entryRef.current]);
    setEntry(undoStack[undoStack.length - 1]!);
    setUndoStack((u) => u.slice(0, -1));
    setMsg('');
  };
  const doRedo = (): void => {
    if (redoStack.length === 0) return;
    setUndoStack((u) => [...u, entryRef.current].slice(-100));
    setEntry(redoStack[redoStack.length - 1]!);
    setRedoStack((r) => r.slice(0, -1));
    setMsg('');
  };
  undoRef.current = doUndo;
  redoRef.current = doRedo;

  useEffect(() => {
    document.documentElement.classList.add('dev-gallery');
    document.body.classList.add('dev-gallery');
    return () => {
      document.documentElement.classList.remove('dev-gallery');
      document.body.classList.remove('dev-gallery');
    };
  }, []);

  // Load a fresh entry when the sprite changes (keeps edits across frame switches).
  useEffect(() => {
    const e = loadEntry(spriteId);
    setEntry(e);
    setOrig(loadEntry(spriteId));
    setFrameIx(0);
    setPlayAnim(Object.keys(e.anims)[0] ?? '');
    setUndoStack([]);
    setRedoStack([]);
    strokeStartRef.current = null;
    setMsg('');
  }, [spriteId]);

  // Play the selected animation live (reads the latest entry each tick, so edits
  // and frame-membership changes show immediately).
  useEffect(() => {
    const canvas = animRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const scale = 6;
    let i = 0;
    const tick = (): void => {
      const en = entryRef.current;
      const list = en.anims[playAnim] ?? [];
      if (list.length === 0) {
        canvas.width = 16 * scale;
        canvas.height = 16 * scale;
        ctx.fillStyle = '#12101a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return;
      }
      const f = en.frames[list[i % list.length]!];
      i++;
      if (!f) return;
      canvas.width = f.w * scale;
      canvas.height = f.h * scale;
      ctx.fillStyle = '#12101a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      try {
        ctx.drawImage(decodeSprite({ w: f.w, h: f.h, rows: f.rows }, PALETTE), 0, 0, f.w * scale, f.h * scale);
      } catch {
        /* mid-edit invalid — skip */
      }
    };
    tick();
    const id = setInterval(tick, 160);
    return () => clearInterval(id);
  }, [playAnim]);

  // Keep frameIx valid when frames are removed / undone.
  useEffect(() => {
    if (frameIx >= entry.frames.length) setFrameIx(Math.max(0, entry.frames.length - 1));
  }, [entry.frames.length, frameIx]);

  // Ctrl/Cmd+Z undo, Ctrl+Y / Ctrl+Shift+Z redo.
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
        ctx.fillStyle = col ?? ((x + y) % 2 ? '#242028' : '#2f2a34');
        ctx.fillRect(x * zoom, y * zoom, zoom, zoom);
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
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

  // Live decoded preview of the current frame.
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
      ctx.drawImage(decodeSprite({ w, h, rows: working }, PALETTE), 0, 0, w * scale, h * scale);
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
    setEntry((en) => {
      const rows = en.frames[frameIx]?.rows;
      if (!rows || rows[y]![x] === ch) return en;
      const frames = [...en.frames];
      const nr = [...rows];
      nr[y] = nr[y]!.slice(0, x) + ch + nr[y]!.slice(x + 1);
      frames[frameIx] = { ...frames[frameIx]!, rows: nr };
      return { ...en, frames };
    });
  };
  const endStroke = (): void => {
    paintRef.current = null;
    const start = strokeStartRef.current;
    strokeStartRef.current = null;
    if (start && !eq(start, entryRef.current)) pushUndo(start);
  };

  // ---- structural ops --------------------------------------------------------
  const addFrame = (): void => {
    pushUndo(clone(entry));
    const dup: Frame = { w: frame!.w, h: frame!.h, rows: [...(frame?.rows ?? [])] };
    const newIx = entry.frames.length;
    setEntry((en) => ({
      ...en,
      frames: [...en.frames, dup],
      headSlots: en.headSlots ? [...en.headSlots, { ...(en.headSlots[frameIx] ?? { x: 2, y: 0, size: 12 }) }] : null,
    }));
    setFrameIx(newIx);
  };
  const removeFrame = (i: number): void => {
    if (entry.frames.length <= 1) return;
    pushUndo(clone(entry));
    setEntry((en) => ({
      frames: en.frames.filter((_, k) => k !== i),
      headSlots: en.headSlots ? en.headSlots.filter((_, k) => k !== i) : null,
      anims: Object.fromEntries(
        Object.entries(en.anims).map(([n, list]) => [n, list.filter((x) => x !== i).map((x) => (x > i ? x - 1 : x))]),
      ),
    }));
    setFrameIx((fx) => Math.max(0, Math.min(fx, entry.frames.length - 2)));
  };
  const toggleAnim = (name: string, i: number): void => {
    pushUndo(clone(entry));
    setEntry((en) => {
      const list = en.anims[name] ?? [];
      const next = list.includes(i) ? list.filter((x) => x !== i) : [...list, i].sort((a, b) => a - b);
      return { ...en, anims: { ...en.anims, [name]: next } };
    });
  };

  // ---- save ------------------------------------------------------------------
  const structural =
    entry.frames.length !== orig.frames.length ||
    JSON.stringify(entry.anims) !== JSON.stringify(orig.anims) ||
    JSON.stringify(entry.headSlots) !== JSON.stringify(orig.headSlots);

  const save = async (): Promise<void> => {
    setSaving(true);
    setMsg('');
    try {
      if (structural) {
        const r = await fetch('/api/dev/sprite/save-entry', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ spriteId, originalEntry: orig, newEntry: entry }),
        }).then((x) => x.json() as Promise<{ ok?: boolean; file?: string; error?: string }>);
        if (!r.ok) throw new Error(r.error ?? 'save failed');
        setMsg(`saved → ${r.file}`);
      } else {
        // pixel-only: swap each changed frame's rows block (formatting-safe).
        let saved = '';
        for (let i = 0; i < entry.frames.length; i++) {
          if (entry.frames[i]!.rows.join('') === orig.frames[i]!.rows.join('')) continue;
          const r = await fetch('/api/dev/sprite/save', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ spriteId, originalRows: orig.frames[i]!.rows, newRows: entry.frames[i]!.rows }),
          }).then((x) => x.json() as Promise<{ ok?: boolean; file?: string; error?: string }>);
          if (!r.ok) throw new Error(`frame ${i}: ${r.error ?? 'save failed'}`);
          saved = r.file ?? '';
        }
        setMsg(saved ? `saved → ${saved}` : 'no changes');
      }
      setOrig(clone(entry));
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const copyRows = (): void => {
    void navigator.clipboard
      .writeText(working.map((r) => `'${r}',`).join('\n'))
      .then(() => setMsg('rows copied'))
      .catch(() => setMsg('copy failed'));
  };

  const animLabel = (i: number): string => {
    const names = Object.entries(entry.anims)
      .filter(([, list]) => list.includes(i))
      .map(([n]) => n);
    return names.length ? `${i} · ${names.join('/')}` : `${i} · (unused)`;
  };

  return (
    <div class="sed-page">
      <div class="sed-header">
        <h1>Sprite Editor</h1>
        <span class="sed-sub">dev · edit pixels, frames &amp; anims → save to source</span>
        <a href="/?dev=fighter-editor" class="sed-link">→ fighter workshop</a>
        <a href="/?dev=assets" class="fed-sed-link">→ asset gallery</a>
      </div>

      <div class="sed-body">
        <div class="sed-side">
          <label class="sed-field">
            <span>Sprite</span>
            <select value={spriteId} onChange={(e) => setSpriteId((e.target as HTMLSelectElement).value)}>
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
            <span>Frames ({entry.frames.length}) — {frame ? `${frame.w}×${frame.h}` : ''}</span>
            <div class="sed-frames">
              {entry.frames.map((_, i) => (
                <button key={i} class={i === frameIx ? 'on' : ''} onClick={() => setFrameIx(i)} title={animLabel(i)}>{i}</button>
              ))}
              <button class="sed-add" onClick={addFrame} title="duplicate current frame">＋</button>
            </div>
            <button class="sed-remove" disabled={entry.frames.length <= 1} onClick={() => removeFrame(frameIx)}>Remove frame {frameIx}</button>
          </div>

          <div class="sed-field">
            <span>Anims (frames each plays)</span>
            <div class="sed-anims">
              {Object.keys(entry.anims).map((name) => (
                <div key={name} class="sed-anim-row">
                  <span class="sed-anim-name">{name}</span>
                  {entry.frames.map((_, i) => (
                    <label key={i} class={entry.anims[name]!.includes(i) ? 'on' : ''}>
                      <input type="checkbox" checked={entry.anims[name]!.includes(i)} onChange={() => toggleAnim(name, i)} />
                      {i}
                    </label>
                  ))}
                </div>
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
            <button disabled={!dirty} onClick={() => { pushUndo(clone(entry)); setEntry(clone(orig)); }}>Revert all</button>
            <button onClick={copyRows}>Copy rows</button>
            <button class="primary" disabled={!dirty || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save to source'}</button>
          </div>
          {msg && <div class="sed-msg">{msg}</div>}
          {dirty && <div class="sed-dirty">unsaved edits{structural ? ' · structural (rewrites the object)' : ''}</div>}
        </div>

        <div class="sed-main">
          <canvas
            ref={editRef}
            class="sed-canvas"
            onContextMenu={(e) => e.preventDefault()}
            onMouseDown={(e) => {
              e.preventDefault();
              const ch = (e as MouseEvent).button === 2 ? '.' : active;
              strokeStartRef.current = clone(entry);
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
            <div class="sed-preview-title">frame {frameIx}</div>
            <canvas ref={previewRef} class="sed-pixel" />
            <div class="sed-preview-title" style="margin-top:16px">animation</div>
            <select class="sed-anim-select" value={playAnim} onChange={(e) => setPlayAnim((e.target as HTMLSelectElement).value)}>
              {Object.keys(entry.anims).map((n) => (
                <option key={n} value={n}>{n} [{(entry.anims[n] ?? []).join(', ')}]</option>
              ))}
            </select>
            <canvas ref={animRef} class="sed-pixel" style="margin-top:6px" />
          </div>
        </div>
      </div>
    </div>
  );
}
