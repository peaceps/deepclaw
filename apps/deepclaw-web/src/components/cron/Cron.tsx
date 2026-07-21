'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, ChevronDown, ChevronRight, Play, Pause, Trash2, CheckCircle2, XCircle, FileText } from 'lucide-react';
import { ContentModal } from '@/laf/content-modal';
import { InfoBar } from '@/laf/info-bar';
import { formatDate } from '@/components/component-utils';

type CronStatus = 'running' | 'paused' | 'error';

type CronExecution = {
    id: string;
    time: string;
    agentName: string;
    duration: string;
    status: 'success' | 'failed';
    report: string;
};

type CronTask = {
    id: string;
    name: string;
    creator: string;
    schedule: string;
    scheduleHuman: string;
    prompt: string;
    status: CronStatus;
    lastRun: string;
    nextRun: string;
    history: CronExecution[];
};

const MOCK_TASKS: CronTask[] = [
    {
        id: '1',
        name: '日报生成',
        creator: '虾米',
        schedule: '0 9 * * *',
        scheduleHuman: '每天 09:00',
        prompt: '汇总今天所有项目的进展情况，包括已完成的任务、进行中的任务和遇到的问题，生成一份简洁的日报。',
        status: 'running',
        lastRun: '2026-07-21T09:00:00+08:00',
        nextRun: '2026-07-22T09:00:00+08:00',
        history: [
            { id: 'h1', time: '2026-07-21T09:00:00+08:00', agentName: '小脑', duration: '45s', status: 'success', report: '# 日报 2026-07-21\n\n## 项目进展\n\n### DeepClaw 开发\n- 完成 Skills 页面开发\n- 修复权限系统 bug\n- 重构 Prompt 缓存分层\n\n### 数据分析\n- 导出 Q2 财务报表\n- 清洗异常数据 12 条\n\n## 待处理\n- 定时任务页面 UI 设计\n- Cron 后端接口对接' },
            { id: 'h2', time: '2026-07-20T09:00:00+08:00', agentName: '小脑', duration: '38s', status: 'success', report: '# 日报 2026-07-20\n\n## 项目进展\n\n### DeepClaw 开发\n- 完成 Skills 系统重构\n- 新增 installSkill 方法\n- 权限服务支持会话级授权\n\n### 文档整理\n- 整理 API 文档 3 篇\n- 更新 README 截图' },
            { id: 'h3', time: '2026-07-19T09:00:00+08:00', agentName: '小脑', duration: '1m12s', status: 'failed', report: '执行失败：LLM 调用超时（30s），已重试 3 次均失败。建议检查网络连接或增加超时时间。' },
            { id: 'h4', time: '2026-07-18T09:00:00+08:00', agentName: '小脑', duration: '41s', status: 'success', report: '# 日报 2026-07-18\n\n## 项目进展\n\n### DeepClaw 开发\n- 完成工具系统重构\n- 新增 delete_skill 工具\n\n### 测试\n- 修复 readDir 返回类型变更导致的兼容问题\n- 新增 FileUtils.exists 方法' },
            { id: 'h5', time: '2026-07-17T09:00:00+08:00', agentName: '小脑', duration: '33s', status: 'success', report: '# 日报 2026-07-17\n\n## 项目进展\n\n### DeepClaw 开发\n- 完成 tasks -> projects 目录迁移\n- 修复 copyResource 路径拼接问题\n\n### 数据分析\n- 完成 7 月数据月报初稿' },
            { id: 'h6', time: '2026-07-16T09:00:00+08:00', agentName: '小脑', duration: '52s', status: 'success', report: '# 日报 2026-07-16\n\n## 项目进展\n\n### DeepClaw 开发\n- 设计 PermissionService 分级权限\n- 实现允许一次/会话级授权\n\n### 文档整理\n- 编写 Agent Skill 开发指南' },
            { id: 'h7', time: '2026-07-15T09:00:00+08:00', agentName: '小脑', duration: '28s', status: 'success', report: '# 日报 2026-07-15\n\n## 项目进展\n\n### DeepClaw 开发\n- 完成 loop 引擎断点机制设计\n- 新增外部中断原因分类' },
            { id: 'h8', time: '2026-07-14T09:00:00+08:00', agentName: '小脑', duration: '1m05s', status: 'failed', report: '执行失败：Anthropic API 返回 429（Rate Limit），已等待重试后仍失败。建议降低调用频率或升级 API tier。' },
            { id: 'h9', time: '2026-07-13T09:00:00+08:00', agentName: '小脑', duration: '36s', status: 'success', report: '# 日报 2026-07-13\n\n## 项目进展\n\n### DeepClaw 开发\n- 完成 SSE 事件推送重构\n- 优化前端消息渲染性能\n\n### 数据分析\n- 清洗异常数据 8 条' },
            { id: 'h10', time: '2026-07-12T09:00:00+08:00', agentName: '小脑', duration: '42s', status: 'success', report: '# 日报 2026-07-12\n\n## 项目进展\n\n### DeepClaw 开发\n- 完成 Hook 系统设计\n- 实现 foot-print/log/background-command 三类 hook\n\n### 测试\n- 编写 loop 引擎单元测试 12 个' },
            { id: 'h11', time: '2026-07-11T09:00:00+08:00', agentName: '小脑', duration: '31s', status: 'success', report: '# 日报 2026-07-11\n\n## 项目进展\n\n### DeepClaw 开发\n- 完成多 LLM 协议适配层\n- 支持 OpenAI Chat / Response / Anthropic 三种协议自动探测' },
            { id: 'h12', time: '2026-07-10T09:00:00+08:00', agentName: '小脑', duration: '47s', status: 'success', report: '# 日报 2026-07-10\n\n## 项目进展\n\n### DeepClaw 开发\n- 搭建 monorepo 项目结构\n- 完成 deepclaw-core 类型定义\n- 实现 AgentIdentity 人格化配置' },
        ],
    },
    {
        id: '2',
        name: '周报汇总',
        creator: '虾米',
        schedule: '0 10 * * 1',
        scheduleHuman: '每周一 10:00',
        prompt: '汇总本周所有项目进展，对比上周的计划，分析完成率和延期原因，生成周报并发送给所有相关人员。',
        status: 'running',
        lastRun: '2026-07-15T10:00:00+08:00',
        nextRun: '2026-07-22T10:00:00+08:00',
        history: [
            { id: 'w1', time: '2026-07-15T10:00:00+08:00', agentName: '小脑', duration: '52s', status: 'success', report: '# 周报 2026-07-15\n\n## 本周概览\n\n共推进项目 5 个，完成任务 23 项，完成率 85%。\n\n## 详细进展\n\n### DeepClaw 平台\n- 完成 Agent Loop 引擎重构\n- 新增多 LLM 协议适配\n- Web 端基础框架搭建\n\n### 数据治理\n- 清理历史数据 3000+ 条\n- 建立数据质量监控' },
            { id: 'w2', time: '2026-07-08T10:00:00+08:00', agentName: '小脑', duration: '48s', status: 'success', report: '# 周报 2026-07-08\n\n## 本周概览\n\n共推进项目 4 个，完成任务 18 项，完成率 78%。' },
        ],
    },
    {
        id: '3',
        name: '数据备份',
        creator: '虾米',
        schedule: '0 2 * * *',
        scheduleHuman: '每天 02:00',
        prompt: '备份项目数据目录到指定路径，验证备份完整性，并清理 7 天前的旧备份。',
        status: 'paused',
        lastRun: '2026-07-21T02:00:00+08:00',
        nextRun: '-',
        history: [
            { id: 'b1', time: '2026-07-21T02:00:00+08:00', agentName: '小脑', duration: '2m15s', status: 'success', report: '备份完成\n\n- 数据目录: /data/projects\n- 备份路径: /backup/2026-07-21\n- 文件数: 1,247\n- 总大小: 456MB\n- 校验: MD5 验证通过\n- 旧备份清理: 已删除 2026-07-14 的备份' },
        ],
    },
];

