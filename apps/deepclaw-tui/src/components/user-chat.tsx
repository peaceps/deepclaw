import { ReactElement, useMemo } from 'react';
import {TextInput} from './input/text-input';
import { i18nInstance } from '@deepclaw/i18n';
import {useTranslation} from 'react-i18next';
import {DEFAULT_LANG} from '@deepclaw/utils';

export function UserChat({
    seed,
    onEnter,
    onExit,
}: {
    seed: number;
    onEnter: (input: string) => void;
    onExit?: () => void;
}): ReactElement {
    const {t} = useTranslation();
    const soupLength = useMemo(() => i18nInstance.getResourceBundle(
        i18nInstance.resolvedLanguage || DEFAULT_LANG, 'translation'
    )?.soup?.length || 0, []);
    const initialSeed = useMemo(() => Math.floor(Math.random() * soupLength), []);

    const crypted = !seed ? initialSeed : seed;
    const soup = t(`soup.${crypted % soupLength}`);
    return (
        <TextInput onEnter={onEnter} onExit={onExit} placeholder={`${soup}...`}/>
    );
}
