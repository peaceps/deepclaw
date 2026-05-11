#!/usr/bin/env node
import {render} from 'ink';
import meow from 'meow';
import App, { AppConfig } from './ui/app.js';

const cli = meow(`
	Usage
	  $ npx tsx main.tsx

	Options
		--test  Test mode

	Examples
	  $ npx tsx main.tsx --test
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


/**
 * c:\git下有哪些文件夹
 * c:\workfile下有哪些文件夹 不要递归扫描
 * 给我写一个200字的西班牙语散文吧，主题是马尔克斯作品的文学感想
 * 写一篇CET6的作文范文,主题是学习中的劳逸结合
 * 用js写一个命令行的计算器脚本，支持基本的加减乘除，不需要编译和测试
 * 让一个子agent用js写一个命令行的计算器脚本，支持基本的加减乘除，不需要编译和测试
 * 用js写一个命令行的计算器脚本，支持基本的加减乘除,再用几个测试用例测试它
 * 用一个子agent写一篇200左右的中文短文，题材是初中校园生活，子agent写好以后告诉你内容，你存到d.txt文件里
 * 今天杭州的天气如何
 */