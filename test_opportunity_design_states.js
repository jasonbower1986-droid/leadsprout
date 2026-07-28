const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = relative => fs.readFileSync(path.join(__dirname,relative),'utf8');
const app = read('frontend/src/App.jsx');
const sidebar = read('frontend/src/components/Sidebar.jsx');
const opportunities = read('frontend/src/pages/Opportunities.jsx');
const detail = read('frontend/src/pages/OpportunityDetail.jsx');
const css = read('frontend/src/index.css') + read('frontend/src/App.css');
assert(app.includes('path="/opportunities/:workspaceId"'));
assert(app.includes('path="/workspace"'));
assert(app.includes('<OpportunityWorkspaceRoute><OpportunityWorkspace /></OpportunityWorkspaceRoute>'));
assert(!sidebar.includes("to: '/dashboard'"));
assert(!sidebar.includes("to: '/agency'"));
for (const destination of ['Opportunities', 'Workspace', 'Reports', 'Activity Feed', 'Settings']) {
  assert(sidebar.includes(`label: '${destination}'`), destination);
}
assert.strictEqual((sidebar.match(/label: '/g) || []).length, 5);
assert(sidebar.includes("location.pathname.startsWith('/opportunities')"));
assert(sidebar.includes("aria-current={item.active ? 'page'"));
assert(opportunities.includes('OpportunityList'));
for (const requirement of ['Estimated consultant fee','Estimated client upside','EvidenceAndUncertainty','ContactVerification','ReviewGate','OutreachTransition','ProposalSummary']) assert(detail.includes(requirement), requirement);
assert(css.includes('@media (max-width:360px)'));
assert(css.includes('outline:3px solid'));
assert(css.includes('min-height:44px'));
assert(css.includes('@media (max-width:340px)'));
assert(css.includes('.home-opportunity-table'));
assert(css.includes('.home-tabs button:focus-visible'));
console.log('Commercial Opportunity Design governed routes, states, navigation, responsive and accessibility source contract: PASS');
