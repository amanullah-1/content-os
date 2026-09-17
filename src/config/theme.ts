import type { ThemeMode } from "@/types";

const light = {
  mode: "light" as ThemeMode,
  appBg: "#f4f5f7", sidebar: "#ffffff", card: "#ffffff", cardHover: "#f9fafb",
  inputBg: "#ffffff", sectionBg: "#fafafa", tagBg: "#f3f4f6", panelBg: "#ffffff",
  modalBg: "#ffffff",
  border: "#e5e7eb", borderLight: "#f3f4f6", borderFaint: "#f9fafb",
  text: "#111827", textSub: "#6b7280", textMuted: "#9ca3af", textFaint: "#d1d5db",
  primary: "#4f46e5", primaryText: "#ffffff",
  statusAI:       { label:"AI Generated", color:"#7c3aed", bg:"#ede9fe",  dot:"#8b5cf6" },
  statusDraft:    { label:"Draft",         color:"#6b7280", bg:"#f3f4f6",  dot:"#9ca3af" },
  statusReview:   { label:"In Review",     color:"#d97706", bg:"#fef3c7",  dot:"#f59e0b" },
  statusApproved: { label:"Approved",      color:"#2563eb", bg:"#dbeafe",  dot:"#3b82f6" },
  statusScheduled:{ label:"Scheduled",     color:"#059669", bg:"#d1fae5",  dot:"#10b981" },
  statusPublished:{ label:"Published",     color:"#374151", bg:"#f3f4f6",  dot:"#6b7280" },
  calEmpty: "#e5e7eb", tableHead: "#fafafa",
  navActive: "#eef2ff", navActiveText: "#4338ca", navText: "#6b7280",
  shadow: "0 1px 3px rgba(0,0,0,0.08),0 1px 2px rgba(0,0,0,0.04)",
  shadowMd: "0 8px 24px rgba(0,0,0,0.12)",
  toggleIcon: "☀️", toggleLabel: "Light mode",
  overlay: "rgba(17,24,39,0.45)",
  danger: "#dc2626", dangerBg: "#fee2e2", dangerBorder: "#fca5a5",
  success: "#059669", successBg: "#d1fae5",
};

const dark = {
  mode: "dark" as ThemeMode,
  appBg: "#0d0f14", sidebar: "#111318", card: "#181c24", cardHover: "#1e2330",
  inputBg: "#1e2330", sectionBg: "#141820", tagBg: "#1e2330", panelBg: "#181c24",
  modalBg: "#181c24",
  border: "#252d3d", borderLight: "#1e2330", borderFaint: "#181c24",
  text: "#f1f5f9", textSub: "#94a3b8", textMuted: "#64748b", textFaint: "#334155",
  primary: "#6366f1", primaryText: "#ffffff",
  statusAI:       { label:"AI Generated", color:"#a78bfa", bg:"#1e1b3a",  dot:"#8b5cf6" },
  statusDraft:    { label:"Draft",         color:"#94a3b8", bg:"#1e2330",  dot:"#64748b" },
  statusReview:   { label:"In Review",     color:"#fbbf24", bg:"#292110",  dot:"#f59e0b" },
  statusApproved: { label:"Approved",      color:"#60a5fa", bg:"#0f1f3d",  dot:"#3b82f6" },
  statusScheduled:{ label:"Scheduled",     color:"#34d399", bg:"#0a2218",  dot:"#10b981" },
  statusPublished:{ label:"Published",     color:"#94a3b8", bg:"#1e2330",  dot:"#64748b" },
  calEmpty: "#252d3d", tableHead: "#141820",
  navActive: "#1e2460", navActiveText: "#818cf8", navText: "#64748b",
  shadow: "0 1px 3px rgba(0,0,0,0.4),0 1px 2px rgba(0,0,0,0.3)",
  shadowMd: "0 8px 24px rgba(0,0,0,0.5)",
  toggleIcon: "🌙", toggleLabel: "Dark mode",
  overlay: "rgba(0,0,0,0.65)",
  danger: "#f87171", dangerBg: "#2d0f0f", dangerBorder: "#7f1d1d",
  success: "#34d399", successBg: "#0a2218",
};

export const THEMES = { light, dark };
export type Theme = typeof light;
