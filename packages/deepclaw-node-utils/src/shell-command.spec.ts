import {describe, expect, test} from 'vitest';
import {readCommand} from './shell-command';

describe('readCommand', () => {

    test('reads a lone command as the one program it starts', () => {
        expect(readCommand('agent-browser open https://example.com', 'posix')).toEqual({
            acted: [], programs: ['agent-browser']
        });
    });

    test('reads a program named in quotes as the program it names', () => {
        expect(readCommand('"agent-browser" doctor', 'cmd')).toEqual({
            acted: [], programs: ['agent-browser']
        });
    });

    test('reads the program on each side of a pipe', () => {
        expect(readCommand('agent-browser snapshot | head -50', 'posix')).toEqual({
            acted: ['|'], programs: ['agent-browser', 'head']
        });
    });

    /** Two characters, one separator: read as two there would be nothing to run between them. */
    test('reads an and as one separator with a command on either side', () => {
        expect(readCommand('agent-browser open x && agent-browser snapshot', 'posix')).toEqual({
            acted: ['&'], programs: ['agent-browser', 'agent-browser']
        });
    });

    /** Whitespace to read a line by, and a separator all the same, to either shell. */
    test('reads the program on the line after a break', () => {
        const command = 'agent-browser snapshot\nwget http://example.com/x';
        expect(readCommand(command, 'posix')).toEqual({
            acted: ['\n'], programs: ['agent-browser', 'wget']
        });
        expect(readCommand(command, 'cmd')).toEqual({
            acted: ['\n'], programs: ['agent-browser', 'wget']
        });
    });

    test('reads a separator followed by nothing as a command it cannot name', () => {
        expect(readCommand('agent-browser snapshot |', 'posix').programs).toEqual([
            'agent-browser', ''
        ]);
    });

    /**
     * The dollars a browser cli is given are selectors, and single quotes are what a posix shell
     * hands over whole.
     */
    test('hands a posix shell nothing out of single quotes', () => {
        expect(readCommand(`agent-browser eval '$$("a").length | 0'`, 'posix')).toEqual({
            acted: [], programs: ['agent-browser']
        });
    });

    test('still reads a dollar inside double quotes on posix', () => {
        expect(readCommand('agent-browser eval "$HOME"', 'posix').acted).toEqual(['$']);
    });

    test('keeps the separators inside double quotes from a posix shell', () => {
        expect(readCommand('agent-browser eval "a | b; c"', 'posix')).toEqual({
            acted: [], programs: ['agent-browser']
        });
    });

    test('reads a backtick as the posix shell reading a command of its own', () => {
        expect(readCommand('agent-browser eval `whoami`', 'posix').acted).toEqual(['`', '`']);
    });

    test('hands over the character after a backslash on posix', () => {
        expect(readCommand('agent-browser eval "\\$x" \\| y', 'posix')).toEqual({
            acted: [], programs: ['agent-browser']
        });
    });

    /** Cmd knows the double quote alone, so a single quote there guards nothing. */
    test('reads a separator inside single quotes on cmd', () => {
        expect(readCommand(`agent-browser eval 'a & b'`, 'cmd').acted).toEqual(['&']);
    });

    test('keeps the separators inside double quotes from cmd', () => {
        expect(readCommand('agent-browser eval "a & b"', 'cmd')).toEqual({
            acted: [], programs: ['agent-browser']
        });
    });

    /** A dollar is nothing to cmd, quoted or not, so cmd is never told about one. */
    test('reads no dollar on cmd', () => {
        expect(readCommand(`agent-browser eval $('#id')`, 'cmd')).toEqual({
            acted: [], programs: ['agent-browser']
        });
    });

    test('reads a windows path as the path it is rather than an escape', () => {
        expect(readCommand('type C:\\tmp\\out.txt', 'cmd')).toEqual({
            acted: [], programs: ['type']
        });
    });
});
