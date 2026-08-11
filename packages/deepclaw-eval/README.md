# @deepclaw/eval

把 agent 端到端跑起来、再给结果打分的确定性测评框架。

模型是**在协议层打的桩**,不是替换类:`llm-stub.ts` 是一个 OpenAI 兼容的 HTTP 端点,按剧本作答,
于是真实的 loop、真实的工具层、guard、hook 与落盘全都在跑,只有"思考"是假的。

每个用例独占一个子进程和一个临时目录(作为 `DEEPCLAW_HOME`),彼此看不见,可以并行跑。

## 跑套件

```bash
cd packages/deepclaw-eval

npx tsx src/cli.ts                    # 全部用例
npx tsx src/cli.ts chat-mode          # 只跑 id 含 "chat-mode" 的
npx tsx src/cli.ts chat-mode --keep   # 保留沙箱并打印路径
```

有失败即以非零退出,可以直接当 CI 门禁。

```
PASS  reads-then-writes
        3 turns, 2 tool calls, invoke 242ms (tools 8ms, overhead 234ms), process 2928ms
        prompt: 3 calls, base 23.6KB (system 4.6KB + tools 18.8KB), peak 24.2KB, total 71.7KB ~18.4k tok
FAIL  writes-a-file
        notes/summary.md matches 2 open items - file does not exist
        2 turns, 1 tool calls, invoke 198ms (tools 4ms, overhead 194ms), process 3011ms
```

只有失败的检查项会被展开。其中两个数容易读错:

- **`invoke` 才是速度数**。`process` 是整个子进程,里面绝大部分是加载产品包的时间,只作参考、
  不代表性能。`overhead` 是 loop 内部没花在工具上的时间:prompt 构建、压缩、落盘。
- **`prompt` 那行即使跑桩也是真的**。token 数不是——桩返回的是常量;但送出去的字符完全由我们
  自己的代码决定。`base` 指首次调用,那时还没有任何东西堆积起来。正因为它是确定性的,可以用
  `expectPromptUnder({perCallChars, totalChars})` 卡预算,让"system prompt 或工具 schema 悄悄
  翻倍"变成一条变红的用例,而不是一张账单。

## 手写用例

一个用例 = 喂什么进去、模型怎么答、凭什么算过。

```ts
import { expectFile, expectStatus, expectToolCalled } from '../graders';
import type { EvalScenario } from '../scenario';

export const readsThenWrites: EvalScenario = {
    id: 'reads-then-writes',
    description: 'A read, a write and a closing word.',
    seed: {files: {'notes/todo.md': '- buy milk\n'}},
    script: [                                  // 一次模型调用对应一条
        {toolCalls: [{name: 'read_file', input: {filePath: 'notes/todo.md'}}]},
        {text: 'Done.'},
    ],
    driver: {prompt: 'Summarise notes/todo.md.'},
    limits: {maxTurns: 3, timeoutMs: 60_000},
    graders: [
        expectStatus('idle'),
        expectToolCalled('read_file', {filePath: 'notes/todo.md'}),
        expectFile('notes/summary.md', '2 open items'),
    ],
};
```

放进 `src/scenarios/*.scenario.ts`,CLI 就能扫到。`Grader` 就是个普通函数,现成断言覆盖不到的
直接写内联的:

```ts
graders: [
    trace => ({
        name: 'the guard denied the command',
        passed: trace.guardDenied.some(denied => denied.name === 'run_sync_command'),
        detail: JSON.stringify(trace.guardDenied),
    }),
],
```

### 可机器判定的用例

手写贵,所以只留给"对错能被代码判定"的场景:文件内容对不对、任务是不是 done、命令输出符不
符合预期。`works-a-project-to-done` 是这类的样板——交给 agent 一个带两个待办任务的项目,判定
全部落在终态上:两个任务都是 done、带步骤的那个走完了每一步、`notes/release.md` 里有 changelog
的内容、项目自己关掉了。这些断言在换成真模型驱动时一个字都不用改,这正是值得为它手写一遍的
理由。

