import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { 
  FileSpreadsheet, 
  Search, 
  X, 
  ZoomIn, 
  ZoomOut, 
  Layers, 
  Download, 
  Loader2, 
  AlertCircle,
  Table,
  CheckCircle2,
  Copy,
  Maximize2
} from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { getLocalFileBlob, saveLocalFileBlob } from '../lib/storage';

function cn(...inputs: any[]) {
  return twMerge(clsx(inputs));
}

interface SheetData {
  name: string;
  rows: (string | number | boolean | null)[][];
  header: string[];
  maxCols: number;
}

interface InAppExcelViewerProps {
  fileId?: string;
  dataUrl?: string;
  fileName: string;
  onDownloadNative?: () => void;
}

export const InAppExcelViewer: React.FC<InAppExcelViewerProps> = ({
  fileId,
  dataUrl,
  fileName,
  onDownloadNative
}) => {
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [activeSheetIdx, setActiveSheetIdx] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const [copiedCell, setCopiedCell] = useState<string | null>(null);

  // Parse Excel file from ArrayBuffer / Base64 instantly
  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);
    setActiveSheetIdx(0);
    setSearchTerm('');

    const loadExcel = async () => {
      try {
        let arrayBuffer: ArrayBuffer | null = null;

        // 1. Try local IndexedDB Cache first
        if (fileId) {
          try {
            const cached = await getLocalFileBlob(fileId);
            if (cached?.blob) {
              arrayBuffer = await cached.blob.arrayBuffer();
            } else if (cached?.dataUrl && cached.dataUrl.startsWith('data:')) {
              const res = await fetch(cached.dataUrl);
              arrayBuffer = await res.arrayBuffer();
            }
          } catch (e) {
            console.warn('IndexedDB load notice:', e);
          }
        }

        // 2. Try remote endpoints (resolves from server disk or auto-restores from Redis)
        if (!arrayBuffer) {
          const candidateUrls = [
            dataUrl,
            fileId ? `/api/file/${encodeURIComponent(fileId)}` : '',
            fileName ? `/api/file/${encodeURIComponent(fileName)}` : '',
            fileName ? `/uploads/${encodeURIComponent(fileName)}` : ''
          ].filter(Boolean) as string[];

          for (const targetUrl of candidateUrls) {
            try {
              if (targetUrl.startsWith('data:')) {
                const res = await fetch(targetUrl);
                arrayBuffer = await res.arrayBuffer();
                break;
              }

              const res = await fetch(targetUrl);
              if (res.ok) {
                const contentType = res.headers.get('content-type') || '';
                if (!contentType.includes('text/html')) {
                  const buf = await res.arrayBuffer();
                  if (buf && buf.byteLength > 0) {
                    arrayBuffer = buf;

                    // Cache locally for instant opening on this device
                    if (fileId) {
                      try {
                        const blob = new Blob([buf], {
                          type: fileName.endsWith('.xls') ? 'application/vnd.ms-excel' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                        });
                        await saveLocalFileBlob(fileId, {
                          blob,
                          name: fileName,
                          type: 'excel'
                        });
                      } catch {}
                    }
                    break;
                  }
                }
              }
            } catch (fetchErr) {
              console.warn(`Excel candidate fetch failed for ${targetUrl}:`, fetchErr);
            }
          }
        }

        if (!arrayBuffer || arrayBuffer.byteLength === 0) {
          throw new Error('엑셀 파일 데이터를 서버에서 불러오는 중이거나 찾을 수 없습니다. PC에서 파일을 열람하거나 재동기화 후 확인해주세요.');
        }

        // 3. Parse with SheetJS (Zero download, client-side memory parse)
        const workbook = XLSX.read(arrayBuffer, {
          type: 'array',
          cellDates: true,
          cellNF: false,
          cellText: true,
          dense: true
        });

        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
          throw new Error('엑셀 파일 내 유효한 시트가 없습니다.');
        }

        const parsedSheets: SheetData[] = workbook.SheetNames.map((sheetName) => {
          const worksheet = workbook.Sheets[sheetName];
          if (!worksheet) {
            return { name: sheetName, rows: [], header: [], maxCols: 0 };
          }

          // Convert to JSON array of arrays
          const rawData: any[][] = XLSX.utils.sheet_to_json(worksheet, {
            header: 1,
            defval: '',
            blankrows: false,
            raw: false
          });

          // Trim empty rows from end
          const trimmedRows = rawData.filter((row) =>
            row && row.some((cell) => cell !== '' && cell !== null && cell !== undefined)
          );

          if (trimmedRows.length === 0) {
            return { name: sheetName, rows: [], header: [], maxCols: 0 };
          }

          // Determine max columns
          let maxCols = 0;
          trimmedRows.forEach((r) => {
            if (r.length > maxCols) maxCols = r.length;
          });

          // Normalize row column lengths
          const normalizedRows = trimmedRows.map((r) => {
            const row = [...r];
            while (row.length < maxCols) row.push('');
            return row;
          });

          const header = (normalizedRows[0] || []).map((h, i) => String(h || `열 ${i + 1}`));

          return {
            name: sheetName,
            rows: normalizedRows,
            header,
            maxCols
          };
        });

        if (isMounted) {
          setSheets(parsedSheets);
          setLoading(false);
        }
      } catch (err: any) {
        console.error('InAppExcelViewer parse error:', err);
        if (isMounted) {
          setError(err?.message || '엑셀 파일을 파싱하는 도중 오류가 발생했습니다.');
          setLoading(false);
        }
      }
    };

    loadExcel();

    return () => {
      isMounted = false;
    };
  }, [fileId, dataUrl]);

  const currentSheet = sheets[activeSheetIdx];

  // Filter rows based on search keyword
  const filteredRows = useMemo(() => {
    if (!currentSheet || !currentSheet.rows) return [];
    if (!searchTerm.trim()) return currentSheet.rows;
    const term = searchTerm.toLowerCase().trim();

    return currentSheet.rows.filter((row, idx) => {
      if (idx === 0) return true; // Always show header row
      return row.some((cell) => String(cell).toLowerCase().includes(term));
    });
  }, [currentSheet, searchTerm]);

  // Copy cell content to clipboard
  const handleCopyCell = (text: string, cellKey: string) => {
    if (!text) return;
    navigator.clipboard?.writeText(String(text));
    setCopiedCell(cellKey);
    setTimeout(() => setCopiedCell(null), 1500);
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-slate-950 text-slate-300">
        <Loader2 size={38} className="animate-spin text-emerald-400 mb-3" />
        <p className="text-sm font-bold text-slate-200">엑셀 시트 불러오는 중...</p>
        <p className="text-xs text-slate-500 mt-1">다운로드 없이 앱 화면에서 바로 열립니다</p>
      </div>
    );
  }

  if (error || sheets.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-slate-900 text-center">
        <AlertCircle size={44} className="text-rose-400 mb-3" />
        <h4 className="text-base font-bold text-white mb-1">엑셀 내용을 표시할 수 없습니다</h4>
        <p className="text-xs text-slate-400 mb-4 max-w-md">{error || '시트 데이터가 없습니다.'}</p>
        {onDownloadNative && (
          <button
            onClick={onDownloadNative}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 mx-auto cursor-pointer"
          >
            <Download size={14} />
            <span>기기 기본 앱으로 열람 시도</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-slate-950 text-slate-100 overflow-hidden select-none">
      {/* 1. Sheet Tabs & Controls Toolbar */}
      <div className="bg-slate-900 border-b border-slate-800 px-3 py-2 flex items-center justify-between gap-3 flex-wrap shrink-0">
        {/* Left: Sheet Selection Tabs (PO, PACKING, etc.) */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 max-w-full sm:max-w-2xl">
          <span className="text-xs font-bold text-slate-500 shrink-0 mr-1 flex items-center gap-1">
            <Layers size={13} className="text-emerald-400" />
            <span>시트:</span>
          </span>
          {sheets.map((sheet, idx) => {
            const isActive = idx === activeSheetIdx;
            return (
              <button
                key={idx}
                onClick={() => setActiveSheetIdx(idx)}
                className={cn(
                  'px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer border flex items-center gap-1.5',
                  isActive
                    ? 'bg-emerald-600 text-white border-emerald-500 shadow-md ring-1 ring-emerald-400'
                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-750 hover:text-slate-200'
                )}
              >
                <FileSpreadsheet size={13} className={isActive ? "text-emerald-200" : "text-slate-400"} />
                <span>{sheet.name}</span>
                <span className="text-[10px] opacity-75 font-mono">({sheet.rows.length}행)</span>
              </button>
            );
          })}
        </div>

        {/* Right: In-Sheet Search & Zoom Controls */}
        <div className="flex items-center gap-2 shrink-0 ml-auto">
          {/* Quick Search */}
          <div className="relative w-36 sm:w-48">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="내용 검색..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-7 pr-6 py-1 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-400 font-bold"
            />
            {searchTerm && (
              <button 
                onClick={() => setSearchTerm('')} 
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Zoom Level */}
          <div className="flex items-center bg-slate-800 rounded-lg border border-slate-700 p-0.5 text-xs">
            <button
              onClick={() => setZoomLevel((z) => Math.max(70, z - 10))}
              className="p-1 hover:bg-slate-700 text-slate-300 rounded cursor-pointer"
              title="축소"
            >
              <ZoomOut size={13} />
            </button>
            <span className="font-mono text-[11px] font-bold px-1.5 text-slate-300 w-11 text-center">
              {zoomLevel}%
            </span>
            <button
              onClick={() => setZoomLevel((z) => Math.min(160, z + 10))}
              className="p-1 hover:bg-slate-700 text-slate-300 rounded cursor-pointer"
              title="확대"
            >
              <ZoomIn size={13} />
            </button>
          </div>

          {/* Reset Zoom */}
          <button
            onClick={() => setZoomLevel(100)}
            className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg transition-all text-[11px] font-bold hidden sm:inline-flex items-center gap-1 border border-slate-800"
            title="100% 기본 크기"
          >
            <Maximize2 size={12} />
            <span>100%</span>
          </button>
        </div>
      </div>

      {/* 2. Main Spreadsheet Table Grid Area */}
      <div className="flex-1 overflow-auto bg-slate-950 p-2 sm:p-4 select-text">
        {filteredRows.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-8 text-slate-500">
            <Table size={36} className="mb-2 opacity-50" />
            <p className="text-xs font-bold">검색 결과가 없습니다.</p>
          </div>
        ) : (
          <div 
            className="inline-block min-w-full rounded-xl overflow-hidden border border-slate-800 shadow-2xl bg-slate-900/90 transition-all origin-top-left"
            style={{ zoom: `${zoomLevel}%` }}
          >
            <table className="min-w-full divide-y divide-slate-800 text-xs text-left border-collapse">
              {/* Header Row */}
              <thead className="bg-slate-850 sticky top-0 z-10 shadow-sm">
                <tr className="divide-x divide-slate-800">
                  <th className="w-12 px-2.5 py-2.5 text-center font-mono font-bold text-slate-400 bg-slate-850 sticky left-0 z-20 border-b border-slate-700">
                    #
                  </th>
                  {currentSheet.header.map((colName, cIdx) => (
                    <th
                      key={cIdx}
                      className="px-3.5 py-2.5 font-bold text-slate-200 whitespace-nowrap bg-slate-850 border-b border-slate-700 tracking-wider"
                    >
                      {colName}
                    </th>
                  ))}
                </tr>
              </thead>

              {/* Data Rows */}
              <tbody className="divide-y divide-slate-800/80 bg-slate-900">
                {filteredRows.slice(1).map((row, rIdx) => {
                  const isEven = rIdx % 2 === 0;
                  return (
                    <tr
                      key={rIdx}
                      className={cn(
                        'divide-x divide-slate-800/60 transition-colors hover:bg-emerald-950/20 group',
                        isEven ? 'bg-slate-900/60' : 'bg-slate-900/30'
                      )}
                    >
                      {/* Row Index Number */}
                      <td className="px-2 py-2 text-center font-mono text-[11px] font-bold text-slate-500 bg-slate-900/90 sticky left-0 z-10 select-none group-hover:text-emerald-400 group-hover:bg-slate-850">
                        {rIdx + 1}
                      </td>

                      {/* Cells */}
                      {row.map((cell, cIdx) => {
                        const cellStr = cell !== null && cell !== undefined ? String(cell) : '';
                        const cellKey = `${rIdx}-${cIdx}`;
                        const isCopied = copiedCell === cellKey;
                        const isHighlighted = searchTerm.trim() && cellStr.toLowerCase().includes(searchTerm.toLowerCase());

                        return (
                          <td
                            key={cIdx}
                            onClick={() => handleCopyCell(cellStr, cellKey)}
                            className={cn(
                              'px-3.5 py-2 whitespace-nowrap font-normal text-slate-300 group-hover:text-white transition-colors relative cursor-pointer',
                              isHighlighted && 'bg-amber-500/20 text-amber-200 font-bold',
                              isCopied && 'bg-emerald-500/30 text-emerald-300 font-bold'
                            )}
                            title="클릭하여 내용 복사"
                          >
                            <span className="inline-block max-w-md truncate align-middle">
                              {cellStr || <span className="text-slate-600">-</span>}
                            </span>
                            {isCopied && (
                              <span className="ml-1.5 text-[10px] text-emerald-400 font-mono inline-flex items-center gap-0.5">
                                <CheckCircle2 size={11} /> 복사됨
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Bottom Status Bar */}
      <div className="bg-slate-900 border-t border-slate-800 px-3 py-1.5 flex items-center justify-between text-[11px] text-slate-400 shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-300">{currentSheet?.name}</span>
          <span>•</span>
          <span>총 {currentSheet?.rows.length ? currentSheet.rows.length - 1 : 0}행 표시 중</span>
          {searchTerm && (
            <span className="text-amber-400 font-bold font-mono">
              (필터링: {filteredRows.length ? filteredRows.length - 1 : 0}행 일치)
            </span>
          )}
        </div>
        <div className="text-slate-500 text-[10px]">
          셀 클릭 시 텍스트 복사 • 표 휠/터치 스크롤 이동
        </div>
      </div>
    </div>
  );
};
