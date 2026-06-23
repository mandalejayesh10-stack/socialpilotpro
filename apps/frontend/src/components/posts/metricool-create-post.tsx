'use client';

import { useState, useRef, useEffect } from 'react';
import { postApi, mediaApi, aiApi, analyticsApi, resolveMediaUrl } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import clsx from 'clsx';
import dayjs from 'dayjs';
import {
  Instagram, Facebook, Youtube, X, Plus, Image, Video,
  Sparkles, Hash, Smile, MapPin, Link, MessageSquare,
  Upload, Loader2, Monitor, Smartphone, ChevronDown,
  Clock, Lightbulb, Settings, Linkedin, Store,
} from 'lucide-react';

const ThreadsIcon = ({ size = 14 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.25"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 2c-5.523 0-10 4.477-10 10s4.477 10 10 10c2.57 0 4.914-.972 6.697-2.563l-1.428-1.428c-1.393 1.222-3.21 1.991-5.269 1.991-4.418 0-8-3.582-8-8s3.582-8 8-8 8 3.582 8 8v1.5c0 .828-.672 1.5-1.5 1.5s-1.5-.672-1.5-1.5v-5.5h-2v1.571c-.754-.973-1.921-1.571-3.25-1.571-2.347 0-4.25 1.903-4.25 4.25s1.903 4.25 4.25 4.25c1.329 0 2.496-.598 3.25-1.571v.821c0 1.933 1.567 3.5 3.5 3.5s3.5-1.567 3.5-3.5v-3c0-5.523-4.477-10-10-10zm0 11.75c-1.243 0-2.25-1.007-2.25-2.25s1.007-2.25 2.25-2.25 2.25 1.007 2.25 2.25-1.007 2.25-2.25 2.25z" />
  </svg>
);

const PLATFORM_ICONS: Record<string, React.ReactNode> = {
  INSTAGRAM: <Instagram size={14} />,
  FACEBOOK:  <Facebook size={14} />,
  YOUTUBE:   <Youtube size={14} />,
  LINKEDIN:  <Linkedin size={14} />,
  THREADS:   <ThreadsIcon size={14} />,
  GOOGLE_BUSINESS: <Store size={14} />,
};

const PLATFORM_COLORS: Record<string, string> = {
  INSTAGRAM: 'bg-gradient-to-br from-purple-500 to-pink-500',
  FACEBOOK:  'bg-blue-600',
  YOUTUBE:   'bg-red-600',
  LINKEDIN:  'bg-sky-600',
  THREADS:   'bg-slate-700',
  GOOGLE_BUSINESS: 'bg-emerald-600',
};

const CHAR_LIMITS: Record<string, number> = {
  INSTAGRAM: 2200,
  FACEBOOK:  63206,
  YOUTUBE:   5000,
  LINKEDIN:  3000,
  THREADS:   500,
  GOOGLE_BUSINESS: 1500,
};

function MediaThumb({ media, className, aspect = 'video' }: { media: any; className: string; aspect?: 'video' | 'square' }) {
  const [failed, setFailed] = useState(false);
  const isVideo = media?.type === 'VIDEO' || media?.type === 'PROCESSED_VIDEO' || media?.mimeType?.startsWith?.('video/');
  const src = resolveMediaUrl(media?.thumbnail || (!isVideo ? media?.url : ''));

  if (!src || failed) {
    return (
      <div className={clsx(className, 'bg-gray-100 dark:bg-surface-hover flex items-center justify-center')}>
        {isVideo ? <Video size={aspect === 'square' ? 24 : 28} className="text-gray-400" /> : <Image size={24} className="text-gray-400" />}
      </div>
    );
  }

  return <img src={src} alt="" className={className} onError={() => setFailed(true)} />;
}

interface Props {
  open: boolean;
  onClose: () => void;
  integrations: any[];
  defaultDate?: string;
  orgId: string;
  onSuccess: () => void;
}

export function MetricoolCreatePost({ open, onClose, integrations, defaultDate, orgId, onSuccess }: Props) {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [selectedIntegrations, setSelectedIntegrations] = useState<string[]>([]);
  const [content, setContent] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [publishDate, setPublishDate] = useState(defaultDate || dayjs().add(1, 'hour').format('YYYY-MM-DDTHH:mm'));
  const [mediaFiles, setMediaFiles] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [previewPlatform, setPreviewPlatform] = useState<string>('FACEBOOK');
  const [previewDevice, setPreviewDevice] = useState<'mobile' | 'desktop'>('mobile');
  const [showNotes, setShowNotes] = useState(false);
  const [notes, setNotes] = useState('');
  const [bestTimes, setBestTimes] = useState<any>(null);
  const [showHashtagSuggestions, setShowHashtagSuggestions] = useState(false);
  const [hashtagSuggestions, setHashtagSuggestions] = useState<string[]>([]);

  useEffect(() => {
    if (defaultDate) setPublishDate(defaultDate);
  }, [defaultDate]);

  // Load best times for selected platform
  useEffect(() => {
    if (!orgId || selectedIntegrations.length === 0) return;
    const firstIntegration = integrations.find((i) => i.id === selectedIntegrations[0]);
    if (!firstIntegration) return;
    analyticsApi.bestTimes(orgId, firstIntegration.platform, 'Asia/Kolkata')
      .then(setBestTimes)
      .catch(() => {});
  }, [selectedIntegrations, orgId]);

  if (!open) return null;

  const toggleIntegration = (id: string) => {
    setSelectedIntegrations((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    );
  };

  const charLimit = selectedIntegrations.length > 0
    ? Math.min(...selectedIntegrations.map((id) => {
        const ig = integrations.find((i) => i.id === id);
        return CHAR_LIMITS[ig?.platform] || 2200;
      }))
    : 63206;

  const charCount = content.length;
  const isOverLimit = charCount > charLimit;

  const handleFileUpload = async (files: FileList | null | File[]) => {
    if (!files?.length) return;
    setUploading(true);
    setUploadProgress(0);
    setUploadErrors([]);
    const total = files.length;
    let done = 0;
    const newMedia: any[] = [];
    const errors: string[] = [];

    for (const file of Array.from(files)) {
      try {
        const uploaded = await mediaApi.upload(orgId, file);
        newMedia.push(uploaded);

        // Run platform validation after upload if platforms are selected
        if (selectedIntegrations.length > 0 && uploaded.id) {
          const firstIntegration = integrations.find((i) => i.id === selectedIntegrations[0]);
          const platform = firstIntegration?.platform;
          if (platform && (platform === 'INSTAGRAM' || platform === 'FACEBOOK' || platform === 'YOUTUBE' || platform === 'LINKEDIN' || platform === 'THREADS' || platform === 'GOOGLE_BUSINESS')) {
            try {
              const validation = await mediaApi.validate(orgId, uploaded.id, platform);
              if (validation.errors?.length > 0) {
                validation.errors.forEach((e: string) => {
                  errors.push(`${file.name}: ${e}`);
                  toast.error(`Media issue for ${platform}`, e);
                });
              } else if (validation.publishReady === false) {
                const reason = validation.publishBlockedReason || validation.publicUrlValidation?.reason || 'Media is not publish-ready';
                errors.push(`${file.name}: ${reason}`);
                toast.error(`${platform} media is not publish-ready`, reason);
              } else if (validation.warnings?.length > 0) {
                validation.warnings.forEach((w: string) => toast.warning?.(`${platform} warning`, w));
              } else {
                toast.success(`Uploaded ${file.name}`);
              }
            } catch {
              // Validation endpoint unavailable — still accept the upload
              toast.success(`Uploaded ${file.name}`);
            }
          } else {
            toast.success(`Uploaded ${file.name}`);
          }
        } else {
          toast.success(`Uploaded ${file.name}`);
        }
      } catch (e: any) {
        errors.push(`${file.name}: ${e.message}`);
        toast.error(`Failed to upload ${file.name}`, e.message);
      } finally {
        done++;
        setUploadProgress(Math.round((done / total) * 100));
      }
    }

    setMediaFiles((prev) => [...prev, ...newMedia]);
    setUploadErrors(errors);
    setUploading(false);
    setTimeout(() => setUploadProgress(0), 1000);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileUpload(e.dataTransfer.files);
  };

  const generateCaption = async () => {
    if (!orgId) return;
    const platform = selectedIntegrations[0]
      ? integrations.find((i) => i.id === selectedIntegrations[0])?.platform?.toLowerCase()
      : 'instagram';
    setAiLoading(true);
    try {
      const res = await aiApi.generateCaption(orgId, { platform, topic: content || 'social media post', tone: 'professional' });
      setContent(res.caption);
      if (res.hashtags?.length) setHashtags(res.hashtags.map((h: string) => '#' + h).join(' '));
      toast.success('Caption generated!');
    } catch {
      toast.error('AI unavailable', 'Make sure Ollama is running');
    } finally {
      setAiLoading(false);
    }
  };

  const suggestHashtags = async () => {
    if (!content.trim() || !orgId) return;
    const platform = selectedIntegrations[0]
      ? integrations.find((i) => i.id === selectedIntegrations[0])?.platform?.toLowerCase()
      : 'instagram';
    setAiLoading(true);
    try {
      const res = await aiApi.suggestHashtags(orgId, { platform, content, count: 15 });
      setHashtagSuggestions(res.hashtags || []);
      setShowHashtagSuggestions(true);
    } catch {
      toast.error('AI unavailable');
    } finally {
      setAiLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!selectedIntegrations.length) { toast.error('Select at least one account'); return; }
    if (!content.trim()) { toast.error('Write some content first'); return; }
    if (!publishDate) { toast.error('Set a publish date'); return; }
    if (isOverLimit) { toast.error('Content too long'); return; }
    if (uploadErrors.length > 0) {
      toast.error('Media is not publish-ready', uploadErrors[0]);
      return;
    }

    setSubmitting(true);
    try {
      await postApi.create(orgId, {
        integrationIds: selectedIntegrations,
        content,
        hashtags,
        publishDate: new Date(publishDate).toISOString(),
        mediaUrls: mediaFiles.map((m) => m.url),
      });
      onSuccess();
    } catch (e: any) {
      toast.error('Failed to schedule', e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const insertEmoji = (emoji: string) => {
    setContent((prev) => prev + emoji);
    textareaRef.current?.focus();
  };

  const QUICK_EMOJIS = ['😊', '🔥', '💯', '✨', '🎉', '👍', '❤️', '🚀', '💪', '🌟'];

  // Preview content
  const previewContent = content + (hashtags ? '\n\n' + hashtags : '');
  const previewIntegration = integrations.find((i) => i.platform === previewPlatform);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-[#1a1a2e] w-full max-w-5xl h-[90vh] rounded-2xl overflow-hidden flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-surface-border flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-900 dark:text-text-primary">Create new post</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-text-primary transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* ── LEFT: Composer ─────────────────────────────── */}
          <div className="flex-1 flex flex-col border-r border-gray-200 dark:border-surface-border overflow-hidden">

            {/* Account selector */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 dark:border-surface-border flex-shrink-0">
              {integrations.map((ig) => (
                <button
                  key={ig.id}
                  onClick={() => { toggleIntegration(ig.id); setPreviewPlatform(ig.platform); }}
                  className={clsx(
                    'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all',
                    selectedIntegrations.includes(ig.id)
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400'
                      : 'border-gray-200 dark:border-surface-border text-gray-500 dark:text-text-muted hover:border-gray-300',
                  )}
                >
                  <span className={clsx('w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px]', PLATFORM_COLORS[ig.platform])}>
                    {PLATFORM_ICONS[ig.platform]}
                  </span>
                  {ig.name}
                  <ChevronDown size={11} />
                </button>
              ))}
              <button className="w-7 h-7 rounded-full border border-dashed border-gray-300 dark:border-surface-border flex items-center justify-center text-gray-400 hover:border-gray-400 transition-colors">
                <Plus size={14} />
              </button>
              <div className="ml-auto">
                <button
                  onClick={() => setShowNotes(!showNotes)}
                  className="flex items-center gap-1 text-xs text-gray-500 dark:text-text-muted hover:text-gray-700 dark:hover:text-text-primary transition-colors"
                >
                  <MessageSquare size={13} />
                  Notes
                </button>
              </div>
            </div>

            {/* Notes panel */}
            {showNotes && (
              <div className="px-4 py-2 border-b border-gray-100 dark:border-surface-border flex-shrink-0">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add internal notes (not published)..."
                  rows={2}
                  className="w-full text-xs text-gray-600 dark:text-text-secondary bg-gray-50 dark:bg-surface-hover border border-gray-200 dark:border-surface-border rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-blue-400"
                />
              </div>
            )}

            {/* Caption editor */}
            <div className="flex-1 overflow-auto px-4 py-3">
              <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Write your caption..."
                className={clsx(
                  'w-full h-full min-h-[200px] text-sm text-gray-800 dark:text-text-primary bg-transparent resize-none focus:outline-none placeholder:text-gray-400 dark:placeholder:text-text-muted',
                  isOverLimit && 'text-red-500',
                )}
              />

              {/* Hashtag suggestions */}
              {showHashtagSuggestions && hashtagSuggestions.length > 0 && (
                <div className="mt-2 p-3 bg-gray-50 dark:bg-surface-hover rounded-xl">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium text-gray-600 dark:text-text-secondary">Suggested hashtags</p>
                    <button onClick={() => setShowHashtagSuggestions(false)} className="text-gray-400 hover:text-gray-600">
                      <X size={12} />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {hashtagSuggestions.map((tag) => (
                      <button
                        key={tag}
                        onClick={() => setHashtags((prev) => prev + (prev ? ' ' : '') + '#' + tag)}
                        className="text-xs bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 px-2 py-1 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-500/20 transition-colors"
                      >
                        #{tag}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Hashtags input */}
              {hashtags && (
                <div className="mt-2">
                  <textarea
                    value={hashtags}
                    onChange={(e) => setHashtags(e.target.value)}
                    placeholder="#hashtags"
                    rows={2}
                    className="w-full text-sm text-blue-500 dark:text-brand-400 bg-transparent resize-none focus:outline-none placeholder:text-gray-300"
                  />
                </div>
              )}
            </div>

            {/* Toolbar */}
            <div className="flex items-center gap-1 px-4 py-2 border-t border-gray-100 dark:border-surface-border flex-shrink-0">
              <input ref={fileInputRef} type="file" multiple accept="image/*,video/*" className="hidden" onChange={(e) => handleFileUpload(e.target.files)} />
              <button onClick={() => fileInputRef.current?.click()} className="w-8 h-8 rounded-lg hover:bg-gray-100 dark:hover:bg-surface-hover flex items-center justify-center text-gray-500 dark:text-text-muted transition-colors" title="Upload media">
                {uploading ? <Loader2 size={16} className="animate-spin" /> : <Image size={16} />}
              </button>
              {QUICK_EMOJIS.map((emoji) => (
                <button key={emoji} onClick={() => insertEmoji(emoji)} className="w-7 h-7 rounded-lg hover:bg-gray-100 dark:hover:bg-surface-hover flex items-center justify-center text-sm transition-colors">
                  {emoji}
                </button>
              ))}
              <button onClick={suggestHashtags} disabled={aiLoading} className="w-8 h-8 rounded-lg hover:bg-gray-100 dark:hover:bg-surface-hover flex items-center justify-center text-gray-500 dark:text-text-muted transition-colors" title="Suggest hashtags">
                <Hash size={16} />
              </button>
              <button onClick={generateCaption} disabled={aiLoading} className="w-8 h-8 rounded-lg hover:bg-gray-100 dark:hover:bg-surface-hover flex items-center justify-center text-gray-500 dark:text-text-muted transition-colors" title="AI caption">
                {aiLoading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              </button>
              <span className={clsx('ml-auto text-xs', isOverLimit ? 'text-red-500' : 'text-gray-400 dark:text-text-muted')}>
                {charCount} / {charLimit.toLocaleString()}
              </span>
            </div>

            {/* Media preview */}
            {mediaFiles.length > 0 && (
              <div className="flex gap-2 px-4 py-2 border-t border-gray-100 dark:border-surface-border flex-shrink-0 overflow-x-auto">
                {mediaFiles.map((m) => (
                  <div key={m.id} className="relative flex-shrink-0">
                    <MediaThumb media={m} className="w-16 h-16 rounded-lg object-cover" aspect="square" />
                    <button onClick={() => setMediaFiles((prev) => prev.filter((x) => x.id !== m.id))} className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center">
                      <X size={9} className="text-white" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Upload progress bar */}
            {uploading && (
              <div className="px-4 py-2 border-t border-gray-100 dark:border-surface-border flex-shrink-0">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-gray-100 dark:bg-surface-border rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-gray-400 dark:text-text-muted flex-shrink-0">{uploadProgress}%</span>
                </div>
              </div>
            )}

            {/* Validation errors */}
            {uploadErrors.length > 0 && (
              <div className="px-4 py-2 border-t border-red-200 dark:border-red-500/20 flex-shrink-0 space-y-1">
                {uploadErrors.map((err, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-xs text-red-500 dark:text-red-400">
                    <span className="flex-shrink-0 mt-0.5">⚠</span>
                    <span className="leading-relaxed">{err}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Global presets */}
            <div className="px-4 py-2 border-t border-gray-100 dark:border-surface-border flex-shrink-0">
              <button className="flex items-center gap-2 w-full text-xs text-gray-500 dark:text-text-muted hover:text-gray-700 dark:hover:text-text-primary transition-colors">
                <Settings size={13} />
                Global presets
                <span className="text-[10px] bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded-full">New</span>
                <ChevronDown size={12} className="ml-auto" />
              </button>
            </div>

            {/* Footer: date + schedule */}
            <div className="flex items-center gap-3 px-4 py-3 border-t border-gray-200 dark:border-surface-border flex-shrink-0">
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-text-secondary hover:text-gray-800 dark:hover:text-text-primary transition-colors">
                Cancel
              </button>
              <div className="flex items-center gap-1 border border-gray-200 dark:border-surface-border rounded-lg px-3 py-2 flex-1">
                <Clock size={13} className="text-gray-400 dark:text-text-muted flex-shrink-0" />
                <input
                  type="datetime-local"
                  value={publishDate}
                  onChange={(e) => setPublishDate(e.target.value)}
                  className="text-xs text-gray-700 dark:text-text-primary bg-transparent focus:outline-none flex-1"
                />
              </div>
              <button
                onClick={handleSubmit}
                disabled={submitting || !selectedIntegrations.length || !content.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-gray-900 dark:bg-surface-hover text-white dark:text-text-primary text-sm font-medium rounded-lg hover:bg-gray-800 dark:hover:bg-surface-border disabled:opacity-50 transition-colors"
              >
                {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
                Schedule
              </button>
            </div>

            {/* Best time suggestions */}
            {bestTimes?.topSlots?.length > 0 && (
              <div className="px-4 py-2 border-t border-gray-100 dark:border-surface-border bg-blue-50 dark:bg-blue-500/5 flex-shrink-0">
                <div className="flex items-center gap-2 mb-1">
                  <Lightbulb size={12} className="text-blue-500" />
                  <p className="text-xs font-medium text-blue-600 dark:text-blue-400">Best times to post</p>
                </div>
                <div className="flex gap-2 overflow-x-auto">
                  {bestTimes.topSlots.slice(0, 4).map((slot: any, i: number) => (
                    <button
                      key={i}
                      onClick={() => {
                        const d = dayjs(publishDate).day(slot.day).hour(slot.hour).minute(0);
                        setPublishDate(d.format('YYYY-MM-DDTHH:mm'));
                      }}
                      className="flex-shrink-0 text-[10px] bg-white dark:bg-surface-card border border-blue-200 dark:border-blue-500/30 text-blue-600 dark:text-blue-400 px-2 py-1 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors"
                    >
                      {slot.dayLabel.slice(0, 3)} {slot.label} ({slot.score}%)
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── RIGHT: Live Preview ─────────────────────────── */}
          <div className="w-80 flex flex-col bg-gray-50 dark:bg-surface overflow-hidden flex-shrink-0">
            {/* Preview header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-surface-border flex-shrink-0">
              {/* Platform tabs */}
              <div className="flex gap-1">
                {integrations.filter((i) => selectedIntegrations.includes(i.id)).map((ig) => (
                  <button
                    key={ig.id}
                    onClick={() => setPreviewPlatform(ig.platform)}
                    className={clsx(
                      'w-7 h-7 rounded-full flex items-center justify-center text-white text-xs transition-all',
                      PLATFORM_COLORS[ig.platform],
                      previewPlatform === ig.platform ? 'ring-2 ring-offset-1 ring-blue-400' : 'opacity-60',
                    )}
                  >
                    {PLATFORM_ICONS[ig.platform]}
                  </button>
                ))}
                {selectedIntegrations.length === 0 && (
                  <span className="text-xs text-gray-400 dark:text-text-muted">Select accounts to preview</span>
                )}
              </div>
              {/* Device toggle */}
              <div className="flex gap-1">
                <button onClick={() => setPreviewDevice('mobile')} className={clsx('w-7 h-7 rounded-lg flex items-center justify-center transition-colors', previewDevice === 'mobile' ? 'bg-gray-900 dark:bg-surface-card text-white dark:text-text-primary' : 'text-gray-400 hover:text-gray-600')}>
                  <Smartphone size={14} />
                </button>
                <button onClick={() => setPreviewDevice('desktop')} className={clsx('w-7 h-7 rounded-lg flex items-center justify-center transition-colors', previewDevice === 'desktop' ? 'bg-gray-900 dark:bg-surface-card text-white dark:text-text-primary' : 'text-gray-400 hover:text-gray-600')}>
                  <Monitor size={14} />
                </button>
              </div>
            </div>

            {/* Preview content */}
            <div className="flex-1 overflow-auto p-4 flex items-start justify-center">
              {previewPlatform === 'FACEBOOK' && (
                <div className={clsx('bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden', previewDevice === 'mobile' ? 'w-64' : 'w-full')}>
                  {/* FB post header */}
                  <div className="flex items-start gap-2 p-3">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                      {previewIntegration?.name?.charAt(0)?.toUpperCase() || 'P'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{previewIntegration?.name || 'Your Page'}</p>
                      <p className="text-xs text-gray-500">{dayjs(publishDate).format('D MMM')} · 🌐</p>
                    </div>
                    <button className="text-gray-400">···</button>
                  </div>
                  {/* Content */}
                  {previewContent && (
                    <div className="px-3 pb-2">
                      <p className="text-sm text-gray-800 whitespace-pre-wrap line-clamp-6">{previewContent}</p>
                    </div>
                  )}
                  {/* Media */}
                  {mediaFiles[0] && (
                    <MediaThumb media={mediaFiles[0]} className="w-full aspect-video object-cover" />
                  )}
                  {/* Actions */}
                  <div className="flex border-t border-gray-100 mt-1">
                    {['👍 Like', '💬 Comment', '↗ Share'].map((action) => (
                      <button key={action} className="flex-1 py-2 text-xs text-gray-500 hover:bg-gray-50 transition-colors text-center">
                        {action}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {previewPlatform === 'INSTAGRAM' && (
                <div className={clsx('bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden', previewDevice === 'mobile' ? 'w-64' : 'w-full')}>
                  <div className="flex items-center gap-2 p-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-xs font-bold">
                      {previewIntegration?.name?.charAt(0)?.toUpperCase() || 'P'}
                    </div>
                    <p className="text-sm font-semibold text-gray-900">{previewIntegration?.name || 'your_account'}</p>
                    <button className="ml-auto text-gray-400">···</button>
                  </div>
                  {mediaFiles[0] ? (
                    <MediaThumb media={mediaFiles[0]} className="w-full aspect-square object-cover" aspect="square" />
                  ) : (
                    <div className="w-full aspect-square bg-gray-100 flex items-center justify-center">
                      <Image size={32} className="text-gray-300" />
                    </div>
                  )}
                  <div className="p-3">
                    <div className="flex gap-3 mb-2 text-gray-600">
                      <span>♡</span><span>💬</span><span>↗</span>
                    </div>
                    {previewContent && (
                      <p className="text-xs text-gray-800 line-clamp-3">
                        <span className="font-semibold">{previewIntegration?.name || 'account'}</span>{' '}
                        {previewContent}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {previewPlatform === 'YOUTUBE' && (
                <div className={clsx('bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden', previewDevice === 'mobile' ? 'w-64' : 'w-full')}>
                  {mediaFiles[0] ? (
                    <MediaThumb media={mediaFiles[0]} className="w-full aspect-video object-cover" />
                  ) : (
                    <div className="w-full aspect-video bg-gray-900 flex items-center justify-center">
                      <Youtube size={32} className="text-red-500" />
                    </div>
                  )}
                  <div className="p-3">
                    <p className="text-sm font-semibold text-gray-900 line-clamp-2">{content || 'Video title'}</p>
                    <p className="text-xs text-gray-500 mt-1">{previewIntegration?.name || 'Your Channel'}</p>
                  </div>
                </div>
              )}

              {previewPlatform === 'LINKEDIN' && (
                <div className={clsx('bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden text-left', previewDevice === 'mobile' ? 'w-64' : 'w-full')}>
                  <div className="flex items-start gap-2 p-3">
                    <div className="w-9 h-9 rounded-full bg-sky-100 flex items-center justify-center text-sky-700 text-sm font-bold flex-shrink-0">
                      {previewIntegration?.name?.charAt(0)?.toUpperCase() || 'L'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-900 truncate">{previewIntegration?.name || 'LinkedIn User'}</p>
                      <p className="text-[10px] text-gray-500">1st · Professional</p>
                      <p className="text-[9px] text-gray-400">Just now · 🌐</p>
                    </div>
                    <button className="text-gray-400">···</button>
                  </div>
                  {previewContent && (
                    <div className="px-3 pb-2">
                      <p className="text-xs text-gray-800 whitespace-pre-wrap line-clamp-6">{previewContent}</p>
                    </div>
                  )}
                  {mediaFiles[0] && (
                    <MediaThumb media={mediaFiles[0]} className="w-full aspect-video object-cover" />
                  )}
                  <div className="flex border-t border-gray-100 mt-1">
                    {['👍 Like', '💬 Comment', '🔁 Repost', '✉ Send'].map((action) => (
                      <button key={action} className="flex-1 py-2 text-[10px] text-gray-500 hover:bg-gray-50 transition-colors text-center font-medium">
                        {action}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {previewPlatform === 'THREADS' && (
                <div className={clsx('bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden text-left', previewDevice === 'mobile' ? 'w-64' : 'w-full')}>
                  <div className="flex items-start gap-2 p-3">
                    <div className="w-8 h-8 rounded-full bg-slate-900 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                      {previewIntegration?.name?.charAt(0)?.toUpperCase() || 'T'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <p className="text-xs font-semibold text-gray-900 truncate">{previewIntegration?.name || 'threads_user'}</p>
                        <span className="text-[10px] text-gray-400">1m</span>
                      </div>
                      {previewContent && (
                        <p className="text-xs text-gray-800 whitespace-pre-wrap mt-1">{previewContent}</p>
                      )}
                    </div>
                    <button className="text-gray-400">···</button>
                  </div>
                  {mediaFiles[0] && (
                    <div className="px-3 pb-3 pl-12">
                      <MediaThumb media={mediaFiles[0]} className="w-full rounded-lg aspect-square object-cover" aspect="square" />
                    </div>
                  )}
                  <div className="flex items-center gap-4 pl-12 pb-3 text-gray-400 text-sm">
                    <span>♡</span><span>💬</span><span>🔁</span><span>↗</span>
                  </div>
                </div>
              )}

              {previewPlatform === 'GOOGLE_BUSINESS' && (
                <div className={clsx('bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden text-left', previewDevice === 'mobile' ? 'w-64' : 'w-full')}>
                  <div className="p-3 border-b border-gray-100 flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-700">
                      <Store size={16} />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-900">{previewIntegration?.name || 'Google Business Location'}</p>
                      <p className="text-[10px] text-gray-500">Google Search & Maps Update</p>
                    </div>
                  </div>
                  {mediaFiles[0] && (
                    <MediaThumb media={mediaFiles[0]} className="w-full aspect-video object-cover" />
                  )}
                  <div className="p-3">
                    {previewContent && (
                      <p className="text-xs text-gray-800 whitespace-pre-wrap mb-3 line-clamp-5">{previewContent}</p>
                    )}
                    <div className="border border-emerald-500 text-emerald-600 rounded-lg py-1.5 text-center text-xs font-semibold hover:bg-emerald-50/50 cursor-default">
                      Learn More
                    </div>
                  </div>
                </div>
              )}

              {selectedIntegrations.length === 0 && (
                <div className="text-center py-12">
                  <p className="text-sm text-gray-400 dark:text-text-muted">Select an account to see preview</p>
                </div>
              )}
            </div>

            {/* Preview disclaimer */}
            <div className="px-4 py-3 border-t border-gray-200 dark:border-surface-border flex-shrink-0">
              <p className="text-[10px] text-gray-400 dark:text-text-muted leading-relaxed">
                ℹ️ Previews are an approximation of how your post will look when published. The final post may look slightly different.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
