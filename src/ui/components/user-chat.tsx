import { ReactElement } from 'react';
import {TextInput} from './input/text-input';

const SOUP = [
    '每一次提问，都是向未知世界迈出的一步',
    '别急，慢慢想——好的答案，往往诞生于安静的时刻',
    '你的思考，比任何答案都更珍贵',
    '停下来，并非停顿，而是为下一个想法积蓄力量',
    '在你犹豫的时候，可能性正在悄悄生长',
    '问题越清晰，答案越靠近',
    '真正重要的不是我说什么，而是你想问什么',
    '耐心等待你的声音，就像等待一朵花慢慢打开',
    '勇敢说出你的疑惑吧，那里藏着成长的种子',
    '安静中，你与自己对话；然后，我们再开始',
    '每一次输入，都是你与这个世界更深的一次连接',
    '思考的空隙里，往往藏着最亮的灵感',
];

const INITIAL_SEED = Math.floor(Math.random() * SOUP.length);

export function UserChat({
    seed,
    onEnter,
    onExit,
}: {
    seed: number;
    onEnter: (input: string) => void;
    onExit?: () => void;
}): ReactElement {
    const crypted = !seed ? INITIAL_SEED : seed;
    const soup = SOUP[crypted % SOUP.length];
    return (
        <TextInput onEnter={onEnter} onExit={onExit} placeholder={`${soup}...`}/>
    );
}
