// imageOptimizationService.js - Client-Side Image Compression & Bandwidth Optimization Layer

/**
 * Client-Side Image Compression & Resizing Pipeline
 * - Resizes images to max 500x500 px (or customizable dimensions)
 * - Converts image format to WebP
 * - Keeps final thumbnail file size under 80 KB
 * @param {File} file Raw file object selected by user
 * @param {number} maxWidth Maximum width in pixels
 * @param {number} maxHeight Maximum height in pixels
 * @param {number} maxFileSizeBytes Target max file size (default 80 KB)
 * @returns {Promise<File>} Compressed File object
 */
export async function compressAndResizeImage(
  file,
  maxWidth = 500,
  maxHeight = 500,
  maxFileSizeBytes = 80 * 1024
) {
  if (!file || !file.type || !file.type.startsWith("image/")) {
    return file;
  }

  return new Promise((resolve) => {
    const img = new Image();
    const reader = new FileReader();

    reader.onload = (e) => {
      img.onload = async () => {
        let width = img.width;
        let height = img.height;

        // Calculate aspect ratio scaling within maxWidth x maxHeight
        if (width > maxWidth || height > maxHeight) {
          if (width / height > maxWidth / maxHeight) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, width, height);

        let quality = 0.82;
        const getBlob = (q) =>
          new Promise((res) => {
            canvas.toBlob(
              (blob) => {
                if (!blob) {
                  // Fallback to jpeg if webp export is unsupported
                  canvas.toBlob(res, "image/jpeg", q);
                } else {
                  res(blob);
                }
              },
              "image/webp",
              q
            );
          });

        let blob = await getBlob(quality);

        // Iteratively lower quality if file size is still above maxFileSizeBytes
        while (blob && blob.size > maxFileSizeBytes && quality > 0.4) {
          quality -= 0.1;
          blob = await getBlob(quality);
        }

        if (!blob) {
          resolve(file);
          return;
        }

        const extension = blob.type === "image/webp" ? ".webp" : ".jpg";
        const baseName = file.name.replace(/\.[^/.]+$/, "");
        const compressedFile = new File([blob], `${baseName}${extension}`, {
          type: blob.type,
          lastModified: Date.now(),
        });

        console.log(
          `Compressed image: ${file.name} (${(file.size / 1024).toFixed(1)} KB) -> ${compressedFile.name} (${(compressedFile.size / 1024).toFixed(1)} KB, ${width}x${height}px)`
        );

        resolve(compressedFile);
      };

      img.onerror = () => resolve(file);
      img.src = e.target.result;
    };

    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
}

/**
 * Returns optimized Firebase Storage metadata for HTTP cache-control
 */
export const LONG_TERM_CACHE_METADATA = {
  cacheControl: "public, max-age=31536000, immutable",
};

/**
 * Safe image fallback attributes string generator
 */
export function buildOptimizedImgTag({
  src,
  alt = "",
  className = "",
  style = "",
  id = "",
  fallbackSrc = "assets/product_sofa.png",
}) {
  const safeSrc = src || fallbackSrc;
  const idAttr = id ? `id="${id}" ` : "";
  const styleAttr = style ? `style="${style}" ` : "";
  const classAttr = className ? `class="${className}" ` : "";

  return `<img ${idAttr}${classAttr}src="${safeSrc}" alt="${alt}" loading="lazy" decoding="async" ${styleAttr}onerror="this.onerror=null;this.src='${fallbackSrc}';">`;
}
