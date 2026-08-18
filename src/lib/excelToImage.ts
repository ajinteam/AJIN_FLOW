// Utility: Convert Excel sheets into high-resolution, print-ready document images (PNG / JPEG)
// Eliminates messy cell grids and renders crisp, beautiful document sheets!

export interface ConvertedSheetImage {
  name: string;
  dataUrl: string;
  rowCount: number;
  colCount: number;
}

export async function convertSheetToDocumentImage(
  sheetName: string,
  data: any[][],
  fileName?: string
): Promise<ConvertedSheetImage> {
  return new Promise((resolve) => {
    // Filter out completely empty rows
    const cleanedRows = data.filter((row) =>
      row && row.some((cell) => cell !== '' && cell !== null && cell !== undefined)
    );

    if (cleanedRows.length === 0) {
      // Empty sheet fallback
      const canvas = document.createElement('canvas');
      canvas.width = 1200;
      canvas.height = 800;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#64748B';
        ctx.font = 'bold 24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`[ ${sheetName} ] 빈 시트입니다.`, canvas.width / 2, canvas.height / 2);
      }
      resolve({
        name: sheetName,
        dataUrl: canvas.toDataURL('image/png'),
        rowCount: 0,
        colCount: 0
      });
      return;
    }

    // Determine max columns
    let maxCols = 0;
    cleanedRows.forEach((r) => {
      if (r.length > maxCols) maxCols = r.length;
    });
    maxCols = Math.max(maxCols, 1);

    // Calculate approximate column widths based on text length
    const colWidths: number[] = new Array(maxCols).fill(100);
    const measureCanvas = document.createElement('canvas');
    const measureCtx = measureCanvas.getContext('2d');
    if (measureCtx) {
      measureCtx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      cleanedRows.forEach((row) => {
        row.forEach((cell, colIdx) => {
          if (cell !== undefined && cell !== null) {
            const text = String(cell);
            const textWidth = measureCtx.measureText(text).width + 36;
            if (textWidth > colWidths[colIdx]) {
              colWidths[colIdx] = Math.min(textWidth, 500); // cap max col width
            }
          }
        });
      });
    }

    // Adjust col widths for balance
    const minColWidth = 110;
    for (let i = 0; i < maxCols; i++) {
      if (colWidths[i] < minColWidth) colWidths[i] = minColWidth;
    }

    const padding = 40;
    const headerBannerHeight = 100;
    const rowHeight = 36;
    const totalTableWidth = colWidths.reduce((a, b) => a + b, 0);
    const canvasWidth = Math.max(totalTableWidth + padding * 2, 1400);
    const canvasHeight = headerBannerHeight + padding * 2 + cleanedRows.length * rowHeight + 60;

    // High DPI 2x canvas for retina crispness
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth * scale;
    canvas.height = canvasHeight * scale;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      resolve({
        name: sheetName,
        dataUrl: '',
        rowCount: cleanedRows.length,
        colCount: maxCols
      });
      return;
    }

    ctx.scale(scale, scale);

    // 1. Background (Clean Paper White)
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // 2. Paper Outer Border
    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 1;
    ctx.strokeRect(10, 10, canvasWidth - 20, canvasHeight - 20);

    // 3. Top Document Header Bar (Professional Business Navy/Emerald)
    const headerGrad = ctx.createLinearGradient(padding, padding, canvasWidth - padding, padding);
    headerGrad.addColorStop(0, '#0F172A');
    headerGrad.addColorStop(1, '#1E293B');
    ctx.fillStyle = headerGrad;
    
    // Rounded header top
    const topBarHeight = 70;
    ctx.beginPath();
    ctx.roundRect(padding, padding, canvasWidth - padding * 2, topBarHeight, [8, 8, 0, 0]);
    ctx.fill();

    // Header Title (Sheet Name e.g. PO, PACKING)
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 22px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`SHEET: ${sheetName.toUpperCase()}`, padding + 24, padding + 42);

    // Header Subtitle (File name & Timestamp)
    ctx.fillStyle = '#94A3B8';
    ctx.font = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'right';
    const timeStr = new Date().toLocaleString('ko-KR', { hour12: false });
    ctx.fillText(`${fileName || 'DOCUMENT'}  |  총 ${cleanedRows.length}행  |  ${timeStr}`, canvasWidth - padding - 24, padding + 42);

    // 4. Draw Rows & Columns
    let startY = padding + topBarHeight;
    let startX = padding;

    cleanedRows.forEach((row, rowIdx) => {
      const isHeaderRow = rowIdx === 0;
      const currentY = startY + rowIdx * rowHeight;

      // Row Background
      if (isHeaderRow) {
        ctx.fillStyle = '#F1F5F9';
      } else if (rowIdx % 2 === 1) {
        ctx.fillStyle = '#FFFFFF';
      } else {
        ctx.fillStyle = '#F8FAFC';
      }
      ctx.fillRect(startX, currentY, totalTableWidth, rowHeight);

      // Row Bottom Line
      ctx.strokeStyle = isHeaderRow ? '#94A3B8' : '#E2E8F0';
      ctx.lineWidth = isHeaderRow ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(startX, currentY + rowHeight);
      ctx.lineTo(startX + totalTableWidth, currentY + rowHeight);
      ctx.stroke();

      // Draw Cells
      let curX = startX;
      for (let colIdx = 0; colIdx < maxCols; colIdx++) {
        const cellValue = row[colIdx];
        const colW = colWidths[colIdx];

        // Vertical Grid Line
        ctx.strokeStyle = isHeaderRow ? '#CBD5E1' : '#EDF2F7';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(curX + colW, currentY);
        ctx.lineTo(curX + colW, currentY + rowHeight);
        ctx.stroke();

        if (cellValue !== undefined && cellValue !== null && cellValue !== '') {
          const text = String(cellValue);
          
          if (isHeaderRow) {
            ctx.fillStyle = '#0F172A';
            ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
          } else {
            ctx.fillStyle = '#1E293B';
            ctx.font = '13.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
          }

          // Smart Alignment (numbers to right, codes to center, words to left)
          const isNumber = !isNaN(Number(text.replace(/,/g, ''))) && text.trim() !== '';
          ctx.textAlign = isHeaderRow ? 'center' : isNumber ? 'right' : 'left';

          let textX = curX + 14;
          if (ctx.textAlign === 'center') textX = curX + colW / 2;
          if (ctx.textAlign === 'right') textX = curX + colW - 14;

          // Clip text if it exceeds cell width
          ctx.save();
          ctx.beginPath();
          ctx.rect(curX + 4, currentY, colW - 8, rowHeight);
          ctx.clip();
          ctx.fillText(text, textX, currentY + 23);
          ctx.restore();
        }

        curX += colW;
      }
    });

    // 5. Outer Table Boundary Box
    ctx.strokeStyle = '#64748B';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(startX, startY, totalTableWidth, cleanedRows.length * rowHeight);

    // 6. Bottom Footer Stamp
    ctx.fillStyle = '#64748B';
    ctx.font = 'italic 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('AJIN PRECISION CO., LTD.  —  DOCUMENT CONVERTED VIEW', canvasWidth / 2, canvasHeight - 22);

    // Export image as PNG / JPEG
    const resultUrl = canvas.toDataURL('image/jpeg', 0.94);
    resolve({
      name: sheetName,
      dataUrl: resultUrl,
      rowCount: cleanedRows.length,
      colCount: maxCols
    });
  });
}
