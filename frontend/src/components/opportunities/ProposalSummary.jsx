import { Download } from 'lucide-react';
export default function ProposalSummary({ workspaceId }) {
  return <a className="coi-button secondary" href={`/api/opportunity-workspaces/${workspaceId}/proposal-summary`} download><Download size={17}/> Download proposal summary</a>;
}