const STATUS_CONFIG: Record<CronStatus, { color: string; bg: string; label: string; labelEn: string }> = {
    running: { color: 'text-emerald-600', bg: 'bg-emerald-500', label: '运行中', labelEn: 'Running' },
    paused: { color: 'text-gray-400', bg: 'bg-gray-400', label: '已暂停', labelEn: 'Paused' },
    error: { color: 'text-red-500', bg: 'bg-red-500', label: '错误', labelEn: 'Error' },
};

export function Cron() {
    const { t, i18n } = useTranslation();
    const [tasks, setTasks] = useState(MOCK_TASKS);
    const [expandedId, setExpandedId] = useState<string | undefined>();
    const [reportContent, setReportContent] = useState<string | null>(null);

    const toggle = (id: string) => {
        setExpandedId(prev => (prev === id ? undefined : id));
    };

    const toggleStatus = (id: string) => {
        setTasks(prev => prev.map(task =>
            task.id === id
                ? { ...task, status: task.status === 'running' ? 'paused' : 'running' }
                : task
        ));
    };

    const deleteTask = (id: string) => {
        setTasks(prev => prev.filter(task => task.id !== id));
        if (expandedId === id) setExpandedId(undefined);
    };

    const isEn = i18n.language === 'en';

    return (
        <div className="h-full w-full overflow-auto p-6">
            <div className="mb-4">
                <h1 className="text-2xl font-bold text-gray-800">{t('web.sidebar.links.cron')}</h1>
            </div>
            <InfoBar message={isEn ? 'Tip: you can create scheduled tasks by chatting with an agent - just tell it what to run and when.' : '提示：可以直接和 Agent 聊天来创建定时任务，告诉它要执行什么以及执行周期即可。'} />

            <div className="space-y-3">
                {tasks.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gray-300 bg-white py-12 text-center text-gray-400">
                        <Clock size={40} className="mx-auto mb-3 opacity-40" />
                        <p className="text-sm">{isEn ? 'No scheduled tasks' : '暂无定时任务'}</p>
                    </div>
                ) : tasks.map(task => {
                    const isExpanded = expandedId === task.id;
                    const statusCfg = STATUS_CONFIG[task.status];
                    return (
                        <div key={task.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                            {/* Header row */}
                            <div
                                onClick={() => toggle(task.id)}
                                className="px-4 sm:px-6 py-4 bg-gradient-to-r from-gray-50 to-white border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors"
                            >
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                    <div className="flex items-center gap-3 sm:gap-4 min-w-0 flex-1">
                                        <div className="text-gray-400 flex-shrink-0">
                                            {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                                        </div>
                                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white flex-shrink-0">
                                            <Clock size={20} />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <h3 className="font-bold text-gray-900 text-base sm:text-lg truncate">
                                                {task.name}
                                            </h3>
                                            <div className="flex items-center gap-3 text-xs text-gray-400 mt-1">
                                                <span>{isEn ? 'Creator' : '创建人'}: {task.creator}</span>
                                                <span>·</span>
                                                <span>{task.scheduleHuman}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4 sm:gap-6 flex-wrap">
                                        <div className="text-right min-w-[100px]">
                                            <div className="text-xs text-gray-400">{isEn ? 'Last run' : '上次执行'}</div>
                                            <div className="text-sm text-gray-700">{formatDate(i18n.language, task.lastRun)}</div>
                                        </div>
                                        <div className="text-right min-w-[100px]">
                                            <div className="text-xs text-gray-400">{isEn ? 'Next run' : '下次执行'}</div>
                                            <div className="text-sm text-gray-700">{task.nextRun === '-' ? '-' : formatDate(i18n.language, task.nextRun)}</div>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <span className={`w-2 h-2 rounded-full ${statusCfg.bg}`} />
                                            <span className={`text-sm font-medium ${statusCfg.color}`}>
                                                {isEn ? statusCfg.labelEn : statusCfg.label}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Expanded content: left detail + right history */}
                            {isExpanded && (
                                <div className="flex flex-col lg:flex-row border-t border-gray-200">
                                    {/* Left: task detail */}
                                    <div className="lg:w-2/5 p-6 border-b lg:border-b-0 lg:border-r border-gray-200 bg-gray-50/50">
                                        <div className="space-y-4">
                                            <div>
                                                <div className="text-xs font-medium text-gray-500 mb-1">{isEn ? 'Schedule' : '任务周期'}</div>
                                                <div className="text-sm text-gray-800">{task.scheduleHuman}</div>
                                                <div className="text-xs text-gray-400 font-mono mt-0.5">{task.schedule}</div>
                                            </div>
                                            <div>
                                                <div className="text-xs font-medium text-gray-500 mb-1">{isEn ? 'Creator' : '创建人'}</div>
                                                <div className="text-sm text-gray-800">{task.creator}</div>
                                            </div>
                                            <div>
                                                <div className="text-xs font-medium text-gray-500 mb-1">{isEn ? 'Prompt' : '任务内容'}</div>
                                                <div className="text-sm text-gray-700 bg-white rounded-lg border border-gray-200 p-3 leading-relaxed">
                                                    {task.prompt}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 pt-2">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); toggleStatus(task.id); }}
                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-300 rounded-md hover:bg-gray-100 transition-colors"
                                                >
                                                    {task.status === 'running' ? <Pause size={14} /> : <Play size={14} />}
                                                    {task.status === 'running' ? (isEn ? 'Pause' : '暂停') : (isEn ? 'Resume' : '恢复')}
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); deleteTask(task.id); }}
                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-500 border border-red-200 rounded-md hover:bg-red-50 transition-colors"
                                                >
                                                    <Trash2 size={14} />
                                                    {isEn ? 'Delete' : '删除'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Right: execution history */}
                                    <div className="lg:w-3/5 p-6">
                                        <div className="text-sm font-medium text-gray-700 mb-3">
                                            {isEn ? 'Execution History' : '执行历史'}
                                        </div>
                                        {task.history.length === 0 ? (
                                            <div className="text-center text-gray-400 py-8 text-sm">
                                                {isEn ? 'No executions yet' : '暂无执行记录'}
                                            </div>
                                        ) : (
                                            <div className="space-y-2 max-h-[400px] overflow-y-auto">
                                                {task.history.map(exec => (
                                                    <div
                                                        key={exec.id}
                                                        className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                                                    >
                                                        <div className="flex-shrink-0">
                                                            {exec.status === 'success'
                                                                ? <CheckCircle2 size={18} className="text-emerald-500" />
                                                                : <XCircle size={18} className="text-red-500" />}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-sm text-gray-800 font-medium">
                                                                    {formatDate(i18n.language, exec.time)}
                                                                </span>
                                                                <span className="text-xs text-gray-400">·</span>
                                                                <span className="text-xs text-gray-500">{exec.agentName}</span>
                                                                <span className="text-xs text-gray-400">·</span>
                                                                <span className="text-xs text-gray-500">{exec.duration}</span>
                                                            </div>
                                                        </div>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); setReportContent(exec.report); }}
                                                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-sky-600 hover:bg-sky-50 rounded-md transition-colors flex-shrink-0 cursor-pointer"
                                                        >
                                                            <FileText size={13} />
                                                            {isEn ? 'Report' : '报告'}
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Report modal */}
            {reportContent !== null && (
                <ContentModal
                    type="markdown"
                    title={isEn ? 'Execution Report' : '执行报告'}
                    content={reportContent}
                    onClose={() => setReportContent(null)}
                />
            )}
        </div>
    );
}
