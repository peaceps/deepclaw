import { AgentPage } from '@/components/agent/AgentPage';
import { LoopGateway} from '@deepclaw/loop-gateway';

export default function Agents() {
  const agents = LoopGateway.getAgents();
  return (
    <AgentPage agents={agents}></AgentPage>
  );
}
