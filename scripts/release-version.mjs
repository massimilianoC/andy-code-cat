import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const releaseFilePath = resolve(process.cwd(), 'RELEASE_VERSION');
const releaseVersionPattern = /^\d{4}\.\d{2}\.\d{2}\.\d+$/;

function readReleaseVersion() {
    return readFileSync(releaseFilePath, 'utf8').trim();
}

function validateReleaseVersion(version) {
    if (!releaseVersionPattern.test(version)) {
        throw new Error(
            'Invalid release version. Expected YYYY.MM.DD.N, for example 2026.04.12.6.',
        );
    }
}

function printUsage() {
    console.log('Usage: node scripts/release-version.mjs <print|validate|set> [version]');
}

function main() {
    const command = process.argv[2] ?? 'print';
    const nextVersion = process.argv[3];

    if (command === 'print') {
        console.log(readReleaseVersion());
        return;
    }

    if (command === 'validate') {
        const currentVersion = readReleaseVersion();
        validateReleaseVersion(currentVersion);
        console.log(`Release version OK: ${currentVersion}`);
        return;
    }

    if (command === 'set') {
        if (!nextVersion) {
            throw new Error('Missing version argument for set command.');
        }

        validateReleaseVersion(nextVersion);
        writeFileSync(releaseFilePath, `${nextVersion}\n`, 'utf8');
        console.log(`Release version updated to ${nextVersion}`);
        return;
    }

    printUsage();
    process.exitCode = 1;
}

try {
    main();
} catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(message);
    process.exitCode = 1;
}