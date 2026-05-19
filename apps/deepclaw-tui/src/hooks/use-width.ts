import {useMemo} from 'react';
import {useStdout} from 'ink';

export function useWidth(indent: number = 0): number {
    const {stdout} = useStdout();
    const columns = stdout.columns ?? 80;
    return useMemo(() => Math.max(8, columns - indent), [columns, indent]);
}
