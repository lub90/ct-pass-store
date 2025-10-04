import {menuButton, normalButton} from './ui/buttons'

export abstract class AbstractController {
  protected readonly pageTitle: string;
  protected readonly title: HTMLElement;
  protected readonly container: HTMLElement;
  protected readonly menuBar: HTMLElement;
  protected readonly footer: HTMLElement;

  constructor(pageTitle: string) {
    this.pageTitle = pageTitle;

    const titleEl = document.getElementById('lubl-title');
    const containerEl = document.getElementById('lubl-container');
    const menuBarEl = document.getElementById('lubl-menu-bar');
    const footerEL = document.getElementById('lubl-footer');

    if (!titleEl || !containerEl || !menuBarEl || !footerEL) {
      throw new Error('Missing required DOM elements for controller initialization.');
    }

    this.title = titleEl;
    this.container = containerEl;
    this.menuBar = menuBarEl;
    this.footer = footerEL;

    this.title.textContent = this.pageTitle;
  }

  // Optional lifecycle hook for subclasses
  abstract init(): void;

  protected addMenuButton(icon: string, tooltip: string, onClick: () => void): HTMLElement {
    const html = menuButton(icon, tooltip);

    const wrapper = document.createElement('div');
    wrapper.innerHTML = html.trim();

    const button = wrapper.firstElementChild as HTMLButtonElement;
    button.onclick = onClick;

    this.menuBar.appendChild(button);
    return button;
  }

  protected addFooterButton(id: string, text: string, onClick: () => void): HTMLElement {
    const html = normalButton(id, text);

    const wrapper = document.createElement('div');
    wrapper.innerHTML = html.trim();

    const button = wrapper.querySelector(`#${id}`) as HTMLButtonElement;
    if (!button) {
        throw new Error(`Button with id "${id}" not found in generated HTML.`);
    }

    button.onclick = onClick;
    this.footer.appendChild(wrapper.firstElementChild!);

    return button;
  }



}
