import type { Component } from "vue";

export interface SetupStep {
  component: Component;
  allowBack(): boolean;
  allowRetry(): boolean;
}