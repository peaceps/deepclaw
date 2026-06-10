import { AgentPage } from '@/components/agent/AgentPage';
import { LoopGateway} from '@deepclaw/loop-gateway';

export default function Agents() {
  const agents = LoopGateway.getAgents();
  const projects = LoopGateway.getProjects();
  return (
    <AgentPage agents={agents} projects={projects} />
  );
}
