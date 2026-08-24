import React, { useState, useEffect } from 'react';
import { InfoProject } from '../types';
import { X, FolderPlus, Save, Calendar, Hash, Tag, Cpu, FileText, History } from 'lucide-react';
import { format, parseISO } from 'date-fns';

interface ProjectModalProps {
  isOpen: boolean;
  projectToEdit?: InfoProject | null;
  onClose: () => void;
  onSave: (projectData: Omit<InfoProject, 'id' | 'createdAt' | 'updatedAt' | 'status'>) => void;
}

export const ProjectModal: React.FC<ProjectModalProps> = ({
  isOpen,
  projectToEdit,
  onClose,
  onSave,
}) => {
  const [model, setModel] = useState('');
  const [machineType, setMachineType] = useState('');
  const [shipmentDate, setShipmentDate] = useState('');
  const [productionQty, setProductionQty] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (projectToEdit) {
      setModel(projectToEdit.model || '');
      setMachineType(projectToEdit.machineType || '');
      setShipmentDate(projectToEdit.shipmentDate ? projectToEdit.shipmentDate.substring(0, 10) : '');
      setProductionQty(String(projectToEdit.productionQty || ''));
      setNotes(projectToEdit.notes || '');
    } else {
      setModel('');
      setMachineType('');
      setShipmentDate(new Date().toISOString().substring(0, 10));
      setProductionQty('');
      setNotes('');
    }
    setError('');
  }, [projectToEdit, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    window.history.pushState({ modal: 'project' }, '');
    const handlePopState = () => {
      onClose();
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!model.trim()) {
      setError('모델명을 입력해 주세요.');
      return;
    }
    if (!machineType.trim()) {
      setError('기종을 입력해 주세요.');
      return;
    }

    onSave({
      model: model.trim(),
      machineType: machineType.trim(),
      shipmentDate: shipmentDate || new Date().toISOString().substring(0, 10),
      productionQty: productionQty.trim() || '0',
      notes: notes.trim(),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-800/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-sky-500/10 text-sky-400 border border-sky-500/20">
              <FolderPlus className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-semibold text-slate-100 text-base">
                {projectToEdit ? '프로젝트 정보 수정' : '새 프로젝트 등록'}
              </h2>
              <p className="text-xs text-slate-400">모델, 기종, 선적일정, 생산수량을 관리합니다.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
              {error}
            </div>
          )}

          {/* 모델 (Model) */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5 text-sky-400" />
              모델명 (Model_1) <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              required
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="예: EF62"
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 placeholder-slate-500"
            />
          </div>

          {/* 기종 (Machine Type) */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-indigo-400" />
              기종 (Model_2) <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              required
              value={machineType}
              onChange={(e) => setMachineType(e.target.value)}
              placeholder="예: CPH-332"
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 placeholder-slate-500"
            />
          </div>

          {/* Grid: 선적날짜 & 생산수량 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-amber-400" />
                선적 날짜 (Shipping Date)
              </label>
              <input
                type="date"
                value={shipmentDate}
                onChange={(e) => setShipmentDate(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 [color-scheme:dark]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Hash className="w-3.5 h-3.5 text-emerald-400" />
                생산 수량 (Quantity)
              </label>
              <input
                type="text"
                value={productionQty}
                onChange={(e) => setProductionQty(e.target.value)}
                placeholder="예: 5,000 EA / 1,200 SET"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 placeholder-slate-500"
              />
            </div>
          </div>

          {/* Previous shipment date history if available */}
          {projectToEdit?.previousShipmentDates && projectToEdit.previousShipmentDates.length > 0 && (
            <div className="p-3 rounded-xl bg-slate-800/80 border border-slate-700/70">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-400 mb-1.5">
                <History className="w-3.5 h-3.5" />
                <span>이전 선적일 변경 이력:</span>
              </div>
              <div className="flex flex-wrap gap-2 text-xs font-mono">
                {projectToEdit.previousShipmentDates.map((prevDate, idx) => (
                  <span
                    key={idx}
                    className="px-2 py-0.5 rounded bg-slate-900 text-slate-400 line-through border border-slate-700/60"
                  >
                    {prevDate ? format(parseISO(prevDate), 'yyyy-MM-dd') : prevDate}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 비고 / 메모 (Notes) */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-slate-400" />
              비고 / 특이사항 (Optional)
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="참고사항, 유의사항 등"
              className="w-full px-3.5 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 placeholder-slate-500 resize-none"
            />
          </div>

          {/* Footer buttons */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium transition-colors"
            >
              취소
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-sm font-semibold transition-colors flex items-center gap-2 shadow-lg shadow-sky-600/20"
            >
              <Save className="w-4 h-4" />
              {projectToEdit ? '수정 완료' : '프로젝트 생성'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
