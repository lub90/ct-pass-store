/** Another save changed the value since it was read. `current` is the stored revision. */
export class ConflictError extends Error {
    current: number;
    constructor(current: number) {
        super(`The value was changed meanwhile (revision ${current})`);
        this.name = 'ConflictError';
        this.current = current;
    }
}

/** The JSON of a value exceeds ChurchTools' limit; thrown before anything is written. */
export class ValueTooLargeError extends Error {
    size: number;
    constructor(size: number, limit: number) {
        super(`The value has ${size} characters, the limit is ${limit}`);
        this.name = 'ValueTooLargeError';
        this.size = size;
    }
}

/** A value to save doesn't match its schema; thrown before anything is written. */
export class InvalidValueError extends Error {
    issues: string[];
    constructor(issues: string[]) {
        super(`Invalid value: ${issues.join('; ')}`);
        this.name = 'InvalidValueError';
        this.issues = issues;
    }
}

/** The category to write to doesn't exist (created by the setup wizard, not here). */
export class CategoryMissingError extends Error {
    constructor(name: string) {
        super(`Category "${name}" does not exist`);
        this.name = 'CategoryMissingError';
    }
}
