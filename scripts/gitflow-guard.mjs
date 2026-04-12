import { execSync } from 'node:child_process';

const branchPatterns = [
    /^main$/,
    /^develop$/,
    /^feat\/[a-z0-9][a-z0-9-]*$/,
    /^fix\/[a-z0-9][a-z0-9-]*$/,
    /^docs\/[a-z0-9][a-z0-9-]*$/,
    /^chore\/[a-z0-9][a-z0-9-]*$/,
    /^refactor\/[a-z0-9][a-z0-9-]*$/,
    /^release\/\d{4}\.\d{2}\.\d{2}\.\d+$/,
    /^hotfix\/[a-z0-9][a-z0-9-]*$/,
];

function getBranchName() {
    const explicitBranch = process.argv[2];

    if (explicitBranch) {
        return explicitBranch.trim();
    }

    return execSync('git branch --show-current', { encoding: 'utf8' }).trim();
}

function isValidBranch(branchName) {
    return branchPatterns.some((pattern) => pattern.test(branchName));
}

try {
    const branchName = getBranchName();

    if (!branchName) {
        throw new Error('Unable to determine current git branch.');
    }

    if (!isValidBranch(branchName)) {
        throw new Error(
            [
                `Branch name not allowed by repository Gitflow policy: ${branchName}`,
                'Allowed: main, develop, feat/*, fix/*, docs/*, chore/*, refactor/*, release/YYYY.MM.DD.N, hotfix/*',
            ].join('\n'),
        );
    }

    console.log(`Gitflow branch OK: ${branchName}`);
} catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(message);
    process.exitCode = 1;
}