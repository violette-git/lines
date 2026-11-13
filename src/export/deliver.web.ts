// Web delivery: browser download via Blob + anchor. PDF opens the report in a new window and
// prints it (expo-print's web printToFileAsync only calls window.print() on the current page).
import type { BuiltExport } from './build';

export interface DeliveryResult {
  fileName: string;
  uri?: string;
}

function download(data: BlobPart, fileName: string, mimeType: string): void {
  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser time to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function printHtml(html: string): boolean {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  const go = () => {
    w.focus();
    w.print();
  };
  // Wait for embedded images to decode before printing.
  if (w.document.readyState === 'complete') setTimeout(go, 300);
  else w.addEventListener('load', () => setTimeout(go, 300));
  return true;
}

export async function deliver(built: BuiltExport): Promise<DeliveryResult> {
  if (built.kind === 'html-pdf') {
    if (printHtml(built.html)) return { fileName: built.fileName };
    // Pop-up blocked: download the report as HTML so it can be opened and printed to PDF.
    const htmlName = built.fileName.replace(/\.pdf$/i, '_report.html');
    download(built.html, htmlName, 'text/html;charset=utf-8');
    return { fileName: htmlName };
  }
  const data: BlobPart = typeof built.data === 'string' ? built.data : (built.data as Uint8Array<ArrayBuffer>);
  download(data, built.fileName, built.type.mimeType);
  return { fileName: built.fileName };
}
