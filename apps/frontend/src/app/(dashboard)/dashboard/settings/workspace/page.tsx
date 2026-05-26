'use client';

import { useState, useRef } from 'react';
import { useAppStore } from '@/lib/store';
import { orgApi, mediaApi, integrationApi, resolveMediaUrl } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { mutate } from 'swr';
import useSWR from 'swr';
import clsx from 'clsx';
import {
  Building2, Plus, Users, Check, Upload, Loader2,
  Instagram, Facebook, Youtube, Pencil, Trash2,
  Globe, Clock, Palette, X,
} from 'lucide-react';

// ── Platform helpers ──────────────────────────────────────────
const PLATFORM_ICONS: Record<string, React.ReactNode> = {
  INSTAGRAM: <Instagram size={12} />,
  FACEBOOK:  <Facebook size={12} />,
  YOUTUBE:   <Youtube size={12} />,
};
const PLATFORM_COLORS: Record<string, string> = {
  INSTAGRAM: 'bg-gradient-to-br from-purple-500 to-pink-500',
  FACEBOOK:  'bg-blue-600',
  YOUTUBE:   'bg-red-600',
};

const PRESET_COLORS = [
  '#6366f1','#8b5cf6','#ec4899','#ef4444','#f97316',
  '#eab308','#22c55e','#14b8a6','#3b82f6','#06b6d4',
];

const TIMEZONES = [
  'UTC','America/New_York','America/Chicago','America/Denver','America/Los_Angeles',
  'Europe/London','Europe/Paris','Europe/Berlin','Asia/Kolkata','Asia/Tokyo',
  'Asia/Singapore','Australia/Sydney','Pacific/Auckland',
];

