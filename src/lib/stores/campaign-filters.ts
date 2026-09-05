import { create } from "zustand";

export type CampaignStatusFilter =
  | "all"
  | "draft"
  | "pendingInternalApproval"
  | "pendingClientApproval"
  | "scheduled"
  | "live"
  | "paused"
  | "completed"
  | "cancelled"
  | "deleted";

type CampaignFiltersState = {
  status: CampaignStatusFilter;
  query: string;
  setStatus: (status: CampaignStatusFilter) => void;
  setQuery: (query: string) => void;
  reset: () => void;
};

export const useCampaignFilters = create<CampaignFiltersState>((set) => ({
  status: "all",
  query: "",
  setStatus: (status) => set({ status }),
  setQuery: (query) => set({ query }),
  reset: () => set({ status: "all", query: "" }),
}));
