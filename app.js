/* Local-only equivalent of FiligraneFacile (BOPdfDocumentTemplate's generic watermark path). */
'use strict';

const $ = selector => document.querySelector(selector);
const form = $('#watermark-form');
const filesInput = $('#files');
const textInput = $('#text');
const counter = $('#text-counter');
const addDate = $('#add-date');
const splitOutput = $('#split');
const useColors = $('#colors');
const protectQr = $('#protect-qr');
const button = $('#submit');
const status = $('#status');
const progress = $('#progress');
const errorBox = $('#error');
const fileList = $('#file-list');
const dropZone = $('.drop-zone');
const result = $('#result');
const downloads = $('#downloads');
const preview = $('#preview');

// PDRectangle.A4 is 595.27563 × 841.8898 points. Keep the PDFBox ratio rather
// than a rounded paper-size ratio because it drives the Java crop calculation.
const A4_RATIO = 841.8898 / 595.27563;
const A4_WIDTH_PT = 595.27563;
const MAX_PAGE_WIDTH = 1240; // PageDimension.A4150.width in the Java implementation
const MAX_TEXT_LENGTH = 100; // same limit as filigrane.beta.gouv.fr
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const PREVIEW_WIDTH = 360;
// BOPdfDocumentTemplate.COLORS. The Java feature is off by configuration by
// default; it is enabled here unless the user unticks "Couleurs variées".
const WATERMARK_COLORS = [
  [64, 64, 64, 255],
  [32, 32, 32, 220],
  [0, 0, 0, 110],
  [0, 0, 91, 170],
  [255, 0, 0, 170],
];
const DEFAULT_COLOR = WATERMARK_COLORS[0];

// vendor/pdf.worker.min.js is loaded by a <script> tag, which exposes window.pdfjsWorker:
// pdf.js then runs it in-page instead of fetching it, so index.html works from file://.
pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

/* ---------- File selection ---------- */

let selected = []; // File[]
let objectUrls = [];

const isPdf = file => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
const isHeic = file => /^image\/hei[cf]/.test(file.type) || /\.hei[cf]$/i.test(file.name);
const isImage = file => file.type.startsWith('image/') || isHeic(file) || /\.(jpe?g|png|gif|webp|bmp|avif|tiff?)$/i.test(file.name);
const formatSize = bytes => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} Ko` : `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = !message;
}

function addFiles(files) {
  const rejected = [];
  for (const file of files) {
    if (!isPdf(file) && !isImage(file)) rejected.push(`${file.name} (format non supporté)`);
    else if (file.size > MAX_FILE_SIZE) rejected.push(`${file.name} (plus de ${formatSize(MAX_FILE_SIZE)})`);
    else if (!selected.some(f => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified)) selected.push(file);
  }
  showError(rejected.length ? `Fichier${rejected.length > 1 ? 's' : ''} ignoré${rejected.length > 1 ? 's' : ''} : ${rejected.join(', ')}.` : '');
  renderFileList();
}

