
export function mainTemplate(): string {
    return `
    <div class="bg-light min-vh-100 d-flex justify-content-center align-items-center" style="height: 100vh; padding: 1vw">
        <div class="card rounded-3 p-4" style="width: 100%; height: 100%">
            <div class="d-flex justify-content-between align-items-center mb-4">
                <h1 class="mb-0 text-primary" id="lubl-title">
                    <!-- Title will be inserted here -->
                </h1>
                <div id='lubl-menu-bar'>
                    <!-- Menu Bar buttons can be inserted here-->
                </div>
            </div>

            <div id="lubl-container" class="mb-4" style="height: 100%">
                <!-- Content will be inserted here -->
            </div>

            <div id="lubl-footer">
                <!-- Stuff that needs to be on the bottom, e.g. progress buttons are inserted here... -->
            </div>


        </div>
    </div>
    `;
}