import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Turns the workspace into the one package that gets published. Everything the workspace owns
 * is bundled or copied in, so an install pulls nothing of deepclaw from the registry beyond
 * this package, and the third party libraries the bundles still name by hand.
 */

const app = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.join(app, '..', '..');
const web = path.join(repo, 'apps', 'deepclaw-web');
const tui = path.join(repo, 'apps', 'deepclaw-tui');
const release = path.join(app, 'release');

const manifest = read(path.join(app, 'package.json'));

function read(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function run(command) {
    console.log(`\n> ${command}`);
    execSync(command, { cwd: repo, stdio: 'inherit' });
}

function copy(from, to, filter) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    // the workspace links its packages, so what is behind a link is what gets copied
    fs.cpSync(from, to, { recursive: true, dereference: true, ...(filter ? { filter } : {}) });
}

function build() {
    // a stale build would be copied along with the fresh one, the standalone tree is additive
    fs.rmSync(path.join(web, '.next'), { recursive: true, force: true });
    run('pnpm exec tsc -b');
    run('pnpm --filter @deepclaw/web build');
    run('pnpm --filter @deepclaw/tui build');
    run('pnpm --filter @deepclaw/deepclaw build');
}

function assemble() {
    fs.rmSync(release, { recursive: true, force: true });
    copy(path.join(app, 'bin'), path.join(release, 'bin'));
    copy(path.join(app, 'dist', 'deepclaw.js'), path.join(release, 'dist', 'deepclaw.js'));
    copy(path.join(tui, 'dist', 'main.js'), path.join(release, 'dist', 'tui.js'));
    // bundled code has lost sight of its own folder, so the launcher hands these over instead
    copy(path.join(repo, 'packages', 'deepclaw-agent', 'resources'), path.join(release, 'resources'));
    assembleWeb();
    // the readme of the workspace is written for the people who work on it, the one of this app
    // for the people who install it
    copy(path.join(app, 'README.md'), path.join(release, 'README.md'));
    if (fs.existsSync(path.join(repo, 'LICENSE'))) copy(path.join(repo, 'LICENSE'), path.join(release, 'LICENSE'));
}

/**
 * The standalone build traces everything the server requires, but it leaves out what the server
 * only ever serves, and it keeps the shape of the workspace it was built in.
 */
function assembleWeb() {
    const standalone = path.join(web, '.next', 'standalone');
    const shipped = path.join(release, 'web', 'apps', 'deepclaw-web');
    // these two are the store and the links into it, which are laid out again further down;
    // any other node_modules is the build's own doing, such as the aliases it gives externals
    const linked = [
        path.join(standalone, 'node_modules'),
        path.join(standalone, 'apps', 'deepclaw-web', 'node_modules'),
    ];
    copy(standalone, path.join(release, 'web'), from => !linked.includes(path.resolve(from)));
    copy(path.join(web, '.next', 'static'), path.join(shipped, '.next', 'static'));
    copy(path.join(web, 'public'), path.join(shipped, 'public'));
    assembleWebLibraries(standalone);
    if (!fs.existsSync(path.join(shipped, 'server.js'))) {
        throw new Error('the web build produced no standalone server, is output: standalone still set?');
    }
}

/**
 * The store the workspace installs into links every package to every other one, so copying it
 * as it stands is a copy per link. What gets shipped instead is the plain layout node resolves
 * without help: one folder per library, and a folder nested inside its dependent only where two
 * versions of the same library disagree.
 */
function assembleWebLibraries(standalone) {
    const modules = path.join(release, 'web', 'node_modules');
    const store = readStore(path.join(standalone, 'node_modules', '.pnpm'));
    // a link of the store points at the folder the workspace installed into, which holds the
    // whole library rather than the part that was traced, so a library is followed by its name
    const traced = new Map(store.map(library => [identify(library), library]));
    const shipped = library => traced.get(identify(library)) ?? library;

    // the versions the web app itself was linked against are the ones that take the plain spot
    const hoisted = new Map();
    for (const link of leavesOf(path.join(standalone, 'apps', 'deepclaw-web', 'node_modules'))) {
        hoisted.set(link.name, shipped(link));
    }
    for (const library of store) {
        if (!hoisted.has(library.name)) hoisted.set(library.name, library);
    }
    for (const [name, library] of hoisted) {
        copy(library.path, path.join(modules, name));
    }

    for (const library of store) {
        for (const dependency of library.dependencies) {
            if (hoisted.get(dependency.name)?.version === dependency.version) continue;
            const nested = path.join(modules, library.name, 'node_modules', dependency.name);
            copy(shipped(dependency).path, nested);
        }
    }
}

