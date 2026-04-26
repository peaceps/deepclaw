import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const cli = readline.createInterface({ input, output });

async function readLine(prompt: string): Promise<string> {
  return (await cli.question(prompt)).trim();
}

export function readUserInput() {
    return {read: readLine, close: async () => await cli.close()};
}