const LIB_URL = "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/dist/index.mjs";
const ORT_WASM_BASE = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0-dev.20250206-d981b153d3/dist/";
let libPromise = null;

async function loadLib() {
  if (!libPromise) {
    libPromise = Promise.all([import(LIB_URL), import("onnxruntime-web")]).then(([bgLib, ort]) => {
      ort.env.wasm.wasmPaths = ORT_WASM_BASE;
      return bgLib;
    });
  }
  return libPromise;
}

// Removes the background from a garment photo entirely on-device (no API key, no server,
// no cost), then recomposes it centered on a plain white square canvas so every garment
// photo ends up with the same consistent framing regardless of the original angle/zoom.
// dataUrl: "data:image/jpeg;base64,...." -> returns a new "data:image/jpeg;base64,...." dataUrl
export async function normalizePhotoLocal(dataUrl, onProgress) {
  const { removeBackground } = await loadLib();
  const cutoutBlob = await removeBackground(dataUrl, {
    progress: onProgress,
  });
  return composeOnWhiteSquare(cutoutBlob);
}

async function composeOnWhiteSquare(blob, size = 900, paddingRatio = 0.08) {
  const img = await blobToImage(blob);

  const source = document.createElement("canvas");
  source.width = img.naturalWidth;
  source.height = img.naturalHeight;
  const sctx = source.getContext("2d");
  sctx.drawImage(img, 0, 0);

  const { minX, minY, maxX, maxY, found } = findContentBounds(sctx, source.width, source.height);
  const cropX = found ? minX : 0;
  const cropY = found ? minY : 0;
  const cropW = found ? maxX - minX + 1 : source.width;
  const cropH = found ? maxY - minY + 1 : source.height;

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);

  const maxContent = size * (1 - paddingRatio * 2);
  const scale = Math.min(maxContent / cropW, maxContent / cropH);
  const drawW = cropW * scale;
  const drawH = cropH * scale;
  const dx = (size - drawW) / 2;
  const dy = (size - drawH) / 2;
  ctx.drawImage(source, cropX, cropY, cropW, cropH, dx, dy, drawW, drawH);

  return canvas.toDataURL("image/jpeg", 0.9);
}

function findContentBounds(ctx, width, height) {
  const { data } = ctx.getImageData(0, 0, width, height);
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let found = false;
  const ALPHA_THRESHOLD = 10;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha > ALPHA_THRESHOLD) {
        found = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, minY, maxX, maxY, found };
}

function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      resolve(img);
      URL.revokeObjectURL(url);
    };
    img.onerror = reject;
    img.src = url;
  });
}
