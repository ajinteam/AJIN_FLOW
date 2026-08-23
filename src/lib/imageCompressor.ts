/**
 * Client-side Image Optimization Utility
 * Resizes large high-res camera photos to optimal dimensions & compresses quality
 * Drastically cuts mobile data usage, upload time, and storage size.
 */

export interface CompressionResult {
  file: File;
  blob: Blob;
  dataUrl: string;
  originalSize: number;
  compressedSize: number;
  savedPercent: number;
  width: number;
  height: number;
}

export async function compressImage(
  file: File,
  maxDimension = 1920,
  quality = 0.82
): Promise<CompressionResult> {
  const originalSize = file.size;

  // If not an image or SVG/GIF, return as-is
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml' || file.type === 'image/gif') {
    const dataUrl = await fileToDataUrl(file);
    return {
      file,
      blob: file,
      dataUrl,
      originalSize,
      compressedSize: originalSize,
      savedPercent: 0,
      width: 0,
      height: 0,
    };
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();

    reader.onload = (e) => {
      img.src = e.target?.result as string;
    };
    reader.onerror = (err) => reject(err);

    img.onload = () => {
      try {
        let { width, height } = img;

        // Calculate aspect-ratio preserved dimensions
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Canvas 2D context not available');
        }

        // Better image smoothing
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Draw image onto canvas
        ctx.drawImage(img, 0, 0, width, height);

        // Convert to optimal JPEG/WebP blob
        const outputMime = file.type === 'image/png' && hasTransparency(ctx, width, height) 
          ? 'image/png' 
          : 'image/jpeg';

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Image compression failed'));
              return;
            }

            // Create compressed File object with same name
            const newFileName = outputMime === 'image/jpeg' && !file.name.toLowerCase().endsWith('.jpg') && !file.name.toLowerCase().endsWith('.jpeg')
              ? file.name.replace(/\.[^/.]+$/, "") + ".jpg"
              : file.name;

            const compressedFile = new File([blob], newFileName, {
              type: outputMime,
              lastModified: Date.now(),
            });

            const compressedSize = blob.size;
            const savedPercent = originalSize > 0 
              ? Math.max(0, Math.round(((originalSize - compressedSize) / originalSize) * 100))
              : 0;

            const compressedDataUrl = canvas.toDataURL(outputMime, quality);

            resolve({
              file: compressedFile,
              blob,
              dataUrl: compressedDataUrl,
              originalSize,
              compressedSize,
              savedPercent,
              width,
              height,
            });
          },
          outputMime,
          quality
        );
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function hasTransparency(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  try {
    const imageData = ctx.getImageData(0, 0, width, height).data;
    for (let i = 3; i < imageData.length; i += 40) { // Sample every 10th pixel
      if (imageData[i] < 255) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
