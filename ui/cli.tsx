#!/usr/bin/env node
import React from 'react';
import {render} from 'ink';
import meow from 'meow';
import App from './app.js';

const cli = meow(
	`
	Usage
	  $ ink

	Options
		--name  Your name

	Examples
	  $ ink --name=Jane
	  Hello, Jane
`,
	{
		importMeta: import.meta,
		flags: {
			name: {
				type: 'string',
			},
		},
	},
);

const appWrapper: { unmount: () => void } = {unmount: () => {}};

const {unmount, waitUntilExit} = render(<App app={appWrapper}/>);
appWrapper.unmount = unmount;
await waitUntilExit();
console.log("再见！");
