const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('./backend/node_modules/express');
const jwt = require('./backend/node_modules/jsonwebtoken');
const sqlite3 = require('./backend/node_modules/sqlite3');
const temp = fs.mkdtempSync(path.join(os.tmpdir(),'coi-design-api-'));
const databasePath = path.join(temp,'database.sqlite');
const teamDb = path.join(temp,'team-db');
fs.writeFileSync(teamDb,`#!/usr/bin/env python3
import json,os,sqlite3,sys
db=sqlite3.connect(os.environ['COI_DESIGN_DATABASE']);db.row_factory=sqlite3.Row;db.execute('PRAGMA foreign_keys=ON')
try:
 sql=sys.argv[1]
 if ';' in sql.strip().rstrip(';'): db.executescript(sql);db.commit();print('[]')
 else:
  cur=db.execute(sql)
  if cur.description: print(json.dumps([dict(row) for row in cur.fetchall()]))
  else: db.commit();print('[]')
finally: db.close()
`,{mode:0o700});
process.env.PATH=`${temp}:${process.env.PATH}`; process.env.COI_DESIGN_DATABASE=databasePath;
const db = new sqlite3.Database(databasePath);
const exec = sql => new Promise((resolve,reject)=>db.exec(sql,error=>error?reject(error):resolve()));
const m002=fs.readFileSync(path.join(__dirname,'backend/migrations/002_opportunity_workspace.sql'),'utf8');
const m003=fs.readFileSync(path.join(__dirname,'backend/migrations/003_commercial_opportunity_design_states.sql'),'utf8');
const j=value=>JSON.stringify(value).replaceAll("'","''");
(async()=>{
 await exec(`CREATE TABLE users(id TEXT PRIMARY KEY);CREATE TABLE leads(id TEXT PRIMARY KEY,evidence_state TEXT);INSERT INTO users VALUES('tenant-a');INSERT INTO users VALUES('tenant-b');INSERT INTO leads VALUES('lead-a','{}');${m002}${m003}`);
 await exec(`INSERT INTO customer_capability_profiles VALUES('profile','tenant-a',1,'["conversion"]','[]','[]','one project','[]','[]','2026-07-24T09:00:00Z');
 INSERT INTO opportunity_workspaces VALUES('workspace-a','tenant-a','ABC Dental Care','SELECTED',1,1,NULL,'2026-07-24T09:00:00Z','2026-07-24T09:00:00Z');
 INSERT INTO opportunity_workspace_versions VALUES('workspace-a',1,'policy','2026-07-24','COMPLETE','candidate-a',NULL,'digest',NULL,'fixture','2026-07-24T09:00:00Z');
 INSERT INTO opportunity_candidate_snapshots VALUES('candidate-a','workspace-a',1,'lead-a','${j({subject_id:'lead-a',business_name:'ABC Dental Care',domain:'abcdentalcare.co.uk',geography:'Manchester, UK'})}','auth','${j([{reference_id:'EVI-1',source_type:'EVIDENCE_IDENTITY',investigation_id:'lead-a',source_path:'evidence',evidence_id:'EVI-1'}])}','${j({confidence_classification:'HIGH',material_limitations:['Decision-maker not confirmed']})}','digest','2026-07-24','[]','ELIGIBLE','CURRENT_PIPELINE','2026-07-24T09:00:00Z');
 INSERT INTO opportunity_candidate_outcomes VALUES('candidate-a','workspace-a',1,'LEAD','High-potential opportunity to improve patient enquiries.','Strong fit','Decision-maker unavailable','HIGH','Material evidence change','Review opportunity');
 INSERT INTO opportunity_offer_recommendations VALUES('offer-a','workspace-a',1,'candidate-a','Conversion-focused appointment booking optimisation','Mobile booking friction','Plausible improvement in patient enquiries','Strong evidence fit','[]','["Traffic remains stable"]','["Outcome not guaranteed"]','RECOMMENDED','policy','2026-07-24T09:00:00Z');
 INSERT INTO opportunity_offer_decisions VALUES('offer-decision-a','offer-a','tenant-a','ACCEPTED',NULL,'Controlled fixture','2026-07-24T09:00:00Z');
 INSERT INTO opportunity_commercial_estimates VALUES('fee','workspace-a',1,'CONSULTANT_FEE',4000,7000,'GBP','One-off project','["Scope"]','["Capacity"]','["Final price"]','Evidence-bounded range','MEDIUM','["EVI-1"]','policy','2026-07-24T09:00:00Z');
 INSERT INTO opportunity_commercial_estimates VALUES('upside','workspace-a',1,'CLIENT_UPSIDE',120000,180000,'GBP','Annual revenue opportunity','["Public demand"]','["Stable traffic"]','["Internal analytics"]','Evidence-bounded scenario','MEDIUM','["EVI-1"]','policy','2026-07-24T09:00:00Z');
 INSERT INTO opportunity_contact_snapshots VALUES('contact','workspace-a',1,'${j({name:'Sarah Mitchell',role:'Practice Manager',email:'sarah@example.test',phone:'+44 161 123 4567',domain:'abcdentalcare.co.uk'})}','${j({business_identity:'VERIFIED',contact_identity:'VERIFIED',contact_role:'VERIFIED',email:'VERIFIED',phone:'VERIFIED',domain:'VERIFIED',decision_authority:'UNCONFIRMED'})}','{}','policy','2026-07-24T09:00:00Z');`);
 db.close();
 const router=require('./backend/routes/opportunity-workspaces');const {requireOpportunityWorkspace}=require('./backend/config/opportunity-workspace');
 const app=express();app.use(express.json());app.use('/api/opportunity-workspaces',requireOpportunityWorkspace,router);
 const server=app.listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject)});
 const base=`http://127.0.0.1:${server.address().port}`;const token=user=>jwt.sign({id:user,email:`${user}@example.test`,plan:'agency'},'leadsprout-super-secret-key-2026');
 const request=async(route,user='tenant-a')=>{const response=await fetch(base+route,{headers:{Authorization:`Bearer ${token(user)}`}});return{response,body:await response.json()}};
 delete process.env.OPPORTUNITY_WORKSPACE_ENABLED;let result=await request('/api/opportunity-workspaces/dashboard');assert.strictEqual(result.response.status,404);
 process.env.OPPORTUNITY_WORKSPACE_ENABLED='true';
 result=await request('/api/opportunity-workspaces/dashboard');assert.strictEqual(result.response.status,200);assert.strictEqual(result.body.strongest_opportunity.business.business_name,'ABC Dental Care');assert.strictEqual(result.body.strongest_opportunity.location,'Manchester, UK');assert.strictEqual(result.body.strongest_opportunity.confidence_score,null);assert.strictEqual(result.body.strongest_opportunity.outreach_eligible,false);assert.strictEqual(result.body.opportunities.length,1);assert.strictEqual(result.body.opportunities[0].priority,true);assert.strictEqual(result.body.opportunities[0].monitored,false);assert.strictEqual(result.body.period.state,'UNAVAILABLE');assert.strictEqual(result.body.momentum.state,'UNAVAILABLE');assert.strictEqual(result.body.at_a_glance.priority_changes,null);assert(result.body.metrics.attributed_revenue.source_name);
 result=await request('/api/opportunity-workspaces');assert.strictEqual(result.response.status,200);assert.strictEqual(result.body.ordering,'SERVER_DERIVED');assert.strictEqual(result.body.opportunities[0].rank,1);
 result=await request('/api/opportunity-workspaces/workspace-a/opportunity');assert.strictEqual(result.response.status,200);assert.strictEqual(result.body.estimates.consultant_fee.non_guaranteed,true);assert.strictEqual(result.body.contact.field_states.decision_authority,'UNCONFIRMED');assert.strictEqual(result.body.outreach_eligible,false);
 result=await request('/api/opportunity-workspaces/workspace-a/opportunity','tenant-b');assert.strictEqual(result.response.status,404);
 result=await request('/api/opportunity-workspaces/workspace-a/proposal-summary');assert.strictEqual(result.response.status,409);
 delete process.env.OPPORTUNITY_WORKSPACE_ENABLED;await new Promise(resolve=>server.close(resolve));fs.rmSync(temp,{recursive:true,force:true});
 console.log('Commercial Opportunity Design authenticated dashboard, list, detail, unavailability, tenant and proposal gate API verification: PASS');
})().catch(error=>{console.error(error);process.exit(1)});
