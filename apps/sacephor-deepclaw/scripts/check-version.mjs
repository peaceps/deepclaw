import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Refuses a release the tag or the registry disagrees with, before anything is built. What gets
 * published is the version in this manifest, which nothing ties to the tag a release was started
 * from, and a version that is already out is answered by npm with a 403 that names neither of
 * them. The tag is taken from the argument, or from the one github ran this for.
 */

const app = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8'));

const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
const tagged = tag?.replace(/^v/, '');
const spec = `${manifest.name}@${manifest.version}`;

function fail(message) {
    // an annotation is what github pins to the job, anywhere else it is only noise
    console.error(process.env.GITHUB_ACTIONS ? `::error::${message}` : message);
    process.exit(1);
}

function published() {
    try {
        // a version the registry does not have is answered by some versions of npm with an empty
        // success rather than with a 404, so what is read is the output and not the exit code
        return execFileSync('npm', ['view', spec, 'version'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            // windows carries npm as a batch file, which is not something to be run as a program
            shell: process.platform === 'win32',
        }).trim() !== '';
    } catch {
        return false;
    }
}

if (tagged && tagged !== manifest.version) {
    fail(`tag ${tag} asks for ${tagged}, the manifest says ${manifest.version}, and the manifest is what would be published.`);
}

if (published()) fail(`${spec} is already on npm. Raise the version in the manifest and tag that instead.`);

console.log(`${spec} is not on npm yet${tag ? `, and is what ${tag} asks for` : ''}`);
