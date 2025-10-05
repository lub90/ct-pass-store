import type { SetupStep } from './SetupStep';
import { Precondition } from './Precondition';
import { Step1 } from './steps/Step1';
import { InitializeKeyValueStoreStep } from './steps/InitializeKeyValueStoreStep'
import { AbstractController } from '../AbstractController';

export class SetupController extends AbstractController {
  private steps: SetupStep[];
  private currentStepIndex = 0;
  private nextButton: HTMLElement;
  private startSetupButton: HTMLElement;
  private readonly churchtoolsClient: any;

  constructor(churchtoolsClient : any) {
    super("Setup");

    this.churchtoolsClient = churchtoolsClient;

    this.steps = [new InitializeKeyValueStoreStep(this.churchtoolsClient), new Step1(), new Step1()];

    // Generate the next button on start, hide and disable the next button on start
    this.nextButton = this.addFooterButton("lubl-next-setup-step", "Next >", () => this.next());
    this.nextButton.style.display = 'none';

    // Generate the start setup button
    this.startSetupButton = this.addFooterButton("lubl-start-setup", "Start Setup", () => {
      // Reveal the next button
      this.nextButton.style.display = 'inline-block';
      // Hide this button
      this.startSetupButton.style.display = 'none';
      this.runStep();
    });
    this.startSetupButton.style.display = 'none';
  }

  async init() {
    // TODO: Rework to react to the settings boolean if it is present
    /**
    const allCompleted = await Promise.all(this.steps.map(s => s.isCompleted()));
    if (allCompleted.every(c => c)) {
      this.showCompletedNotice();
      window.location.hash = '!/settings';
      return;
    }
    */

    this.showPreconditions();
  }

  private async showPreconditions() {
    // Generate status display
    const statusText = document.createElement('p');
    statusText.innerHTML = 'The extension has not been set up yet. Starting setup and checking preconditions…';
    statusText.classList.add('alert', 'alert-info', 'd-flex', 'align-items-center', 'gap-2', 'py-2', 'px-3', 'mb-3', 'fw-semibold');
    this.container.appendChild(statusText);

    const allPreconditions = await Promise.all(this.steps.map(s => s.checkPrecondition()));
    const flatPreconditions = allPreconditions.flat();

    this.renderPreconditions(flatPreconditions);

    const allFulfilled = flatPreconditions.every(p => p.fulfilled);

    // Update status
    statusText.innerHTML += '<br><br>';
    statusText.innerHTML += allFulfilled
      ? '✅ All preconditions fulfilled. You can start the setup.'
      : '❌ Some preconditions are not fulfilled. You are not authorized to run the setup.';

    // Show setup button
    if (allFulfilled) {
      this.startSetupButton.style.display = 'inline-block';
    }
  }

  private renderPreconditions(preconditions: Precondition[]): void {
    const list = document.createElement('ul');
    list.classList.add('list-group');

    preconditions.forEach(p => {
      const item = document.createElement('li');
      item.classList.add('list-group-item', 'd-flex', 'align-items-center');

      const icon = document.createElement('i');
      icon.classList.add('bi', p.fulfilled ? 'bi-check-circle-fill' : 'bi-x-circle-fill', 'me-2');
      icon.classList.add(p.fulfilled ? 'text-success' : 'text-danger');

      const text = document.createElement('span');
      text.textContent = p.description;
      text.classList.add(p.fulfilled ? 'text-success' : 'text-danger');

      item.appendChild(icon);
      item.appendChild(text);
      list.appendChild(item);
    });

    this.container.appendChild(list);
  }


  private async runStep() {
    while (this.currentStepIndex < this.steps.length) {
      const step = this.steps[this.currentStepIndex];
      const completed = await step.isCompleted();
      if (completed) {
        this.currentStepIndex++;
        continue;
      }

      this.container.innerHTML = ''; // Clear previous content
      this.nextButton.disabled = true;
      await step.run(this.container);
      this.nextButton.disabled = false;
      break;
    }

    if (this.currentStepIndex >= this.steps.length) {
      // Setup is completed
      window.location.hash = '!/settings';
    }

  }

  private next() {
    this.currentStepIndex++;
    this.runStep();
  }

  private showCompletedNotice() {
    const alert = document.createElement('div');
    alert.className = 'alert alert-info';
    alert.textContent = 'Setup has already been completed.';
    this.container.appendChild(alert);
  }
}
