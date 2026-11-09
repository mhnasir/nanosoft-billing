import { Router } from 'express';
import { query, run } from '../db.js';
import { wrap, badReq, notFound, int } from '../util.js';

// A small picture per product (vegetable), shown beside the item in the sales / purchase screens. Never printed.
export const productImagesRouter = Router();

const MAX_BYTES = 150 * 1024; // the browser shrinks pictures to a small square first, so real ones are ~10 KB
const SIGNATURES = { 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/jpeg': [0xff, 0xd8, 0xff], 'image/webp': [0x52, 0x49, 0x46, 0x46] };

let ready;
const ensure = () => {
  ready ??= run('CREATE TABLE IF NOT EXISTS productimage (prodkey integer PRIMARY KEY, mime varchar(20) NOT NULL, img bytea NOT NULL, updated bigint NOT NULL DEFAULT 0)').catch((e) => { ready = undefined; throw e; });
  return ready;
};

function parse(dataUrl) {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw badReq('Choose a PNG, JPG or WebP picture');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_BYTES) throw badReq(`The picture is too big (${Math.round(buf.length / 1024)} KB)`);
  if (!SIGNATURES[m[1]].every((b, i) => buf[i] === b)) throw badReq('That file is not a real picture of that type');
  return { mime: m[1], buf };
}

/** All pictures at once, as { productKey: dataUrl }: one request fills the whole item list. */
productImagesRouter.get(
  '/product-images',
  wrap(async (_req, res) => {
    await ensure();
    const rows = await query('SELECT prodkey, mime, img FROM productimage');
    res.json(Object.fromEntries(rows.map((r) => [r.prodkey, `data:${r.mime};base64,${Buffer.from(r.img).toString('base64')}`])));
  }),
);

productImagesRouter.put(
  '/products/:id/image',
  wrap(async (req, res) => {
    const id = int(req.params.id);
    const { mime, buf } = parse(req.body?.dataUrl);
    await ensure();
    const p = await query('SELECT prodkey FROM productmast WHERE prodkey=@id', { id });
    if (!p[0]) throw notFound('Product not found');
    await run(
      'INSERT INTO productimage(prodkey, mime, img, updated) VALUES(@id, @mime, @img, @u) ON CONFLICT (prodkey) DO UPDATE SET mime=EXCLUDED.mime, img=EXCLUDED.img, updated=EXCLUDED.updated',
      { id, mime, img: buf, u: Date.now() },
    );
    res.json({ ok: true });
  }),
);

productImagesRouter.delete(
  '/products/:id/image',
  wrap(async (req, res) => {
    await ensure();
    await run('DELETE FROM productimage WHERE prodkey=@id', { id: int(req.params.id) });
    res.json({ ok: true });
  }),
);
