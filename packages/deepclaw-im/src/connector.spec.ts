import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type AgentConfig} from '@deepclaw/config';
import {connectIM} from './connector';

const mocks = vi.hoisted(() => ({
    loadAgentConfig: vi.fn(),
    dingtalkConnect: vi.fn(() => ({disconnect: vi.fn()})),
    feishuConnect: vi.fn(() => ({disconnect: vi.fn()})),
}));

vi.mock('@deepclaw/config', () => ({loadAgentConfig: mocks.loadAgentConfig}));
vi.mock('./im/dingtalk', () => ({dingTalk: {connect: mocks.dingtalkConnect}}));
vi.mock('./im/feishu', () => ({feishu: {connect: mocks.feishuConnect}}));

function newAgent(im: Partial<AgentConfig['im']> = {}): AgentConfig {
    return {
        id: 'a1',
        name: 'Ada',
        mode: 'agent',
        im: {enabled: true, engine: 'dingtalk', appId: 'app-id', secret: 'app-secret', ...im},
        llm: {baseURL: 'https://api.example.com', apiKey: 'key', model: 'model'},
    };
}

describe('connectIM', () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('connects the configured engine with the agent credentials', () => {
        mocks.loadAgentConfig.mockReturnValue(newAgent());
        connectIM('a1');
        expect(mocks.dingtalkConnect).toHaveBeenCalledWith('app-id', 'app-secret', 'a1');
        expect(mocks.feishuConnect).not.toHaveBeenCalled();
    });

    test('routes to the engine named in the config', () => {
        mocks.loadAgentConfig.mockReturnValue(newAgent({engine: 'feishu'}));
        connectIM('a1');
        expect(mocks.feishuConnect).toHaveBeenCalledWith('app-id', 'app-secret', 'a1');
    });

    test('stays idle when the agent does not exist', () => {
        mocks.loadAgentConfig.mockReturnValue(undefined);
        expect(() => connectIM('missing').disconnect()).not.toThrow();
        expect(mocks.dingtalkConnect).not.toHaveBeenCalled();
    });

    test('stays idle when a credential is missing', () => {
        for (const im of [{engine: undefined}, {appId: ''}, {secret: ''}]) {
            mocks.loadAgentConfig.mockReturnValue(newAgent(im));
            expect(() => connectIM('a1').disconnect()).not.toThrow();
        }
        expect(mocks.dingtalkConnect).not.toHaveBeenCalled();
    });

    test('fails loudly for an unknown engine', () => {
        mocks.loadAgentConfig.mockReturnValue(newAgent({engine: 'wechat' as AgentConfig['im']['engine']}));
        expect(() => connectIM('a1')).toThrow('IM engine wechat not found');
    });
});
