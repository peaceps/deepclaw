import { Skills } from '@/components/skills/Skills';
import { getSkills, getActiveAgents } from '@/server/data';

export default async function SkillsPage() {
  const [skills, agents] = await Promise.all([getSkills(), getActiveAgents()]);
  return <Skills skills={skills} agents={agents} />;
}
