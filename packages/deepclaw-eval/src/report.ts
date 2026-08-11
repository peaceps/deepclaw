import type { CaseResult } from './runner';

export type Report = {
    total: number;
    passed: number;
    failed: number;
    cases: CaseResult[];
};

export function newReport(cases: CaseResult[]): Report {
    const passed = cases.filter(result => result.passed).length;
    return {total: cases.length, passed, failed: cases.length - passed, cases};
}

/** A plain text report, because the first reader of an eval run is a person in a terminal. */
export function formatReport(report: Report): string {
    const lines: string[] = [];
    for (const result of report.cases) {
        lines.push(`${result.passed ? 'PASS' : 'FAIL'}  ${result.scenarioId}`);
        for (const grade of result.grades.filter(grade => !grade.passed)) {
            lines.push(`        ${grade.name}${grade.detail ? ` - ${grade.detail}` : ''}`);
        }
        const {turns, toolCalls, failedToolCalls, invokeMs, toolMs, overheadMs, latencyMs, prompt}
            = result.metrics;
        lines.push(`        ${turns} turns, ${toolCalls} tool calls`
            + `${failedToolCalls ? ` (${failedToolCalls} failed)` : ''}`
            + `, invoke ${invokeMs}ms (tools ${toolMs}ms, overhead ${overheadMs}ms)`
            + `, process ${latencyMs}ms`);
        if (prompt.calls) {
            lines.push(`        prompt: ${prompt.calls} calls`
                + `, base ${kb(prompt.firstCallChars)} (system ${kb(prompt.systemChars)}`
                + ` + tools ${kb(prompt.toolsChars)})`
                + `, peak ${kb(prompt.peakCallChars)}, total ${kb(prompt.totalChars)}`
                + ` ~${Math.round(prompt.estInputTokens / 100) / 10}k tok`);
        }
        if (result.home) {
            lines.push(`        sandbox kept at ${result.home}`);
        }
    }
    lines.push('');
    lines.push(`${report.passed}/${report.total} passed`);
    return lines.join('\n');
}

function kb(chars: number): string {
    return `${Math.round(chars / 102.4) / 10}KB`;
}
