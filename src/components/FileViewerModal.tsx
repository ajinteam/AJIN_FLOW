import React, { useState, useEffect } from 'react';
import { InfoFile } from '../types';
import { X, Download, ZoomIn, ZoomOut, RotateCw, FileSpreadsheet, FileText, Image as ImageIcon, Search, Maximize2, Minimize2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import { format, parseISO } from 'date-fns';
import { formatFileSize } from '../lib/imageCompressor';
import { PdfViewer } from './PdfViewer';

interface FileViewerModalProps {
  file: InfoFile | null;
  onClose: () => void;
  canDownload?: boolean;
}

export const FileViewerModal: React.FC<FileViewerModalProps> = ({ file, onClose, canDownload = true }) => {
  const [zoom, setZoom] = useState<number>(100);
  const [rotation, setRotation] = useState<number>(0);
  // Default to true so PC/Desktop opens in full-screen view (Requirement #3)
  const [isFullscreen, setIsFullscreen] = useState<boolean>(true);

  // Excel viewer state
  const [excelSheets, setExcelSheets] = useState<{ name: string; data: any[][] }[]>([]);
  const [activeSheetIndex, setActiveSheetIndex] = useState<number>(0);
  const [excelSearch, setExcelSearch] = useState<string>('');
  const [excelLoading, setExcelLoading] = useState<boolean>(false);
  const [excelError, setExcelError] = useState<string>('');

  // Mobile Back Button support (Requirement #4)
  useEffect(() => {
    if (!file) return;

    // Push history state when viewer opens
    window.history.pushState({ modal: 'file-viewer', fileId: file.id }, '');

    const handlePopState = (e: PopStateEvent) => {
      onClose();
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [file, onClose]);

  useEffect(() => {
    setZoom(100);
    setRotation(0);
    setExcelSheets([]);
    setActiveSheetIndex(0);
    setExcelSearch('');
    setExcelError('');

    if (!file) return;

    if (file.fileType === 'excel') {
      loadExcelData(file);
    }
  }, [file]);

  const loadExcelData = async (fileObj: InfoFile) => {
    setExcelLoading(true);
    setExcelError('');
    try {
      let arrayBuffer: ArrayBuffer;

      if (fileObj.fileUrl.startsWith('data:')) {
        // Base64 data URL
        const base64 = fileObj.fileUrl.split(',')[1];
        const binaryString = window.atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        arrayBuffer = bytes.buffer;
      } else {
        const response = await fetch(fileObj.fileUrl);
        if (!response.ok) throw new Error('파일을 불러올 수 없습니다.');
        arrayBuffer = await response.arrayBuffer();
      }

      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const parsedSheets = workbook.SheetNames.map((name) => {
        const worksheet = workbook.Sheets[name];
        const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' }) as any[][];
        return { name, data: rawData };
      });

      setExcelSheets(parsedSheets);
    } catch (err: any) {
      console.error('Excel parse error:', err);
      setExcelError('엑셀 파일을 파싱하는 데 실패했습니다. 다운로드하여 확인해 주세요.');
    } finally {
      setExcelLoading(false);
    }
  };

  if (!file) return null;

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = file.fileUrl;
    link.download = file.fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 25, 300));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 25, 50));
  const handleRotate = () => setRotation((prev) => (prev + 90) % 360);

  // Filter Excel data based on search
  const currentSheet = excelSheets[activeSheetIndex];
  const filteredRows = currentSheet
    ? currentSheet.data.filter((row, idx) => {
        if (idx === 0) return true; // Always show header row
        if (!excelSearch.trim()) return true;
        return row.some((cell) =>
          String(cell || '').toLowerCase().includes(excelSearch.toLowerCase())
        );
      })
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-0 md:p-4">
      <div
        className={`flex flex-col bg-slate-900 text-slate-100 border border-slate-700 shadow-2xl overflow-hidden transition-all duration-200 ${
          isFullscreen
            ? 'fixed inset-0 w-full h-full rounded-none'
            : 'w-full h-full md:h-[92vh] md:max-w-6xl md:rounded-2xl'
        }`}
      >
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-3 bg-slate-800/90 border-b border-slate-700 select-none shrink-0">
          <div className="flex items-center gap-2.5 min-w-0 pr-2">
            <div className="p-1.5 rounded-lg bg-slate-700 text-slate-200 shrink-0">
              {file.fileType === 'pdf' && <FileText className="w-5 h-5 text-red-400" />}
              {file.fileType === 'excel' && <FileSpreadsheet className="w-5 h-5 text-emerald-400" />}
              {file.fileType === 'image' && <ImageIcon className="w-5 h-5 text-sky-400" />}
              {file.fileType === 'other' && <FileText className="w-5 h-5 text-slate-400" />}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-sm md:text-base text-slate-100 truncate">
                  {file.fileName}
                </h2>
                <span
                  className={`px-1.5 py-0.5 rounded font-bold font-mono text-[10px] shrink-0 ${
                    file.isImageAlbum
                      ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                      : file.version && file.version > 1
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                  }`}
                >
                  {file.isImageAlbum ? `연속사진 (${file.imageList?.length || 'N'}P)` : `V${file.version || 1}`}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 whitespace-nowrap mt-0.5">
                <span>{formatFileSize(file.fileSize)}</span>
                <span>•</span>
                <span>
                  업로드:{' '}
                  {file.updatedAt
                    ? format(parseISO(file.updatedAt), 'yyyy-MM-dd HH:mm')
                    : file.uploadedAt
                    ? format(parseISO(file.uploadedAt), 'yyyy-MM-dd HH:mm')
                    : '-'}
                </span>
                <span>•</span>
                <span>등록자: <strong className="text-slate-200">{file.uploadedBy}</strong></span>
                {file.originalSize && file.originalSize > file.fileSize && (
                  <>
                    <span>•</span>
                    <span className="text-emerald-400 font-medium">
                      최적화 완료 (-{Math.round(((file.originalSize - file.fileSize) / file.originalSize) * 100)}%)
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1 shrink-0">
            {file.fileType === 'image' && (
              <>
                <button
                  onClick={handleZoomOut}
                  className="p-2 rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
                  title="축소"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <span className="text-xs text-slate-400 font-mono px-1 min-w-[3rem] text-center hidden sm:inline-block">
                  {zoom}%
                </span>
                <button
                  onClick={handleZoomIn}
                  className="p-2 rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
                  title="확대"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  onClick={handleRotate}
                  className="p-2 rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
                  title="회전"
                >
                  <RotateCw className="w-4 h-4" />
                </button>
              </>
            )}

            {canDownload && (
              <button
                onClick={handleDownload}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs md:text-sm font-medium transition-colors ml-1"
                title="다운로드"
              >
                <Download className="w-4 h-4" />
                <span className="hidden sm:inline">다운로드</span>
              </button>
            )}

            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="p-2 rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white transition-colors hidden md:block"
              title={isFullscreen ? '창 모드' : '전체화면'}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>

            <button
              onClick={onClose}
              className="p-2 rounded-lg text-slate-300 hover:bg-red-500/20 hover:text-red-400 transition-colors ml-1"
              title="닫기"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content body */}
        <div className="flex-1 overflow-auto bg-slate-950 flex flex-col relative">
          {/* 1. PDF Viewer with HTML5 Canvas (No '열기' button, Instant Mobile Rendering) */}
          {file.fileType === 'pdf' && (
            <PdfViewer fileUrl={file.fileUrl} fileName={file.fileName} />
          )}

          {/* 2. Image Viewer / Webtoon Album Viewer */}
          {file.fileType === 'image' && (
            file.isImageAlbum && file.imageList && file.imageList.length > 0 ? (
              /* Continuous Vertical Webtoon Scroll Mode */
              <div className="w-full h-full overflow-y-auto overflow-x-hidden p-2 sm:p-6 select-none touch-pan-y flex flex-col items-center bg-slate-950">
                <div
                  style={{
                    transform: `scale(${zoom / 100})`,
                    transformOrigin: 'top center',
                    transition: 'transform 0.15s ease-out',
                  }}
                  className="w-full max-w-3xl flex flex-col items-center gap-4 my-2"
                >
                  <div className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg bg-slate-900/90 border border-slate-800 text-xs text-slate-400">
                    <span className="font-semibold text-sky-400 flex items-center gap-1.5">
                      <ImageIcon className="w-4 h-4" />
                      연속사진 • 총 {file.imageList.length}장
                    </span>
                    <span>위아래로 스크롤하여 연속 열람</span>
                  </div>

                  {file.imageList.map((imgItem, imgIdx) => (
                    <div
                      key={imgIdx}
                      className="w-full flex flex-col items-center bg-slate-900/40 rounded-xl overflow-hidden border border-slate-800/80 shadow-2xl"
                    >
                      <div className="w-full px-3 py-1.5 bg-slate-800/80 border-b border-slate-700/60 flex items-center justify-between text-[11px] text-slate-300">
                        <span className="font-mono font-bold text-sky-400">
                          #{imgIdx + 1} / {file.imageList!.length}
                        </span>
                        <span className="truncate max-w-[200px] text-slate-400 font-mono">
                          {imgItem.name}
                        </span>
                      </div>
                      <img
                        src={imgItem.url}
                        alt={imgItem.name || `사진 ${imgIdx + 1}`}
                        loading="lazy"
                        className="w-full h-auto object-contain block"
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              /* Single Image Standard Mode */
              <div className="w-full h-full flex items-center justify-center overflow-auto p-4 select-none touch-pan-x touch-pan-y">
                <div
                  style={{
                    transform: `scale(${zoom / 100}) rotate(${rotation}deg)`,
                    transition: 'transform 0.15s ease-out',
                  }}
                  className="flex items-center justify-center max-w-full max-h-full"
                >
                  <img
                    src={file.fileUrl}
                    alt={file.fileName}
                    className="max-w-full max-h-[80vh] object-contain rounded shadow-2xl border border-slate-800"
                  />
                </div>
              </div>
            )
          )}

          {/* 3. Excel Viewer */}
          {file.fileType === 'excel' && (
            <div className="flex-1 flex flex-col h-full overflow-hidden">
              {/* Sheet selector and search bar */}
              <div className="p-3 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 shrink-0">
                {/* Sheets tabs */}
                <div className="flex items-center gap-1 overflow-x-auto max-w-full py-1">
                  {excelSheets.map((sheet, sIdx) => (
                    <button
                      key={sheet.name}
                      onClick={() => setActiveSheetIndex(sIdx)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                        activeSheetIndex === sIdx
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      {sheet.name}
                    </button>
                  ))}
                </div>

                {/* Table search filter */}
                <div className="relative w-full sm:w-64">
                  <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={excelSearch}
                    onChange={(e) => setExcelSearch(e.target.value)}
                    placeholder="내용 / 도번 / 품명 검색..."
                    className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 placeholder-slate-500"
                  />
                  {excelSearch && (
                    <button
                      onClick={() => setExcelSearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>

              {/* Table Data display */}
              <div className="flex-1 overflow-auto p-2">
                {excelLoading && (
                  <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-2">
                    <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm">엑셀 데이터를 분석하고 있습니다...</span>
                  </div>
                )}

                {excelError && (
                  <div className="flex flex-col items-center justify-center h-64 text-red-400 gap-3 p-4 text-center">
                    <p className="text-sm">{excelError}</p>
                    {canDownload && (
                      <button
                        onClick={handleDownload}
                        className="px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 text-sm hover:bg-slate-700 flex items-center gap-2"
                      >
                        <Download className="w-4 h-4" />
                        엑셀 원본 다운로드
                      </button>
                    )}
                  </div>
                )}

                {!excelLoading && !excelError && currentSheet && (
                  <div className="border border-slate-800 rounded-lg overflow-hidden bg-slate-900 shadow-md">
                    <div className="overflow-x-auto max-h-[calc(90vh-140px)]">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          {filteredRows[0] && (
                            <tr className="bg-slate-800/90 sticky top-0 z-10 border-b border-slate-700">
                              <th className="py-2.5 px-3 font-semibold text-slate-300 border-r border-slate-700/50 w-12 text-center">
                                #
                              </th>
                              {filteredRows[0].map((header: any, cIdx: number) => (
                                <th
                                  key={cIdx}
                                  className="py-2.5 px-3 font-semibold text-emerald-400 border-r border-slate-700/50 whitespace-nowrap min-w-[100px]"
                                >
                                  {header !== '' && header !== null && header !== undefined
                                    ? String(header)
                                    : `열 ${cIdx + 1}`}
                                </th>
                              ))}
                            </tr>
                          )}
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                          {filteredRows.slice(1).map((row, rIdx) => (
                            <tr
                              key={rIdx}
                              className="hover:bg-slate-800/60 transition-colors odd:bg-slate-900/40 even:bg-slate-900/90"
                            >
                              <td className="py-2 px-3 text-slate-500 border-r border-slate-800 text-center font-mono select-none">
                                {rIdx + 1}
                              </td>
                              {row.map((cell: any, cIdx: number) => (
                                <td
                                  key={cIdx}
                                  className="py-2 px-3 text-slate-200 border-r border-slate-800 whitespace-nowrap"
                                >
                                  {cell !== '' && cell !== null && cell !== undefined
                                    ? String(cell)
                                    : '-'}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="p-2 bg-slate-800/70 border-t border-slate-800 text-xs text-slate-400 flex items-center justify-between">
                      <span>총 {filteredRows.length > 0 ? filteredRows.length - 1 : 0}행 표시 중</span>
                      {excelSearch && (
                        <span className="text-emerald-400 font-medium">검색 필터 적용됨</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 4. Other File types */}
          {file.fileType === 'other' && (
            <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center gap-4">
              <FileText className="w-16 h-16 text-slate-500" />
              <div className="max-w-md">
                <h3 className="text-base font-medium text-slate-200 mb-1">{file.fileName}</h3>
                <p className="text-xs text-slate-400 mb-4">
                  미리보기를 지원하지 않는 파일 형식입니다.{canDownload ? ' 다운로드하여 확인해 주세요.' : ''}
                </p>
                {canDownload && (
                  <button
                    onClick={handleDownload}
                    className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium transition-colors inline-flex items-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    파일 다운로드
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
