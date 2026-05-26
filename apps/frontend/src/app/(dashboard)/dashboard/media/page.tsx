"use client";

import { useState, useRef, useCallback } from "react";
import { useMedia, useOrgId } from "@/lib/hooks";
import { mediaApi, resolveMediaUrl } from "@/lib/api";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { mutate } from "swr";
import clsx from "clsx";
import {
  Upload, Image, Video, Music, Trash2, Play,
  Scissors, Film, Loader2, Copy, Check,
  Search, Filter, ExternalLink, Info,
} from "lucide-react";

const TYPE_ICONS: Record<string, React.ReactNode> = {
  IMAGE:           <Image size={18} />,
  VIDEO:           <Video size={18} />,
  AUDIO:           <Music size={18} />,
  PROCESSED_VIDEO: <Film size={18} />,
};

const TYPE_COLORS: Record<string, string> = {
  IMAGE:           "text-blue-400 bg-blue-500/10",
  VIDEO:           "text-purple-400 bg-purple-500/10",
  AUDIO:           "text-green-400 bg-green-500/10",
  PROCESSED_VIDEO: "text-amber-400 bg-amber-500/10",
};

type FilterType = "ALL" | "IMAGE" | "VIDEO" | "AUDIO" | "PROCESSED_VIDEO";

function mediaStatusLabel(item: any) {
  const status = item.processingStatus;
  const friendlyError = String(item.validationError || "").includes("Supabase Storage configuration")
    ? "Preparing public upload..."
    : item.validationError;
  const map: Record<string, string> = {
    UPLOADING: "Uploading...",
    PROCESSING: "Checking media...",
    OPTIMIZING: "Optimizing video for Reel/Short...",
    GENERATING_THUMBNAIL: "Generating thumbnail...",
    UPLOADING_TO_CLOUD: "Preparing public upload...",
    READY_TO_PUBLISH: "Ready to publish",
    PUBLISHING: "Publishing...",
    PUBLISHED: "Published",
    VALIDATION_FAILED: friendlyError || "Needs attention before publishing",
  };
  return map[status] || friendlyError || null;
}

function mediaStatusStyle(status?: string) {
  if (status === "READY_TO_PUBLISH" || status === "PUBLISHED") return "text-green-300 bg-green-500/10 border-green-500/20";
  if (status === "VALIDATION_FAILED") return "text-amber-300 bg-amber-500/10 border-amber-500/20";
  return "text-blue-300 bg-blue-500/10 border-blue-500/20";
}

