import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import meow from 'meow';

const cli = meow(`
	Usage
	  $ deepclaw start

	Options
	  --tui       Terminal ui instead of the web ui
	  --port      Port of the web ui, 3000 unless another one is named
	  --host      Address the web ui binds to, localhost by default

	Examples
	  $ deepclaw start
	  $ deepclaw start --tui
`,
	{
		importMeta: import.meta,
		flags: {
			tui: {
				type: 'boolean',
				default: false,
			},
			port: {
				type: 'string',
			},
			host: {
				type: 'string',
			},
		},
	},
);

/**
 * The folder the launcher was shipped in: `<package>` for an installed build, where this file
 * runs as `dist/deepclaw.js`, and `apps/sacephor-deepclaw` in a checkout.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Only an installed build carries these; a checkout reaches the web app and the tui otherwise. */
const shippedWeb = join(root, 'web', 'apps', 'deepclaw-web');
const shippedTui = join(root, 'dist', 'tui.js');
const shippedResources = join(root, 'resources');

/** Bundled code cannot find the resources it was shipped with, so they are named here. */
function withResources(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	return existsSync(shippedResources) ? {...env, DEEPCLAW_RESOURCES: shippedResources} : env;
}

/**
 * The web ui is a server of its own. An installed build runs the one that was built into the
 * package; a checkout runs the app of the workspace, in dev mode, so that a change still shows.
 */
function startWeb(port?: string, host?: string): void {
	// The web ui asks for no password, so it stays off the network until it is sent there. The
	// address is the plain one rather than the name, which resolves to one family of addresses
	// only and leaves whoever asks for the other with nothing to talk to.
	const address = host ?? '127.0.0.1';
	// shells export a HOSTNAME of their own, which the server would otherwise bind to
	const env = withResources({...process.env, ...(port ? {PORT: port} : {}), HOSTNAME: address});
	watch(existsSync(shippedWeb) ? startShippedWeb(env) : startWebOfCheckout(env, port, address));
}

function startShippedWeb(env: NodeJS.ProcessEnv): ChildProcess {
	return spawn(process.execPath, [join(shippedWeb, 'server.js')], {
		cwd: shippedWeb,
		env,
		stdio: 'inherit',
	});
}

/** The dev server of next takes the address as arguments rather than out of the environment. */
function startWebOfCheckout(env: NodeJS.ProcessEnv, port: string | undefined, host: string): ChildProcess {
	const webDir = join(root, '..', 'deepclaw-web');
	const requireFromWeb = createRequire(join(webDir, 'package.json'));
	const address = [...(port ? ['--port', port] : []), '--hostname', host];
	return spawn(process.execPath, [requireFromWeb.resolve('next/dist/bin/next'), 'dev', ...address], {
		cwd: webDir,
		env,
		stdio: 'inherit',
	});
}

function watch(child: ChildProcess): void {
	child.on('exit', (code, signal) => {
		if (signal) {
			process.kill(process.pid, signal);
			return;
		}
		process.exit(code ?? 1);
	});
}

/** The tui shares this process, so what it needs to find has to be named before it loads. */
async function startTui(): Promise<void> {
	if (existsSync(shippedResources)) {
		process.env['DEEPCLAW_RESOURCES'] = shippedResources;
	}
	// a specifier the bundler cannot read is left alone, which is what lets both paths resolve
	const tui = existsSync(shippedTui) ? './tui.js' : '@deepclaw/tui';
	await import(tui);
}

const command = cli.input[0] ?? 'start';
if (command !== 'start') {
	console.error(`deepclaw: there is no ${command} command.`);
	cli.showHelp(1);
}

if (cli.flags.tui) {
	await startTui();
} else {
	startWeb(cli.flags.port, cli.flags.host);
}
