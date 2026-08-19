[English](https://github.com/peaceps/deepclaw/blob/main/README.md) | **简体中文**

# Deepclaw

一个自己跑起来的 agent 平台。招一支 agent 团队，给它们装上技能，让它们去做你的项目、按你的日程干活
—— 网页界面和终端界面都有。

所有东西都跑在你自己的机器上，用你自己的模型密钥。没有配过的地方，不会有数据发过去。

<!-- 截图：打开某个项目的看板，三列里都有任务，最好有几张卡片带着负责人头像和进度条。
     这是所有人看到的第一眼，挑最热闹的那个项目。 -->

![项目看板](https://raw.githubusercontent.com/peaceps/deepclaw/main/docs/images/board.png)

## 安装

需要 Node 21 或更新的版本。Linux、macOS 和 Windows 都能跑。

```bash
npm install -g @sacephor/deepclaw
```

## 启动

```bash
deepclaw start            # 网页界面，地址是 http://localhost:3000
deepclaw start --tui      # 终端界面
```

| 选项     | 作用                                       |
| -------- | ------------------------------------------ |
| `--tui`  | 打开终端界面，而不是网页界面               |
| `--port` | 网页界面的端口，不指定就是 3000            |
| `--host` | 网页界面绑定的地址，默认 `127.0.0.1`       |

第一次启动会引导你走一遍设置：用哪个模型，以及连它用的密钥。

网页界面不设密码，所以它只待在运行它的那台机器上。任何能访问到它的人都能拿你的密钥驱使你的 agent
干活 —— 在用 `--host` 把它交给一个网络地址之前，这一点值得记住。

## 界面上有什么

侧边栏里五个地方：**Agent**、**项目看板**、**定时任务**、**技能**、**设置**。

### Agent

<!-- 截图：Agent 页面并选中某个 agent，左边是列表右边是详情面板。最好选一个正忙的，
     这样"正在进行"那张卡片里能看到带进度条的任务。 -->

![Agent 页面](https://raw.githubusercontent.com/peaceps/deepclaw/main/docs/images/agents.png)

每个 agent 都是一个具体的人：名字、头像、角色、性格特点，还有它擅长的领域。招人和辞退都在设置里。

点开一个，详情面板会告诉你它此刻在干什么 —— 正在跑哪些任务、进度到哪儿了、归属哪个项目、还有哪些
定时任务在等它。Agent 分忙碌和空闲，而且各自带着心情：开心、专注、疲惫、困惑，或者不想说。

### 对话

<!-- 截图：一段 agent 调用了工具的对话，让工具卡片和回复一起出现在记录里。 -->

![和 agent 对话](https://raw.githubusercontent.com/peaceps/deepclaw/main/docs/images/chat.png)

可以跟某个 agent 聊，也可以跟某个项目聊。回复是一边生成一边流式吐出来的，过程中 agent 伸手去用的
工具 —— 读文件、执行命令、画图 —— 会同步出现在对话里，所以你看到的是活儿本身，不只是最后那个答案。
消息里可以带图片。

碰上只有你能拍板的事，agent 会停下来问。问题直接弹到你面前；要是你人不在，会有通知告诉你有人在等。

每段对话都会显示花了多少 token，其中有多少输入是从缓存里拿的。

### 项目看板

任务分三列 —— 待办、进行中、已完成 —— 干完一段就往右挪。卡片上带着负责人、优先级、进度，以及它在等
哪些任务。项目可以按标题、描述或标签搜索，看板也可以只看某一个负责人的。

任务卡片上的两个按钮是你介入的入口。**暂停**告诉 agent 做完这个任务就停下，别接着往下跑。它停在
那儿之后，任务会等你**验收**：你没看过、没点头，后面就不会继续。那些你想先过目再往上垒的环节，用它。

做完的任务会附一份报告，可以当场读，也可以下载。

### 定时任务

<!-- 截图：定时任务页面，展开其中一个让执行历史露出来，能看到过去几次的执行记录。 -->

![定时任务](https://raw.githubusercontent.com/peaceps/deepclaw/main/docs/images/cron.png)

会重复的活儿：一段提示词、一个日程、一个接活的 agent。每条都显示上次什么时候跑的、下次什么时候跑，
留着完整的执行历史，还能暂停和恢复，历史一条不丢。

你不用去填表建它。跟 agent 说清楚要跑什么、什么时候跑，它会替你把任务建好。

### 技能

<!-- 截图：技能页面，列着几个装好的技能，"应用于"那一列里最好有一个是限定给某个 agent 的。 -->

![技能页面](https://raw.githubusercontent.com/peaceps/deepclaw/main/docs/images/skills.png)

技能是你的 agent 会做的事，这里列着每个技能是干什么的、应用在哪些 agent 上。一个技能可以对所有人
开放，也可以只留给某一个 agent。

和定时任务一样，装技能靠说。让 agent 去找一个技能装上，它会自己搜索、下载、安装。

### 设置

语言，以及每个 agent 一张卡片：它是谁、用哪个模型和对应的密钥、画图用哪个模型、要不要接钉钉或飞书。
MCP 服务地址在高级设置里。

### 用你的语言，在你的手机上

整个界面支持 English 和简体中文，在设置里选一个，其余地方都会跟着变。

Agent 页面和对话有专门为窄屏做的布局，看板的列在挤不下的时候会自动堆叠 —— 所以用手机看看 agent
干得怎么样，是可行的。

<!-- 截图：把浏览器窗口拉窄后的 agent 页面（或者直接用手机截），展示移动端布局。
     这里放竖的窄图比宽图合适。 -->

![手机上的样子](https://raw.githubusercontent.com/peaceps/deepclaw/main/docs/images/mobile.png)

## 你的 agent 能做什么

**用你的电脑。** `agent` 模式下的 agent 能读写文件、执行 shell 命令、盯着长时间运行的进程。`chat`
模式的只会说话 —— 当你要的是一个助手而不是一个操作员时，就该用这个。

**把一个项目做到底。** 领到任务的 agent 会在一段独立的对话里处理它，按需调用工具，最后回报结果。
多个任务能在不同 agent 上同时推进，看板实时跟着变。依赖关系是被尊重的：被挡住的任务会等在那儿。

**记住重要的事。** Agent 会一边做一边记：你的偏好、你给过的规矩和纠正、你反复让它去看的那些文档和
看板的位置。一条记忆可以属于所有人、属于某一个 agent，或者属于某一个项目。

**画图。** 支持 OpenAI（GPT-image）、阿里（Qwen-Image）、字节（Seedream），每个 agent 可以配自己的
模型和密钥。

**在钉钉或飞书里回话。** 把 agent 接到即时通讯平台上，那边来的消息会走同一条对话循环，回复直接发回
聊天里。

## 参考

### 能对接的模型

- Anthropic（Claude）—— 原生的 tool-use 协议
- OpenAI —— chat completions 和 responses API
- 任何 OpenAI 兼容的端点（baseURL + apiKey）

最多 30 个 agent，每个都能配自己的模型。

### 技能在磁盘上的样子

一个技能就是一个文件夹，里面有 `SKILL.md`（frontmatter + markdown 正文），以及需要的配套文件。它们
放在 `~/.deepclaw/.agents/skills/`，改动会热加载，所以你手动丢进去的技能不用重启就能被认出来。

### 记忆在磁盘上的样子

记忆是带 frontmatter 的 markdown 文件。每条都有作用范围和类型：

| 范围 | 覆盖到哪里 |
|-------|---------------|
| `global` | 对所有 agent 和项目生效 |
| `agent` | 只属于某一个 agent |
| `project` | 绑定当前的项目或定时任务 |

| 类型 | 什么时候用 |
|------|---------------|
| `preference` | 用户的风格、习惯、默认偏好 |
| `rules` | 约束、纠正、已经定下来的决定 |
| `reference` | 指向外部文档、看板、工单的线索 |

什么时候该写一条，agent 自己决定，依据是记忆工具描述里带着的那套准则。

### 子循环

交给 agent 的任务跑在一条**子循环（sub-loop）**里：一段只服务于这一个任务的对话，有自己的上下文窗口
和自己的工具权限。它读取任务和步骤，干活，边干边更新状态和步骤进度，最后产出一份结构化的输出。编排
器盯着哪些任务在跑、哪些被挡住了、哪些已经可以开始。

### MCP（Model Context Protocol）

通过 MCP 接入外部的工具服务。任何兼容 MCP 的服务都会把自己的工具自动暴露给你的 agent —— 工具被发现
之后会加上 `MCP_` 前缀，和内置工具一起可用。服务地址在高级设置里填。

### 内置工具

| 工具 | 作用 |
|------|-------------|
| `read_file` / `write_file` / `edit_file` | 文件操作 |
| `run_sync_command` | 执行一条 shell 命令并等它的输出 |
| `run_background_command` | 启动一个长时间运行的进程 |
| `check_background_command_status` / `check_all_background_command_status` | 查一个后台进程，或者查全部 |
| `remove_background_command` | 清掉一个不再需要的后台进程 |
| `generate_image` | 用配置好的供应商生成图片 |
| `create_project` / `update_project` | 创建和管理项目 |
| `create_simple_task` / `update_task` | 创建和管理任务 |
| `update_task_current_step` | 推进任务的步骤进度 |
| `get_project_list` / `get_project_detail` | 读取项目状态 |
| `task_loop` | 把项目里的一个任务交给能继续拆分它的子 agent |
| `sub_loop` | 为一件具体的活开一条子循环 |
| `create_cron_task` / `update_cron_task` | 管理定时任务 |
| `update_cron_output` | 汇报一次定时执行产出了什么 |
| `get_cron_histories` | 回看这个定时任务此前几次执行的产出 |
| `load_skill_details` / `search_online_skills` / `download_skill` / `create_skill` / `remove_skill` / `refresh_skills` | 技能操作 |
| `save_memory` / `read_memory_detail` | 记下值得记的东西，以及把它读回来 |
| `update_agent_runtime` | 让 agent 更新自己的心情和情绪 |
| `base64` | base64 编解码 |

### 你的东西放在哪

不管你从哪个目录启动，所有东西都在 `~/.deepclaw` 底下：

```
~/.deepclaw/
├── .deepclaw.config.json     # 设置：agent、模型、IM、MCP
├── DEEPCLAW.md               # 关于这个地方，每个 agent 都会被告知的内容
├── .agents/                  # 每个 agent 的会话文件和记忆
│   └── skills/               # 装好的技能
├── .projects/                # 项目数据和任务状态
├── .cron/                    # 定时任务的定义和历史
├── .memory/                  # 全局记忆条目
└── .logs/                    # 运行日志
```

用 `DEEPCLAW_HOME` 指定另一个目录，就能让多份数据互不打扰地并存：

```bash
DEEPCLAW_HOME=~/work/deepclaw deepclaw start
```

## 开发

如果你要改 deepclaw 本身，而不只是用它：

```bash
pnpm install
pnpm --filter=@sacephor/deepclaw web      # 网页界面
pnpm --filter=@sacephor/deepclaw tui      # 终端界面
```

这两条命令直接从源码启动，不经过安装后的启动器，因此它们不会去找 `~/.deepclaw`：数据会落在你执行
命令的那个目录里。用 `DEEPCLAW_HOME` 指一个别处，免得自己的数据混进代码库。

`@sacephor/deepclaw` 是这个 workspace 里唯一会发布的包。其余的都被打包或构建进了它，所以安装时不需要
再从 registry 拉 deepclaw 的任何其它东西。

```bash
pnpm --filter=@sacephor/deepclaw build:release
npm publish apps/sacephor-deepclaw/release
```
