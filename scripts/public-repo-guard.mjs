/**
 * public-repo-guard — enforces docs/guides/PUBLIC_REPO_CHECKLIST.md against what git actually
 * tracks. That checklist is the single source of truth for public-repo hygiene; this script does
 * not add rules of its own, it makes the existing ones non-optional.
 *
 * It fails the build when:
 *   1. a junk path (Playwright MCP dumps, debug/, root screenshots, editor/build scratch) is
 *      tracked or staged;
 *   2. a real `.env*` file (anything but `*.example`) is tracked or staged;
 *   3. a private-infrastructure path from checklist §2 is tracked or staged — with the one
 *      documented exception, `nginx/sites-enabled/local.conf`;
 *   4. a newly added `.md` file is predominantly Italian.
 *
 * Check 4 is diff-based on purpose: 26 pre-existing documents are known, recorded debt (see
 * checklist §6) and must not fail every future run. The guard only looks at what a change adds,
 * so it enforces "do not make it worse" rather than "retroactively fail on old debt".
 *
 * Run: npm run guard:public-repo
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function run(cmd) {
    return execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
}

function tryRun(cmd) {
    try {
        return run(cmd);
    } catch {
        return null;
    }
}

function lines(text) {
    return (text ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
}

// ─── 1) Junk paths that must never be tracked or staged ──────────────────────

const junkPathRules = [
    { pattern: /^\.playwright-mcp\//, reason: 'Playwright MCP session dump — scratch, not a deliverable' },
    { pattern: /^debug\//, reason: 'debug/ is exploratory output and must stay gitignored' },
    { pattern: /^[^/]+\.(png|jpe?g|gif|webp)$/i, reason: 'screenshot at the repository root — documentation images belong under docs/' },
    { pattern: /\.(bak|orig|rej)$/i, reason: 'editor / one-off backup file' },
    { pattern: /~$/, reason: 'editor backup file' },
    { pattern: /\.tsbuildinfo$/i, reason: 'TypeScript build artifact' },
    { pattern: /^health_test\.json$/, reason: 'throwaway probe file' },
];

// ─── 2) Environment files: only *.example may ever be tracked ────────────────

function isForbiddenEnvFile(file) {
    const base = file.split('/').pop() ?? file;
    if (!base.startsWith('.env')) return false;
    return !base.endsWith('.example');
}

// ─── 3) Private infrastructure (checklist §2) ─────────────────────────────────
// nginx/sites-enabled/local.conf is the one documented exception: it is mounted read-only by
// docker-compose.yml, docker-compose.deploy.yml and docker-compose.droplet.yml, and it contains
// nothing sensitive. The rule targets droplet/production vhost configs, not that tracked default.

const privateInfraRules = [
    { pattern: /^docker-compose\.droplet\.yml$/, reason: 'private infrastructure (checklist §2)' },
    { pattern: /^\.deploy\//, reason: 'private infrastructure (checklist §2)' },
    {
        pattern: /^nginx\/sites-enabled\/.*\.conf$/,
        exceptions: [/^nginx\/sites-enabled\/local\.conf$/],
        reason: 'droplet/production nginx vhost config (checklist §2) — only local.conf may be tracked',
    },
    { pattern: /^docs\/deploy\//, reason: 'private infrastructure (checklist §2)' },
    { pattern: /^docs\/review\//, reason: 'private infrastructure (checklist §2)' },
    { pattern: /^docs\/_archive\//, reason: 'private infrastructure (checklist §2)' },
];

// ─── 4) Language — newly added .md files only ─────────────────────────────────

// No homograph with English, so a hit is unambiguous. Fixed by the task: do not add or remove
// words here without re-validating the threshold against checklist §6's known-debt list.
const italianStopwords = ['che', 'per', 'della', 'sono', 'questo', 'quindi', 'viene', 'essere', 'nella', 'anche'];

// Calibrated against the 29 known pre-existing Italian documents (checklist §6): the worst of
// them (heavily-Italian prose, docs/archive/vision/TARGET-VISION_2026-05-14.md) scores ~5.0% on
// this word list; clean English documentation scores ~0-0.2%; freshly-written Italian prose
// scores 10%+. 0.06 sits in the gap so pre-existing debt never trips it, while a genuinely new
// Italian document does.
const ITALIAN_RATIO_THRESHOLD = 0.06;
const MIN_WORDS_TO_JUDGE = 40;

function italianRatio(text) {
    const words = text.toLowerCase().match(/[a-zàèéìòùç]+/gi) ?? [];
    if (words.length < MIN_WORDS_TO_JUDGE) return { ratio: 0, words: words.length, hits: 0 };
    let hits = 0;
    for (const word of words) if (italianStopwords.includes(word)) hits += 1;
    return { ratio: hits / words.length, words: words.length, hits };
}

/**
 * Newly added markdown files: whatever is new relative to the PR's base branch in CI, or
 * relative to the local develop/main tracking branch otherwise, plus anything staged or
 * untracked that isn't in any commit yet (the pre-commit-hook case).
 */
