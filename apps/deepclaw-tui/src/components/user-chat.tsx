import { ReactElement, useMemo } from 'react';
import {TextInput} from './input/text-input';
import { DEFAULT_LANG } from '@deepclaw/i18n';
import {useTranslation} from 'react-i18next';

const initSeed = Math.random();

export function UserChat({
    seed,
    onEnter,
    onExit,
}: {
    seed: number;
    onEnter: (input: string) => void;
    onExit?: () => void;
}): ReactElement {
    const {t, i18n} = useTranslation();
    const soupLength = useMemo(() => i18n.getResourceBundle(
        i18n.resolvedLanguage || DEFAULT_LANG, 'translation'
    )?.soup?.length || 0, [i18n]);

    const crypted = !seed ? Math.floor(initSeed * soupLength) : seed;
    const soup = t(`soup.${crypted % soupLength}`);
    return (
        <TextInput onEnter={onEnter} onExit={onExit} placeholder={`${soup}...`}/>
    );
}
