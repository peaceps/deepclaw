import { ReactElement } from 'react';
import {TextInput} from './input/text-input';
import i18n from 'i18next';
import {useTranslation} from 'react-i18next';

const soupLength = (i18n as any).store.data[i18n.language!]['translation']['soup'].length;

const INITIAL_SEED = Math.floor(Math.random() * soupLength);

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
    const crypted = !seed ? INITIAL_SEED : seed;
    const soup = t(`soup.${crypted % soupLength}`);
    return (
        <TextInput onEnter={onEnter} onExit={onExit} placeholder={`${soup}...`}/>
    );
}
