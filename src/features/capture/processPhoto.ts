// Shrinks a captured/picked photo to at most 2048 px on the long edge as JPEG.
// Never throws: on failure (web without canvas support, odd formats) the original is returned.
import { ImageManipulator, SaveFormat, type ImageManipulatorContext, type ImageRef } from 'expo-image-manipulator';

export const MAX_PHOTO_EDGE = 2048;

export interface ProcessedPhoto {
  uri: string;
  width: number;
  height: number;
}

export async function shrinkPhoto(uri: string, width: number, height: number, quality = 0.75): Promise<ProcessedPhoto> {
  // Native contexts/images hold full-size bitmaps; release them right away so a long capture
  // session does not pile up native memory the JS GC cannot see.
  let ctx: ImageManipulatorContext | null = null;
  let img: ImageRef | null = null;
  try {
    const long = Math.max(width, height);
    ctx = ImageManipulator.manipulate(uri);
    if (long > MAX_PHOTO_EDGE) {
      if (width >= height) ctx.resize({ width: MAX_PHOTO_EDGE });
      else ctx.resize({ height: MAX_PHOTO_EDGE });
    }
    img = await ctx.renderAsync();
    const out = await img.saveAsync({ compress: quality, format: SaveFormat.JPEG });
    return { uri: out.uri, width: out.width, height: out.height };
  } catch {
    return { uri, width, height };
  } finally {
    try {
      img?.release();
      ctx?.release();
    } catch {
      // release is best effort (not implemented on every platform)
    }
  }
}
