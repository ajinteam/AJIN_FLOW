import React, { useState } from 'react';
import { Loader2, ExternalLink, RefreshCw } from 'lucide-react';

interface PdfViewerProps {
  fileUrl: string;
  fileName: string;
}

export const PdfViewer: React.FC<PdfViewerProps> = ({ fileUrl, fileName }) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [useFallback, setUseFallback] = useState<boolean>(false);

  // Convert relative file URL to absolute URL for Google Docs Viewer
  const getAbsoluteUrl = (url: string) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    if (typeof window !== 'undefined') {
      return `${window.location.origin}${url.startsWith('/') ? '' : '/'}${url}`;
    }
    return url;
  };

  const absoluteUrl = getAbsoluteUrl(fileUrl);
  const isBase64 = fileUrl.startsWith('data:');

  // Google Docs viewer URL for online PDF viewing without mobile download/open prompt
  const googleDocsViewerUrl = `https://docs.google.com/viewer?url=${encodeURIComponent(
    absoluteUrl
  )}&embedded=true`;

  const srcUrl = isBase64 || useFallback
    ? `${fileUrl}#toolbar=1&navpanes=0&view=FitH`
    : googleDocsViewerUrl;

  return (
    <div className="w-full h-full flex flex-col items-center select-none overflow-hidden bg-slate-950 relative">
      {/* Loading Overlay */}
      {loading && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-sm text-slate-300">
          <Loader2 className="w-8 h-8 animate-spin text-sky-400 mb-2" />
          <p className="text-xs sm:text-sm font-medium text-slate-200">PDF 도면을 불러오는 중입니다...</p>
        </div>
      )}

      {/* PDF View Frame (Google Docs / Native PDF) */}
      <iframe
        key={srcUrl}
        src={srcUrl}
        className="w-full h-full border-0 flex-1 bg-slate-900"
        title={fileName}
        onLoad={() => setLoading(false)}
      />

      {/* Subtle bottom control bar */}
      <div className="w-full px-3 py-1.5 bg-slate-900/90 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400 shrink-0">
        <span className="truncate max-w-[60%]">{fileName}</span>
        <div className="flex items-center gap-2">
          {!isBase64 && (
            <button
              onClick={() => {
                setLoading(true);
                setUseFallback(!useFallback);
              }}
              className="hover:text-slate-200 flex items-center gap-1 text-[11px] transition-colors"
              title="뷰어 모드 전환"
            >
              <RefreshCw className="w-3 h-3" />
              <span>{useFallback ? '구글 뷰어로 보기' : '기본 뷰어로 보기'}</span>
            </button>
          )}
          <a
            href={fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-sky-400 flex items-center gap-1 text-[11px] transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            <span>새 창</span>
          </a>
        </div>
      </div>
    </div>
  );
};


