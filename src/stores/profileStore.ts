import { create } from "zustand";
import { api, type Profile } from "../lib/api";

type ProfileState = {
  profiles: Profile[];
  /** Aktif profil — null sadece boot öncesi anlık. Boot sonrası ilkine düşer. */
  activeId: number | null;
  loading: boolean;

  refresh: () => Promise<void>;
  setActive: (id: number) => void;
  create: (name: string) => Promise<Profile>;
  rename: (id: number, name: string) => Promise<void>;
  remove: (id: number) => Promise<void>;
  setPinned: (id: number, pinned: boolean) => Promise<void>;
};

export const useProfileStore = create<ProfileState>((set, get) => ({
  profiles: [],
  activeId: null,
  loading: false,

  refresh: async () => {
    set({ loading: true });
    try {
      const list = await api.listProfiles();
      set({ profiles: list, loading: false });
      const { activeId } = get();
      if (activeId == null || !list.find((p) => p.id === activeId)) {
        set({ activeId: list[0]?.id ?? null });
      }
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },

  setActive: (id) => set({ activeId: id }),

  create: async (name) => {
    const p = await api.createProfile(name);
    set((s) => ({ profiles: [...s.profiles, p] }));
    return p;
  },

  rename: async (id, name) => {
    await api.renameProfile(id, name);
    set((s) => ({
      profiles: s.profiles.map((p) => (p.id === id ? { ...p, name } : p)),
    }));
  },

  remove: async (id) => {
    await api.deleteProfile(id);
    set((s) => {
      const next = s.profiles.filter((p) => p.id !== id);
      const activeId = s.activeId === id ? next[0]?.id ?? null : s.activeId;
      return { profiles: next, activeId };
    });
  },

  setPinned: async (id, pinned) => {
    await api.setProfilePin(id, pinned);
    set((s) => ({
      profiles: s.profiles
        .map((p) => (p.id === id ? { ...p, pinned: pinned ? 1 : 0 } : p))
        .sort((a, b) => b.pinned - a.pinned || a.id - b.id),
    }));
  },
}));
