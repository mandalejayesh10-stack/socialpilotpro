import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// ── Types ─────────────────────────────────────────────────────
export interface Organization {
  id: string;
  name: string;
  logoUrl?: string;
  brandColor?: string;
  timezone: string;
  website?: string;
  description?: string;
  subscription?: {
    tier: 'FREE' | 'PRO' | 'AGENCY';
    status: string;
    currentPeriodEnd?: string;
  };
  usageLimits?: {
    postsUsed: number;
    postsLimit: number;
    accountsConnected: number;
    accountsLimit: number;
    aiCreditsUsed: number;
    aiCreditsLimit: number;
  };
  role?: string;
  integrationCount?: number;
  integrations?: Array<{ platform: string; pictureUrl?: string; name: string }>;
}

export interface User {
  id: string;
  name: string;
  email: string;
  pictureUrl?: string;
  bio?: string;
  timezone?: string;
  language?: string;
  isSuperAdmin: boolean;
  providerName?: string;
  organizations?: Array<{
    organization: Organization;
    role: string;
  }>;
}

interface AppStore {
  // State
  user: User | null;
  currentOrg: Organization | null;
  organizations: Organization[];
  sidebarCollapsed: boolean;

  // Actions
  setUser: (user: User | null) => void;
  setCurrentOrg: (org: Organization | string) => void;
  setOrganizations: (orgs: Organization[]) => void;
  updateOrg: (orgId: string, data: Partial<Organization>) => void;
  setSidebarCollapsed: (v: boolean) => void;
  reset: () => void;

  // Computed
  currentPlan: () => 'FREE' | 'PRO' | 'AGENCY';
  currentOrgId: () => string;
  getCurrentOrg: () => Organization | null;
  getCurrentTier: () => 'FREE' | 'PRO' | 'AGENCY';
  isAdmin: () => boolean;
  canUseFeature: (feature: 'reports' | 'ai' | 'media' | 'api' | 'bulk') => boolean;
}

export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => ({
      user: null,
      currentOrg: null,
      organizations: [],
      sidebarCollapsed: false,

      setUser: (user) => {
        const currentUser = get().user;
        // If different user is logging in, clear the persisted org
        if (user && currentUser && currentUser.id !== user.id) {
          set({ user, currentOrg: null, organizations: [] });
        } else {
          set({ user });
        }
      },

      setCurrentOrg: (org) => {
        if (typeof org === 'string') {
          const found = get().organizations.find((item) => item.id === org) || null;
          set({ currentOrg: found });
          return;
        }
        set({ currentOrg: org });
      },

      setOrganizations: (orgs) => {
        set({ organizations: orgs });
        // Always reset to first org when orgs are loaded fresh from server
        // This prevents stale org from previous login session
        if (orgs.length > 0) {
          const current = get().currentOrg;
          const stillValid = current && orgs.find(o => o.id === current.id);
          if (!stillValid) {
            // Current org doesn't belong to this user — reset to first
            set({ currentOrg: orgs[0] });
          } else {
            // Refresh current org data from server
            const updated = orgs.find(o => o.id === current!.id);
            if (updated) set({ currentOrg: updated });
          }
        }
      },

      updateOrg: (orgId, data) => {
        set(state => ({
          organizations: state.organizations.map(o =>
            o.id === orgId ? { ...o, ...data } : o,
          ),
          currentOrg: state.currentOrg?.id === orgId
            ? { ...state.currentOrg, ...data }
            : state.currentOrg,
        }));
      },

      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),

      reset: () => set({
        user: null,
        currentOrg: null,
        organizations: [],
      }),

      currentPlan: () => {
        const tier = get().currentOrg?.subscription?.tier;
        return tier || 'FREE';
      },

      currentOrgId: () => get().currentOrg?.id || '',

      getCurrentOrg: () => get().currentOrg,

      getCurrentTier: () => get().currentPlan(),

      isAdmin: () => {
        const org = get().currentOrg;
        if (!org) return false;
        return ['ADMIN', 'SUPERADMIN'].includes((org as any).role || '');
      },

      canUseFeature: (feature) => {
        const plan = get().currentPlan();
        const featureMap: Record<string, string[]> = {
          reports:  ['PRO', 'AGENCY'],
          ai:       ['PRO', 'AGENCY'],
          media:    ['PRO', 'AGENCY'],
          api:      ['PRO', 'AGENCY'],
          bulk:     ['PRO', 'AGENCY'],
        };
        return featureMap[feature]?.includes(plan) ?? false;
      },
    }),
    {
      name: 'socialpilot-store',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        currentOrg: state.currentOrg,
        user: state.user ? {
          id: state.user.id,
          name: state.user.name,
          email: state.user.email,
          pictureUrl: state.user.pictureUrl,
          isSuperAdmin: state.user.isSuperAdmin,
          providerName: state.user.providerName,
        } : null,
        sidebarCollapsed: state.sidebarCollapsed,
      }),
    },
  ),
);
