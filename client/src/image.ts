/** Centre-crop a picture to a small square and return it as a JPEG data URL (about 5-15 KB), whatever size the camera or file was.
 *  Doing this in the browser keeps uploads tiny and the item list quick to load on a phone. */
export async function squareThumb(file: File, size = 160): Promise<string> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); // honours the phone's rotation
  } catch {
    throw new Error('That file could not be read as a picture');
  }
  const s = Math.min(bmp.width, bmp.height);
  const out = Math.max(1, Math.min(size, s));
  const c = document.createElement('canvas');
  c.width = out;
  c.height = out;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('This browser cannot resize pictures');
  ctx.fillStyle = '#fff'; // transparent PNGs get a white background
  ctx.fillRect(0, 0, out, out);
  ctx.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, out, out);
  bmp.close?.();
  return c.toDataURL('image/jpeg', 0.82);
}
