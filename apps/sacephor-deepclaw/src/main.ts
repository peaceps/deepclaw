import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { uptime } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import meow from 'meow';

const cli = meow(`
	Usage
	  $ deepclaw start
	  $ deepclaw stop

	Options
	  --foreground  Keep the web ui in this terminal instead of leaving it running behind
	  --tui         Terminal ui instead of the web ui, which stays in this terminal either way
	  --port        Port of the web ui, 3000 unless another one is named
	  --host        Address the web ui binds to, localhost by default

	Examples
	  $ deepclaw start
	  $ deepclaw stop
	  $ deepclaw start --tui
`,
	{
		importMeta: import.meta,
		flags: {
			tui: {
				type: 'boolean',
				default: false,
			},
			foreground: {
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

/**
 * Where everything of deepclaw is kept. An installed build has been told: `bin/cli.js` names the
 * home and changes into it before this bundle is loaded. The fallback is for a launcher run out
 * of a checkout, and it is the working directory because that is what the rest of the code falls
 * back to as well — the record of a run belongs beside the data of that run, not in a home that
 * nothing there is using.
 */
const home = process.env['DEEPCLAW_HOME'] || process.cwd();

/**
 * What a run in the background leaves behind: who it is, and what it had to say. Both sit at the
 * top of the home rather than in `.logs/`, which is rotated by the app itself and swept of every
 * file whose name it does not know — this one is written to for as long as the server lives.
 */
const pidFile = join(home, 'deepclaw.pid');
const consoleLog = join(home, 'console.log');

/** The port the web ui takes when none is named, printed so the address is a whole one. */
const DEFAULT_PORT = '3000';

/**
 * Windows, where a process has no signal to be sent, no children that go down with it and no
 * command line anybody can read off it. Everything about stopping a run differs there.
 */
const onWindows = process.platform === 'win32';

/** Linux, the one system that hands over what it knows of a process as a file to read. */
const onLinux = process.platform === 'linux';

/** How long a server has to close what it holds open before it is taken down where it stands. */
const STOP_GRACE_MS = 10_000;

/** How often the stopping process is asked whether it is gone yet. */
const STOP_POLL_MS = 100;

/**
 * How long a server is watched before its start is called a success. A port already taken is the
 * failure to expect and it comes at once; a start that goes wrong later says so in the console
 * log, which is where anybody would look for it anyway.
 */
const SETTLE_MS = 1_000;

/**
 * How far apart two readings of the moment this machine came up may be and still be the one
 * moment. A reading is the clock now less how long the machine says it has been up, and both ends
 * of that move a little: uptime is counted in whole seconds, and a clock kept straight against a
 * time server is nudged by seconds more. A minute is well past both of those, and well short of
 * the jumps that are worth doubting a reading over.
 */
const SAME_BOOT_MS = 60_000;

/**
 * A deepclaw left running: the pid, a mark of what was under it when the record was written, and
 * the moment the machine came up. Both of those are there because a pid says less than it looks —
 * the system hands it out again once the process is done with it, and the only thing worse than
 * failing to stop deepclaw is stopping whatever came after it. What the mark is, `markOf` says.
 *
 * The command line is a note and nothing reads it. It is here for whoever opens the file after
 * being told to look at the pid themselves, which is a thing to be told in front of a record that
 * says what it was written for rather than one holding a number and a mark of the system's.
 */
type RunningDeepclaw = { pid: number, mark: string, booted: number, command: string };

/** How the web ui is run, apart from whether it is run in front of you or behind you. */
type WebProcess = { args: string[], cwd: string, env: NodeJS.ProcessEnv };

/** How a run ended: of its own accord once asked, or taken down for not going. */
type Ending = 'stopped' | 'killed' | undefined;

/**
 * What a record still stands for: the run it names, nothing at all, or a pid nothing here can
 * vouch for. The third is not the second — it is the answer nobody has, and it carries what the
 * doubt is, there being more than one way to arrive at it and a different thing to look at behind
 * each. The user is being sent to look at a pid; what to look for goes with them.
 */
type Standing = {of: 'running'} | {of: 'gone'} | {of: 'unknown', doubt: string};

/** Bundled code cannot find the resources it was shipped with, so they are named here. */
function withResources(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	return existsSync(shippedResources) ? {...env, DEEPCLAW_RESOURCES: shippedResources} : env;
}

/**
 * The web ui is a server of its own. An installed build runs the one that was built into the
 * package; a checkout runs the app of the workspace, in dev mode, so that a change still shows.
 */
function webProcess(port?: string, host?: string): WebProcess {
	// The web ui asks for no password, so it stays off the network until it is sent there. The
	// address is the plain one rather than the name, which resolves to one family of addresses
	// only and leaves whoever asks for the other with nothing to talk to.
	const address = host ?? '127.0.0.1';
	// shells export a HOSTNAME of their own, which the server would otherwise bind to
	const env = withResources({...process.env, ...(port ? {PORT: port} : {}), HOSTNAME: address});
	return existsSync(shippedWeb) ? shippedWebProcess(env) : webProcessOfCheckout(env, port, address);
}

function shippedWebProcess(env: NodeJS.ProcessEnv): WebProcess {
	return {args: [join(shippedWeb, 'server.js')], cwd: shippedWeb, env};
}

/** The dev server of next takes the address as arguments rather than out of the environment. */
function webProcessOfCheckout(env: NodeJS.ProcessEnv, port: string | undefined, host: string): WebProcess {
	const webDir = join(root, '..', 'deepclaw-web');
	const requireFromWeb = createRequire(join(webDir, 'package.json'));
	const address = [...(port ? ['--port', port] : []), '--hostname', host];
	return {
		args: [requireFromWeb.resolve('next/dist/bin/next'), 'dev', ...address],
		cwd: webDir,
		env,
	};
}

/** The terminal it was started from is the terminal it runs in, and closing that closes it. */
function runInFront(web: WebProcess): void {
	watch(spawn(process.execPath, web.args, {cwd: web.cwd, env: web.env, stdio: 'inherit'}));
}

/**
 * The server, not this launcher, is the process left running: nothing of deepclaw stays between
 * you and it, and `stop` has the server's own pid to send its signal to.
 */
async function runBehind(web: WebProcess, port: string | undefined, host: string | undefined): Promise<void> {
	if (!nothingRunning()) {
		return;
	}
	mkdirSync(home, {recursive: true});
	// Opened from the top each time. This is what the server said on its way down the one morning
	// it did not come up, not a log to keep: the log of the app itself is kept and rotated in
	// `.logs/`, and there is no reading of a file that holds every run there has ever been.
	const out = openSync(consoleLog, 'w');
	const child = spawn(process.execPath, web.args, {
		cwd: web.cwd,
		env: web.env,
		detached: true,
		stdio: ['ignore', out, out],
		// a detached start on windows is otherwise a console window opening on nothing
		windowsHide: true,
	});
	// the child was handed its own copy of the file, and this one keeps the process here alive
	closeSync(out);
	if (!child.pid) {
		console.error('deepclaw: the web ui could not be started.');
		process.exit(1);
		return;
	}
	const mark = markOf(child.pid) ?? '';
	// written before the waiting rather than after it: a launcher that is itself killed in that
	// second would otherwise leave a server behind that nothing names
	writeFileSync(pidFile, JSON.stringify({
		pid: child.pid, mark, booted: bootedAt(), command: web.args.join(' '),
	}));
	const fell = await settle(child);
	child.unref();
	if (fell !== undefined) {
		rmSync(pidFile, {force: true});
		console.error(`deepclaw: the web ui stopped as it started, with ${fell}. It says why in ${consoleLog}.`);
		process.exit(1);
		return;
	}
	console.log(`deepclaw is running on http://${host ?? '127.0.0.1'}:${port ?? DEFAULT_PORT}, pid ${child.pid}.`);
	console.log(`It says what it has to say in ${consoleLog}, and "deepclaw stop" stops it.`);
	// Said now rather than left for the stop that will not work. Nothing about the server is wrong
	// and there is no reason to hold the start up over it, but a run nothing can identify is a run
	// nothing may signal, and finding that out is better done before it is the thing being asked for.
	if (!mark) {
		console.error(`deepclaw: this system would say nothing of pid ${child.pid}, so "deepclaw stop" will not stop this one. Stopping it is yours to do; the record is ${pidFile}.`);
	}
}

/** The moment this machine came up, as near as the clock and the uptime together can place it. */
function bootedAt(): number {
	return Date.now() - uptime() * 1000;
}

/**
 * Whether there is nothing already running for this start to collide with. A second server on the
 * same port and the same data is worth this much care: where the record names something that
 * cannot be identified, the start is refused rather than risked, and says what to look at.
 */
function nothingRunning(): boolean {
	const running = readRunning();
	if (!running) {
		return true;
	}
	const standing = standingOf(running);
	if (standing.of === 'gone') {
		return true;
	}
	console.error(standing.of === 'running'
		? `deepclaw: already running, pid ${running.pid}. Stop it with: deepclaw stop`
		: `deepclaw: pid ${running.pid} is taken and ${standing.doubt}. Look at it, and take ${pidFile} away if it is not deepclaw.`);
	process.exit(1);
	return false;
}

/**
 * The code a server left with, if it left at once, and nothing if it is still up after a moment.
 * Handing back an address for a server that is already gone is the failure this catches: with the
 * console no longer inherited, a port already taken would otherwise read as a start that worked.
 */
function settle(child: ChildProcess): Promise<number | undefined> {
	return new Promise((resolve) => {
		const enough = setTimeout(() => resolve(undefined), SETTLE_MS);
		child.once('exit', (code) => {
			clearTimeout(enough);
			resolve(code ?? 1);
		});
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

/** What the last start left behind, or nothing when there is no record or none that can be read. */
function readRunning(): RunningDeepclaw | undefined {
	try {
		const running = JSON.parse(readFileSync(pidFile, 'utf8')) as RunningDeepclaw;
		return running.pid ? running : undefined;
	} catch {
		return undefined;
	}
}

/**
 * What a record still stands for. A pid says less than it looks — the system hands it out again
 * once the process is done with it — so the mark taken at the start is asked for again and the
 * two are compared. Where the system will not say, the answer is that nobody knows, never a guess
 * that it is ours: the one thing worse than failing to stop deepclaw is stopping whatever came
 * after it. A record from a start that could not be marked is that same nobody knows.
 */
function standingOf(running: RunningDeepclaw): Standing {
	if (!there(running.pid)) {
		return {of: 'gone'};
	}
	if (!running.mark || !running.booted) {
		return {of: 'unknown', doubt: 'the record does not say what was started under it'};
	}
	const mark = markOf(running.pid);
	if (!mark) {
		return {of: 'unknown', doubt: 'this system will not say what that pid is'};
	}
	if (mark !== running.mark) {
		return {of: 'gone'};
	}
	if (!sameBoot(running.booted)) {
		return {of: 'unknown', doubt: 'the record was written before this machine came up'};
	}
	return {of: 'running'};
}

/**
 * Whether the record was written since this machine came up. A mark that matches across a restart
 * is a mark that cannot tell: windows says no more than `node.exe` of any pid, so a record from
 * before a restart matches whatever node holds that number now, and a machine of node processes is
 * every windows machine deepclaw runs on. A pid does not live through a restart, so a machine that
 * has been up and down since is a pid that is somebody else's.
 *
 * Nobody knows rather than gone, though, which is the other way round from a mark that differs.
 * The moment a machine came up is not read anywhere, it is the clock less an uptime, and the clock
 * is the end of that which moves on its own: a time server pulling it a long way at once, a virtual
 * machine coming back from a snapshot, a dual boot writing local time into the hardware clock. Any
 * of those reads as another boot with nothing having gone down. The uptime is the steady end, sleep
 * counted into it on all three of these systems, so an opened lid is not one of them. Doubt leaves
 * the record alone and hands the pid to the user; gone would clear the record of a server that is
 * still up, which is the failure this whole scheme is here to avoid.
 */
function sameBoot(booted: number): boolean {
	return Math.abs(bootedAt() - booted) < SAME_BOOT_MS;
}

/**
 * Whether anything at all holds that pid. A signal of zero asks after a process without sending
 * it anything, and being turned away for want of permission is somebody else's process, which is
 * as good as gone to us.
 */
function there(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/**
 * Something the system says about a pid that stays the same for as long as that process lives and
 * that the process cannot write itself. The moment it began is that, on the unixes: a pid handed
 * out again is a process that began later, so the pair of the two is an identity.
 *
 * The command line was this until it was found not to be. Node writes `process.title` into the
 * memory the command line is read out of, and the web server renames itself `next-server` as it
 * comes up, so a record written at the start matched nothing a minute later and stop declared its
 * own server gone. Nothing a process says of itself can be the mark.
 *
 * Windows will not be asked the moment cheaply, and gives the name of the program instead, which
 * still tells a node from a service and is no less than was asked of it before.
 */
function markOf(pid: number): string | undefined {
	try {
		if (onWindows) {
			return programOf(execFileSync('tasklist', ['/fi', `pid eq ${pid}`, '/fo', 'csv', '/nh'], {encoding: 'utf8'}));
		}
		if (onLinux) {
			return startedAt(readFileSync(`/proc/${pid}/stat`, 'utf8'));
		}
		return execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], {encoding: 'utf8'}).trim() || undefined;
	} catch {
		return undefined;
	}
}

/**
 * The twenty-second field of the line `/proc` keeps for a process, which is the moment it began in
 * the clock ticks since the machine came up. The second field is the name of the program in
 * brackets and the program chose that name, spaces and brackets and all, so the counting starts
 * after the last bracket of the line rather than at the beginning of it.
 */
function startedAt(stat: string): string | undefined {
	return stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/)[19];
}

/** The program of the one row tasklist prints, or nothing where what it printed was no row. */
function programOf(said: string): string | undefined {
	return /^"([^"]+)"/.exec(said.trim())?.[1]?.toLowerCase();
}

async function stop(): Promise<void> {
	const running = readRunning();
	if (!running) {
		console.log('deepclaw is not running.');
		return;
	}
	const standing = standingOf(running);
	if (standing.of === 'unknown') {
		console.error(`deepclaw: nothing was signalled: pid ${running.pid} is taken and ${standing.doubt}. Look at it yourself; the record is ${pidFile}.`);
		process.exit(1);
		return;
	}
	if (standing.of === 'gone') {
		rmSync(pidFile, {force: true});
		console.log(`deepclaw is not running; the record of pid ${running.pid} was left behind.`);
		return;
	}
	const ending = onWindows ? endTheTree(running) : await signalItDown(running);
	if (!ending) {
		return;
	}
	rmSync(pidFile, {force: true});
	console.log(ending === 'killed'
		? `deepclaw would not close and was killed, pid ${running.pid}.`
		: `deepclaw stopped, pid ${running.pid}.`);
}

/**
 * The pid alone is signalled, not the process group the detached start opened. The group is the
 * server's own and taking all of it would be the thorough thing to do, but nothing here can say
 * whose group it is now if the pid has moved on, and the mark speaks for the pid and nothing else.
 * The server takes its own children with it, which is what leaves the group nothing to be for.
 */
async function signalItDown(running: RunningDeepclaw): Promise<Ending> {
	signal(running.pid, 'SIGTERM');
	if (await waitForExit(running)) {
		return 'stopped';
	}
	// ten seconds is long enough for a pid to have gone and been handed on, and SIGKILL is not a
	// thing to send on an answer that old
	const standing = standingOf(running);
	if (standing.of === 'gone') {
		return 'stopped';
	}
	if (standing.of === 'unknown') {
		console.error(`deepclaw: pid ${running.pid} is still taken after ten seconds and ${standing.doubt}, so it was not killed. Look at it yourself; the record is ${pidFile}.`);
		process.exit(1);
		return undefined;
	}
	signal(running.pid, 'SIGKILL');
	return 'killed';
}

/** A process that goes in the moment between being asked after and being signalled has stopped. */
function signal(pid: number, name: NodeJS.Signals): void {
	try {
		process.kill(pid, name);
	} catch {
		// there is nothing left to send it to, which is the end this was working towards
	}
}

/**
 * Windows has no signal to ask a process with — killing is all `process.kill` does there — and no
 * process takes its children down with it, so the workers the server started would be left holding
 * the port. taskkill ends the tree, which is what a signal would have reached on its own.
 */
function endTheTree(running: RunningDeepclaw): Ending {
	try {
		execFileSync('taskkill', ['/pid', String(running.pid), '/t', '/f'], {stdio: 'ignore'});
		return 'stopped';
	} catch {
		console.error(`deepclaw: pid ${running.pid} would not be stopped, and its record is left as it was.`);
		process.exit(1);
		return undefined;
	}
}

/** The pid alone is asked after here: what it is was settled before the signal was sent. */
async function waitForExit(running: RunningDeepclaw): Promise<boolean> {
	for (let waited = 0; waited < STOP_GRACE_MS; waited += STOP_POLL_MS) {
		if (!there(running.pid)) {
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, STOP_POLL_MS));
	}
	return !there(running.pid);
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
if (command === 'stop') {
	await stop();
} else if (command !== 'start') {
	console.error(`deepclaw: there is no ${command} command.`);
	cli.showHelp(1);
} else if (cli.flags.tui) {
	// a terminal ui has nowhere to go in the background, so it stays here whatever was asked for
	await startTui();
} else if (cli.flags.foreground) {
	runInFront(webProcess(cli.flags.port, cli.flags.host));
} else {
	await runBehind(webProcess(cli.flags.port, cli.flags.host), cli.flags.port, cli.flags.host);
}
