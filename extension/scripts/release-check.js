#!/usr/bin/env node
// Checks an extension release before it is built (spec 13.7, versioning.md): the tag is `extension-v<x.y.z>`;
// package.json, package-lock.json and a dated CHANGELOG.md section `## [x.y.z] - YYYY-MM-DD` all carry that version;
// CHANGELOG.md has no `## [Unreleased]` section; and MAJOR.MINOR equals that of ../backend/VERSION.
// On success it prints the CHANGELOG section (the release notes); otherwise one line per problem on stderr. Exits 0 or 1.
// Usage: node scripts/release-check.js <tag> [extension folder]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const VERSION = /^\d+\.\d+\.\d+$/;

function read(file) {
    try {
        return fs.readFileSync(file, 'utf8');
    } catch {
        return null;
    }
}

function readJson(file) {
    try {
        return JSON.parse(read(file) ?? '');
    } catch {
        return null;
    }
}

function isRealDate(text) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
    const date = new Date(`${text}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

const majorMinor = (version) => version.split('.').slice(0, 2).join('.');

/**
 * Checks the release `tag` against the extension folder `extensionDir` (with `../backend/VERSION` next to it).
 * Returns every problem found, and the CHANGELOG section as notes (empty when there are problems).
 */
export function checkRelease(tag, extensionDir) {
    const match = /^extension-v(\d+\.\d+\.\d+)$/.exec(tag);
    if (!match) return { problems: [`tag "${tag}" is not extension-vMAJOR.MINOR.PATCH`], notes: '' };
    const version = match[1];
    const problems = [];
    const expect = (what, found) => {
        if (typeof found !== 'string') problems.push(`${what} is missing or has no version`);
        else if (found !== version) problems.push(`${what} has version ${found}, the tag ${tag} needs ${version}`);
    };

    const pkg = readJson(path.join(extensionDir, 'package.json'));
    expect('package.json', pkg?.version);

    const lock = readJson(path.join(extensionDir, 'package-lock.json'));
    expect('package-lock.json', lock?.version);
    if (typeof lock?.version === 'string' && lock.packages?.[''] !== undefined) {
        const root = lock.packages[''].version;
        if (root !== version) problems.push(`package-lock.json (packages[""]) has version ${root}, the tag ${tag} needs ${version}`);
    }

    const lines = (read(path.join(extensionDir, 'CHANGELOG.md')) ?? '').split(/\r?\n/);
    const headings = lines.map((line, i) => [line, i]).filter(([line]) => line.startsWith('## '));
    if (headings.some(([line]) => /^## \[Unreleased\]/i.test(line))) {
        problems.push('CHANGELOG.md still has an "## [Unreleased]" section');
    }
    let notes = '';
    const own = headings.findIndex(([line]) => line === `## [${version}]` || line.startsWith(`## [${version}] `));
    if (own === -1) {
        problems.push(`CHANGELOG.md has no section "## [${version}] - YYYY-MM-DD"`);
    } else {
        const [heading, start] = headings[own];
        const date = heading.slice(`## [${version}]`.length).replace(/^ - /, '').trim();
        if (!isRealDate(date)) {
            problems.push(`CHANGELOG.md: section [${version}] has no valid date (YYYY-MM-DD), found "${date}"`);
        } else {
            const end = headings[own + 1]?.[1] ?? lines.length;
            notes = lines.slice(start + 1, end).join('\n').trim();
            if (notes === '') problems.push(`CHANGELOG.md: section [${version}] is empty`);
        }
    }

    const backend = (read(path.join(extensionDir, '..', 'backend', 'VERSION')) ?? '').trim();
    if (!VERSION.test(backend)) {
        problems.push('backend/VERSION is missing or has no version x.y.z');
    } else if (majorMinor(backend) !== majorMinor(version)) {
        problems.push(`MAJOR.MINOR ${majorMinor(version)} differs from the backend's ${majorMinor(backend)} (backend/VERSION ${backend}, versioning.md)`);
    }

    return problems.length ? { problems, notes: '' } : { problems, notes: `${notes}\n` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    if (process.argv.length < 3) {
        console.error('Usage: node scripts/release-check.js <tag> [extension folder]');
        process.exit(1);
    }
    const { problems, notes } = checkRelease(process.argv[2], path.resolve(process.argv[3] ?? path.join(import.meta.dirname, '..')));
    if (problems.length) {
        console.error(problems.join('\n'));
        process.exit(1);
    }
    process.stdout.write(notes);
}
