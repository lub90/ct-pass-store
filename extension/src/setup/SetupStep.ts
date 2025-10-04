import { Precondition } from './Precondition';

export interface SetupStep {
  checkPrecondition(): Promise<Precondition[]>;
  isCompleted(): Promise<boolean>;
  run(container: HTMLElement): Promise<void>;
}
