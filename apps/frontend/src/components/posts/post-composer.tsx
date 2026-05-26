'use client';

import { useState, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { useIntegrations, useOrgId } from '@/lib/hooks';
import { postApi, mediaApi, aiApi, resolveMediaUrl } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Textarea, Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Badge, PlatformBadge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { mutate } from 'swr';
import clsx from 'clsx';
import {
  Instagram, Facebook, Youtube, Image, Video,
  Sparkles, Hash, Calendar, X, Upload, Loader2,
  Eye, Clock,
} from 'lucide-react';

const PLATFORM_ICONS: Record<string, React.ReactNode> = {
  INSTAGRAM: <Instagram size={14} />,
  FACEBOOK:  <Facebook size={14} />,
  YOUTUBE:   <Youtube size={14} />,
};

const PLATFORM_COLORS: Record<string, string> = {
  INSTAGRAM: 'bg-pink-500/15 border-pink-500/40 text-pink-400',
  FACEBOOK:  'bg-blue-500/15 border-blue-500/40 text-blue-400',
  YOUTUBE:   'bg-red-500/15 border-red-500/40 text-red-400',
};

const CHAR_LIMITS: Record<string, number> = {
  INSTAGRAM: 2200,
  FACEBOOK:  63206,
  YOUTUBE:   5000,
};

interface PostComposerProps {
  open: boolean;
  onClose: () => void;
  defaultDate?: string;
  onSuccess?: () => void;
}

export function PostComposer({ open, onClose, defaultDate, onSuccess }: PostComposerProps) {
  const orgId = useOrgId();
  const toast = useToast();
  const { data: integrations = [] } = useIntegrations();

  const [selectedIntegrations, setSelectedIntegrations] = useState<string[]>([]);
  const [mediaFiles, setMediaFiles] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { register, handleSubmit, watch, setValue, reset, formState: { errors } } = useForm<{
    content: string;
    hashtags: string;
    publishDate: string;
    title: string;
  }>({
    defaultValues: { publishDate: defaultDate || '' },
  });

  const content = watch('content') || '';
  const hashtags = watch('hashtags') || '';

  // Get char limit for selected platforms
  const charLimit = selectedIntegrations.length > 0
    ? Math.min(...selectedIntegrations.map(id => {
        const ig = integrations.find((i: any) => i.id === id);
        return CHAR_LIMITS[ig?.platform] || 2200;
      }))
    : 2200;

  const charCount = content.length + (hashtags ? hashtags.length + 2 : 0);
  const isOverLimit = charCount > charLimit;

  const toggleIntegration = (id: string) => {
    setSelectedIntegrations(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id],
    );
  };

  const handleFileUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      const uploaded = await Promise.all(
        Array.from(files).map(f => mediaApi.upload(orgId, f)),
      );
      setMediaFiles(prev => [...prev, ...uploaded]);
    } catch (e: any) {
      toast.error('Upload failed', e.message);
    } finally {
      setUploading(false);
    }
  };

  const removeMedia = (id: string) => {
    setMediaFiles(prev => prev.filter(m => m.id !== id));
  };

  const generateCaption = async () => {
    const topic = content || 'social media post';
    const platform = selectedIntegrations[0]
      ? integrations.find((i: any) => i.id === selectedIntegrations[0])?.platform?.toLowerCase()
      : 'instagram';

    setAiLoading(true);
    try {
      const res = await aiApi.generateCaption(orgId, { platform, topic, tone: 'professional' });
      setValue('content', res.caption);
      if (res.hashtags?.length) {
        setValue('hashtags', res.hashtags.map((h: string) => `#${h}`).join(' '));
      }
      toast.success('Caption generated!');
    } catch (e: any) {
      toast.error('AI unavailable', 'Make sure Ollama is running');
    } finally {
      setAiLoading(false);
    }
  };

  const suggestHashtags = async () => {
    if (!content.trim()) { toast.warning('Write some content first'); return; }
    const platform = selectedIntegrations[0]
      ? integrations.find((i: any) => i.id === selectedIntegrations[0])?.platform?.toLowerCase()
      : 'instagram';

    setAiLoading(true);
    try {
      const res = await aiApi.suggestHashtags(orgId, { platform, content, count: 15 });
      setValue('hashtags', res.hashtags.map((h: string) => `#${h}`).join(' '));
      toast.success('Hashtags suggested!');
    } catch {
      toast.error('AI unavailable', 'Make sure Ollama is running');
    } finally {
      setAiLoading(false);
    }
  };

  const onSubmit = async (data: any) => {
    if (!selectedIntegrations.length) { toast.error('Select at least one account'); return; }
    if (!data.publishDate) { toast.error('Set a publish date'); return; }
    if (isOverLimit) { toast.error('Content too long', `Reduce by ${charCount - charLimit} characters`); return; }

    setSubmitting(true);
    try {
      await postApi.create(orgId, {
        integrationIds: selectedIntegrations,
        content: data.content,
        hashtags: data.hashtags,
        title: data.title,
        publishDate: new Date(data.publishDate).toISOString(),
        mediaUrls: mediaFiles.map(m => m.url),
      });

      toast.success('Post scheduled!');
      reset();
      setSelectedIntegrations([]);
      setMediaFiles([]);
      mutate(['posts', orgId, '{}']);
      onSuccess?.();
      onClose();
    } catch (e: any) {
      toast.error('Failed to schedule', e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const hasYoutube = selectedIntegrations.some(id =>
    integrations.find((i: any) => i.id === id)?.platform === 'YOUTUBE',
  );

  return (
    <Modal open={open} onClose={onClose} title="Create Post" size="xl">
      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="grid grid-cols-5 gap-5">

          {/* ── Left: Composer ─────────────────────────────── */}
          <div className="col-span-3 space-y-4">

            {/* Account selector */}
            <div>
              <label className="block text-xs font-medium text-text-muted uppercase tracking-wider mb-2">
                Post to
              </label>
              {integrations.length === 0 ? (
                <div className="bg-surface-hover rounded-xl p-3 text-sm text-text-muted">
                  No accounts connected.{' '}
                  <a href="/dashboard/settings/connections" className="text-brand-400 hover:underline">
                    Connect one →
                  </a>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {integrations.map((ig: any) => (
                    <button
                      key={ig.id}
                      type="button"
                      onClick={() => toggleIntegration(ig.id)}
                      className={clsx(
                        'flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition-all',
                        selectedIntegrations.includes(ig.id)
                          ? PLATFORM_COLORS[ig.platform]
                          : 'bg-surface-hover border-surface-border text-text-secondary hover:text-text-primary',
                      )}
                    >
                      {PLATFORM_ICONS[ig.platform]}
                      <span className="max-w-[100px] truncate">{ig.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* YouTube title */}
            {hasYoutube && (
              <Input
                label="Video title (YouTube)"
                placeholder="Enter video title..."
                {...register('title')}
              />
            )}

            {/* Content */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-medium text-text-secondary">Caption</label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={generateCaption}
                    disabled={aiLoading}
                    className="flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 transition-colors disabled:opacity-50"
                  >
                    {aiLoading ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                    AI caption
                  </button>
                </div>
              </div>
              <textarea
                {...register('content', { required: 'Caption is required' })}
                rows={6}
                placeholder="Write your caption..."
                className={clsx(
                  'w-full bg-surface-input border rounded-xl px-4 py-3 text-sm text-text-primary',
                  'placeholder:text-text-muted focus:outline-none transition-colors resize-none',
                  isOverLimit
                    ? 'border-error/50 focus:border-error'
                    : 'border-surface-border focus:border-brand-500',
                )}
              />
              <div className="flex items-center justify-between mt-1">
                {errors.content && <p className="text-xs text-error">{errors.content.message}</p>}
                <span className={clsx('text-xs ml-auto', isOverLimit ? 'text-error' : 'text-text-muted')}>
                  {charCount}/{charLimit}
                </span>
              </div>
            </div>

            {/* Hashtags */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-medium text-text-secondary">Hashtags</label>
                <button
                  type="button"
                  onClick={suggestHashtags}
                  disabled={aiLoading}
                  className="flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 transition-colors disabled:opacity-50"
                >
                  {aiLoading ? <Loader2 size={11} className="animate-spin" /> : <Hash size={11} />}
                  AI suggest
                </button>
              </div>
              <input
                {...register('hashtags')}
                placeholder="#socialmedia #marketing"
                className="w-full bg-surface-input border border-surface-border rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-500 transition-colors"
              />
            </div>

            {/* Schedule */}
            <Input
              label="Schedule date & time"
              type="datetime-local"
              {...register('publishDate', { required: 'Schedule date is required' })}
              error={errors.publishDate?.message}
              icon={<Clock size={14} />}
            />
          </div>

          {/* ── Right: Media + Preview ──────────────────────── */}
          <div className="col-span-2 space-y-4">

            {/* Media upload */}
            <div>
              <label className="block text-xs font-medium text-text-muted uppercase tracking-wider mb-2">
                Media
              </label>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,video/*"
                className="hidden"
                onChange={e => handleFileUpload(e.target.files)}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full border-2 border-dashed border-surface-border rounded-xl p-4 text-center hover:border-brand-500/50 transition-colors"
              >
                {uploading ? (
                  <Loader2 size={20} className="animate-spin text-text-muted mx-auto" />
                ) : (
                  <>
                    <Upload size={20} className="text-text-muted mx-auto mb-1" />
                    <p className="text-xs text-text-muted">Click or drag to upload</p>
                  </>
                )}
              </button>

              {/* Media grid */}
              {mediaFiles.length > 0 && (
                <div className="grid grid-cols-3 gap-2 mt-3">
                  {mediaFiles.map(m => (
                    <div key={m.id} className="relative group aspect-square rounded-lg overflow-hidden bg-surface-hover">
                      {m.type === 'IMAGE' || m.type === 'PROCESSED_VIDEO' ? (
                        <img src={resolveMediaUrl(m.thumbnail || m.url)} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Video size={20} className="text-text-muted" />
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => removeMedia(m.id)}
                        className="absolute top-1 right-1 w-5 h-5 bg-black/60 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X size={10} className="text-white" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Post preview */}
            <div className="bg-surface-hover rounded-xl p-4">
              <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">Preview</p>
              <div className="space-y-2">
                <p className="text-sm text-text-primary whitespace-pre-wrap line-clamp-6">
                  {content || <span className="text-text-muted italic">Your caption will appear here...</span>}
                </p>
                {hashtags && (
                  <p className="text-sm text-brand-400 line-clamp-2">{hashtags}</p>
                )}
              </div>
              {selectedIntegrations.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-3 pt-3 border-t border-surface-border">
                  {selectedIntegrations.map(id => {
                    const ig = integrations.find((i: any) => i.id === id);
                    return ig ? (
                      <PlatformBadge key={id} platform={ig.platform} />
                    ) : null;
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-5 mt-5 border-t border-surface-border">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <div className="flex gap-3">
            <Button
              type="submit"
              loading={submitting}
              disabled={isOverLimit}
              icon={<Calendar size={15} />}
            >
              Schedule Post
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
