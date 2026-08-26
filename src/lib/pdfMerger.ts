import { PDFDocument } from 'pdf-lib';

/**
 * Merges multiple PDF files into a single continuous PDF document on the client side.
 * Preserves high resolution and vectors without quality loss.
 */
export async function mergePdfFiles(
  files: File[],
  customFileName?: string
): Promise<File> {
  if (files.length === 0) {
    throw new Error('병합할 PDF 파일이 없습니다.');
  }

  if (files.length === 1 && !customFileName) {
    return files[0];
  }

  const mergedPdf = await PDFDocument.create();

  for (const file of files) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const loadedPdf = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
      const copiedPages = await mergedPdf.copyPages(loadedPdf, loadedPdf.getPageIndices());
      copiedPages.forEach((page) => mergedPdf.addPage(page));
    } catch (err: any) {
      console.error(`Failed to read/merge PDF file: ${file.name}`, err);
      throw new Error(`PDF 파일 '${file.name}'을(를) 읽고 병합하는 중 오류가 발생했습니다: ${err?.message || '지원되지 않는 형식이거나 암호화되어 있을 수 있습니다.'}`);
    }
  }

  const mergedPdfBytes = await mergedPdf.save();
  const blob = new Blob([mergedPdfBytes], { type: 'application/pdf' });

  let finalName = (customFileName || '').trim();
  if (!finalName) {
    const baseName = files[0].name.replace(/\.[^/.]+$/, '');
    finalName = `${baseName}_병합_${files.length}P.pdf`;
  } else if (!finalName.toLowerCase().endsWith('.pdf')) {
    finalName = `${finalName}.pdf`;
  }

  return new File([blob], finalName, {
    type: 'application/pdf',
    lastModified: Date.now(),
  });
}
