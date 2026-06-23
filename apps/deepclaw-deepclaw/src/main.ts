import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import meow from 'meow';

const cli = meow(`
	Usage
	  $ deepclaw

	Options
		--headless  Headless mode with IM
        --tui       TUI mode
        --web       Web mode (next start; run build in apps/deepclaw-web first)

	Examples
	  $ deepclaw --headless
`,
	{
		importMeta: import.meta,
		flags: {
			headless: {
				type: 'boolean',
                optional: true,
                default: false,
			},
			tui: {
				type: 'boolean',
				optional: true,
				default: false,
			},
			web: {
				type: 'boolean',
				optional: true,
				default: true,
			}
		},
	},
);

/** `apps/deepclaw-web` — works from both `src/main.ts` (tsx) and `dist/deepclaw.js` (rollup). */
function resolveWebAppDir(): string {
	const here = dirname(fileURLToPath(import.meta.url));
	return join(here, '..', '..', 'deepclaw-web');
}

function startNextStart(): void {
	const webDir = resolveWebAppDir();
	const requireFromWeb = createRequire(join(webDir, 'package.json'));
	const nextBin = requireFromWeb.resolve('next/dist/bin/next');
	const child = spawn(process.execPath, [nextBin, 'dev'], {
		cwd: webDir,
		stdio: 'inherit',
	});
	child.on('exit', (code, signal) => {
		if (signal) {
			process.kill(process.pid, signal);
			return;
		}
		process.exit(code ?? 1);
	});
}

if (cli.flags.headless) {
    void import('@deepclaw/headless');
} else if (cli.flags.web) {
	startNextStart();
} else if (cli.flags.tui) {
	void import('@deepclaw/tui');
}
