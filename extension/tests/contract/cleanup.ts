/**
 * Undo steps, run last-in first-out. Every step runs even when an earlier one fails; the failures are thrown together
 * at the end, so a cleanup problem is never hidden. `done` lists what was removed or restored (for the report).
 */
export class Cleanup {
    private steps: { label: string; run: () => Promise<void> }[] = [];
    readonly done: string[] = [];

    add(label: string, run: () => Promise<void>): void {
        this.steps.push({ label, run });
    }

    async runAll(): Promise<void> {
        const failures: string[] = [];
        while (this.steps.length > 0) {
            const step = this.steps.pop()!;
            try {
                await step.run();
                this.done.push(step.label);
            } catch (e) {
                failures.push(`${step.label}: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
        if (this.done.length > 0) console.info(`[contract cleanup] ${this.done.join('; ')}`);
        if (failures.length > 0) {
            console.error(`[contract cleanup] WARNING, check by hand: ${failures.join('; ')}`);
            throw new Error(`Cleanup failed, check the test instance by hand: ${failures.join('; ')}`);
        }
    }
}
