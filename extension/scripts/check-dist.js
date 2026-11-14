#!/usr/bin/env node
// Post-build guard (spec 13.5): rules a normal build would silently break.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? walk(full) : [full];
    });
}

/**
 * Checks a build folder and returns the list of failures (empty when it passes). `demoStrings`: texts of the demo data
 * (`src/dev/demo-data.ts`) that must not appear anywhere in the build.
 */
export function checkDist(dist, { demoStrings = [] } = {}) {
    const failures = [];
    const files = walk(dist);
    // Everything that is not a known binary type is scanned as text: sourcemaps, licence texts, JSON, SVG, ...
    const binary = /\.(png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|eot|zip|gz|br|pdf)$/i;
    const text = files.filter((f) => !binary.test(f));
    const rel = (f) => path.relative(dist, f);

    // 1. One bundle: a tab must never request a chunk an update has deleted.
    const scripts = files.filter((f) => /\.(js|mjs|cjs)$/.test(f));
    if (scripts.length !== 1) {
        failures.push(`expected exactly one JavaScript bundle, found ${scripts.length}: ${scripts.map(rel).join(', ')}`);
    }

    // 2. No inline script: the ChurchTools CSP has no 'unsafe-inline' in script-src.
    const indexHtml = path.join(dist, 'index.html');
    if (!fs.existsSync(indexHtml)) {
        failures.push('index.html missing');
    } else {
        for (const tag of fs.readFileSync(indexHtml, 'utf8').match(/<script\b[^>]*>/gi) ?? []) {
            if (!/\bsrc=/.test(tag)) failures.push(`inline script in index.html: ${tag}`);
        }
    }

    // 3. No instance host: the package is meant for other congregations too.
    for (const file of text) {
        const content = fs.readFileSync(file, 'utf8');
        for (const host of content.match(/[a-z0-9-]+\.church\.tools/gi) ?? []) {
            if (host.toLowerCase() !== 'example.church.tools') failures.push(`instance host "${host}" in ${rel(file)}`);
        }
        for (const key of ['CT_LOGIN_TOKEN', 'VITE_PASSWORD', 'VITE_USERNAME', 'VITE_BASE_URL']) {
            if (content.includes(key)) failures.push(`dev credential key "${key}" in ${rel(file)}`);
        }
    }

    // 4. Fonts only from the own bundle: a font service would learn of every device.
    const fontServices = /fonts\.(googleapis|gstatic)\.com|use\.typekit\.net|fonts\.bunny\.net/i;
    const remoteFontFace = /@font-face\s*{[^}]*url\(\s*['"]?(https?:)?\/\//i;
    for (const file of text) {
        const content = fs.readFileSync(file, 'utf8');
        const hit = content.match(fontServices)?.[0] ?? (remoteFontFace.test(content) && '@font-face with an external url');
        if (hit) failures.push(`external font source "${hit}" in ${rel(file)}`);
    }

    // 5. No demo code or data: every module under src/dev/ carries the marker; it exists for development only.
    for (const file of text) {
        const content = fs.readFileSync(file, 'utf8');
        if (content.includes('__DEMO__')) failures.push(`demo code (__DEMO__) in ${rel(file)}`);
        for (const demo of demoStrings) {
            if (content.includes(demo)) failures.push(`demo data "${demo}" in ${rel(file)}`);
        }
    }

    // 6. Licence texts of the bundled packages travel with the build.
    if (!fs.existsSync(path.join(dist, 'THIRD-PARTY-LICENSES.txt'))) failures.push('THIRD-PARTY-LICENSES.txt missing');

    return failures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const dist = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, '..', 'dist'));
    // Fails closed: without the demo data strings the check would pass silently.
    const { DEMO_STRINGS } = await import('../src/dev/demo-data.ts');
    if (!Array.isArray(DEMO_STRINGS) || DEMO_STRINGS.length === 0) {
        console.error('dist check failed: no demo data strings loaded from src/dev/demo-data.ts');
        process.exit(1);
    }
    const failures = checkDist(dist, { demoStrings: DEMO_STRINGS });
    if (failures.length) {
        console.error('dist check failed:\n  - ' + failures.join('\n  - '));
        process.exit(1);
    }
    console.log('dist check passed (one bundle, no inline script, no instance host, no external fonts, no demo code or data, licenses present)');
}
