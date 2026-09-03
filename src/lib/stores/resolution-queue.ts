import { create } from "zustand";

type ResolutionQueueState = {
  selectedEntryId: string | null;
  select: (entryId: string) => void;
  clear: () => void;
};

export const useResolutionQueue = create<ResolutionQueueState>((set) => ({
  selectedEntryId: null,
  select: (entryId) => set({ selectedEntryId: entryId }),
  clear: () => set({ selectedEntryId: null }),
}));
