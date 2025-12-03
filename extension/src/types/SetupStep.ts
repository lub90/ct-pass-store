import type { Component } from "vue";
import type { SetupProcessStatus } from "./SetupProcessStatus";

export interface SetupStep {
  component: Component;
  allowBack(): boolean;
  allowRetry(): boolean;
}