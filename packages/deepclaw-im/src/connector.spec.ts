import {beforeEach, describe, expect, test, vi} from 'vitest';
import {type AgentConfig} from '@deepclaw/config';
import {connectIM} from './connector';

type EngineConnect = (appId: string, secret: string, agentId: string) => Promise<{disconnect: () => void}>;

const mocks = vi.hoisted(() => ({
    loadAgentConfig: vi.fn(),
    dingtalkConnect: vi.fn<EngineConnect>(),
    feishuConnect: vi.fn<EngineConnect>(),
}));

vi.mock('@deepclaw/config', () => ({loadAgentConfig: mocks.loadAgentConfig}));
vi.mock('./im/dingtalk/dingtalk-engine', () => ({dingTalk: {connect: mocks.dingtalkConnect}}));
vi.mock('./im/feishu/feishu-engine', () => ({feishu: {connect: mocks.feishuConnect}}));

function newAgent(im: Partial<AgentConfig['im']> = {}): AgentConfig {
    return {
        id: 'a1',
        name: 'Ada',
        mode: 'agent',
        im: {enabled: true, engine: 'dingtalk', appId: 'app-id', secret: 'app-secret', ...im},
        llm: {baseURL: 'https://api.example.com', apiKey: 'key', model: 'model'},
        multimodal: {},
    };
}

describe('connectIM', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.dingtalkConnect.mockResolvedValue({disconnect: vi.fn()});
        mocks.feishuConnect.mockResolvedValue({disconnect: vi.fn()});
    });

    test('connects the configured engine with the agent credentials', async () => {
        mocks.loadAgentConfig.mockReturnValue(newAgent());
        await connectIM('a1');
        expect(mocks.dingtalkConnect).toHaveBeenCalledWith('app-id', 'app-secret', 'a1');
        expect(mocks.feishuConnect).not.toHaveBeenCalled();
    });

    test('routes to the engine named in the config', async () => {
        mocks.loadAgentConfig.mockReturnValue(newAgent({engine: 'feishu'}));
        await connectIM('a1');
        expect(mocks.feishuConnect).toHaveBeenCalledWith('app-id', 'app-secret', 'a1');
    });

    test('hands back the disconnect of the engine', async () => {
        const disconnect = vi.fn();
        mocks.dingtalkConnect.mockResolvedValue({disconnect});
        mocks.loadAgentConfig.mockReturnValue(newAgent());
        (await connectIM('a1')).disconnect();
        expect(disconnect).toHaveBeenCalledOnce();
    });

    test('waits for the engine to be connected', async () => {
        let connected = false;
        mocks.loadAgentConfig.mockReturnValue(newAgent());
        mocks.dingtalkConnect.mockImplementation(async () => {
            await Promise.resolve();
            connected = true;
            return {disconnect: vi.fn()};
        });
        await connectIM('a1');
        expect(connected).toBe(true);
    });

    test('stays idle when the agent does not exist', async () => {
        mocks.loadAgentConfig.mockReturnValue(undefined);
        const {disconnect} = await connectIM('missing');
        expect(() => disconnect()).not.toThrow();
        expect(mocks.dingtalkConnect).not.toHaveBeenCalled();
    });

    test('stays idle when a credential is missing', async () => {
        for (const im of [{engine: undefined}, {appId: ''}, {secret: ''}]) {
            mocks.loadAgentConfig.mockReturnValue(newAgent(im));
            const {disconnect} = await connectIM('a1');
            expect(() => disconnect()).not.toThrow();
        }
        expect(mocks.dingtalkConnect).not.toHaveBeenCalled();
    });

    test('fails loudly for an unknown engine', async () => {
        mocks.loadAgentConfig.mockReturnValue(newAgent({engine: 'wechat' as AgentConfig['im']['engine']}));
        await expect(connectIM('a1')).rejects.toThrow('IM engine wechat not found');
    });

    test('passes the failure of the engine to the caller', async () => {
        mocks.loadAgentConfig.mockReturnValue(newAgent());
        mocks.dingtalkConnect.mockRejectedValue(new Error('handshake refused'));
        await expect(connectIM('a1')).rejects.toThrow('handshake refused');
    });
});
