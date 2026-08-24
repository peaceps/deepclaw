import process from 'node:process';

/**
 * Which shell a command line is handed to. The two do not agree on what a quote is, and a guard
 * that reads a line by its characters alone reads an argument as an operator: a browser driven by
 * a cli spends its arguments on css selectors and javascript, where a dollar is a dollar.
 */
export type CommandShell = 'posix' | 'cmd';

/** The shell commands are actually run in, which is the one whose rules apply to reading them. */
export const commandShell: CommandShell = process.platform === 'win32' ? 'cmd' : 'posix';

/**
 * What the shell reads for itself, splitting one line into several commands. A line break is one
 * of them to both shells: read as the whitespace it also is, everything past the first line of a
 * command would be a command nobody ever saw.
 */
export const COMMAND_SEPARATORS = [';', '|', '&', '\n'];

export type CommandRead = {
    /**
     * The characters the shell would act on rather than hand to a program, in the order they
     * stand. A line holding none of them is the one command it appears to be.
     */
    acted: string[];
    /**
     * The first word of each command the line holds. Empty where a separator is followed by
     * nothing to run, which is a line to be read as no command at all rather than as none.
     */
    programs: string[];
};

/**
 * Reads a command line the way the shell that runs it would: what it would keep for itself, and
 * what program each part of it would start. Only the shell's own reading is followed here, and no
 * judgement is passed on any of it.
 *
 * A posix shell keeps everything inside single quotes whole, keeps the separators inside double
 * quotes but still reads a dollar or a backtick there, and a backslash outside single quotes hands
 * the character after it over untouched. Cmd knows only the double quote, and a dollar is nothing
 * to it, so a dollar is never read as its own. Cmd's own way of naming a variable, a percent on
 * either side of it, went unguarded before this and goes unguarded still.
 */
export function readCommand(command: string, shell: CommandShell = commandShell): CommandRead {
    const posix = shell === 'posix';
    const acted: string[] = [];
    const programs: string[] = [];
    let word = '';
    let started = false;
    let quote: '"' | '\'' | undefined;

    const endWord = () => {
        if (!started && word) {
            programs.push(word);
            started = true;
        }
        word = '';
    };
    const endCommand = (separator: string) => {
        endWord();
        if (!started) {
            programs.push('');
        }
        acted.push(separator);
        started = false;
    };

    for (let index = 0; index < command.length; index++) {
        const char = command[index]!;
        if (posix && char === '\\' && quote !== '\'') {
            word += command[++index] ?? '';
            continue;
        }
        if (quote) {
            if (char === quote) {
                quote = undefined;
            } else if (posix && quote === '"' && (char === '$' || char === '`')) {
                acted.push(char);
            } else {
                word += char;
            }
            continue;
        }
        if (char === '"' || (posix && char === '\'')) {
            quote = char as '"' | '\'';
            continue;
        }
        if (COMMAND_SEPARATORS.includes(char)) {
            // Doubled, it is still the one separator: "and" and "or" are written that way, and
            // reading them as two would leave nothing to run between them.
            if (command[index + 1] === char) {
                index++;
            }
            endCommand(char);
            continue;
        }
        if (posix && (char === '$' || char === '`')) {
            acted.push(char);
            continue;
        }
        if (/\s/.test(char)) {
            endWord();
            continue;
        }
        word += char;
    }
    endWord();
    if (!started) {
        programs.push('');
    }
    return {acted, programs};
}
