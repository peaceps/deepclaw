import { AgentEmployee } from "@deepclaw/core";

// TODO test file only, will remove later
const colors: Record<AgentEmployee['mood'], string> = {
    happy: 'from-yellow-50 to-orange-50 border-yellow-200',
    focused: 'from-blue-50 to-indigo-50 border-blue-200',
    tired: 'from-gray-50 to-slate-50 border-gray-300',
    confused: 'from-purple-50 to-pink-50 border-purple-200',
    none: 'from-gray-50 to-slate-50 border-gray-200',
};

const emojis: Record<string, string> = {
    happy: '😊',
    focused: '🎯',
    tired: '😴',
    confused: '🤔',
    none: '🌧',
};

const moodThoughts: Record<AgentEmployee['mood'], string[]> = {
    happy: [
      '今天心情不错，工作很有干劲！',
      '这个任务挺有意思的，我喜欢！',
      '状态很好，准备大干一场！',
      '今天效率应该会很高~',
    ],
    focused: [
      '正在专注处理任务，请勿打扰',
      '思路很清晰，继续推进中',
      '进入心流状态了，感觉很好',
      '集中精力，争取早点完成',
    ],
    tired: [
      '好累啊，需要休息一下...',
      '连续工作好久了，有点疲惫',
      '眼皮在打架，需要咖啡续命',
      '这个工作有点枯燥，想摸鱼',
    ],
    confused: [
      '这个需求有点看不懂...',
      '有点懵，需要再理清楚思路',
      '遇到了一些困难，正在思考',
      '这个问题有点复杂，需要点时间',
    ],
    none: [
      '没什么可说的...',
    ],
};

const statusThoughts: Record<AgentEmployee['status'], string[]> = {
    busy: [
        '忙死了，任务堆成山了！',
        '手头事情好多，压力有点大',
        '正在赶进度，时间不够用啊',
        '这个 deadline 有点紧张...',
    ],
    idle: [
        '有点闲，有什么任务给我吗？',
        '等待分配新任务中...',
        '手头暂时没事，随时待命',
        '空闲时间，可以接新任务了',
    ],
    fired: [
        '？'
    ]
};

function getAgentThoughts(agent: AgentEmployee): { emoji: string; text: string; color: string } {
  
    const thoughtPool = [...moodThoughts[agent.mood], ...statusThoughts[agent.status]];
  
    // 根据 agent id 和当前时间选择一个想法（保持一致性）
    const seed = [...agent.id].reduce((p, r) => p + r.charCodeAt(0), 0) + new Date().getMinutes();
    const thought = thoughtPool[seed % thoughtPool.length];
  
    return {
      emoji: emojis[agent.mood] || '💭',
      text: thought,
      color: colors[agent.mood] || 'from-gray-50 to-gray-100 border-gray-200',
    };
  }
  
export function AgentThoughts({ agent }: { agent: AgentEmployee }) {
    const { emoji, text, color } = getAgentThoughts(agent);
  
    return (
        <>
          <span className={`text-l mr-2 ${color}`}>{emoji}</span>
          <span className={`text-l text-gray-700 font-medium ${color}`}>{text}</span>
        </>

    );
  }
  