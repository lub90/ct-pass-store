
// Menu Button
export function menuButton(icon: string, tooltip: string): string {
  return `
    <button class="btn btn-outline-secondary rounded-circle fs-4" title="${tooltip}">
      <i class="bi bi-${icon}"></i>
    </button>
  `;
}


// Normal Button
export function normalButton(id: string, text: string): string {
  return `
    <div class="text-center">
        <button id="${id}" class="btn btn-primary rounded-pill px-4">${text}</button>
    </div>
  `;
}