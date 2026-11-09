import { useEffect, useRef, useState } from 'react';
import { Modal } from './components';

const OUT = 200; // the saved list picture is OUT x OUT px

/** Enlarged picture with zoom and drag to crop. Saves a square that is used in the item lists.
 *  Mouse: drag to move, wheel or slider to zoom. Touch: drag to move, slider to zoom. */
export default function PictureCropper({ src, title, onSave, onCancel, onRemove, saveLabel = 'Save picture' }: {
  src: string; title: string; onSave: (thumb: string) => void; onCancel: () => void; onRemove?: () => void; saveLabel?: string;
}) {
  const V = Math.max(220, Math.min(340, (typeof window !== 'undefined' ? window.innerWidth : 400) - 70)); // size of the big square on screen
  const cv = useRef<HTMLCanvasElement>(null);
  const prev1 = useRef<HTMLCanvasElement>(null);
  const prev2 = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [bad, setBad] = useState(false);
  const [zoom, setZoom] = useState(1); // 1 = the whole short side fits, up to 4x closer
  const [c, setC] = useState({ x: 0, y: 0 }); // centre of the square, in picture pixels
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const i = new Image();
    i.onload = () => { setImg(i); setC({ x: i.width / 2, y: i.height / 2 }); };
    i.onerror = () => setBad(true);
    i.src = src;
  }, [src]);

  const side = img ? Math.min(img.width, img.height) / zoom : 1; // width of the visible square, in picture pixels
  const clamp = (p: { x: number; y: number }, s = side) => (img ? { x: Math.min(img.width - s / 2, Math.max(s / 2, p.x)), y: Math.min(img.height - s / 2, Math.max(s / 2, p.y)) } : p);

  useEffect(() => {
    if (!img || !cv.current) return;
    const p = clamp(c);
    const ctx = cv.current.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, V, V);
    ctx.drawImage(img, p.x - side / 2, p.y - side / 2, side, side, 0, 0, V, V);
    for (const [ref, size] of [[prev1, 36], [prev2, 88]] as const) { // how it will look in the item list
      const pc = ref.current?.getContext('2d');
      if (pc) pc.drawImage(cv.current, 0, 0, V, V, 0, 0, size, size);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, c, zoom, V]);

  const move = (dx: number, dy: number) => setC((p) => clamp({ x: p.x - (dx * side) / V, y: p.y - (dy * side) / V }));
  const setZ = (z: number) => { setZoom(z); setC((p) => (img ? clamp(p, Math.min(img.width, img.height) / z) : p)); };

  function save() {
    if (!img) return;
    const p = clamp(c);
    const o = document.createElement('canvas');
    o.width = OUT;
    o.height = OUT;
    const ctx = o.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, OUT, OUT);
    ctx.drawImage(img, p.x - side / 2, p.y - side / 2, side, side, 0, 0, OUT, OUT);
    onSave(o.toDataURL('image/jpeg', 0.85));
  }

  return (
    <Modal title={`Picture - ${title}`} onClose={onCancel}>
      {bad && <div className="err">This picture could not be opened.</div>}
      <div style={{ display: 'grid', placeItems: 'center' }}>
        <canvas
          ref={cv} width={V} height={V}
          style={{ width: V, height: V, borderRadius: 10, border: '1px solid var(--line)', cursor: 'grab', touchAction: 'none', background: '#fff' }}
          onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY }; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
          onPointerMove={(e) => { if (!drag.current) return; move(e.clientX - drag.current.x, e.clientY - drag.current.y); drag.current = { x: e.clientX, y: e.clientY }; }}
          onPointerUp={() => { drag.current = null; }}
          onPointerCancel={() => { drag.current = null; }}
          onWheel={(e) => setZ(Math.min(4, Math.max(1, zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))))}
        />
      </div>
      <div className="row" style={{ alignItems: 'center', margin: '12px 0' }}>
        <span className="muted">Zoom</span>
        <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => setZ(Number(e.target.value))} style={{ flex: 1, minHeight: 0, padding: 0 }} />
        <button type="button" className="sm" onClick={() => { setZoom(1); if (img) setC({ x: img.width / 2, y: img.height / 2 }); }}>Reset</button>
      </div>
      <div className="row" style={{ alignItems: 'center', gap: 14 }}>
        <span className="muted">In the item list:</span>
        <canvas ref={prev1} width={36} height={36} style={{ borderRadius: 6, border: '1px solid var(--line)' }} />
        <canvas ref={prev2} width={88} height={88} style={{ borderRadius: 10, border: '1px solid var(--line)' }} />
      </div>
      <div className="muted" style={{ fontSize: '.78rem', marginTop: 8 }}>Drag the picture to move it, use the slider or the mouse wheel to zoom. The square you see is what is saved.</div>
      <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
        {onRemove && <button type="button" className="danger" onClick={onRemove} style={{ marginRight: 'auto' }}>Remove picture</button>}
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary" onClick={save} disabled={!img}>{saveLabel}</button>
      </div>
    </Modal>
  );
}
