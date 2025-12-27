export const AlertState = {
  Idle: "idle",
  Loading: "loading",
  Success: "success",
  Error: "error",
} as const;

export type AlertState = typeof AlertState[keyof typeof AlertState];
