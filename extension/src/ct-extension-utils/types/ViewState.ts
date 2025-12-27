export const ViewState = {
  Loading: "loading",
  Ready: "ready",
  Error: "error",
} as const;

export type ViewState = typeof ViewState[keyof typeof ViewState];
