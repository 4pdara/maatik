// Pages that are already cropped (a DocScan PDF or images): each becomes a JPEG to upload,
// without the corner-marking step. Runs in the browser.

const MAX_SIDE = 4000; // long side of an uploaded page

function canvasToJpeg(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("JPEG"))), "image/jpeg", 0.92));
}

/** An image file, upright (EXIF applied), as a JPEG no larger than MAX_SIDE. A JPEG that already
 *  fits and needs no turning is sent as it is, so nothing is lost to re-encoding. */
async function imageToJpeg(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const s = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  if (file.type === "image/jpeg" && s === 1) {
    // Same size after EXIF orientation means no turning is needed... unless width and height swapped.
    const raw = await createImageBitmap(file, { imageOrientation: "none" });
    const same = raw.width === bmp.width && raw.height === bmp.height;
    raw.close();
    if (same) { bmp.close(); return file; }
  }
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return canvasToJpeg(c);
}

/** Every page of a PDF, rendered so its long side is about MAX_SIDE (about 300 dpi for A4). */
async function pdfToJpegs(file: File, onPage?: (done: number, total: number) => void): Promise<Blob[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const out: Blob[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(MAX_SIDE / Math.max(base.width, base.height), 6);
      const vp = page.getViewport({ scale });
      const c = document.createElement("canvas");
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      await page.render({ canvas: c, viewport: vp }).promise;
      out.push(await canvasToJpeg(c));
      page.cleanup();
      onPage?.(i, doc.numPages);
    }
  } finally {
    await task.destroy(); // ends the document and its worker
  }
  return out;
}

/** Files in the order given; a PDF expands into its pages. */
export async function readyPages(files: File[], onProgress?: (text: string) => void): Promise<Blob[]> {
  const pages: Blob[] = [];
  for (const f of files) {
    if (f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")) {
      pages.push(...(await pdfToJpegs(f, (d, t) => onProgress?.(`פותח את ה-PDF: עמוד ${d} מתוך ${t}`))));
    } else if (f.type.startsWith("image/")) {
      pages.push(await imageToJpeg(f));
    }
  }
  return pages;
}
