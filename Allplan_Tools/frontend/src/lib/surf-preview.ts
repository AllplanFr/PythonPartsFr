// Allplan .surf files start with an uncompressed TIFF thumbnail (the textured cube).
export function decodeSurfPreview(buf: ArrayBuffer): { width: number; height: number; data: Uint8ClampedArray<ArrayBuffer> } | null {
  const v = new DataView(buf);
  if (v.byteLength < 8) return null;
  const le = v.getUint16(0) === 0x4949;
  if (!le && v.getUint16(0) !== 0x4d4d) return null;
  const u16 = (o: number) => v.getUint16(o, le);
  const u32 = (o: number) => v.getUint32(o, le);
  const ifd = u32(4);
  const tags = new Map<number, number[]>();
  for (let i = 0, n = u16(ifd); i < n; i++) {
    const e = ifd + 2 + i * 12, type = u16(e + 2), count = u32(e + 4), size = type === 3 ? 2 : 4;
    if (type !== 3 && type !== 4) continue;
    const at = count * size <= 4 ? e + 8 : u32(e + 8);
    tags.set(u16(e), Array.from({ length: count }, (_, k) => size === 2 ? u16(at + k * 2) : u32(at + k * 4)));
  }
  const w = tags.get(256)?.[0] ?? 0, h = tags.get(257)?.[0] ?? 0;
  const photo = tags.get(262)?.[0], spp = tags.get(277)?.[0] ?? 1;
  if (!w || !h || w * h > 4e6 || (tags.get(259)?.[0] ?? 1) !== 1 || (tags.get(258)?.[0] ?? 8) !== 8) return null;
  const offs = tags.get(273) ?? [], lens = tags.get(279) ?? [];
  const px = new Uint8Array(w * h * spp);
  let p = 0;
  offs.forEach((o, i) => { const len = Math.min(lens[i] ?? 0, px.length - p, buf.byteLength - o); if (len > 0) { px.set(new Uint8Array(buf, o, len), p); p += len; } });
  const map = tags.get(320);
  const out = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  for (let i = 0; i < w * h; i++) {
    let r: number, g: number, b: number;
    if (photo === 3 && map) { const c = px[i] ?? 0, n = map.length / 3; r = (map[c] ?? 0) >> 8; g = (map[n + c] ?? 0) >> 8; b = (map[2 * n + c] ?? 0) >> 8; }
    else if (photo === 2 && spp >= 3) { r = px[i * spp] ?? 0; g = px[i * spp + 1] ?? 0; b = px[i * spp + 2] ?? 0; }
    else if (photo === 1 || photo === 0) { r = g = b = photo === 0 ? 255 - (px[i * spp] ?? 0) : px[i * spp] ?? 0; }
    else return null;
    out.data.set([r, g, b, 255], i * 4);
  }
  return out;
}

export async function surfPreviewUrl(file: Blob): Promise<string> {
  const img = decodeSurfPreview(await file.arrayBuffer());
  if (!img) return "";
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  c.getContext("2d")?.putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  return c.toDataURL("image/png");
}
