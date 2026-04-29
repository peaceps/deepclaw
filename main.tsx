#!/usr/bin/env node
import {render} from 'ink';
import meow from 'meow';
import App, { AppConfig } from './ui/app.js';

const cli = meow(
	`
	Usage
	  $ ink

	Options
		--test  Test mode

	Examples
	  $ ink --test
`,
	{
		importMeta: import.meta,
		flags: {
			test: {
				type: 'boolean',
                optional: true,
                default: false,
			},
		},
	},
);

const appWrapper: AppConfig = {unmount: () => {}, testMode: cli.flags.test};

const {unmount, waitUntilExit} = render(<App app={appWrapper}/>);
appWrapper.unmount = unmount;
await waitUntilExit();
console.log("\n  再见！");
