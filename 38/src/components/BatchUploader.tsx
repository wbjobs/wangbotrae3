import { useState, useCallback, useRef } from 'react';
import { Upload, FileAudio, X, CheckCircle, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatFileSize } from '../utils/format';
import type { Device } from '../../shared/types';

interface UploadFile {
  id: string;
  file: File;
  name: string;
  size: number;
  status: 'pending' | 'uploading' | 'success' | 'error';
  progress: number;
  error?: string;
}

interface BatchUploaderProps {
  device: Device | null;
  onUpload: (file: File, deviceId: string) => Promise<void>;
  acceptedTypes?: string[];
  maxSize?: number;
}

const DEFAULT_ACCEPTED = ['.wav', '.mp3', '.csv', '.mat', '.bin'];
const DEFAULT_MAX_SIZE = 100 * 1024 * 1024;

export function BatchUploader({
  device,
  onUpload,
  acceptedTypes = DEFAULT_ACCEPTED,
  maxSize = DEFAULT_MAX_SIZE,
}: BatchUploaderProps) {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateFile = useCallback((file: File): { valid: boolean; error?: string } => {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!acceptedTypes.includes(ext)) {
      return { valid: false, error: '不支持的文件格式' };
    }
    if (file.size > maxSize) {
      return { valid: false, error: `文件大小超过 ${formatFileSize(maxSize)} 限制` };
    }
    return { valid: true };
  }, [acceptedTypes, maxSize]);

  const handleFiles = useCallback((fileList: FileList) => {
    const newFiles: UploadFile[] = [];

    Array.from(fileList).forEach((file) => {
      const validation = validateFile(file);
      newFiles.push({
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        file,
        name: file.name,
        size: file.size,
        status: validation.valid ? 'pending' : 'error',
        progress: 0,
        error: validation.error,
      });
    });

    setFiles(prev => [...prev, ...newFiles]);
  }, [validateFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const removeFile = useCallback((id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  }, []);

  const uploadFile = useCallback(async (uploadFile: UploadFile) => {
    if (!device || uploadFile.status === 'error') return;

    setFiles(prev => prev.map(f =>
      f.id === uploadFile.id ? { ...f, status: 'uploading', progress: 0 } : f
    ));

    try {
      await onUpload(uploadFile.file, device.id);
      setFiles(prev => prev.map(f =>
        f.id === uploadFile.id ? { ...f, status: 'success', progress: 100 } : f
      ));
    } catch (error) {
      setFiles(prev => prev.map(f =>
        f.id === uploadFile.id
          ? { ...f, status: 'error', error: error instanceof Error ? error.message : '上传失败' }
          : f
      ));
    }
  }, [device, onUpload]);

  const uploadAll = useCallback(async () => {
    const pendingFiles = files.filter(f => f.status === 'pending');
    for (const file of pendingFiles) {
      await uploadFile(file);
    }
  }, [files, uploadFile]);

  const clearAll = useCallback(() => {
    setFiles([]);
  }, []);

  const pendingCount = files.filter(f => f.status === 'pending').length;
  const successCount = files.filter(f => f.status === 'success').length;
  const errorCount = files.filter(f => f.status === 'error').length;

  return (
    <div className="space-y-4">
      <div
        className={cn(
          'border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer',
          isDragging
            ? 'border-[#165DFF] bg-[#165DFF]/10'
            : 'border-slate-600 hover:border-slate-500 bg-slate-800/30'
        )}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={acceptedTypes.join(',')}
          className="hidden"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
        <Upload className={cn(
          'w-12 h-12 mx-auto mb-4 transition-colors',
          isDragging ? 'text-[#165DFF]' : 'text-slate-500'
        )} />
        <div className="text-white font-medium mb-1">
          {isDragging ? '松开鼠标上传文件' : '拖拽文件到此处'}
        </div>
        <div className="text-slate-400 text-sm mb-3">
          或点击选择文件 · 支持 {acceptedTypes.join('、')} 格式
        </div>
        <div className="text-slate-500 text-xs">
          单文件最大 {formatFileSize(maxSize)}
        </div>
        {!device && (
          <div className="mt-4 text-[#F53F3F] text-sm flex items-center justify-center gap-1">
            <AlertCircle className="w-4 h-4" />
            请先选择目标设备
          </div>
        )}
      </div>

      {files.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 text-sm">
              <span className="text-slate-400">
                共 {files.length} 个文件
              </span>
              {pendingCount > 0 && (
                <span className="text-slate-400">
                  待上传: {pendingCount}
                </span>
              )}
              {successCount > 0 && (
                <span className="text-[#00B42A]">
                  成功: {successCount}
                </span>
              )}
              {errorCount > 0 && (
                <span className="text-[#F53F3F]">
                  失败: {errorCount}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={clearAll}
                className="px-3 py-1.5 text-sm text-slate-400 hover:text-white transition-colors"
              >
                清空
              </button>
              <button
                onClick={uploadAll}
                disabled={pendingCount === 0 || !device}
                className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                开始诊断
              </button>
            </div>
          </div>

          <div className="space-y-2 max-h-80 overflow-y-auto">
            {files.map((file) => (
              <div
                key={file.id}
                className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/50 border border-slate-700/50"
              >
                <div className="w-10 h-10 rounded-lg bg-slate-700/50 flex items-center justify-center flex-shrink-0">
                  <FileAudio className="w-5 h-5 text-[#165DFF]" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">{file.name}</div>
                  <div className="text-xs text-slate-500">{formatFileSize(file.size)}</div>
                  {file.status === 'uploading' && (
                    <div className="mt-1.5 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#165DFF] rounded-full transition-all duration-300"
                        style={{ width: `${file.progress}%` }}
                      />
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {file.status === 'pending' && (
                    <button
                      onClick={() => uploadFile(file)}
                      disabled={!device}
                      className="text-xs text-[#165DFF] hover:text-[#165DFF]/80 disabled:opacity-50"
                    >
                      上传
                    </button>
                  )}
                  {file.status === 'uploading' && (
                    <span className="text-xs text-[#165DFF]">{file.progress}%</span>
                  )}
                  {file.status === 'success' && (
                    <CheckCircle className="w-5 h-5 text-[#00B42A]" />
                  )}
                  {file.status === 'error' && (
                    <div className="flex items-center gap-1 text-[#F53F3F]">
                      <AlertCircle className="w-4 h-4" />
                      <span className="text-xs">{file.error}</span>
                    </div>
                  )}
                  {file.status !== 'uploading' && (
                    <button
                      onClick={() => removeFile(file.id)}
                      className="p-1 rounded hover:bg-slate-700/50 transition-colors"
                    >
                      <X className="w-4 h-4 text-slate-400" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default BatchUploader;