// ── Brand avatar ──────────────────────────────────────────────
function BrandAvatar({ org, size = 'lg' }: { org: any; size?: 'sm'|'md'|'lg'|'xl' }) {
  const sizes = { sm:'w-8 h-8 text-xs', md:'w-10 h-10 text-sm', lg:'w-14 h-14 text-lg', xl:'w-20 h-20 text-2xl' };
  const logo = resolveMediaUrl(org.logoUrl);
  return logo ? (
    <img src={logo} alt={org.name} className={clsx('rounded-2xl object-cover flex-shrink-0', sizes[size])} />
  ) : (
    <div
      className={clsx('rounded-2xl flex items-center justify-center font-bold text-white flex-shrink-0', sizes[size])}
      style={{ backgroundColor: org.brandColor || '#6366f1' }}
    >
      {org.name?.charAt(0)?.toUpperCase()}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────
export default function WorkspacePage() {
  const { organizations, currentOrg, setCurrentOrg, setOrganizations } = useAppStore();
  const [showCreate, setShowCreate] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [editingOrg, setEditingOrg] = useState<any>(null);
  const toast = useToast();

  const { data: members = [], isLoading: loadingMembers } = useSWR<any[]>(
    currentOrg ? ['members', currentOrg.id] : null,
    () => orgApi.getMembers(currentOrg!.id) as Promise<any[]>,
  );

  const { data: integrations = [] } = useSWR(
    currentOrg ? ['integrations', currentOrg.id] : null,
    () => integrationApi.list(currentOrg!.id),
  );

  const handleSwitch = (org: any) => {
    setCurrentOrg(org);
    mutate(() => true, undefined, { revalidate: true });
    toast.success(`Switched to ${org.name}`);
  };

  const handleBrandUpdated = async () => {
    const orgs = await orgApi.list();
    setOrganizations(orgs);
    const updated = orgs.find((o: any) => o.id === currentOrg?.id);
    if (updated) setCurrentOrg(updated);
    setEditingOrg(null);
    toast.success('Brand updated');
  };

  const roleColors: Record<string, string> = {
    ADMIN:'bg-brand-500/15 text-brand-400',
    EDITOR:'bg-blue-500/15 text-blue-400',
    VIEWER:'bg-surface-border text-text-muted',
    USER:'bg-surface-border text-text-muted',
    SUPERADMIN:'bg-amber-500/15 text-amber-400',
  };

  return (
    <div className="space-y-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Brands & Workspaces</h1>
          <p className="text-sm text-text-muted mt-0.5">Manage all your brands, team members, and connected accounts</p>
        </div>
        <Button icon={<Plus size={15} />} onClick={() => setShowCreate(true)}>
          Add Brand
        </Button>
      </div>

      {/* Brand cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {organizations.map((org) => {
          const isActive = currentOrg?.id === org.id;
          const orgIntegrations = isActive ? integrations : [];
          const platforms = [...new Set(orgIntegrations.map((i: any) => i.platform))];

          return (
            <div
              key={org.id}
              className={clsx(
                'relative bg-surface-card border rounded-2xl p-5 transition-all group',
                isActive
                  ? 'border-brand-500/50 shadow-lg shadow-brand-500/5'
                  : 'border-surface-border hover:border-brand-500/20 cursor-pointer',
              )}
              onClick={() => !isActive && handleSwitch(org)}
            >
              {/* Active indicator */}
              {isActive && (
                <div className="absolute top-3 right-3 flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-[10px] font-medium text-green-500">Active</span>
                </div>
              )}

              <div className="flex items-start gap-4">
                <BrandAvatar org={org} size="lg" />
                <div className="flex-1 min-w-0">
                  <p className="text-base font-semibold text-text-primary truncate">{org.name}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-xs text-text-muted flex items-center gap-1">
                      <Clock size={11} /> {org.timezone || 'UTC'}
                    </span>
                    {(org as any).subscription?.tier && (
                      <Badge variant={(org as any).subscription.tier === 'FREE' ? 'default' : 'info'} size="sm">
                        {(org as any).subscription.tier}
                      </Badge>
                    )}
                    <span className="text-xs text-text-muted capitalize">
                      {(org as any).role?.toLowerCase() || 'member'}
                    </span>
                  </div>

                  {/* Platform icons */}
                  {platforms.length > 0 && (
                    <div className="flex items-center gap-1 mt-2">
                      {platforms.map((p) => (
                        <div key={p} className={clsx('w-5 h-5 rounded-full flex items-center justify-center text-white', PLATFORM_COLORS[p])}>
                          {PLATFORM_ICONS[p]}
                        </div>
                      ))}
                      <span className="text-[11px] text-text-muted ml-1">
                        {orgIntegrations.length} account{orgIntegrations.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Actions */}
              {isActive && (
                <div className="flex gap-2 mt-4 pt-4 border-t border-surface-border">
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditingOrg(org); }}
                    className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition-colors px-2 py-1 rounded-lg hover:bg-surface-hover"
                  >
                    <Pencil size={12} /> Edit Brand
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {/* Add brand card */}
        <button
          onClick={() => setShowCreate(true)}
          className="border-2 border-dashed border-surface-border rounded-2xl p-5 flex flex-col items-center justify-center gap-3 hover:border-brand-500/40 hover:bg-surface-hover/30 transition-all min-h-[140px] group"
        >
          <div className="w-12 h-12 rounded-2xl border-2 border-dashed border-surface-border group-hover:border-brand-500/40 flex items-center justify-center transition-colors">
            <Plus size={20} className="text-text-muted group-hover:text-brand-400 transition-colors" />
          </div>
          <p className="text-sm font-medium text-text-muted group-hover:text-text-primary transition-colors">Add Brand</p>
        </button>
      </div>

      {/* Current brand details */}
      {currentOrg && (
        <div className="space-y-5">
          {/* Team members */}
          <div className="bg-surface-card border border-surface-border rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
              <div className="flex items-center gap-2">
                <Users size={16} className="text-brand-400" />
                <h3 className="text-sm font-semibold text-text-primary">Team Members</h3>
                <span className="text-xs text-text-muted bg-surface-hover px-2 py-0.5 rounded-full">{members.length}</span>
              </div>
              <Button variant="secondary" size="sm" icon={<Plus size={13} />} onClick={() => setShowInvite(true)}>
                Invite
              </Button>
            </div>

            {loadingMembers ? (
              <div className="p-5 space-y-3">
                {[1,2].map(i => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="skeleton w-9 h-9 rounded-full" />
                    <div className="flex-1 space-y-1.5">
                      <div className="skeleton h-4 w-32" />
                      <div className="skeleton h-3 w-24" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="divide-y divide-surface-border/50">
                {members.map((m: any) => (
                  <MemberRow key={m.id} member={m} orgId={currentOrg.id} roleColors={roleColors} />
                ))}
              </div>
            )}
          </div>

          {/* Connected accounts */}
          {integrations.length > 0 && (
            <div className="bg-surface-card border border-surface-border rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-surface-border">
                <h3 className="text-sm font-semibold text-text-primary">Connected Accounts</h3>
              </div>
              <div className="divide-y divide-surface-border/50">
                {integrations.map((ig: any) => (
                  <div key={ig.id} className="flex items-center gap-4 px-5 py-3">
                    <div className={clsx('w-8 h-8 rounded-full flex items-center justify-center text-white flex-shrink-0', PLATFORM_COLORS[ig.platform])}>
                      {PLATFORM_ICONS[ig.platform]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate">{ig.name}</p>
                      <p className="text-xs text-text-muted capitalize">{ig.platform.toLowerCase()}</p>
                    </div>
                    <div className={clsx('w-2 h-2 rounded-full', ig.disabled ? 'bg-error' : 'bg-green-500')} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Edit brand modal */}
      {editingOrg && (
        <EditBrandModal
          org={editingOrg}
          onClose={() => setEditingOrg(null)}
          onSuccess={handleBrandUpdated}
        />
      )}

      {/* Create brand modal */}
      <CreateBrandModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSuccess={async (org) => {
          const orgs = await orgApi.list();
          setOrganizations(orgs);
          const created = orgs.find((o: any) => o.id === org.id) || org;
          setCurrentOrg({ ...created, role: 'ADMIN' });
          setShowCreate(false);
          mutate(() => true, undefined, { revalidate: true });
          toast.success(`Brand "${org.name}" created`);
        }}
      />

      {/* Invite modal */}
      {currentOrg && (
        <InviteMemberModal
          open={showInvite}
          onClose={() => setShowInvite(false)}
          orgId={currentOrg.id}
          onSuccess={() => {
            mutate(['members', currentOrg.id]);
            setShowInvite(false);
            toast.success('Invitation sent');
          }}
        />
      )}
    </div>
  );
}

// ── Member row ────────────────────────────────────────────────
function MemberRow({ member, orgId, roleColors }: { member: any; orgId: string; roleColors: Record<string,string> }) {
  const { user: currentUser } = useAppStore();
  const toast = useToast();
  const [removing, setRemoving] = useState(false);

  const handleRemove = async () => {
    if (!confirm(`Remove ${member.user.name} from this workspace?`)) return;
    setRemoving(true);
    try {
      await orgApi.removeMember(orgId, member.userId);
      mutate(['members', orgId]);
      toast.success('Member removed');
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="flex items-center gap-4 px-5 py-3 hover:bg-surface-hover/50 transition-colors">
      <div className="w-9 h-9 rounded-full bg-brand-500/20 flex items-center justify-center text-brand-400 text-sm font-semibold flex-shrink-0">
        {member.user.name?.charAt(0)?.toUpperCase() || '?'}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary">{member.user.name}</p>
        <p className="text-xs text-text-muted">{member.user.email}</p>
      </div>
      <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full', roleColors[member.role] || roleColors.USER)}>
        {member.role}
      </span>
      {member.userId !== currentUser?.id && (
        <Button variant="ghost" size="sm" loading={removing} onClick={handleRemove} className="text-error hover:text-error text-xs">
          Remove
        </Button>
      )}
    </div>
  );
}

// ── Edit Brand Modal ──────────────────────────────────────────
function EditBrandModal({ org, onClose, onSuccess }: { org: any; onClose: () => void; onSuccess: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(org.name || '');
  const [timezone, setTimezone] = useState(org.timezone || 'UTC');
  const [brandColor, setBrandColor] = useState(org.brandColor || '#6366f1');
  const [website, setWebsite] = useState(org.website || '');
  const [description, setDescription] = useState(org.description || '');
  const [logoPreview, setLogoPreview] = useState<string | null>(resolveMediaUrl(org.logoUrl) || null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setLogoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Brand name is required'); return; }
    setLoading(true);
    try {
      let logoUrl = org.logoUrl;
      if (logoFile) {
        const uploaded = await mediaApi.upload(org.id, logoFile);
        logoUrl = resolveMediaUrl(uploaded.url);
      }
      await orgApi.update(org.id, { name: name.trim(), timezone, brandColor, website, description, logoUrl });
      onSuccess();
    } catch (e: any) {
      toast.error('Failed to update brand', e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Edit Brand" size="md">
      <div className="space-y-5">
        {/* Logo + name */}
        <div className="flex items-start gap-4">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center cursor-pointer border-2 border-dashed border-surface-border hover:border-brand-500/50 transition-colors overflow-hidden flex-shrink-0"
            style={{ backgroundColor: logoPreview ? 'transparent' : brandColor + '20' }}
            onClick={() => fileRef.current?.click()}
          >
            {logoPreview ? (
              <img src={logoPreview} alt="logo" className="w-full h-full object-cover" />
            ) : (
              <div className="flex flex-col items-center gap-1">
                <Upload size={16} className="text-text-muted" />
                <span className="text-[10px] text-text-muted">Logo</span>
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
          <div className="flex-1">
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Brand Name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-surface-input border border-surface-border rounded-xl px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-brand-500 transition-colors"
            />
          </div>
        </div>

        {/* Brand color */}
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-2 flex items-center gap-1.5">
            <Palette size={12} /> Brand Color
          </label>
          <div className="flex items-center gap-2 flex-wrap">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setBrandColor(c)}
                className={clsx('w-7 h-7 rounded-lg transition-all', brandColor === c && 'ring-2 ring-offset-2 ring-offset-surface-card ring-white scale-110')}
                style={{ backgroundColor: c }}
              />
            ))}
            <input type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)}
              className="w-7 h-7 rounded-lg cursor-pointer border border-surface-border bg-transparent" />
          </div>
        </div>

        {/* Timezone */}
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5 flex items-center gap-1.5">
            <Clock size={12} /> Timezone
          </label>
          <select value={timezone} onChange={(e) => setTimezone(e.target.value)}
            className="w-full bg-surface-input border border-surface-border rounded-xl px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-brand-500 transition-colors">
            {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
          </select>
        </div>

        {/* Website */}
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5 flex items-center gap-1.5">
            <Globe size={12} /> Website
          </label>
          <input value={website} onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://yourbrand.com"
            className="w-full bg-surface-input border border-surface-border rounded-xl px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-brand-500 transition-colors" />
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)}
            rows={2} placeholder="What does this brand do?"
            className="w-full bg-surface-input border border-surface-border rounded-xl px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-brand-500 transition-colors resize-none" />
        </div>

        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
          <Button loading={loading} onClick={handleSave} className="flex-1">Save Changes</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Create Brand Modal ────────────────────────────────────────
function CreateBrandModal({ open, onClose, onSuccess }: any) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [brandColor, setBrandColor] = useState('#6366f1');
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setLogoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (!name.trim()) { toast.error('Brand name is required'); return; }
    setLoading(true);
    try {
      const org = await orgApi.create({ name: name.trim(), timezone, brandColor }) as any;
      if (logoFile) {
        try {
          const uploaded = await mediaApi.upload(org.id, logoFile) as any;
          const logoUrl = resolveMediaUrl(uploaded.url);
          await orgApi.update(org.id, { logoUrl });
          org.logoUrl = logoUrl;
        } catch { /* logo upload failed, org still created */ }
      }
      setName(''); setTimezone('UTC'); setBrandColor('#6366f1');
      setLogoPreview(null); setLogoFile(null);
      onSuccess(org);
    } catch (e: any) {
      toast.error('Failed to create brand', e.message);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} title="Add Brand" size="sm">
      <div className="space-y-4">
        {/* Logo + name */}
        <div className="flex items-center gap-4">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center cursor-pointer border-2 border-dashed border-surface-border hover:border-brand-500/50 transition-colors overflow-hidden flex-shrink-0"
            style={{ backgroundColor: logoPreview ? 'transparent' : brandColor + '20' }}
            onClick={() => fileRef.current?.click()}
          >
            {logoPreview ? (
              <img src={logoPreview} alt="logo" className="w-full h-full object-cover" />
            ) : (
              <Upload size={14} className="text-text-muted" />
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Brand name *"
            autoFocus
            className="flex-1 bg-surface-input border border-surface-border rounded-xl px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-brand-500 transition-colors"
          />
        </div>

        {/* Color */}
        <div className="flex items-center gap-2 flex-wrap">
          {PRESET_COLORS.map((c) => (
            <button key={c} onClick={() => setBrandColor(c)}
              className={clsx('w-6 h-6 rounded-lg transition-all', brandColor === c && 'ring-2 ring-offset-1 ring-offset-surface-card ring-white scale-110')}
              style={{ backgroundColor: c }} />
          ))}
          <input type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)}
            className="w-6 h-6 rounded-lg cursor-pointer border border-surface-border bg-transparent" />
        </div>

        {/* Timezone */}
        <select value={timezone} onChange={(e) => setTimezone(e.target.value)}
          className="w-full bg-surface-input border border-surface-border rounded-xl px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-brand-500 transition-colors">
          {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
        </select>

        <div className="flex gap-3 pt-1">
          <Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
          <Button loading={loading} disabled={!name.trim()} onClick={handleSubmit} className="flex-1">Create</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Invite member modal ───────────────────────────────────────
function InviteMemberModal({ open, onClose, orgId, onSuccess }: any) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('EDITOR');
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const handleSubmit = async () => {
    if (!email.trim()) { toast.error('Email is required'); return; }
    setLoading(true);
    try {
      await orgApi.invite(orgId, email.trim(), role);
      setEmail(''); setRole('EDITOR');
      onSuccess();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Invite Team Member" size="sm">
      <div className="space-y-4">
        <input value={email} onChange={(e) => setEmail(e.target.value)}
          type="email" placeholder="colleague@company.com" autoFocus
          className="w-full bg-surface-input border border-surface-border rounded-xl px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-brand-500 transition-colors" />
        <select value={role} onChange={(e) => setRole(e.target.value)}
          className="w-full bg-surface-input border border-surface-border rounded-xl px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-brand-500 transition-colors">
          <option value="ADMIN">Admin — full access</option>
          <option value="EDITOR">Editor — create & schedule posts</option>
          <option value="VIEWER">Viewer — read-only analytics</option>
        </select>
        <div className="flex gap-3 pt-1">
          <Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
          <Button loading={loading} disabled={!email.trim()} onClick={handleSubmit} className="flex-1">Send Invite</Button>
        </div>
      </div>
    </Modal>
  );
}