export default function MediaPage() {
  const orgId = useOrgId();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedMedia, setSelectedMedia] = useState<any>(null);
  const [showProcessor, setShowProcessor] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewItem, setPreviewItem] = useState<any>(null);
  const [filterType, setFilterType] = useState<FilterType>("ALL");
  const [search, setSearch] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useMedia(page);
  const allItems: any[] = data?.items || [];
  const total: number = data?.total || 0;
  const pages: number = data?.pages || 1;

  // Client-side filter
  const items = allItems.filter((item) => {
    const matchType = filterType === "ALL" || item.type === filterType;
    const matchSearch = !search || item.originalName?.toLowerCase().includes(search.toLowerCase());
    return matchType && matchSearch;
  });

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadProgress(0);
    const total = files.length;
    let done = 0;
    try {
      for (const file of Array.from(files)) {
        await mediaApi.upload(orgId, file);
        done++;
        setUploadProgress(Math.round((done / total) * 100));
      }
      mutate(["media", orgId, page]);
      toast.success(`${total} file${total > 1 ? "s" : ""} uploaded`);
    } catch (err: any) {
      toast.error("Upload failed", err.message);
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    try {
      await mediaApi.delete(orgId, id);
      mutate(["media", orgId, page]);
      toast.success("File deleted");
    } catch (err: any) {
      toast.error("Delete failed", err.message);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleUpload(e.dataTransfer.files);
  }, [orgId]);

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(resolveMediaUrl(url));
    toast.success("URL copied to clipboard");
  };

  const formatSize = (bytes: number) => {
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${bytes} B`;
  };

  const FILTER_TABS: { id: FilterType; label: string }[] = [
    { id: "ALL",            label: "All" },
    { id: "IMAGE",          label: "Images" },
    { id: "VIDEO",          label: "Videos" },
    { id: "AUDIO",          label: "Audio" },
    { id: "PROCESSED_VIDEO", label: "Processed" },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Media Library</h1>
          <p className="text-sm text-text-muted mt-0.5">{total} files</p>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*,audio/*"
            className="hidden"
            onChange={(e) => handleUpload(e.target.files)}
          />
          <Button
            icon={uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? `Uploading ${uploadProgress}%` : "Upload"}
          </Button>
        </div>
      </div>

      {/* Search + Filter */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search files..."
            className="w-full bg-surface-input border border-surface-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-500 transition-colors"
          />
        </div>
        <div className="flex gap-1 bg-surface-card border border-surface-border rounded-xl p-1">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterType(tab.id)}
              className={clsx(
                "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                filterType === tab.id ? "bg-brand-500 text-white" : "text-text-muted hover:text-text-primary",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={clsx(
          "border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all",
          isDragging
            ? "border-brand-500 bg-brand-500/5"
            : "border-surface-border hover:border-brand-500/50 hover:bg-surface-hover/30",
        )}
      >
        <Upload size={24} className={clsx("mx-auto mb-2", isDragging ? "text-brand-400" : "text-text-muted")} />
        <p className="text-sm text-text-secondary">
          {isDragging ? "Drop files here" : "Drop files here or click to upload"}
        </p>
        <p className="text-xs text-text-muted mt-1">Images, videos, audio — up to 500MB each</p>
        {uploading && (
          <div className="mt-3 max-w-xs mx-auto">
            <div className="h-1.5 bg-surface-border rounded-full overflow-hidden">
              <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
            </div>
            <p className="text-xs text-text-muted mt-1">{uploadProgress}% uploaded</p>
          </div>
        )}
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="aspect-square bg-surface-card border border-surface-border rounded-xl skeleton" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Image size={24} />}
          title={search || filterType !== "ALL" ? "No files match your filter" : "No media yet"}
          description={search || filterType !== "ALL" ? "Try a different search or filter" : "Upload images, videos, or audio files to use in your posts."}
          action={!search && filterType === "ALL" ? { label: "Upload files", onClick: () => fileInputRef.current?.click() } : undefined}
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {items.map((item: any) => (
            <MediaCard
              key={item.id}
              item={item}
              onDelete={() => handleDelete(item.id, item.originalName)}
              onProcess={() => { setSelectedMedia(item); setShowProcessor(true); }}
              onPreview={() => { setPreviewItem(item); setShowPreview(true); }}
              onCopyUrl={() => copyUrl(item.url)}
              formatSize={formatSize}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="text-sm text-text-muted">Page {page} of {pages}</span>
          <Button variant="secondary" size="sm" disabled={page === pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}

      {/* Preview modal */}
      {previewItem && (
        <MediaPreviewModal
          open={showPreview}
          item={previewItem}
          onClose={() => { setShowPreview(false); setPreviewItem(null); }}
          onCopyUrl={() => copyUrl(previewItem.url)}
          formatSize={formatSize}
        />
      )}

      {/* Video processor modal */}
      {selectedMedia && (
        <VideoProcessorModal
          open={showProcessor}
          media={selectedMedia}
          orgId={orgId}
          onClose={() => { setShowProcessor(false); setSelectedMedia(null); }}
          onSuccess={() => {
            mutate(["media", orgId, page]);
            setShowProcessor(false);
            setSelectedMedia(null);
          }}
        />
      )}
    </div>
  );
}

// ── Media card ────────────────────────────────────────────────
function MediaCard({ item, onDelete, onProcess, onPreview, onCopyUrl, formatSize }: {
  item: any; onDelete: () => void; onProcess: () => void;
  onPreview: () => void; onCopyUrl: () => void; formatSize: (n: number) => string;
}) {
  const isVideo = item.type === "VIDEO" || item.type === "PROCESSED_VIDEO";
  const typeStyle = TYPE_COLORS[item.type] || "text-text-muted bg-surface-hover";
  const resolvedUrl = resolveMediaUrl(item.url);
  const resolvedThumb = resolveMediaUrl(item.thumbnail);
  const statusLabel = mediaStatusLabel(item);

  return (
    <div className="group relative bg-surface-card border border-surface-border rounded-xl overflow-hidden hover:border-brand-500/30 transition-all hover:shadow-sm">
      {/* Preview area */}
      <div
        className="aspect-square bg-surface-hover flex items-center justify-center overflow-hidden cursor-pointer"
        onClick={onPreview}
      >
        {resolvedThumb ? (
          <img src={resolvedThumb} alt={item.originalName} className="w-full h-full object-cover" />
        ) : item.type === "IMAGE" ? (
          <img src={resolvedUrl} alt={item.originalName} className="w-full h-full object-cover" onError={(e) => { (e.target as any).style.display = "none"; }} />
        ) : (
          <div className={clsx("w-12 h-12 rounded-xl flex items-center justify-center", typeStyle)}>
            {TYPE_ICONS[item.type]}
          </div>
        )}

        {isVideo && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <Play size={18} className="text-white ml-0.5" />
            </div>
          </div>
        )}

        {/* Type badge */}
        <div className={clsx("absolute top-2 left-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full", typeStyle)}>
          {item.type.replace("_", " ")}
        </div>
      </div>

      {/* Info */}
      <div className="p-2.5">
        <p className="text-xs text-text-primary font-medium truncate" title={item.originalName}>
          {item.originalName}
        </p>
        <div className="flex items-center justify-between mt-1">
          <span className="text-xs text-text-muted">{formatSize(item.fileSize)}</span>
          {item.duration && (
            <span className="text-xs text-text-muted">{item.duration.toFixed(1)}s</span>
          )}
        </div>
        {statusLabel && item.processingStatus !== "READY_TO_PUBLISH" && (
          <div className={clsx("mt-2 rounded-lg border px-2 py-1 text-[11px] leading-snug", mediaStatusStyle(item.processingStatus))}>
            {statusLabel}
          </div>
        )}
      </div>

      {/* Actions overlay */}
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={onCopyUrl} className="w-7 h-7 rounded-lg bg-surface-card/90 backdrop-blur-sm flex items-center justify-center text-text-secondary hover:text-brand-400 transition-colors" title="Copy URL">
          <Copy size={12} />
        </button>
        {isVideo && (
          <button onClick={onProcess} className="w-7 h-7 rounded-lg bg-surface-card/90 backdrop-blur-sm flex items-center justify-center text-text-secondary hover:text-brand-400 transition-colors" title="Process video">
            <Scissors size={12} />
          </button>
        )}
        <button onClick={onDelete} className="w-7 h-7 rounded-lg bg-surface-card/90 backdrop-blur-sm flex items-center justify-center text-text-secondary hover:text-error transition-colors" title="Delete">
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

// ── Media Preview Modal ───────────────────────────────────────
function MediaPreviewModal({ open, item, onClose, onCopyUrl, formatSize }: any) {
  const isVideo = item.type === "VIDEO" || item.type === "PROCESSED_VIDEO";
  const isAudio = item.type === "AUDIO";
  const isImage = item.type === "IMAGE";
  const resolvedUrl = resolveMediaUrl(item.url);

  return (
    <Modal open={open} onClose={onClose} title={item.originalName} size="lg">
      <div className="space-y-4">
        {/* Preview */}
        <div className="bg-surface-hover rounded-xl overflow-hidden flex items-center justify-center" style={{ minHeight: 300 }}>
          {isImage && <img src={resolvedUrl} alt={item.originalName} className="max-w-full max-h-96 object-contain" />}
          {isVideo && <video src={resolvedUrl} controls className="max-w-full max-h-96" />}
          {isAudio && <audio src={resolvedUrl} controls className="w-full" />}
          {!isImage && !isVideo && !isAudio && (
            <div className="flex flex-col items-center gap-3 py-12">
              <div className={clsx("w-16 h-16 rounded-2xl flex items-center justify-center", TYPE_COLORS[item.type])}>
                {TYPE_ICONS[item.type]}
              </div>
              <p className="text-sm text-text-muted">Preview not available</p>
            </div>
          )}
        </div>

        {/* Metadata */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "Type", value: item.type.replace("_", " ") },
            { label: "Size", value: formatSize(item.fileSize) },
            { label: "Dimensions", value: item.width && item.height ? `${item.width}×${item.height}` : "—" },
            { label: "Duration", value: item.duration ? `${item.duration.toFixed(1)}s` : "—" },
          ].map((m) => (
            <div key={m.label} className="bg-surface-hover rounded-xl p-3">
              <p className="text-xs text-text-muted">{m.label}</p>
              <p className="text-sm font-medium text-text-primary mt-0.5">{m.value}</p>
            </div>
          ))}
        </div>

        {/* URL */}
        <div className="flex items-center gap-2">
          <code className="flex-1 bg-surface-hover border border-surface-border rounded-xl px-3 py-2 text-xs text-text-secondary font-mono truncate">
            {resolvedUrl}
          </code>
          <button onClick={onCopyUrl} className="w-9 h-9 rounded-xl bg-surface-hover border border-surface-border flex items-center justify-center text-text-muted hover:text-brand-400 transition-colors">
            <Copy size={14} />
          </button>
          <a href={resolvedUrl} target="_blank" rel="noopener noreferrer" className="w-9 h-9 rounded-xl bg-surface-hover border border-surface-border flex items-center justify-center text-text-muted hover:text-brand-400 transition-colors">
            <ExternalLink size={14} />
          </a>
        </div>
      </div>
    </Modal>
  );
}

// ── Video Processor Modal ─────────────────────────────────────
function VideoProcessorModal({ open, media, orgId, onClose, onSuccess }: any) {
  const [processing, setProcessing] = useState(false);
  const [options, setOptions] = useState({ trimStart: '', trimEnd: '', volume: '1.0' });

  const handleProcess = async () => {
    setProcessing(true);
    try {
      const { mediaApi } = await import('@/lib/api');
      await mediaApi.processVideo(orgId, media.id, {
        trimStart: options.trimStart ? parseFloat(options.trimStart) : undefined,
        trimEnd: options.trimEnd ? parseFloat(options.trimEnd) : undefined,
        volume: parseFloat(options.volume),
      });
      onSuccess();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Process Video" size="md">
      <div className="space-y-5">
        <div className="bg-surface-hover rounded-xl p-3">
          <p className="text-sm font-medium text-text-primary">{media.originalName}</p>
          {media.duration && <p className="text-xs text-text-muted mt-0.5">Duration: {media.duration.toFixed(1)}s</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Input label="Trim start (seconds)" type="number" min="0" step="0.1" placeholder="0"
            value={options.trimStart} onChange={(e) => setOptions({ ...options, trimStart: e.target.value })} icon={<Scissors size={14} />} />
          <Input label="Trim end (seconds)" type="number" min="0" step="0.1" placeholder={media.duration?.toFixed(1) || ""}
            value={options.trimEnd} onChange={(e) => setOptions({ ...options, trimEnd: e.target.value })} icon={<Scissors size={14} />} />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">Volume: {parseFloat(options.volume).toFixed(1)}x</label>
          <input type="range" min="0" max="2" step="0.1" value={options.volume}
            onChange={(e) => setOptions({ ...options, volume: e.target.value })} className="w-full accent-brand-500" />
          <div className="flex justify-between text-xs text-text-muted mt-1"><span>Mute</span><span>Original</span><span>2x</span></div>
        </div>

        <div className="bg-brand-500/5 border border-brand-500/20 rounded-xl p-3 text-xs text-text-muted">
          ⚠️ FFmpeg must be installed for video processing. Download from{" "}
          <a href="https://ffmpeg.org/download.html" target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:underline">ffmpeg.org</a>
        </div>

        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
          <Button loading={processing} onClick={handleProcess} icon={<Film size={15} />} className="flex-1">Process Video</Button>
        </div>
      </div>
    </Modal>
  );
}