function findBaseRef() {
    const ciBase = process.env.GITHUB_BASE_REF;
    const candidates = [];
    if (ciBase) candidates.push(`origin/${ciBase}`);
    candidates.push('origin/develop', 'origin/main', 'develop', 'main');

    for (const ref of candidates) {
        const resolved = tryRun(`git rev-parse --verify ${ref}`);
        if (!resolved) continue;
        const mergeBase = tryRun(`git merge-base ${ref} HEAD`);
        if (mergeBase) return mergeBase;
    }
    return null;
}

function findNewlyAddedMarkdownFiles() {
    const found = new Set();

    const baseRef = findBaseRef();
    if (baseRef) {
        const diffed = lines(tryRun(`git diff --name-status --diff-filter=A ${baseRef} HEAD -- "*.md"`) ?? '');
        for (const entry of diffed) {
            const file = entry.split('\t').pop();
            if (file) found.add(file);
        }
    }

    // Local pre-commit case: files staged or untracked that are not in HEAD at all yet.
    const staged = lines(tryRun('git diff --cached --name-status --diff-filter=A -- "*.md"') ?? '');
    for (const entry of staged) {
        const file = entry.split('\t').pop();
        if (file) found.add(file);
    }
    const untracked = lines(tryRun('git ls-files --others --exclude-standard -- "*.md"') ?? '');
    for (const file of untracked) found.add(file);

    return [...found];
}

// ─── Checks ────────────────────────────────────────────────────────────────────

function trackedOrStagedFiles() {
    // `git ls-files` reads the index, so it already includes staged-but-uncommitted additions.
    return lines(run('git ls-files'));
}

function checkJunkPaths(files) {
    const failures = [];
    for (const file of files) {
        const hit = junkPathRules.find((rule) => rule.pattern.test(file));
        if (hit) failures.push(`${file} — ${hit.reason}`);
    }
    return failures;
}

function checkEnvFiles(files) {
    return files.filter(isForbiddenEnvFile).map((file) => `${file} — only *.example env files may be tracked`);
}

function checkPrivateInfra(files) {
    const failures = [];
    for (const file of files) {
        const hit = privateInfraRules.find((rule) => rule.pattern.test(file));
        if (!hit) continue;
        if (hit.exceptions?.some((exception) => exception.test(file))) continue;
        failures.push(`${file} — ${hit.reason}`);
    }
    return failures;
}

function checkLanguage() {
    const failures = [];
    for (const file of findNewlyAddedMarkdownFiles()) {
        let text;
        try {
            text = readFileSync(file, 'utf8');
        } catch {
            continue; // added then deleted again before the check ran
        }
        const { ratio, words, hits } = italianRatio(text);
        if (ratio > ITALIAN_RATIO_THRESHOLD) {
            failures.push(
                `${file} — ${(ratio * 100).toFixed(1)}% Italian-stopword density (${hits}/${words} words) — new documents must be in English`,
            );
        }
    }
    return failures;
}

// ─── Report ────────────────────────────────────────────────────────────────────

const files = trackedOrStagedFiles();
const junk = checkJunkPaths(files);
const envFiles = checkEnvFiles(files);
const privateInfra = checkPrivateInfra(files);
const language = checkLanguage();

const sections = [
    ['Tracked junk paths', junk],
    ['Tracked real environment files', envFiles],
    ['Tracked private-infrastructure paths', privateInfra],
    ['Newly added documents that are not in English', language],
];

let failureCount = 0;
for (const [title, failures] of sections) {
    if (!failures.length) continue;
    failureCount += failures.length;
    console.error(`\n✖ ${title} (${failures.length}):\n`);
    for (const failure of failures) console.error(`   ${failure}`);
}

if (failureCount > 0) {
    console.error(
        `\npublic-repo-guard failed: ${failureCount} problem(s). See docs/guides/PUBLIC_REPO_CHECKLIST.md.\n`,
    );
    process.exit(1);
}

console.log(`public-repo-guard passed — ${files.length} tracked files checked.`);
