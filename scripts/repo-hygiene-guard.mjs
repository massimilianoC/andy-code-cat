/**
 * repo-hygiene-guard — enforces the rules in AGENTS.md ("Repository Hygiene" and
 * "Language") against what is actually tracked by git.
 *
 * This exists because those rules were stated for months and silently broken the
 * whole time: AGENTS.md claimed debug/ was gitignored when only debug/sample/ was,
 * and sixty-nine scratch artifacts reached the public repository. A rule nothing
 * checks is a preference.
 *
 * Run: npm run hygiene:guard
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// ─── What must never be tracked ──────────────────────────────────────────────

const forbiddenPaths = [
    { pattern: /^\.playwright-mcp\//, reason: 'Playwright MCP session dumps are scratch, not deliverables' },
    { pattern: /^debug\//, reason: 'debug/ is exploratory work and is gitignored' },
    { pattern: /^[^/]+\.(png|jpe?g|gif|webp)$/i, reason: 'images belong under docs/, never in the repository root' },
    { pattern: /\.(bak|orig|rej|swp)$/i, reason: 'editor and one-off backup files' },
    { pattern: /~$/, reason: 'editor backup files' },
    { pattern: /\.tsbuildinfo$/i, reason: 'TypeScript build artifact' },
    { pattern: /^health_test\.json$/, reason: 'throwaway probe file' },
    { pattern: /^(?!\.env\.example$|\.env\.deploy\.example$)\.env(\..+)?$/, reason: 'only .env*.example may be tracked — never a real environment file' },
];

// ─── Language ────────────────────────────────────────────────────────────────

/**
 * Italian markers with no English homograph. Words that exist in both languages
 * ("come", "sono" as a proper noun, "e") are deliberately excluded: a guard that
 * cries wolf on English prose gets switched off within a week.
 */
const italianMarkers = [
    'perché', 'perche', 'questo', 'questa', 'questi', 'queste', 'quello', 'quella',
    'della', 'dello', 'degli', 'delle', 'nella', 'nello', 'negli', 'nelle',
    'viene', 'vengono', 'deve', 'devono', 'essere', 'abbiamo', 'cioè', 'quindi',
    'oppure', 'senza', 'soltanto', 'anche', 'già', 'può', 'sempre', 'ogni',
    'dell', 'nell', 'sull', 'all', 'utente', 'utenti', 'pagina', 'campo',
];

const MARKER_THRESHOLD = 3;

/**
 * Files whose non-English content is product data rather than documentation.
 * Localisation catalogues are the point; prompt modules and seeded copy are
 * product behaviour and are migrated through the i18n layer, not through a
 * hygiene sweep — changing the language of a prompt changes what the model does.
 *
 * Every entry carries a reason. An entry without one is not an exception, it is
 * a hole.
 */
const languageExceptions = [
    { pattern: /^apps\/web\/i18n\//, reason: 'localisation catalogues — non-English by definition' },
    { pattern: /^apps\/api\/src\/domain\/entities\/ProjectPreset\.ts$/, reason: 'Italian preset prompt modules and brief questions: product content pending i18n migration' },
    { pattern: /^apps\/api\/src\/presentation\/http\/routes\/llmRoutes\.ts$/, reason: 'Italian userMessage strings: product copy pending i18n migration' },
    { pattern: /^apps\/api\/src\/application\/llm\/llmMessageBuilder\.ts$/, reason: 'Italian prompt fragments: changing them changes model behaviour' },
    { pattern: /^apps\/api\/src\/application\/platform-runtime\/browserRuntimeAssets\.ts$/, reason: 'Italian runtime copy injected into generated pages' },
    { pattern: /^apps\/web\/app\/admin\/guided-mode\/page\.tsx$/, reason: 'Italian admin copy pending i18n migration' },
    { pattern: /^apps\/api\/src\/application\/use-cases\/ExportLayer1Zip\.ts$/, reason: 'Italian strings written into exported bundles' },
    { pattern: /^apps\/api\/src\/application\/use-cases\/__tests__\//, reason: 'fixtures asserting Italian product copy' },
];

// ─── Checks ──────────────────────────────────────────────────────────────────

function trackedFiles() {
    return execSync('git ls-files', { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
}

function checkForbiddenPaths(files) {
    const failures = [];
    for (const file of files) {
        const hit = forbiddenPaths.find((rule) => rule.pattern.test(file));
        if (hit) failures.push(`${file} — ${hit.reason}`);
    }
    return failures;
}

function countItalianMarkers(text) {
    const found = new Set();
    const lowered = text.toLowerCase();
    for (const marker of italianMarkers) {
        if (new RegExp(`\\b${marker}\\b`, 'u').test(lowered)) found.add(marker);
    }
    return found;
}

function checkLanguage(files) {
    const failures = [];
    const documents = files.filter((file) => file.endsWith('.md'));

    for (const file of documents) {
        if (languageExceptions.some((rule) => rule.pattern.test(file))) continue;
        let text;
        try {
            text = readFileSync(file, 'utf8');
        } catch {
            continue; // deleted in the working tree but still in the index
        }
        const markers = countItalianMarkers(text);
        if (markers.size >= MARKER_THRESHOLD) {
            failures.push(`${file} — ${markers.size} Italian markers (${[...markers].slice(0, 6).join(', ')}…)`);
        }
    }
    return failures;
}

// ─── Report ──────────────────────────────────────────────────────────────────

const files = trackedFiles();
const forbidden = checkForbiddenPaths(files);
const language = checkLanguage(files);

if (forbidden.length) {
    console.error(`\n✖ Tracked files that must not be in the repository (${forbidden.length}):\n`);
    for (const failure of forbidden) console.error(`   ${failure}`);
    console.error('\n  Remove them with `git rm --cached <path>` and confirm .gitignore covers the category.');
}

if (language.length) {
    console.error(`\n✖ Documents that are not in English (${language.length}):\n`);
    for (const failure of language) console.error(`   ${failure}`);
    console.error('\n  Tracked documentation is English. See "Language" in AGENTS.md.');
}

if (forbidden.length || language.length) {
    console.error(`\nrepo-hygiene-guard failed: ${forbidden.length + language.length} problem(s).\n`);
    process.exit(1);
}

console.log(`repo-hygiene-guard passed — ${files.length} tracked files, ${languageExceptions.length} recorded language exceptions.`);