function renderFileList() {
  fileList.replaceChildren(...selected.map((file, index) => {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = file.name;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${isPdf(file) ? 'PDF' : 'Image'} · ${formatSize(file.size)}`;
    const tools = document.createElement('span');
    tools.className = 'tools';
    const make = (label, title, action, disabled) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = label; b.title = title; b.setAttribute('aria-label', `${title} : ${file.name}`);
      b.disabled = disabled; b.addEventListener('click', action);
      return b;
    };
    tools.append(
      make('↑', 'Monter', () => move(index, -1), index === 0),
      make('↓', 'Descendre', () => move(index, 1), index === selected.length - 1),
      make('✕', 'Retirer', () => { selected.splice(index, 1); renderFileList(); }, false),
    );
    item.append(name, meta, tools);
    return item;
  }));
}

function move(index, delta) {
  const [file] = selected.splice(index, 1);
  selected.splice(index + delta, 0, file);
  renderFileList();
}

filesInput.addEventListener('change', () => { addFiles(filesInput.files); filesInput.value = ''; });
['dragenter', 'dragover'].forEach(type => dropZone.addEventListener(type, e => { e.preventDefault(); dropZone.classList.add('drag'); }));
['dragleave', 'drop'].forEach(type => dropZone.addEventListener(type, e => { e.preventDefault(); dropZone.classList.remove('drag'); }));
dropZone.addEventListener('drop', e => addFiles(e.dataTransfer.files));
// Dropping a file outside the zone must not navigate away from the page.
['dragover', 'drop'].forEach(type => window.addEventListener(type, e => e.preventDefault()));

/* ---------- Watermark text ---------- */

const updateCounter = () => { counter.textContent = `${textInput.value.length}/${MAX_TEXT_LENGTH} caractères`; };
textInput.addEventListener('input', updateCounter);
document.querySelectorAll('.chip').forEach(chip => chip.addEventListener('click', () => {
  textInput.value = chip.dataset.text.slice(0, MAX_TEXT_LENGTH);
  updateCounter();
  textInput.focus();
  const placeholder = textInput.value.indexOf('[');
  if (placeholder >= 0) textInput.setSelectionRange(placeholder, textInput.value.indexOf(']') + 1);
}));

function watermarkText() {
  let text = textInput.value.trim().replace(/\s+/g, ' ');
  if (text && addDate.checked) text += ` — ${new Date().toLocaleDateString('fr-FR')}`;
  return text;
}

/* ---------- Rendering helpers ---------- */

// BufferedImage dimensions are Java int casts, which truncate toward zero.
const canvas = (width, height) => Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.trunc(width)), height: Math.max(1, Math.trunc(height)) });
const random = (min, max) => min + Math.random() * (max - min);
const release = c => { c.width = 0; c.height = 0; }; // frees canvas memory early on large documents

let heicLoader;
function loadHeicConverter() {
  heicLoader ??= new Promise((resolve, reject) => {
    const script = Object.assign(document.createElement('script'), { src: 'vendor/heic2any.min.js' });
    script.onload = () => resolve(window.heic2any);
    script.onerror = () => { heicLoader = null; reject(new Error('convertisseur HEIC introuvable')); };
    document.head.append(script);
  });
  return heicLoader;
}

async function decodeImage(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (error) {
    if (!isHeic(file)) throw new Error('image illisible ou corrompue');
  }
  // Safari decodes HEIC natively; other browsers need the bundled converter.
  status.textContent = `Conversion de ${file.name} (HEIC)…`;
  const heic2any = await loadHeicConverter();
  const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: .95 });
  return createImageBitmap(Array.isArray(converted) ? converted[0] : converted, { imageOrientation: 'from-image' });
}

async function* imagePages(file) {
  const bitmap = await decodeImage(file);
  const result = canvas(bitmap.width, bitmap.height);
  result.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close();
  yield { canvas: result, total: 1 };
}

async function openPdf(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjsLib.getDocument({ data, disableWorker: true, isEvalSupported: false });
  let cancelled = false;
  task.onPassword = (update, reason) => {
    const message = reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD
      ? `Mot de passe incorrect pour « ${file.name} ». Réessayez :`
      : `« ${file.name} » est protégé par un mot de passe. Saisissez-le :`;
    const password = prompt(message);
    if (password === null) { cancelled = true; task.destroy(); } else update(password);
  };
  try {
    return await task.promise;
  } catch (error) {
    if (cancelled || (error && error.name === 'PasswordException')) throw new Error('PDF protégé par mot de passe');
    console.error(error);
    throw new Error('PDF illisible ou corrompu');
  }
}

async function* pdfPages(file) {
  const pdf = await openPdf(file);
  try {
    for (let number = 1; number <= pdf.numPages; number++) {
      status.textContent = `Lecture de ${file.name}, page ${number} sur ${pdf.numPages}…`;
      const page = await pdf.getPage(number);
      const base = page.getViewport({ scale: 1 });
      const ratio = base.height / base.width;
      const scale = (ratio < A4_RATIO ? base.width : base.height / A4_RATIO) < MAX_PAGE_WIDTH ? 2 : (MAX_PAGE_WIDTH / base.width) * 2;
      const viewport = page.getViewport({ scale });
      const result = canvas(viewport.width, viewport.height);
      const ctx = result.getContext('2d');
      ctx.fillStyle = 'white'; ctx.fillRect(0, 0, result.width, result.height); // transparent PDF backgrounds would turn black in JPEG
      await page.render({ canvasContext: ctx, viewport }).promise;
      page.cleanup();
      yield { canvas: result, total: pdf.numPages };
    }
  } finally {
    pdf.destroy();
  }
}

async function countPages(file) {
  if (!isPdf(file)) return 1;
  try {
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), disableWorker: true, isEvalSupported: false }).promise;
    const count = pdf.numPages; pdf.destroy();
    return count;
  } catch (_) { return 1; } // password-protected or broken: counted when actually processed
}

function fitImageToPage(source) {
  const ratio = source.height / source.width;
  const width = ratio < A4_RATIO ? source.width : source.height / A4_RATIO;
  const height = ratio < A4_RATIO ? source.width * A4_RATIO : source.height;
  const scale = width < MAX_PAGE_WIDTH ? 1 : MAX_PAGE_WIDTH / source.width; // as in the Java code
  const result = canvas(scale * width, scale * height);
  const ctx = result.getContext('2d');
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, result.width, result.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, scale * (width - source.width) / 2, scale * (height - source.height) / 2, scale * source.width, scale * source.height);
  return result;
}

function qrBox(source) {
  try {
    const image = source.getContext('2d').getImageData(0, 0, source.width, source.height);
    const code = jsQR(image.data, source.width, source.height, { inversionAttempts: 'attemptBoth' });
    if (!code) return null;
    const p = code.location;
    const xs = [p.topLeftCorner.x, p.topRightCorner.x, p.bottomLeftCorner.x, p.bottomRightCorner.x];
    const ys = [p.topLeftCorner.y, p.topRightCorner.y, p.bottomLeftCorner.y, p.bottomRightCorner.y];
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  } catch (_) { return null; }
}

function applyWatermark(source, text, { colors, keepQr }) {
  const diagonal = Math.floor(Math.hypot(source.width, source.height));
  const layer = canvas(diagonal, diagonal);
  const ctx = layer.getContext('2d');
  const watermark = text.repeat(1 + Math.floor(128 / text.length));
  ctx.globalAlpha = random(.52, .6);
  // java.awt.Font accepts an int point size: 28 * width / 1240 is therefore
  // truncated before the glyphs are drawn.
  ctx.font = `${Math.trunc(28 * source.width / MAX_PAGE_WIDTH)}px Arial, Helvetica, sans-serif`;
  ctx.textBaseline = 'alphabetic';
  const lineGap = diagonal / random(8, 10);
  for (let i = 1; i < 11; i++) {
    const [red, green, blue, alpha] = colors ? WATERMARK_COLORS[Math.floor(Math.random() * WATERMARK_COLORS.length)] : DEFAULT_COLOR;
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
  release(layer); release(blurred);
  const crop = canvas(source.width, source.height);
  crop.getContext('2d').drawImage(rotated, diagonal / 2 - source.width / 2, diagonal / 2 - source.height / 2, source.width, source.height, 0, 0, source.width, source.height);
  release(rotated);
  const code = keepQr && qrBox(source);
  if (code) crop.getContext('2d').clearRect(Math.max(0, code.x - 20), Math.max(0, code.y - 20), code.w + 40, code.h + 40);
  source.getContext('2d').drawImage(crop, 0, 0);
  release(crop);
  return source;
}

function thumbnail(source, label) {
  const scale = PREVIEW_WIDTH / source.width;
  const thumb = canvas(PREVIEW_WIDTH, source.height * scale);
  const ctx = thumb.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, thumb.width, thumb.height);
  const figure = document.createElement('figure');
  const caption = document.createElement('figcaption');
  caption.textContent = label;
  thumb.setAttribute('role', 'img');
  thumb.setAttribute('aria-label', `Aperçu : ${label}`);
  figure.append(thumb, caption);
  return figure;
}

/* ---------- Output ---------- */

const baseName = name => name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_') || 'document';

function newPdf() {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4', compress: true });
  pdf.setProperties({ title: 'Document filigrané', creator: 'Filigrane (local)' });
  return { pdf, pages: 0 };
}

function addPage(doc, image) {
  if (doc.pages++ > 0) doc.pdf.addPage('a4', 'portrait');
  doc.pdf.addImage(image.toDataURL('image/jpeg', .9), 'JPEG', 0, 0, A4_WIDTH_PT, A4_WIDTH_PT * image.height / image.width, undefined, 'FAST');
}

function clearResult() {
  objectUrls.forEach(url => URL.revokeObjectURL(url));
  objectUrls = [];
  downloads.replaceChildren();
  preview.replaceChildren();
  result.hidden = true;
}

function addDownload(doc, filename) {
  const url = URL.createObjectURL(doc.pdf.output('blob'));
  objectUrls.push(url);
  const item = document.createElement('li');
  const link = Object.assign(document.createElement('a'), { href: url, download: filename, className: 'btn btn-download' });
  link.textContent = 'Télécharger le document filigrané';
  const open = Object.assign(document.createElement('a'), { href: url, target: '_blank', rel: 'noopener', className: 'open' });
  open.textContent = 'Ouvrir';
  const name = document.createElement('span');
  name.className = 'meta';
  name.textContent = `${filename} · ${doc.pages} page${doc.pages > 1 ? 's' : ''}`;
  item.append(link, name, open);
  downloads.append(item);
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const text = watermarkText();
  if (!selected.length) { showError('Veuillez sélectionner au moins un fichier.'); filesInput.focus(); return; }
  if (!textInput.value.trim()) { showError('Veuillez indiquer le filigrane à insérer.'); textInput.focus(); return; }
  showError('');
  clearResult();
  button.disabled = true;
  form.setAttribute('aria-busy', 'true');
  const options = { colors: useColors.checked, keepQr: protectQr.checked };
  const files = [...selected];
  const failures = [];
  try {
    status.textContent = 'Préparation…';
    const totals = await Promise.all(files.map(countPages));
    progress.max = totals.reduce((a, b) => a + b, 0);
    progress.value = 0;
    progress.hidden = false;
    const split = splitOutput.checked && files.length > 1;
    let doc = newPdf();
    for (const file of files) {
      if (split) doc = newPdf();
      let filePage = 0;
      try {
        for await (const { canvas: page } of (isPdf(file) ? pdfPages(file) : imagePages(file))) {
          status.textContent = `Ajout du filigrane, page ${progress.value + 1} sur ${progress.max}…`;
          const fitted = fitImageToPage(page);
          if (fitted !== page) release(page);
          // The trailing spaces separate repetitions, as in the Java implementation.
          const image = applyWatermark(fitted, `${text}   `, options);
          addPage(doc, image);
          preview.append(thumbnail(image, `${file.name} — page ${++filePage}`));
          release(image);
          progress.value = Math.min(progress.max, progress.value + 1);
          await new Promise(resolve => setTimeout(resolve, 0)); // keep the page responsive (rAF would pause in background tabs)
        }
      } catch (error) {
        console.error(error);
        failures.push(`${file.name} (${error.message || error})`);
      }
      if (split && doc.pages) addDownload(doc, `${baseName(file.name)}-filigrane.pdf`);
    }
    if (!split && doc.pages) addDownload(doc, files.length === 1 ? `${baseName(files[0].name)}-filigrane.pdf` : 'documents-filigranes.pdf');
    if (failures.length) showError(`Impossible de traiter : ${failures.join(', ')}.`);
    if (downloads.children.length) {
      result.hidden = false;
      status.textContent = 'Terminé.';
      result.scrollIntoView({ behavior: 'smooth', block: 'start' });
      downloads.querySelector('a').focus({ preventScroll: true });
    } else {
      status.textContent = '';
    }
  } catch (error) {
    console.error(error);
    showError(`Impossible de créer le PDF : ${error.message || error}`);
    status.textContent = '';
  } finally {
    button.disabled = false;
    progress.hidden = true;
    form.removeAttribute('aria-busy');
  }
});

window.addEventListener('pagehide', () => objectUrls.forEach(url => URL.revokeObjectURL(url)));
