import { AgentPage } from '@/components/agent/AgentPage';
import { LoopGateway} from '@deepclaw/loop-gateway';

export default function Agents() {
  const agents = LoopGateway.getAgents().filter(agent => !agent.fired);
  const projects = LoopGateway.getProjects();
  return (
    <AgentPage agents={agents} projects={projects} />
  );
}
