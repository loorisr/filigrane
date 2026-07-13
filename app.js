/* Standalone, local-only equivalent of BOPdfDocumentTemplate's generic watermark path. */
const form = document.querySelector('#watermark-form');
const filesInput = document.querySelector('#files');
const textInput = document.querySelector('#text');
const button = document.querySelector('#submit');
const status = document.querySelector('#status');
const fileList = document.querySelector('#file-list');
const dropZone = document.querySelector('.drop-zone');
// PDRectangle.A4 is 595.27563 × 841.8898 points. Keep the PDFBox ratio rather
// than a rounded paper-size ratio because it drives the Java crop calculation.
const A4_RATIO = 841.8898 / 595.27563;
const MAX_PAGE_WIDTH = 1240; // PageDimension.A4150.width in the Java implementation
// BOPdfDocumentTemplate.COLORS. The Java feature is off by configuration by
// default; the local page deliberately enables it for more visible output.
const WATERMARK_COLORS = [
  [64, 64, 64, 255],
  [32, 32, 32, 220],
  [0, 0, 0, 110],
  [0, 0, 91, 170],
  [255, 0, 0, 170],
];

pdfjsLib.GlobalWorkerOptions.workerSrc = ''; // enables opening index.html directly, without a web server

function setFiles(files) {
  const transfer = new DataTransfer();
  [...files].forEach(file => transfer.items.add(file));
  filesInput.files = transfer.files;
  fileList.textContent = [...filesInput.files].map(file => file.name).join(', ') || 'No files selected';
}
filesInput.addEventListener('change', () => setFiles(filesInput.files));
['dragenter', 'dragover'].forEach(event => dropZone.addEventListener(event, e => { e.preventDefault(); dropZone.classList.add('drag'); }));
['dragleave', 'drop'].forEach(event => dropZone.addEventListener(event, e => { e.preventDefault(); dropZone.classList.remove('drag'); }));
dropZone.addEventListener('drop', e => setFiles(e.dataTransfer.files));

// BufferedImage dimensions are Java int casts, which truncate toward zero.
const canvas = (width, height) => Object.assign(document.createElement('canvas'), { width: Math.trunc(width), height: Math.trunc(height) });
const random = (min, max) => min + Math.random() * (max - min);

async function imageFromFile(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const result = canvas(bitmap.width, bitmap.height);
  result.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close();
  return result;
}

async function pagesFromPdf(file) {
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer(), disableWorker: true }).promise;
  const pages = [];
  for (let number = 1; number <= pdf.numPages; number++) {
    status.textContent = `Rendering ${file.name}, page ${number} of ${pdf.numPages}…`;
    const page = await pdf.getPage(number);
    const base = page.getViewport({ scale: 1 });
    const ratio = base.height / base.width;
    const scale = (ratio < A4_RATIO ? base.width : base.height / A4_RATIO) < MAX_PAGE_WIDTH ? 2 : (MAX_PAGE_WIDTH / base.width) * 2;
    const viewport = page.getViewport({ scale });
    const result = canvas(viewport.width, viewport.height);
    await page.render({ canvasContext: result.getContext('2d'), viewport }).promise;
    pages.push(result);
  }
  return pages;
}

function fitImageToPage(source) {
  const ratio = source.height / source.width;
  const width = ratio < A4_RATIO ? source.width : source.height / A4_RATIO;
  const height = ratio < A4_RATIO ? source.width * A4_RATIO : source.height;
  const scale = width < MAX_PAGE_WIDTH ? 1 : MAX_PAGE_WIDTH / source.width;
  const result = canvas(scale * width, scale * height);
  const ctx = result.getContext('2d');
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, result.width, result.height);
  ctx.drawImage(source, scale * (width - source.width) / 2, scale * (height - source.height) / 2, scale * source.width, scale * source.height);
  return result;
}

