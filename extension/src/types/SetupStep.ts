import type { Component } from "vue";
import type { Precondition } from "./Precondition";

export interface SetupStep {
  component: Component;
  async checkPrecondition() : Promise<Precondition[]>;
}