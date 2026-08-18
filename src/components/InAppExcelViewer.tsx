import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { 
  FileSpreadsheet, 
  Layers, 
  Search, 
  X, 
  Maximize2, 
  ZoomIn, 
  ZoomOut, 
  Download, 
  Loader2, 
  AlertCircle 
} from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { getLocalFileBlob } from '../lib/storage';

function cn(...inputs: any[]) {
  return twMerge(clsx(inputs));
}

interface SheetData {
  name: string;
  rows: (string | number)[][];
  header: string[];
  maxCols: number;
}

interface InAppExcelViewerProps {
  fileId?: string;
  dataUrl?: string;
  fileName: string;
}

export const InAppExcelViewer: React.FC<InAppExcelViewerProps> = ({ fileId, dataUrl, fileName }) => {
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [activeSheetIdx, setActiveSheetIdx] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [zoomLevel, setZoomLevel] = useState<number>(100);

  // Load and Parse Excel
  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);

    const loadExcelData = async () => {
      try {
        let arrayBuffer: ArrayBuffer | null = null;

        // 1. Try local IndexedDB
        if (fileId) {
          const cached = await getLocalFileBlob(fileId);
          if (cached?.blob) {
            arrayBuffer = await cached.blob.arrayBuffer();
          } else if (cached?.dataUrl && cached.dataUrl.startsWith('data:')) {
            const base64Index = cached.dataUrl.indexOf(';base64,');
            if (base64Index !== -1) {
              const b64 = cached.dataUrl.substring(base64Index + 8);
              const binary = window.atob(b64);
              const len = binary.length;
              const bytes = new Uint8Array(len);
              for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
              arrayBuffer = bytes.buffer;
            }
          }
        }

        // 2. Fetch from URL if not found in IndexedDB
        if (!arrayBuffer && dataUrl) {
          if (dataUrl.startsWith('data:')) {
            const base64Index = dataUrl.indexOf(';base64,');
            if (base64Index !== -1) {
              const b64 = dataUrl.substring(base64Index + 8);
              const binary = window.atob(b64);
              const len = binary.length;
              const bytes = new Uint8Array(len);
              for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
              arrayBuffer = bytes.buffer;
            }
          } else {
            const res = await fetch(dataUrl);
            if (!res.ok) throw new Error('파일 다운로드 실패');
            arrayBuffer = await res.arrayBuffer();
          }
        }

        if (!arrayBuffer) {
          throw new Error('엑셀 데이터를 불러올 수 없습니다.');
        }

        // Parse with XLSX
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        const parsedSheets: SheetData[] = [];

        workbook.SheetNames.forEach((sheetName) => {
          const worksheet = workbook.Sheets[sheetName];
          const rawRows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

          // Filter completely empty rows
          const validRows = rawRows.filter((r) => r && r.some((c) => c !== '' && c !== null && c !== undefined));

          if (validRows.length > 0) {
            let maxCols = 0;
            validRows.forEach((r) => {
              if (r.length > maxCols) maxCols = r.length;
            });

            // Normalize row lengths
            const normalized = validRows.map((r) => {
              const newRow = [...r];
              while (newRow.length < maxCols) newRow.push('');
              return newRow;
            });

            parsedSheets.push({
              name: sheetName,
              rows: normalized,
              header: normalized[0] ? normalized[0].map(String) : [],
              maxCols
            });
          } else {
            parsedSheets.push({
              name: sheetName,
              rows: [],
              header: [],
              maxCols: 0
            });
          }
        });

        if (isMounted) {
          setSheets(parsedSheets);
          setActiveSheetIdx(0);
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

    loadExcelData();

    return () => {
      isMounted = false;
    };
  }, [fileId, dataUrl]);

  const currentSheet = sheets[activeSheetIdx];

  // Filter rows based on search
  const filteredRows = React.useMemo(() => {
    if (!currentSheet || !currentSheet.rows) return [];
    if (!searchTerm.trim()) return currentSheet.rows;
    const term = searchTerm.toLowerCase().trim();

    return currentSheet.rows.filter((row, idx) => {
      if (idx === 0) return true; // Always keep header
      return row.some((cell) => String(cell).toLowerCase().includes(term));
    });
  }, [currentSheet, searchTerm]);

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-slate-950 text-slate-300">
        <Loader2 size={36} className="animate-spin text-emerald-400 mb-3" />
        <p className="text-sm font-bold">엑셀 시트 불러오는 중...</p>
        <p className="text-xs text-slate-500 mt-1">다운로드 없이 앱 화면에서 바로 열립니다</p>
      </div>
    );
  }

  if (error || sheets.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-slate-900 text-center">
        <AlertCircle size={44} className="text-amber-400 mb-3" />
        <h4 className="text-base font-bold text-white mb-1">엑셀 내용을 표시할 수 없습니다</h4>
        <p className="text-xs text-slate-400 mb-4">{error || '시트 데이터가 없습니다.'}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-slate-950 text-slate-100 overflow-hidden select-none">
      {/* Top Toolbar */}
      <div className="bg-slate-900 border-b border-slate-800 px-3 py-2 flex items-center justify-between gap-3 flex-wrap shrink-0">
        {/* Left: Sheet Selection Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          <span className="text-xs font-bold text-slate-500 shrink-0 mr-1 flex items-center gap-1">
            <Layers size={13} />
            <span>시트:</span>
          </span>
          {sheets.map((sheet, idx) => {
            const isActive = idx === activeSheetIdx;
            return (
              <button
                key={idx}
                onClick={() => setActiveSheetIdx(idx)}
                className={cn(
                  'px-3 py-1 rounded-lg text-xs font-bold transition-all shrink-0 cursor-pointer border flex items-center gap-1.5',
                  isActive
                    ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm'
                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-750 hover:text-slate-200'
                )}
              >
                <FileSpreadsheet size={13} />
                <span>{sheet.name}</span>
                <span className="text-[10px] opacity-75 font-mono">({sheet.rows.length}행)</span>
              </button>
            );
          })}
        </div>

        {/* Right: Search & Zoom */}
        <div className="flex items-center gap-2 shrink-0">
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
              <button onClick={() => setSearchTerm('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
                <X size={12} />
              </button>
            )}
          </div>

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
              onClick={() => setZoomLevel((z) => Math.min(150, z + 10))}
              className="p-1 hover:bg-slate-700 text-slate-300 rounded cursor-pointer"
              title="확대"
            >
              <ZoomIn size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* Main Table Grid Area */}
      <div className="flex-1 overflow-auto bg-slate-900 p-2 sm:p-4">
        {filteredRows.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-500 text-sm">
            <FileSpreadsheet size={36} className="mb-2 opacity-50" />
            <span>표시할 데이터가 없습니다.</span>
          </div>
        ) : (
          <div 
            className="inline-block min-w-full bg-white rounded-xl shadow-xl border border-slate-300 overflow-hidden"
            style={{ transform: `scale(${zoomLevel / 100})`, transformOrigin: 'top left' }}
          >
            <table className="border-collapse w-full text-slate-800 text-xs sm:text-sm">
              <tbody>
                {filteredRows.map((row, rowIdx) => {
                  const isHeader = rowIdx === 0;
                  return (
                    <tr
                      key={rowIdx}
                      className={cn(
                        'transition-colors',
                        isHeader
                          ? 'bg-slate-800 text-white font-black sticky top-0 shadow-xs z-10'
                          : rowIdx % 2 === 1
                          ? 'bg-white hover:bg-emerald-50/50'
                          : 'bg-slate-50 hover:bg-emerald-50/50'
                      )}
                    >
                      {/* Row Index Indicator */}
                      <td className="border border-slate-300/80 px-2 py-1.5 text-center font-mono text-[11px] font-bold text-slate-400 bg-slate-100 select-none w-10 shrink-0">
                        {rowIdx + 1}
                      </td>

                      {row.map((cell, colIdx) => {
                        const cellStr = cell !== null && cell !== undefined ? String(cell) : '';
                        const isNumber = !isNaN(Number(cellStr.replace(/,/g, ''))) && cellStr.trim() !== '';
                        const isHighlighted = searchTerm.trim() && cellStr.toLowerCase().includes(searchTerm.toLowerCase().trim());

                        return (
                          <td
                            key={colIdx}
                            className={cn(
                              'border border-slate-300/80 px-3 py-1.5 whitespace-nowrap leading-tight',
                              isHeader ? 'text-center font-bold text-white border-slate-700' : 'text-slate-800',
                              isNumber && !isHeader ? 'text-right font-mono' : 'text-left',
                              isHighlighted && 'bg-amber-200 text-slate-900 font-black'
                            )}
                          >
                            {cellStr}
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

      {/* Bottom Sheet Summary Bar */}
      <div className="bg-slate-950 border-t border-slate-800 px-3 py-1 flex items-center justify-between text-[11px] text-slate-400 shrink-0 font-mono">
        <span>시트: {currentSheet?.name} (총 {currentSheet?.rows.length}행 × {currentSheet?.maxCols}열)</span>
        <span className="text-emerald-400 font-bold">인앱 엑셀 즉시 열람 중</span>
      </div>
    </div>
  );
};