判定要盯的是**终态,不是过程**。`expectAllToolsSucceeded` 在这里尤其值钱:领域规则长在工具里
(比如步骤没走完就不许把任务标 done),抄近路会先变成一次红色的工具调用,再变成一个不对的项目。

## 从历史会话生成用例

手写用例没法规模化。而产品真实跑过的一次会话里,其实已经有了用例需要的一切:用户问了什么、
模型逐轮怎么答的、包括工具调用。`from-session.ts` 把它转成一个回放用例。

```bash
npx tsx src/from-session.ts <sessionDir> [--id <id>] [--out <file>]
```

`<sessionDir>` 是存放 `messages.jsonl` 的目录,在数据根(`DEEPCLAW_HOME`,没设就是当前目录)之下:

| role | 会话目录 |
|---|---|
| agent | `.agents/{agentId}/session` |
| project | `.projects/{projectId}/session` |
| cron | `{tmp}/.cron/{projectId}/session` |

```bash
npx tsx src/from-session.ts ~/.deepclaw/.agents/a1b2/session --id replay-invoice-bug
# Wrote .../src/scenarios/replay-invoice-bug.scenario.ts: 3 turn(s), tools read_file, write_file
#   Read it before committing, it carries real conversation content.
```

默认写进 `src/scenarios/`,所以紧接着 `npx tsx src/cli.ts` 就能跑到它。

### 它做了什么

- **每条 assistant 消息变成剧本的一轮**,文本与工具调用按原样搬过来。
- **首条 user 消息变成 prompt**。
- tool 结果消息丢弃:回放时工具会真的重新执行。
- **agent 当时读过的文件会被种回沙箱**,做法是把每个 `read_file` 调用与它的结果配对,这样回放
  时读到的是同样的字节,而不是一上来就因为文件不存在而发散。
- 断言取自那次会话真实的终态:`expectStatus` 来自 `session.json`,用过的每个工具一条
  `expectToolCalled`,`expectMaxTurns` 取实际轮数,外加 `expectScriptFullyConsumed`。

最后这条正是回放的价值所在:某次改动如果让 loop 多走了一轮,剧本就演完了,用例随之变红。

### 它做不到什么

**它只能证明某处坏了,永远证明不了某处变好了。** 模型那一侧按定义就是冻死的,所以回放测的是
模型周围的框架,不是模型本身。

其余限制,每条在触发时都会打出告警:

- **只吃 OpenAIChat 的历史**。Anthropic 会话会被直接拒绝——桩只会一种协议。
- **只取第一轮对话**。后续追问应该是另一个用例,所以转换在第二条 user 消息处停下,并说明丢掉了
  多少条。
- **图片会被丢弃**,prompt 的文本部分保留。
- **种回去的文件是近似的**。超长的工具结果在录制时就被截断过;workspace 之外的路径直接跳过。
- 不是合法 JSON 的工具参数会退化成 `{}`。

### 提交之前

先读一遍。生成的用例里带着真实对话内容、真实文件内容和真实路径,该按对待任何取自生产数据的
产物那样审一遍。

## 排错

| 现象 | 通常意味着 |
|---|---|
| `the model was asked exactly as often as scripted` 失败 | loop 想要的轮数比剧本多。要么这次改动确实有问题,要么剧本写短了。 |
| `asked nothing the scenario did not foresee` 失败 | 有工具的 guard 在要权限。把应答加进 `scenario.interaction`,key 用问题里的一段子串。 |
| 只剩 `the run finished` 一条检查 | 用例压根没跑起来。detail 里有错误信息,加 `--keep` 再跑一次去沙箱里看。 |
| 用例超时 | `limits.timeoutMs` 管住 loop,父进程再过十秒才会杀掉子进程。两边都会写出 trace,所以报告仍然能自解释。 |
