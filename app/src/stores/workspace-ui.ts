"use client";

import { create } from "zustand";

interface WorkspaceUiState {
  membersOpen: boolean;
  setMembersOpen: (open: boolean) => void;
}

export const useWorkspaceUiStore = create<WorkspaceUiState>((set) => ({
  membersOpen: false,
  setMembersOpen: (membersOpen) => set({ membersOpen }),
}));