function identify(library) {
    return `${library.name}@${library.version}`;
}

/** Every folder of the store holds one library of its own next to links to the ones it needs. */
function readStore(store) {
    const libraries = [];
    for (const entry of fs.readdirSync(store)) {
        if (entry === 'node_modules') continue;
        const folder = fs.realpathSync(path.join(store, entry));
        const leaves = leavesOf(path.join(folder, 'node_modules'));
        const own = leaves.filter(leaf => leaf.path.startsWith(folder));
        const dependencies = leaves.filter(leaf => !leaf.path.startsWith(folder));
        libraries.push(...own.map(leaf => ({ ...leaf, dependencies })));
    }
    return libraries;
}

/** A scope is a folder rather than a library, so what it holds is what counts. */
function leavesOf(modules) {
    if (!fs.existsSync(modules)) return [];
    const leaves = [];
    for (const entry of fs.readdirSync(modules)) {
        if (entry.startsWith('.')) continue;
        const full = path.join(modules, entry);
        if (entry.startsWith('@')) {
            leaves.push(...fs.readdirSync(full).map(name => named(`${entry}/${name}`, path.join(full, name))));
        } else {
            leaves.push(named(entry, full));
        }
    }
    return leaves;
}

function named(name, full) {
    const real = fs.realpathSync(full);
    return { name, path: real, version: read(path.join(real, 'package.json')).version };
}

/** Whatever a bundle still names at runtime has to be a dependency of the published package. */
function dependenciesOf(...files) {
    const named = new Set();
    for (const file of files) {
        const code = fs.readFileSync(file, 'utf8');
        const patterns = [
            /from\s*["']([^"']+)["']/g,
            /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
            /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
        ];
        for (const pattern of patterns) {
            for (const [, id] of code.matchAll(pattern)) {
                if (!id.startsWith('.') && !isBuiltin(id)) named.add(packageOf(id));
            }
        }
    }
    return named;
}

function isBuiltin(id) {
    return id.startsWith('node:') || builtinModules.includes(id);
}

function packageOf(id) {
    const parts = id.split('/');
    return id.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/**
 * The workspace pins its versions, so the version a package was built against is the one it is
 * published with. A library that no package of the workspace declares is a mistake worth stopping
 * for: it would install as whatever the registry hands out.
 */
function versionsOf(names) {
    const pinned = new Map();
    for (const dir of ['packages', 'apps']) {
        for (const name of fs.readdirSync(path.join(repo, dir))) {
            const file = path.join(repo, dir, name, 'package.json');
            if (!fs.existsSync(file)) continue;
            const { dependencies = {}, devDependencies = {} } = read(file);
            for (const [library, version] of Object.entries({ ...dependencies, ...devDependencies })) {
                if (!version.startsWith('workspace:')) pinned.set(library, version);
            }
        }
    }
    const missing = [...names].filter(name => !pinned.has(name));
    if (missing.length) {
        throw new Error(`no version is pinned in the workspace for: ${missing.join(', ')}`);
    }
    return Object.fromEntries([...names].sort().map(name => [name, pinned.get(name)]));
}

function writeManifest() {
    const dependencies = versionsOf(dependenciesOf(
        path.join(release, 'dist', 'deepclaw.js'),
        path.join(release, 'dist', 'tui.js'),
    ));
    fs.writeFileSync(path.join(release, 'package.json'), `${JSON.stringify({
        name: manifest.name,
        version: manifest.version,
        description: 'Deepclaw, an agent you run yourself, with a web ui and a terminal ui.',
        license: manifest.license,
        type: 'module',
        engines: manifest.engines,
        bin: { deepclaw: 'bin/cli.js' },
        dependencies,
    }, null, 2)}\n`);
    return dependencies;
}

function sizeOf(dir) {
    let bytes = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        bytes += entry.isDirectory() ? sizeOf(full) : fs.statSync(full).size;
    }
    return bytes;
}

// --staged reuses the builds that are already there, which is only worth it while packaging itself
// is what is being worked on
if (!process.argv.includes('--staged')) build();
assemble();
const dependencies = writeManifest();

console.log(`\n${manifest.name} ${manifest.version} is staged in ${release}`);
console.log(`  ${(sizeOf(release) / 1024 / 1024).toFixed(1)} MB`);
console.log(`  depends on ${Object.keys(dependencies).join(', ')}`);
console.log(`\nTo publish it: npm publish ${path.relative(repo, release)}`);
