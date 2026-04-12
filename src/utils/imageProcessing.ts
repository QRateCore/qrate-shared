/**
 * Universal image preprocessing pipeline for menu item uploads.
 *
 * Re-encodes any browser-supported image (JPEG, PNG, WebP, GIF, and HEIC
 * on iOS Safari) into a JPEG Blob with the longer edge clamped to
 * MAX_EDGE_PX. Strips EXIF metadata as a side effect, normalizing
 * orientation. Output is typically 200–500 KB regardless of input size.
 *
 * Used by EditModal.handleUpload to shrink phone-camera photos (often
 * 5–20 MB raw) before the existing 3-step S3 presign upload runs. The
 * helper does NOT catch its own errors — the caller decides whether to
 * fall back to the raw file.
 *
 * STR-251 mobile + camera capture (2026-04-08).
 */

const MAX_EDGE_PX = 2048;
const JPEG_QUALITY = 0.85;

export interface ImageProcessingResult {
  blob: Blob;
  width: number;
  height: number;
}

/**
 * Re-encode a user-selected image into a max-2048px JPEG blob.
 *
 * Throws if `createImageBitmap` cannot decode the file (unsupported
 * format / corrupt data) or if the canvas backend cannot produce a Blob.
 */
export async function processImageForUpload(file: File): Promise<Blob> {
  const result = await processImageForUploadWithMeta(file);
  return result.blob;
}

/**
 * Same as processImageForUpload but also returns the final dimensions —
 * useful for tests and for surfacing post-resize info to the UI.
 */
export async function processImageForUploadWithMeta(file: File): Promise<ImageProcessingResult> {
  // createImageBitmap handles HEIC on iOS Safari natively (since iOS 14),
  // along with all other browser-supported formats.
  const bitmap = await createImageBitmap(file);
  try {
    const { width: srcW, height: srcH } = bitmap;
    const longEdge = Math.max(srcW, srcH);
    const scale = longEdge > MAX_EDGE_PX ? MAX_EDGE_PX / longEdge : 1;
    const targetW = Math.max(1, Math.round(srcW * scale));
    const targetH = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context unavailable');
    }
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))),
        'image/jpeg',
        JPEG_QUALITY,
      );
    });

    return { blob, width: targetW, height: targetH };
  } finally {
    bitmap.close();
  }
}

export const __testing__ = { MAX_EDGE_PX, JPEG_QUALITY };
