import type { SetupStep } from '../SetupStep';
import { Precondition } from '../Precondition';

export class Step1 implements SetupStep {
  
  async checkPrecondition(): Promise<Precondition[]> {
    return [new Precondition('Backend reachable', true)];
  }

  async isCompleted(): Promise<boolean> {
    // Check from key-value store or local state
    return false;
  }

  async run(container: HTMLElement): Promise<void> {
    container.innerHTML = '<p>Running Step 1...</p>';
    await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate async
    container.innerHTML += '<p>Step 1 completed.</p>';
  }
}
