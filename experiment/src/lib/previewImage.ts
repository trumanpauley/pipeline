import { supabase } from './supabase';

export const PREVIEW_BUCKET = 'experiment-previews';

/**
 * Link-preview images are shown at 1.91:1 by iMessage, WhatsApp, X, LinkedIn
 * and others. The chosen picture is cropped to 1200×630 and saved as a JPEG
 * (well under WhatsApp's ~600 KB limit), then uploaded to a public bucket so
 * crawlers can fetch it. Only admins can upload (storage policy, migration 016).
 */
export async function uploadPreviewImage(file: File, experimentId: string | null): Promise<string> {
  if (!/^image\/(png|jpe?g|webp|gif|heic|heif)$/i.test(file.type)) throw new Error('Choose a PNG, JPEG or WebP image.');
  if (file.size > 20 * 1024 * 1024) throw new Error('That image is too large (20 MB at most).');
  const blob = await toPreviewJpeg(file);
  const path = `${experimentId ?? 'new'}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabase.storage.from(PREVIEW_BUCKET).upload(path, blob, {
    contentType: 'image/jpeg',
    cacheControl: '31536000',
    upsert: false,
  });
  if (error) {
    throw new Error(/bucket not found/i.test(error.message)
      ? 'Image uploads need migration 016 in Supabase (it creates the image storage).'
      : `Upload failed: ${error.message}`);
  }
  return supabase.storage.from(PREVIEW_BUCKET).getPublicUrl(path).data.publicUrl;
}

async function toPreviewJpeg(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('That file couldn’t be read as an image.'));
      el.src = url;
    });
    const W = 1200;
    const H = 630;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#09090B';
    ctx.fillRect(0, 0, W, H);
    // Cover: fill the frame, cropping the overflow evenly.
    const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The image couldn’t be prepared.'))), 'image/jpeg', 0.86),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
