import meow from 'meow';

const cli = meow(`
	Usage
	  $ deepclaw

	Options
		--headless  Headless mode with IM
        --tui       TUI mode

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
				default: true,
			}
		},
	},
);

if (cli.flags.headless) {
    void import('./headless.js');
} else if (cli.flags.tui) {
	void import('@deepclaw/tui');
}