function qrBox(source) {
  try {
    const image = source.getContext('2d').getImageData(0, 0, source.width, source.height);
    const code = jsQR(image.data, source.width, source.height, { inversionAttempts: 'attemptBoth' });
    if (!code) return null;
    const p = code.location;
    return { x: Math.min(p.topLeftCorner.x, p.bottomLeftCorner.x), y: Math.min(p.topLeftCorner.y, p.topRightCorner.y), w: Math.abs(p.topRightCorner.x - p.topLeftCorner.x), h: Math.abs(p.bottomLeftCorner.y - p.topLeftCorner.y) };
  } catch (_) { return null; }
}

function applyWatermark(source, watermarkText) {
  const diagonal = Math.floor(Math.hypot(source.width, source.height));
  const layer = canvas(diagonal, diagonal);
  const ctx = layer.getContext('2d');
  const watermark = watermarkText.repeat(1 + Math.floor(128 / watermarkText.length));
  ctx.globalAlpha = random(.52, .6);
  // java.awt.Font accepts an int point size: 28 * width / 1240 is therefore
  // truncated before the glyphs are drawn.
  ctx.font = `${Math.trunc(28 * source.width / MAX_PAGE_WIDTH)}px Arial`;
  ctx.textBaseline = 'alphabetic';
  const lineGap = diagonal / random(8, 10);
  for (let i = 1; i < 11; i++) {
    const [red, green, blue, alpha] = WATERMARK_COLORS[Math.floor(Math.random() * WATERMARK_COLORS.length)];
    ctx.fillStyle = `rgba(${red}, ${green}, ${blue}, ${alpha / 255})`;
    ctx.fillText(watermark, 0, i * lineGap);
  }

  const blurred = canvas(diagonal, diagonal);
  const blurCtx = blurred.getContext('2d');
  blurCtx.globalAlpha = random(.75, .95);
  // Java builds a Gaussian kernel whose sigma is radius / 3, then convolves it
  // once horizontally and once vertically. CSS blur() takes the comparable
  // Gaussian standard deviation, not the Java kernel radius.
  const blurRadius = Math.floor(random(45, 65));
  blurCtx.filter = `blur(${blurRadius / 3}px)`;
  blurCtx.drawImage(layer, 0, 0);
  const rotated = canvas(diagonal, diagonal);
  const rctx = rotated.getContext('2d');
  rctx.translate(diagonal / 2, diagonal / 2); rctx.rotate(-25 * Math.PI / 180); rctx.translate(-diagonal / 2, -diagonal / 2);
  rctx.drawImage(layer, 0, 0); rctx.drawImage(blurred, 0, 0);
  const crop = canvas(source.width, source.height);
  crop.getContext('2d').drawImage(rotated, diagonal / 2 - source.width / 2, diagonal / 2 - source.height / 2, source.width, source.height, 0, 0, source.width, source.height);
  const code = qrBox(source);
  if (code) { const c = crop.getContext('2d'); c.clearRect(Math.max(0, code.x - 20), Math.max(0, code.y - 20), code.w + 40, code.h + 40); }
  source.getContext('2d').drawImage(crop, 0, 0);
  return source;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const files = [...filesInput.files]; const text = textInput.value.trim();
  if (!files.length || !text) return;
  button.disabled = true;
  try {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4', compress: true });
    let outputPages = 0;
    for (const file of files) {
      const pages = file.type === 'application/pdf' ? await pagesFromPdf(file) : [await imageFromFile(file)];
      for (const page of pages) {
        status.textContent = `Watermarking page ${++outputPages}…`;
        const image = applyWatermark(fitImageToPage(page), `${text}   `);
        if (outputPages > 1) pdf.addPage('a4', 'portrait');
        pdf.addImage(image.toDataURL('image/jpeg', .9), 'JPEG', 0, 0, 595.28, 595.28 * image.height / image.width, undefined, 'FAST');
      }
    }
    pdf.save('watermarked.pdf');
    status.textContent = `Done — ${outputPages} flattened page${outputPages === 1 ? '' : 's'} exported.`;
  } catch (error) {
    console.error(error); status.textContent = `Could not create the PDF: ${error.message || error}`;
  } finally { button.disabled = false; }
});
