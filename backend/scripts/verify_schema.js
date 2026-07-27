const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { IndependentEvidenceIntegrityGate } = require('../utils/evidence-integrity-authority');

const MIGRATIONS = Object.freeze([
  '001_evidence_identity_foundation.sql',
  '002_opportunity_workspace.sql',
  '003_commercial_opportunity_design_states.sql',
  '004_evidence_integrity_operational.sql'
]);

class MigrationControlError extends Error {
  constructor(code) {
    super(code);
    this.name = 'MigrationControlError';
    this.code = code;
  }
}

function fail(code) {
  throw new MigrationControlError(code);
}

function featureDisabled(value = process.env.OPPORTUNITY_WORKSPACE_ENABLED) {
  if (value !== undefined && value !== 'false') fail('FEATURE_STATE_INVALID');
  return true;
}

function migrationInventory(migrationsDir = path.join(__dirname, '../migrations')) {
  return MIGRATIONS.map((filename, index) => {
    const content = fs.readFileSync(path.join(migrationsDir, filename));
    return Object.freeze({
      migration_id: filename.slice(0, 3),
      filename,
      sequence: index + 1,
      checksum: crypto.createHash('sha256').update(content).digest('hex'),
      content: content.toString('utf8')
    });
  });
}

function loadDependency(reference, namedExport) {
  if (!reference) return undefined;
  try {
    const loaded = require(reference);
    const dependency = loaded[namedExport] || loaded.default || loaded;
    if (!dependency || typeof dependency !== 'object') return undefined;
    return dependency;
  } catch (_) {
    return undefined;
  }
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const EXPECTED_SCHEMA_MANIFEST = deepFreeze({
  tables: {
    "customer_capability_profiles": {"name":"customer_capability_profiles","sql":"createtablecustomer_capability_profiles(profile_idtextprimarykey,user_idtextnotnull,versionintegernotnull,service_capabilities_jsontextnotnull,delivery_constraints_jsontextnotnull,geography_jsontextnotnull,capacitytextnotnull,exclusions_jsontextnotnull,disqualifiers_jsontextnotnull,created_attextnotnull,unique(user_id,version),foreignkey(user_id)referencesusers(id)ondeleterestrict)","columns":[["profile_id","TEXT",0,null,1],["user_id","TEXT",1,null,0],["version","INTEGER",1,null,0],["service_capabilities_json","TEXT",1,null,0],["delivery_constraints_json","TEXT",1,null,0],["geography_json","TEXT",1,null,0],["capacity","TEXT",1,null,0],["exclusions_json","TEXT",1,null,0],["disqualifiers_json","TEXT",1,null,0],["created_at","TEXT",1,null,0]],"foreignKeys":[[0,0,"users","user_id","id","NO ACTION","RESTRICT","NONE"]],"indexes":[["idx_capability_profiles_owner",0,"c",0,[[1,"user_id"],[2,"version"]],"createindexidx_capability_profiles_owneroncustomer_capability_profiles(user_id,version)"],[null,1,"pk",0,[[0,"profile_id"]],""],[null,1,"u",0,[[1,"user_id"],[2,"version"]],""]]},
    "evidence_authorisation_evidence_identities": {"name":"evidence_authorisation_evidence_identities","sql":"createtableevidence_authorisation_evidence_identities(contract_idtextnotnull,evidence_idtextnotnull,lifecycle_state_at_decisiontextnotnullcheck(lifecycle_state_at_decisionin('active','superseded','invalidated')),primarykey(contract_id,evidence_id),foreignkey(contract_id)referencesevidence_authorisations(contract_id)ondeleterestrict,foreignkey(evidence_id)referencesevidence_identities(evidence_id)ondeleterestrict)","columns":[["contract_id","TEXT",1,null,1],["evidence_id","TEXT",1,null,2],["lifecycle_state_at_decision","TEXT",1,null,0]],"foreignKeys":[[0,0,"evidence_identities","evidence_id","evidence_id","NO ACTION","RESTRICT","NONE"],[1,0,"evidence_authorisations","contract_id","contract_id","NO ACTION","RESTRICT","NONE"]],"indexes":[[null,1,"pk",0,[[0,"contract_id"],[1,"evidence_id"]],""]]},
    "evidence_authorisations": {"name":"evidence_authorisations","sql":"createtableevidence_authorisations(contract_idtextprimarykey,lead_idtextnotnull,outcometextnotnull,contract_jsontextnotnull,supersedes_contract_idtextdefaultnull,created_attextdefaultcurrent_timestamp)","columns":[["contract_id","TEXT",0,null,1],["lead_id","TEXT",1,null,0],["outcome","TEXT",1,null,0],["contract_json","TEXT",1,null,0],["supersedes_contract_id","TEXT",0,"null",0],["created_at","TEXT",0,"current_timestamp",0]],"foreignKeys":[],"indexes":[[null,1,"pk",0,[[0,"contract_id"]],""]]},
    "evidence_identities": {"name":"evidence_identities","sql":"createtableevidence_identities(evidence_idtextprimarykey,schema_versiontextnotnull,standard_versionintegernotnull,item_kindtextnotnullcheck(item_kindin('source','fragment','derived')),subject_business_idtextnotnull,source_namespacetextnotnull,source_locatortextnotnull,observed_attextnotnull,content_sha256textnotnull,fragment_locatortextnotnulldefault'',parent_evidence_ids_jsontextnotnulldefault'',derivation_profiletextnotnulldefault'',canonical_payload_digesttextnotnullunique,provenance_record_idtextnotnull,source_profile_versiontextnotnull,derivation_profile_versiontextdefaultnull,lifecycle_statetextnotnullcheck(lifecycle_statein('active','superseded','invalidated')),supersedes_evidence_idtextdefaultnull,superseded_by_evidence_idtextdefaultnull,created_attextnotnull)","columns":[["evidence_id","TEXT",0,null,1],["schema_version","TEXT",1,null,0],["standard_version","INTEGER",1,null,0],["item_kind","TEXT",1,null,0],["subject_business_id","TEXT",1,null,0],["source_namespace","TEXT",1,null,0],["source_locator","TEXT",1,null,0],["observed_at","TEXT",1,null,0],["content_sha256","TEXT",1,null,0],["fragment_locator","TEXT",1,"''",0],["parent_evidence_ids_json","TEXT",1,"'[]'",0],["derivation_profile","TEXT",1,"''",0],["canonical_payload_digest","TEXT",1,null,0],["provenance_record_id","TEXT",1,null,0],["source_profile_version","TEXT",1,null,0],["derivation_profile_version","TEXT",0,"null",0],["lifecycle_state","TEXT",1,null,0],["supersedes_evidence_id","TEXT",0,"null",0],["superseded_by_evidence_id","TEXT",0,"null",0],["created_at","TEXT",1,null,0]],"foreignKeys":[],"indexes":[["idx_evidence_identities_subject",0,"c",0,[[4,"subject_business_id"],[16,"lifecycle_state"]],"createindexidx_evidence_identities_subjectonevidence_identities(subject_business_id,lifecycle_state)"],[null,1,"pk",0,[[0,"evidence_id"]],""],[null,1,"u",0,[[12,"canonical_payload_digest"]],""]]},
    "evidence_identity_authorisation_baselines": {"name":"evidence_identity_authorisation_baselines","sql":"createtableevidence_identity_authorisation_baselines(contract_idtextnotnull,evidence_idtextnotnull,snapshot_digesttextnotnullunique,primarykey(contract_id,evidence_id))","columns":[["contract_id","TEXT",1,null,1],["evidence_id","TEXT",1,null,2],["snapshot_digest","TEXT",1,null,0]],"foreignKeys":[],"indexes":[[null,1,"pk",0,[[0,"contract_id"],[1,"evidence_id"]],""],[null,1,"u",0,[[2,"snapshot_digest"]],""]]},
    "evidence_identity_integrity_state": {"name":"evidence_identity_integrity_state","sql":"createtableevidence_identity_integrity_state(store_idtextprimarykeycheck(store_id='evidence_identity'),identity_countintegernotnull,lifecycle_event_countintegernotnull,authorisation_link_countintegernotnull,initialized_attextnotnull)","columns":[["store_id","TEXT",0,null,1],["identity_count","INTEGER",1,null,0],["lifecycle_event_count","INTEGER",1,null,0],["authorisation_link_count","INTEGER",1,null,0],["initialized_at","TEXT",1,null,0]],"foreignKeys":[],"indexes":[[null,1,"pk",0,[[0,"store_id"]],""]]},
    "evidence_identity_lifecycle_baselines": {"name":"evidence_identity_lifecycle_baselines","sql":"createtableevidence_identity_lifecycle_baselines(event_digesttextprimarykey,evidence_idtextnotnull)","columns":[["event_digest","TEXT",0,null,1],["evidence_id","TEXT",1,null,0]],"foreignKeys":[],"indexes":[[null,1,"pk",0,[[0,"event_digest"]],""]]},
    "evidence_identity_lifecycle_events": {"name":"evidence_identity_lifecycle_events","sql":"createtableevidence_identity_lifecycle_events(event_idintegerprimarykeyautoincrement,evidence_idtextnotnull,from_statetextdefaultnull,to_statetextnotnullcheck(to_statein('active','superseded','invalidated')),reasontextnotnull,responsible_authoritytextnotnull,occurred_attextnotnull,foreignkey(evidence_id)referencesevidence_identities(evidence_id))","columns":[["event_id","INTEGER",0,null,1],["evidence_id","TEXT",1,null,0],["from_state","TEXT",0,"null",0],["to_state","TEXT",1,null,0],["reason","TEXT",1,null,0],["responsible_authority","TEXT",1,null,0],["occurred_at","TEXT",1,null,0]],"foreignKeys":[[0,0,"evidence_identities","evidence_id","evidence_id","NO ACTION","NO ACTION","NONE"]],"indexes":[["idx_evidence_identity_events",0,"c",0,[[1,"evidence_id"],[0,"event_id"]],"createindexidx_evidence_identity_eventsonevidence_identity_lifecycle_events(evidence_id,event_id)"]]},
    "evidence_identity_record_baselines": {"name":"evidence_identity_record_baselines","sql":"createtableevidence_identity_record_baselines(evidence_idtextprimarykey,immutable_digesttextnotnullunique,provenance_record_idtextnotnull)","columns":[["evidence_id","TEXT",0,null,1],["immutable_digest","TEXT",1,null,0],["provenance_record_id","TEXT",1,null,0]],"foreignKeys":[],"indexes":[[null,1,"pk",0,[[0,"evidence_id"]],""],[null,1,"u",0,[[1,"immutable_digest"]],""]]},
    "evidence_integrity_decision_evidence": {"name":"evidence_integrity_decision_evidence","sql":"createtableevidence_integrity_decision_evidence(decision_idtextnotnull,evidence_idtextnotnull,claim_classes_jsontextnotnull,parent_evidence_ids_jsontextnotnull,primarykey(decision_id,evidence_id),foreignkey(decision_id)referencesevidence_integrity_decisions(decision_id)ondeleterestrict)","columns":[["decision_id","TEXT",1,null,1],["evidence_id","TEXT",1,null,2],["claim_classes_json","TEXT",1,null,0],["parent_evidence_ids_json","TEXT",1,null,0]],"foreignKeys":[[0,0,"evidence_integrity_decisions","decision_id","decision_id","NO ACTION","RESTRICT","NONE"]],"indexes":[[null,1,"pk",0,[[0,"decision_id"],[1,"evidence_id"]],""]]},
    "evidence_integrity_decisions": {"name":"evidence_integrity_decisions","sql":"createtableevidence_integrity_decisions(decision_idtextprimarykey,subject_idtextnotnull,outcometextnotnullcheck(outcomein('eligible','limited','refused','reassessment_required')),envelope_jsontextnotnull,decision_digesttextnotnullunique,bundle_idtextnotnull,bundle_versiontextnotnull,bundle_digesttextnotnull,supersedes_decision_idtext,superseded_by_decision_idtext,lifecycle_statetextnotnullcheck(lifecycle_statein('current','superseded','invalidated')),created_attextnotnull,foreignkey(supersedes_decision_id)referencesevidence_integrity_decisions(decision_id))","columns":[["decision_id","TEXT",0,null,1],["subject_id","TEXT",1,null,0],["outcome","TEXT",1,null,0],["envelope_json","TEXT",1,null,0],["decision_digest","TEXT",1,null,0],["bundle_id","TEXT",1,null,0],["bundle_version","TEXT",1,null,0],["bundle_digest","TEXT",1,null,0],["supersedes_decision_id","TEXT",0,null,0],["superseded_by_decision_id","TEXT",0,null,0],["lifecycle_state","TEXT",1,null,0],["created_at","TEXT",1,null,0]],"foreignKeys":[[0,0,"evidence_integrity_decisions","supersedes_decision_id","decision_id","NO ACTION","NO ACTION","NONE"]],"indexes":[["idx_evidence_integrity_current_subject",1,"c",1,[[1,"subject_id"]],"createuniqueindexidx_evidence_integrity_current_subjectonevidence_integrity_decisions(subject_id)wherelifecycle_state='current'"],[null,1,"pk",0,[[0,"decision_id"]],""],[null,1,"u",0,[[4,"decision_digest"]],""]]},
    "evidence_integrity_dependent_reasoning": {"name":"evidence_integrity_dependent_reasoning","sql":"createtableevidence_integrity_dependent_reasoning(reasoning_idtextprimarykey,decision_idtextnotnull,output_digesttextnotnull,validintegernotnullcheck(validin(0,1)),invalidated_attext,invalidation_reasontext,created_attextnotnull,foreignkey(decision_id)referencesevidence_integrity_decisions(decision_id)ondeleterestrict)","columns":[["reasoning_id","TEXT",0,null,1],["decision_id","TEXT",1,null,0],["output_digest","TEXT",1,null,0],["valid","INTEGER",1,null,0],["invalidated_at","TEXT",0,null,0],["invalidation_reason","TEXT",0,null,0],["created_at","TEXT",1,null,0]],"foreignKeys":[[0,0,"evidence_integrity_decisions","decision_id","decision_id","NO ACTION","RESTRICT","NONE"]],"indexes":[[null,1,"pk",0,[[0,"reasoning_id"]],""]]},
    "evidence_integrity_lifecycle_events": {"name":"evidence_integrity_lifecycle_events","sql":"createtableevidence_integrity_lifecycle_events(event_idtextprimarykey,subject_idtextnotnull,prior_decision_idtext,new_decision_idtextnotnull,trigger_codes_jsontextnotnull,occurred_attextnotnull,foreignkey(prior_decision_id)referencesevidence_integrity_decisions(decision_id),foreignkey(new_decision_id)referencesevidence_integrity_decisions(decision_id))","columns":[["event_id","TEXT",0,null,1],["subject_id","TEXT",1,null,0],["prior_decision_id","TEXT",0,null,0],["new_decision_id","TEXT",1,null,0],["trigger_codes_json","TEXT",1,null,0],["occurred_at","TEXT",1,null,0]],"foreignKeys":[[0,0,"evidence_integrity_decisions","new_decision_id","decision_id","NO ACTION","NO ACTION","NONE"],[1,0,"evidence_integrity_decisions","prior_decision_id","decision_id","NO ACTION","NO ACTION","NONE"]],"indexes":[[null,1,"pk",0,[[0,"event_id"]],""]]},
    "opportunity_attribution_snapshots": {"name":"opportunity_attribution_snapshots","sql":"createtableopportunity_attribution_snapshots(attribution_idtextprimarykey,workspace_idtextnotnull,workspace_versionintegernotnull,metric_keytextnotnull,value_jsontextnotnull,source_nametextnotnull,source_referencetext,created_attextnotnull,unique(workspace_id,workspace_version,metric_key),foreignkey(workspace_id,workspace_version)referencesopportunity_workspace_versions(workspace_id,version)ondeleterestrict)","columns":[["attribution_id","TEXT",0,null,1],["workspace_id","TEXT",1,null,0],["workspace_version","INTEGER",1,null,0],["metric_key","TEXT",1,null,0],["value_json","TEXT",1,null,0],["source_name","TEXT",1,null,0],["source_reference","TEXT",0,null,0],["created_at","TEXT",1,null,0]],"foreignKeys":[[0,0,"opportunity_workspace_versions","workspace_id","workspace_id","NO ACTION","RESTRICT","NONE"],[0,1,"opportunity_workspace_versions","workspace_version","version","NO ACTION","RESTRICT","NONE"]],"indexes":[["idx_attribution_dashboard",0,"c",0,[[1,"workspace_id"],[2,"workspace_version"],[3,"metric_key"]],"createindexidx_attribution_dashboardonopportunity_attribution_snapshots(workspace_id,workspace_version,metric_key)"],[null,1,"pk",0,[[0,"attribution_id"]],""],[null,1,"u",0,[[1,"workspace_id"],[2,"workspace_version"],[3,"metric_key"]],""]]},
    "opportunity_candidate_outcomes": {"name":"opportunity_candidate_outcomes","sql":"createtableopportunity_candidate_outcomes(candidate_snapshot_idtextprimarykey,workspace_idtextnotnull,workspace_versionintegernotnull,outcometextnotnull,decisive_reasontextnotnull,differentiatortextnotnull,limitationtext,confidence_basistextnotnull,priority_change_conditiontextnotnull,next_actiontextnotnull,foreignkey(candidate_snapshot_id)referencesopportunity_candidate_snapshots(snapshot_id)ondeleterestrict)","columns":[["candidate_snapshot_id","TEXT",0,null,1],["workspace_id","TEXT",1,null,0],["workspace_version","INTEGER",1,null,0],["outcome","TEXT",1,null,0],["decisive_reason","TEXT",1,null,0],["differentiator","TEXT",1,null,0],["limitation","TEXT",0,null,0],["confidence_basis","TEXT",1,null,0],["priority_change_condition","TEXT",1,null,0],["next_action","TEXT",1,null,0]],"foreignKeys":[[0,0,"opportunity_candidate_snapshots","candidate_snapshot_id","snapshot_id","NO ACTION","RESTRICT","NONE"]],"indexes":[[null,1,"pk",0,[[0,"candidate_snapshot_id"]],""]]},
    "opportunity_candidate_snapshots": {"name":"opportunity_candidate_snapshots","sql":"createtableopportunity_candidate_snapshots(snapshot_idtextprimarykey,workspace_idtextnotnull,workspace_versionintegernotnull,lead_idtextnotnull,subject_identity_jsontextnotnull,evidence_authorisation_idtext,evidence_references_jsontextnotnull,opportunity_understanding_jsontextnotnull,evidence_digesttextnotnull,freshnesstextnotnull,contradictions_jsontextnotnull,eligibility_statustextnotnull,comparison_contexttextnotnull,captured_attextnotnull,unique(workspace_id,workspace_version,lead_id),foreignkey(workspace_id)referencesopportunity_workspaces(workspace_id)ondeleterestrict,foreignkey(lead_id)referencesleads(id)ondeleterestrict)","columns":[["snapshot_id","TEXT",0,null,1],["workspace_id","TEXT",1,null,0],["workspace_version","INTEGER",1,null,0],["lead_id","TEXT",1,null,0],["subject_identity_json","TEXT",1,null,0],["evidence_authorisation_id","TEXT",0,null,0],["evidence_references_json","TEXT",1,null,0],["opportunity_understanding_json","TEXT",1,null,0],["evidence_digest","TEXT",1,null,0],["freshness","TEXT",1,null,0],["contradictions_json","TEXT",1,null,0],["eligibility_status","TEXT",1,null,0],["comparison_context","TEXT",1,null,0],["captured_at","TEXT",1,null,0]],"foreignKeys":[[0,0,"leads","lead_id","id","NO ACTION","RESTRICT","NONE"],[1,0,"opportunity_workspaces","workspace_id","workspace_id","NO ACTION","RESTRICT","NONE"]],"indexes":[["idx_candidate_snapshots_version",0,"c",0,[[1,"workspace_id"],[2,"workspace_version"]],"createindexidx_candidate_snapshots_versiononopportunity_candidate_snapshots(workspace_id,workspace_version)"],[null,1,"pk",0,[[0,"snapshot_id"]],""],[null,1,"u",0,[[1,"workspace_id"],[2,"workspace_version"],[3,"lead_id"]],""]]},
    "opportunity_commercial_estimates": {"name":"opportunity_commercial_estimates","sql":"createtableopportunity_commercial_estimates(estimate_idtextprimarykey,workspace_idtextnotnull,workspace_versionintegernotnull,estimate_typetextnotnullcheck(estimate_typein('consultant_fee','client_upside')),value_lowinteger,value_highinteger,currencytext,periodtext,inputs_jsontextnotnull,assumptions_jsontextnotnull,unavailable_information_jsontextnotnull,methodtextnotnull,confidencetextnotnull,evidence_references_jsontextnotnull,policy_versiontextnotnull,created_attextnotnull,unique(workspace_id,workspace_version,estimate_type),foreignkey(workspace_id,workspace_version)referencesopportunity_workspace_versions(workspace_id,version)ondeleterestrict)","columns":[["estimate_id","TEXT",0,null,1],["workspace_id","TEXT",1,null,0],["workspace_version","INTEGER",1,null,0],["estimate_type","TEXT",1,null,0],["value_low","INTEGER",0,null,0],["value_high","INTEGER",0,null,0],["currency","TEXT",0,null,0],["period","TEXT",0,null,0],["inputs_json","TEXT",1,null,0],["assumptions_json","TEXT",1,null,0],["unavailable_information_json","TEXT",1,null,0],["method","TEXT",1,null,0],["confidence","TEXT",1,null,0],["evidence_references_json","TEXT",1,null,0],["policy_version","TEXT",1,null,0],["created_at","TEXT",1,null,0]],"foreignKeys":[[0,0,"opportunity_workspace_versions","workspace_id","workspace_id","NO ACTION","RESTRICT","NONE"],[0,1,"opportunity_workspace_versions","workspace_version","version","NO ACTION","RESTRICT","NONE"]],"indexes":[["idx_commercial_estimates_current",0,"c",0,[[1,"workspace_id"],[2,"workspace_version"],[3,"estimate_type"]],"createindexidx_commercial_estimates_currentonopportunity_commercial_estimates(workspace_id,workspace_version,estimate_type)"],[null,1,"pk",0,[[0,"estimate_id"]],""],[null,1,"u",0,[[1,"workspace_id"],[2,"workspace_version"],[3,"estimate_type"]],""]]},
    "opportunity_contact_snapshots": {"name":"opportunity_contact_snapshots","sql":"createtableopportunity_contact_snapshots(contact_snapshot_idtextprimarykey,workspace_idtextnotnull,workspace_versionintegernotnull,contact_jsontextnotnull,field_states_jsontextnotnull,provenance_jsontextnotnull,policy_versiontextnotnull,created_attextnotnull,unique(workspace_id,workspace_version),foreignkey(workspace_id,workspace_version)referencesopportunity_workspace_versions(workspace_id,version)ondeleterestrict)","columns":[["contact_snapshot_id","TEXT",0,null,1],["workspace_id","TEXT",1,null,0],["workspace_version","INTEGER",1,null,0],["contact_json","TEXT",1,null,0],["field_states_json","TEXT",1,null,0],["provenance_json","TEXT",1,null,0],["policy_version","TEXT",1,null,0],["created_at","TEXT",1,null,0]],"foreignKeys":[[0,0,"opportunity_workspace_versions","workspace_id","workspace_id","NO ACTION","RESTRICT","NONE"],[0,1,"opportunity_workspace_versions","workspace_version","version","NO ACTION","RESTRICT","NONE"]],"indexes":[["idx_contact_snapshots_current",0,"c",0,[[1,"workspace_id"],[2,"workspace_version"]],"createindexidx_contact_snapshots_currentonopportunity_contact_snapshots(workspace_id,workspace_version)"],[null,1,"pk",0,[[0,"contact_snapshot_id"]],""],[null,1,"u",0,[[1,"workspace_id"],[2,"workspace_version"]],""]]},
    "opportunity_contact_verification_snapshots": {"name":"opportunity_contact_verification_snapshots","sql":"createtableopportunity_contact_verification_snapshots(snapshot_idtextprimarykey,review_idtextnotnull,field_states_jsontextnotnull,provenance_jsontextnotnull,snapshot_digesttextnotnull,created_attextnotnull,foreignkey(review_id)referencesopportunity_reviews(review_id)ondeleterestrict)","columns":[["snapshot_id","TEXT",0,null,1],["review_id","TEXT",1,null,0],["field_states_json","TEXT",1,null,0],["provenance_json","TEXT",1,null,0],["snapshot_digest","TEXT",1,null,0],["created_at","TEXT",1,null,0]],"foreignKeys":[[0,0,"opportunity_reviews","review_id","review_id","NO ACTION","RESTRICT","NONE"]],"indexes":[[null,1,"pk",0,[[0,"snapshot_id"]],""]]},
    "opportunity_conversation_preparations": {"name":"opportunity_conversation_preparations","sql":"createtableopportunity_conversation_preparations(conversation_idtextprimarykey,workspace_idtextnotnull,workspace_versionintegernotnull,offer_idtextnotnull,target_role_categorytextnotnull,observed_conditiontextnotnull,business_relevancetextnotnull,bounded_questiontextnotnull,offer_to_exploretextnotnull,evidence_nodes_jsontextnotnull,confidence_languagetextnotnull,limitations_jsontextnotnull,system_versiontextnotnull,customer_adaptationtext,created_attextnotnull,foreignkey(offer_id)referencesopportunity_offer_recommendations(offer_id)ondeleterestrict)","columns":[["conversation_id","TEXT",0,null,1],["workspace_id","TEXT",1,null,0],["workspace_version","INTEGER",1,null,0],["offer_id","TEXT",1,null,0],["target_role_category","TEXT",1,null,0],["observed_condition","TEXT",1,null,0],["business_relevance","TEXT",1,null,0],["bounded_question","TEXT",1,null,0],["offer_to_explore","TEXT",1,null,0],["evidence_nodes_json","TEXT",1,null,0],["confidence_language","TEXT",1,null,0],["limitations_json","TEXT",1,null,0],["system_version","TEXT",1,null,0],["customer_adaptation","TEXT",0,null,0],["created_at","TEXT",1,null,0]],"foreignKeys":[[0,0,"opportunity_offer_recommendations","offer_id","offer_id","NO ACTION","RESTRICT","NONE"]],"indexes":[[null,1,"pk",0,[[0,"conversation_id"]],""]]},
    "opportunity_decision_nodes": {"name":"opportunity_decision_nodes","sql":"createtableopportunity_decision_nodes(node_idtextprimarykey,workspace_idtextnotnull,workspace_versionintegernotnull,candidate_snapshot_idtextnotnull,typetextnotnull,statementtextnotnull,confidencetextnotnull,evidence_references_jsontextnotnull,parent_node_references_jsontextnotnull,assumptions_jsontextnotnull,limitations_jsontextnotnull,created_attextnotnull,foreignkey(candidate_snapshot_id)referencesopportunity_candidate_snapshots(snapshot_id)ondeleterestrict)","columns":[["node_id","TEXT",0,null,1],["workspace_id","TEXT",1,null,0],["workspace_version","INTEGER",1,null,0],["candidate_snapshot_id","TEXT",1,null,0],["type","TEXT",1,null,0],["statement","TEXT",1,null,0],["confidence","TEXT",1,null,0],["evidence_references_json","TEXT",1,null,0],["parent_node_references_json","TEXT",1,null,0],["assumptions_json","TEXT",1,null,0],["limitations_json","TEXT",1,null,0],["created_at","TEXT",1,null,0]],"foreignKeys":[[0,0,"opportunity_candidate_snapshots","candidate_snapshot_id","snapshot_id","NO ACTION","RESTRICT","NONE"]],"indexes":[[null,1,"pk",0,[[0,"node_id"]],""]]},
    "opportunity_next_action_events": {"name":"opportunity_next_action_events","sql":"createtableopportunity_next_action_events(event_idtextprimarykey,action_idtextnotnull,user_idtextnotnull,from_statetext,to_statetextnotnull,occurred_attextnotnull,foreignkey(action_id)referencesopportunity_next_actions(action_id)ondeleterestrict)","columns":[["event_id","TEXT",0,null,1],["action_id","TEXT",1,null,0],["user_id","TEXT",1,null,0],["from_state","TEXT",0,null,0],["to_state","TEXT",1,null,0],["occurred_at","TEXT",1,null,0]],"foreignKeys":[[0,0,"opportunity_next_actions","action_id","action_id","NO ACTION","RESTRICT","NONE"]],"indexes":[[null,1,"pk",0,[[0,"event_id"]],""]]},
    "opportunity_next_actions": {"name":"opportunity_next_actions","sql":"createtableopportunity_next_actions(action_idtextprimarykey,workspace_idtextnotnull,workspace_versionintegernotnull,user_idtextnotnull,typetextnotnull,ownertextnotnull,statetextnotnull,rationaletextnotnull,due_attext,occurred_attext,outcome_notetext,created_attextnotnull,updated_attextnotnull,foreignkey(workspace_id)referencesopportunity_workspaces(workspace_id)ondeleterestrict,foreignkey(user_id)referencesusers(id)ondeleterestrict)","columns":[["action_id","TEXT",0,null,1],["workspace_id","TEXT",1,null,0],["workspace_version","INTEGER",1,null,0],["user_id","TEXT",1,null,0],["type","TEXT",1,null,0],["owner","TEXT",1,null,0],["state","TEXT",1,null,0],["rationale","TEXT",1,null,0],["due_at","TEXT",0,null,0],["occurred_at","TEXT",0,null,0],["outcome_note","TEXT",0,null,0],["created_at","TEXT",1,null,0],["updated_at","TEXT",1,null,0]],"foreignKeys":[[0,0,"users","user_id","id","NO ACTION","RESTRICT","NONE"],[1,0,"opportunity_workspaces","workspace_id","workspace_id","NO ACTION","RESTRICT","NONE"]],"indexes":[[null,1,"pk",0,[[0,"action_id"]],""]]},
    "opportunity_offer_decisions": {"name":"opportunity_offer_decisions","sql":"createtableopportunity_offer_decisions(decision_idtextprimarykey,offer_idtextnotnull,user_idtextnotnull,decisiontextnotnullcheck(decisionin('accepted','adapted','rejected')),adaptation_texttext,rationaletext,created_attextnotnull,foreignkey(offer_id)referencesopportunity_offer_recommendations(offer_id)ondeleterestrict,foreignkey(user_id)referencesusers(id)ondeleterestrict)","columns":[["decision_id","TEXT",0,null,1],["offer_id","TEXT",1,null,0],["user_id","TEXT",1,null,0],["decision","TEXT",1,null,0],["adaptation_text","TEXT",0,null,0],["rationale","TEXT",0,null,0],["created_at","TEXT",1,null,0]],"foreignKeys":[[0,0,"users","user_id","id","NO ACTION","RESTRICT","NONE"],[1,0,"opportunity_offer_recommendations","offer_id","offer_id","NO ACTION","RESTRICT","NONE"]],"indexes":[[null,1,"pk",0,[[0,"decision_id"]],""]]},
    "opportunity_offer_recommendations": {"name":"opportunity_offer_recommendations","sql":"createtableopportunity_offer_recommendations(offer_idtextprimarykey,workspace_idtextnotnull,workspace_versionintegernotnull,candidate_snapshot_idtext,primary_service_directiontext,problem_fittext,intended_qualitative_outcometext,why_firsttext,evidence_nodes_jsontextnotnull,assumptions_jsontextnotnull,limitations_jsontextnotnull,resulttextnotnull,policy_versiontextnotnull,created_attextnotnull,unique(workspace_id,workspace_version),foreignkey(candidate_snapshot_id)referencesopportunity_candidate_snapshots(snapshot_id)ondeleterestrict)","columns":[["offer_id","TEXT",0,null,1],["workspace_id","TEXT",1,null,0],["workspace_version","INTEGER",1,null,0],["candidate_snapshot_id","TEXT",0,null,0],["primary_service_direction","TEXT",0,null,0],["problem_fit","TEXT",0,null,0],["intended_qualitative_outcome","TEXT",0,null,0],["why_first","TEXT",0,null,0],["evidence_nodes_json","TEXT",1,null,0],["assumptions_json","TEXT",1,null,0],["limitations_json","TEXT",1,null,0],["result","TEXT",1,null,0],["policy_version","TEXT",1,null,0],["created_at","TEXT",1,null,0]],"foreignKeys":[[0,0,"opportunity_candidate_snapshots","candidate_snapshot_id","snapshot_id","NO ACTION","RESTRICT","NONE"]],"indexes":[[null,1,"pk",0,[[0,"offer_id"]],""],[null,1,"u",0,[[1,"workspace_id"],[2,"workspace_version"]],""]]},
    "opportunity_outreach_progression_events": {"name":"opportunity_outreach_progression_events","sql":"createtableopportunity_outreach_progression_events(event_idtextprimarykey,completion_idtextnotnull,workspace_idtextnotnull,workspace_versionintegernotnull,user_idtextnotnull,transition_typetextnotnullcheck(transition_typein('pursue','qualify','research','defer','decline','archive','prepare')),idempotency_keytextnotnull,selected_attextnotnull,unique(user_id,idempotency_key),foreignkey(completion_id)referencesopportunity_review_completions(completion_id)ondeleterestrict)","columns":[["event_id","TEXT",0,null,1],["completion_id","TEXT",1,null,0],["workspace_id","TEXT",1,null,0],["workspace_version","INTEGER",1,null,0],["user_id","TEXT",1,null,0],["transition_type","TEXT",1,null,0],["idempotency_key","TEXT",1,null,0],["selected_at","TEXT",1,null,0]],"foreignKeys":[[0,0,"opportunity_review_completions","completion_id","completion_id","NO ACTION","RESTRICT","NONE"]],"indexes":[[null,1,"pk",0,[[0,"event_id"]],""],[null,1,"u",0,[[4,"user_id"],[6,"idempotency_key"]],""]]},
    "opportunity_proposal_summaries": {"name":"opportunity_proposal_summaries","sql":"createtableopportunity_proposal_summaries(proposal_summary_idtextprimarykey,workspace_idtextnotnull,workspace_versionintegernotnull,offer_decision_idtextnotnull,completion_idtextnotnull,content_jsontextnotnull,content_digesttextnotnull,created_attextnotnull,unique(workspace_id,workspace_version,offer_decision_id,completion_id),foreignkey(offer_decision_id)referencesopportunity_offer_decisions(decision_id)ondeleterestrict,foreignkey(completion_id)referencesopportunity_review_completions(completion_id)ondeleterestrict)","columns":[["proposal_summary_id","TEXT",0,null,1],["workspace_id","TEXT",1,null,0],["workspace_version","INTEGER",1,null,0],["offer_decision_id","TEXT",1,null,0],["completion_id","TEXT",1,null,0],["content_json","TEXT",1,null,0],["content_digest","TEXT",1,null,0],["created_at","TEXT",1,null,0]],"foreignKeys":[[0,0,"opportunity_review_completions","completion_id","completion_id","NO ACTION","RESTRICT","NONE"],[1,0,"opportunity_offer_decisions","offer_decision_id","decision_id","NO ACTION","RESTRICT","NONE"]],"indexes":[["idx_proposal_summary_current",0,"c",0,[[1,"workspace_id"],[2,"workspace_version"],[4,"completion_id"]],"createindexidx_proposal_summary_currentonopportunity_proposal_summaries(workspace_id,workspace_version,completion_id)"],[null,1,"pk",0,[[0,"proposal_summary_id"]],""],[null,1,"u",0,[[1,"workspace_id"],[2,"workspace_version"],[3,"offer_decision_id"],[4,"completion_id"]],""]]},
    "opportunity_review_acknowledgements": {"name":"opportunity_review_acknowledgements","sql":"createtableopportunity_review_acknowledgements(acknowledgement_idtextprimarykey,review_idtextnotnull,user_idtextnotnull,limitation_set_digesttextnotnull,idempotency_keytextnotnull,acknowledged_attextnotnull,unique(user_id,idempotency_key),foreignkey(review_id)referencesopportunity_reviews(review_id)ondeleterestrict)","columns":[["acknowledgement_id","TEXT",0,null,1],["review_id","TEXT",1,null,0],["user_id","TEXT",1,null,0],["limitation_set_digest","TEXT",1,null,0],["idempotency_key","TEXT",1,null,0],["acknowledged_at","TEXT",1,null,0]],"foreignKeys":[[0,0,"opportunity_reviews","review_id","review_id","NO ACTION","RESTRICT","NONE"]],"indexes":[[null,1,"pk",0,[[0,"acknowledgement_id"]],""],[null,1,"u",0,[[2,"user_id"],[4,"idempotency_key"]],""]]},
    "opportunity_review_bases": {"name":"opportunity_review_bases","sql":"createtableopportunity_review_bases(review_idtextprimarykey,decision_basis_jsontextnotnull,decision_basis_digesttextnotnull,evidence_resolution_jsontextnotnull,created_attextnotnull,foreignkey(review_id)referencesopportunity_reviews(review_id)ondeleterestrict)","columns":[["review_id","TEXT",0,null,1],["decision_basis_json","TEXT",1,null,0],["decision_basis_digest","TEXT",1,null,0],["evidence_resolution_json","TEXT",1,null,0],["created_at","TEXT",1,null,0]],"foreignKeys":[[0,0,"opportunity_reviews","review_id","review_id","NO ACTION","RESTRICT","NONE"]],"indexes":[[null,1,"pk",0,[[0,"review_id"]],""]]},
    "opportunity_review_completions": {"name":"opportunity_review_completions","sql":"createtableopportunity_review_completions(completion_idtextprimarykey,review_idtextnotnullunique,workspace_versionintegernotnull,offer_decision_idtextnotnull,condition_digesttextnotnull,verification_snapshot_idtextnotnull,policy_versiontextnotnull,idempotency_keytextnotnull,completed_attextnotnull,unique(idempotency_key),foreignkey(review_id)referencesopportunity_reviews(review_id)ondeleterestrict,foreignkey(offer_decision_id)referencesopportunity_offer_decisions(decision_id)ondeleterestrict,foreignkey(verification_snapshot_id)referencesopportunity_contact_verification_snapshots(snapshot_id)ondeleterestrict)","columns":[["completion_id","TEXT",0,null,1],["review_id","TEXT",1,null,0],["workspace_version","INTEGER",1,null,0],["offer_decision_id","TEXT",1,null,0],["condition_digest","TEXT",1,null,0],["verification_snapshot_id","TEXT",1,null,0],["policy_version","TEXT",1,null,0],["idempotency_key","TEXT",1,null,0],["completed_at","TEXT",1,null,0]],"foreignKeys":[[0,0,"opportunity_contact_verification_snapshots","verification_snapshot_id","snapshot_id","NO ACTION","RESTRICT","NONE"],[1,0,"opportunity_offer_decisions","offer_decision_id","decision_id","NO ACTION","RESTRICT","NONE"],[2,0,"opportunity_reviews","review_id","review_id","NO ACTION","RESTRICT","NONE"]],"indexes":[["idx_review_completion_eligibility",0,"c",0,[[1,"review_id"],[2,"workspace_version"],[3,"offer_decision_id"]],"createindexidx_review_completion_eligibilityonopportunity_review_completions(review_id,workspace_version,offer_decision_id)"],[null,1,"pk",0,[[0,"completion_id"]],""],[null,1,"u",0,[[1,"review_id"]],""],[null,1,"u",0,[[7,"idempotency_key"]],""]]},
    "opportunity_review_invalidations": {"name":"opportunity_review_invalidations","sql":"createtableopportunity_review_invalidations(invalidation_idtextprimarykey,review_idtextnotnull,completion_idtext,superseding_workspace_versionintegernotnull,material_categorytextnotnull,reasontextnotnull,invalidated_attextnotnull,foreignkey(review_id)referencesopportunity_reviews(review_id)ondeleterestrict,foreignkey(completion_id)referencesopportunity_review_completions(completion_id)ondeleterestrict)","columns":[["invalidation_id","TEXT",0,null,1],["review_id","TEXT",1,null,0],["completion_id","TEXT",0,null,0],["superseding_workspace_version","INTEGER",1,null,0],["material_category","TEXT",1,null,0],["reason","TEXT",1,null,0],["invalidated_at","TEXT",1,null,0]],"foreignKeys":[[0,0,"opportunity_review_completions","completion_id","completion_id","NO ACTION","RESTRICT","NONE"],[1,0,"opportunity_reviews","review_id","review_id","NO ACTION","RESTRICT","NONE"]],"indexes":[[null,1,"pk",0,[[0,"invalidation_id"]],""]]},
    "opportunity_review_presentations": {"name":"opportunity_review_presentations","sql":"createtableopportunity_review_presentations(presentation_idtextprimarykey,review_idtextnotnull,user_idtextnotnull,guidance_versiontextnotnull,guidance_digesttextnotnull,presented_attextnotnull,unique(review_id,user_id),foreignkey(review_id)referencesopportunity_reviews(review_id)ondeleterestrict,foreignkey(user_id)referencesusers(id)ondeleterestrict)","columns":[["presentation_id","TEXT",0,null,1],["review_id","TEXT",1,null,0],["user_id","TEXT",1,null,0],["guidance_version","TEXT",1,null,0],["guidance_digest","TEXT",1,null,0],["presented_at","TEXT",1,null,0]],"foreignKeys":[[0,0,"users","user_id","id","NO ACTION","RESTRICT","NONE"],[1,0,"opportunity_reviews","review_id","review_id","NO ACTION","RESTRICT","NONE"]],"indexes":[["idx_review_presentations_owner",0,"c",0,[[2,"user_id"],[1,"review_id"],[5,"presented_at"]],"createindexidx_review_presentations_owneronopportunity_review_presentations(user_id,review_id,presented_at)"],[null,1,"pk",0,[[0,"presentation_id"]],""],[null,1,"u",0,[[1,"review_id"],[2,"user_id"]],""]]},
    "opportunity_reviews": {"name":"opportunity_reviews","sql":"createtableopportunity_reviews(review_idtextprimarykey,workspace_idtextnotnull,workspace_versionintegernotnull,candidate_snapshot_idtextnotnull,user_idtextnotnull,policy_versiontextnotnull,statustextnotnullcheck(statusin('incomplete','complete','invalidated')),limitation_set_digesttextnotnull,evidence_accessibleintegernotnulldefault0,next_action_guidance_presentedintegernotnulldefault0,completion_action_requestedintegernotnulldefault0,created_attextnotnull,completed_attext,invalidated_attext,unique(workspace_id,workspace_version,candidate_snapshot_id,user_id),foreignkey(workspace_id,workspace_version)referencesopportunity_workspace_versions(workspace_id,version)ondeleterestrict,foreignkey(candidate_snapshot_id)referencesopportunity_candidate_snapshots(snapshot_id)ondeleterestrict,foreignkey(user_id)referencesusers(id)ondeleterestrict)","columns":[["review_id","TEXT",0,null,1],["workspace_id","TEXT",1,null,0],["workspace_version","INTEGER",1,null,0],["candidate_snapshot_id","TEXT",1,null,0],["user_id","TEXT",1,null,0],["policy_version","TEXT",1,null,0],["status","TEXT",1,null,0],["limitation_set_digest","TEXT",1,null,0],["evidence_accessible","INTEGER",1,"0",0],["next_action_guidance_presented","INTEGER",1,"0",0],["completion_action_requested","INTEGER",1,"0",0],["created_at","TEXT",1,null,0],["completed_at","TEXT",0,null,0],["invalidated_at","TEXT",0,null,0]],"foreignKeys":[[0,0,"users","user_id","id","NO ACTION","RESTRICT","NONE"],[1,0,"opportunity_candidate_snapshots","candidate_snapshot_id","snapshot_id","NO ACTION","RESTRICT","NONE"],[2,0,"opportunity_workspace_versions","workspace_id","workspace_id","NO ACTION","RESTRICT","NONE"],[2,1,"opportunity_workspace_versions","workspace_version","version","NO ACTION","RESTRICT","NONE"]],"indexes":[["idx_opportunity_reviews_owner",0,"c",0,[[4,"user_id"],[1,"workspace_id"],[2,"workspace_version"],[6,"status"]],"createindexidx_opportunity_reviews_owneronopportunity_reviews(user_id,workspace_id,workspace_version,status)"],[null,1,"pk",0,[[0,"review_id"]],""],[null,1,"u",0,[[1,"workspace_id"],[2,"workspace_version"],[3,"candidate_snapshot_id"],[4,"user_id"]],""]]},
    "opportunity_selection_decisions": {"name":"opportunity_selection_decisions","sql":"createtableopportunity_selection_decisions(decision_idtextprimarykey,workspace_idtextnotnull,workspace_versionintegernotnull,user_idtextnotnull,decisiontextnotnullcheck(decisionin('accepted','challenged')),selected_candidate_snapshot_idtext,resolution_routetextcheck(resolution_routeisnullorresolution_routein('reassessment','changed_input','further_evidence','alternative_decision')),rationaletext,created_attextnotnull,foreignkey(workspace_id,workspace_version)referencesopportunity_workspace_versions(workspace_id,version)ondeleterestrict,foreignkey(selected_candidate_snapshot_id)referencesopportunity_candidate_snapshots(snapshot_id)ondeleterestrict,foreignkey(user_id)referencesusers(id)ondeleterestrict)","columns":[["decision_id","TEXT",0,null,1],["workspace_id","TEXT",1,null,0],["workspace_version","INTEGER",1,null,0],["user_id","TEXT",1,null,0],["decision","TEXT",1,null,0],["selected_candidate_snapshot_id","TEXT",0,null,0],["resolution_route","TEXT",0,null,0],["rationale","TEXT",0,null,0],["created_at","TEXT",1,null,0]],"foreignKeys":[[0,0,"users","user_id","id","NO ACTION","RESTRICT","NONE"],[1,0,"opportunity_candidate_snapshots","selected_candidate_snapshot_id","snapshot_id","NO ACTION","RESTRICT","NONE"],[2,0,"opportunity_workspace_versions","workspace_id","workspace_id","NO ACTION","RESTRICT","NONE"],[2,1,"opportunity_workspace_versions","workspace_version","version","NO ACTION","RESTRICT","NONE"]],"indexes":[[null,1,"pk",0,[[0,"decision_id"]],""]]},
    "opportunity_workspace_events": {"name":"opportunity_workspace_events","sql":"createtableopportunity_workspace_events(event_idtextprimarykey,workspace_idtextnotnull,workspace_versioninteger,user_idtextnotnull,event_typetextnotnull,result_categorytextnotnull,correlation_idtextnotnull,duration_msinteger,created_attextnotnull,foreignkey(workspace_id)referencesopportunity_workspaces(workspace_id)ondeleterestrict)","columns":[["event_id","TEXT",0,null,1],["workspace_id","TEXT",1,null,0],["workspace_version","INTEGER",0,null,0],["user_id","TEXT",1,null,0],["event_type","TEXT",1,null,0],["result_category","TEXT",1,null,0],["correlation_id","TEXT",1,null,0],["duration_ms","INTEGER",0,null,0],["created_at","TEXT",1,null,0]],"foreignKeys":[[0,0,"opportunity_workspaces","workspace_id","workspace_id","NO ACTION","RESTRICT","NONE"]],"indexes":[["idx_workspace_events_owner",0,"c",0,[[3,"user_id"],[1,"workspace_id"],[8,"created_at"]],"createindexidx_workspace_events_owneronopportunity_workspace_events(user_id,workspace_id,created_at)"],[null,1,"pk",0,[[0,"event_id"]],""]]},
    "opportunity_workspace_outcomes": {"name":"opportunity_workspace_outcomes","sql":"createtableopportunity_workspace_outcomes(workspace_idtextnotnull,workspace_versionintegernotnull,resulttextnotnull,comparative_explanationtextnotnull,lead_snapshot_idtext,evaluation_limitations_jsontextnotnull,primarykey(workspace_id,workspace_version),foreignkey(workspace_id,workspace_version)referencesopportunity_workspace_versions(workspace_id,version)ondeleterestrict)","columns":[["workspace_id","TEXT",1,null,1],["workspace_version","INTEGER",1,null,2],["result","TEXT",1,null,0],["comparative_explanation","TEXT",1,null,0],["lead_snapshot_id","TEXT",0,null,0],["evaluation_limitations_json","TEXT",1,null,0]],"foreignKeys":[[0,0,"opportunity_workspace_versions","workspace_id","workspace_id","NO ACTION","RESTRICT","NONE"],[0,1,"opportunity_workspace_versions","workspace_version","version","NO ACTION","RESTRICT","NONE"]],"indexes":[[null,1,"pk",0,[[0,"workspace_id"],[1,"workspace_version"]],""]]},
    "opportunity_workspace_versions": {"name":"opportunity_workspace_versions","sql":"createtableopportunity_workspace_versions(workspace_idtextnotnull,versionintegernotnull,policy_versiontextnotnull,evidence_windowtextnotnull,evaluation_statustextnotnull,lead_candidate_snapshot_idtext,no_winner_reasontext,candidate_set_digesttextnotnull,superseded_versioninteger,change_explanationtext,created_attextnotnull,primarykey(workspace_id,version),foreignkey(workspace_id)referencesopportunity_workspaces(workspace_id)ondeleterestrict)","columns":[["workspace_id","TEXT",1,null,1],["version","INTEGER",1,null,2],["policy_version","TEXT",1,null,0],["evidence_window","TEXT",1,null,0],["evaluation_status","TEXT",1,null,0],["lead_candidate_snapshot_id","TEXT",0,null,0],["no_winner_reason","TEXT",0,null,0],["candidate_set_digest","TEXT",1,null,0],["superseded_version","INTEGER",0,null,0],["change_explanation","TEXT",0,null,0],["created_at","TEXT",1,null,0]],"foreignKeys":[[0,0,"opportunity_workspaces","workspace_id","workspace_id","NO ACTION","RESTRICT","NONE"]],"indexes":[[null,1,"pk",0,[[0,"workspace_id"],[1,"version"]],""]]},
    "opportunity_workspaces": {"name":"opportunity_workspaces","sql":"createtableopportunity_workspaces(workspace_idtextprimarykey,user_idtextnotnull,titletextnotnull,lifecycletextnotnullcheck(lifecyclein('draft','evaluated','selected','prepared','closed')),current_versionintegernotnulldefault0,capability_profile_versionintegernotnull,pending_change_explanationtext,created_attextnotnull,updated_attextnotnull,foreignkey(user_id)referencesusers(id)ondeleterestrict)","columns":[["workspace_id","TEXT",0,null,1],["user_id","TEXT",1,null,0],["title","TEXT",1,null,0],["lifecycle","TEXT",1,null,0],["current_version","INTEGER",1,"0",0],["capability_profile_version","INTEGER",1,null,0],["pending_change_explanation","TEXT",0,null,0],["created_at","TEXT",1,null,0],["updated_at","TEXT",1,null,0]],"foreignKeys":[[0,0,"users","user_id","id","NO ACTION","RESTRICT","NONE"]],"indexes":[["idx_opportunity_workspaces_owner",0,"c",0,[[1,"user_id"],[8,"updated_at"]],"createindexidx_opportunity_workspaces_owneronopportunity_workspaces(user_id,updated_at)"],[null,1,"pk",0,[[0,"workspace_id"]],""]]},
    "schema_migrations": {"name":"schema_migrations","sql":"createtableschema_migrations(migration_idtextprimarykey,filenametextnotnullunique,sequenceintegernotnullunique,checksumtextnotnull,application_revisiontextnotnull,target_identifiertextnotnull,started_attextnotnull,completed_attext,operator_identitytextnotnull,outcometextnotnullcheck(outcomein('started','completed','failed','interrupted','adopted')))","columns":[["migration_id","TEXT",0,null,1],["filename","TEXT",1,null,0],["sequence","INTEGER",1,null,0],["checksum","TEXT",1,null,0],["application_revision","TEXT",1,null,0],["target_identifier","TEXT",1,null,0],["started_at","TEXT",1,null,0],["completed_at","TEXT",0,null,0],["operator_identity","TEXT",1,null,0],["outcome","TEXT",1,null,0]],"foreignKeys":[],"indexes":[[null,1,"pk",0,[[0,"migration_id"]],""],[null,1,"u",0,[[1,"filename"]],""],[null,1,"u",0,[[2,"sequence"]],""]]}
  },
  leadsEvidenceState: ["evidence_state","TEXT",0,"null",0]
});

function createdTables(inventory) {
  const names = new Set(['schema_migrations']);
  const expression = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?([a-zA-Z0-9_]+)/gi;
  for (const migration of inventory) {
    let match;
    while ((match = expression.exec(migration.content))) names.add(match[1]);
  }
  return [...names].sort();
}

function quoteIdentifier(name) {
  if (!/^[a-zA-Z0-9_]+$/.test(name)) fail('SCHEMA_MISMATCH');
  return `"${name}"`;
}

function normalizeSql(sql) {
  return String(sql || '')
    .replace(/--[^\n]*/g, '')
    .replace(/\bIF\s+NOT\s+EXISTS\b/gi, '')
    .replace(/["`\[\]]/g, '')
    .replace(/\s+/g, '')
    .replace(/;$/g, '')
    .toLowerCase();
}

function normalizeDefault(value) {
  if (value === null || value === undefined) return null;
  return String(value).replace(/\s+/g, '').replace(/^\((.*)\)$/s, '$1').toLowerCase();
}

async function inspectTable(query, name) {
  const identifier = quoteIdentifier(name);
  const master = await query.all(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = '${name}'`
  );
  if (master.length !== 1 || !master[0].sql) fail('SCHEMA_MISMATCH');
  const columns = (await query.all(`PRAGMA table_info(${identifier})`)).map(row => [
    row.name,
    String(row.type || '').toUpperCase(),
    Number(row.notnull),
    normalizeDefault(row.dflt_value),
    Number(row.pk)
  ]);
  const foreignKeys = (await query.all(`PRAGMA foreign_key_list(${identifier})`)).map(row => [
    Number(row.id),
    Number(row.seq),
    row.table,
    row.from,
    row.to,
    String(row.on_update || '').toUpperCase(),
    String(row.on_delete || '').toUpperCase(),
    String(row.match || '').toUpperCase()
  ]).sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const indexes = [];
  for (const index of await query.all(`PRAGMA index_list(${identifier})`)) {
    const indexName = quoteIdentifier(index.name);
    const info = (await query.all(`PRAGMA index_info(${indexName})`))
      .sort((left, right) => Number(left.seqno) - Number(right.seqno))
      .map(row => [Number(row.cid), row.name]);
    const sqlRows = await query.all(
      `SELECT sql FROM sqlite_master WHERE type = 'index' AND name = '${index.name}'`
    );
    indexes.push([
      index.origin === 'c' ? index.name : null,
      Number(index.unique),
      index.origin,
      Number(index.partial),
      info,
      normalizeSql(sqlRows[0]?.sql)
    ]);
  }
  indexes.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return {
    name,
    sql: normalizeSql(master[0].sql),
    columns,
    foreignKeys,
    indexes
  };
}

async function verifyStructuralSchema(query, contract) {
  for (const [name, expected] of Object.entries(contract.tables)) {
    let actual;
    try {
      actual = await inspectTable(query, name);
    } catch (_) {
      fail('SCHEMA_MISMATCH');
    }
    if (JSON.stringify(actual) !== JSON.stringify(expected)) fail('SCHEMA_MISMATCH');
  }
  let leads;
  try {
    leads = await query.all('PRAGMA table_info("leads")');
  } catch (_) {
    fail('SCHEMA_MISMATCH');
  }
  const evidenceState = leads.find(row => row.name === 'evidence_state');
  if (!evidenceState) fail('SCHEMA_MISMATCH');
  const actualEvidenceState = [
    evidenceState.name,
    String(evidenceState.type || '').toUpperCase(),
    Number(evidenceState.notnull),
    normalizeDefault(evidenceState.dflt_value),
    Number(evidenceState.pk)
  ];
  if (JSON.stringify(actualEvidenceState) !== JSON.stringify(contract.leadsEvidenceState)) {
    fail('SCHEMA_MISMATCH');
  }
}

async function verifySchema(options = {}) {
  featureDisabled(options.featureState);
  let gate = options.integrityGate;
  if (!gate) {
    const authority = options.authority || loadDependency(
      process.env.EVIDENCE_INTEGRITY_AUTHORITY_MODULE, 'authority'
    );
    const provenanceResolver = options.provenanceResolver || loadDependency(
      process.env.EVIDENCE_PROVENANCE_RESOLVER_MODULE, 'provenanceResolver'
    );
    gate = new IndependentEvidenceIntegrityGate({
      authority,
      provenanceResolver,
      maxAttestationAgeMs: options.maxAttestationAgeMs,
      now: options.now
    });
  }
  const query = options.dbQuery || require('../database').dbQuery;
  const inventory = options.inventory || migrationInventory(options.migrationsDir);
  const rows = await query.all(
    "SELECT migration_id, filename, sequence, checksum, outcome FROM schema_migrations ORDER BY sequence"
  ).catch(() => fail('LEDGER_MISSING'));
  if (rows.length !== inventory.length) fail('LEDGER_MISSING');
  rows.forEach((row, index) => {
    const expected = inventory[index];
    if (row.outcome !== 'COMPLETED' && row.outcome !== 'ADOPTED') fail('LEDGER_DIRTY');
    if (Number(row.sequence) !== expected.sequence || row.migration_id !== expected.migration_id) fail('LEDGER_ORDER');
    if (row.filename !== expected.filename) fail('LEDGER_UNKNOWN');
    if (row.checksum !== expected.checksum) fail('LEDGER_CHECKSUM');
  });

  await verifyStructuralSchema(query, EXPECTED_SCHEMA_MANIFEST);

  await gate.verify(query).catch(() => fail('ATTESTATION_INVALID'));
  featureDisabled(options.finalFeatureState);
  return Object.freeze({
    status: 'VERIFIED',
    feature_enabled: false,
    migrations: inventory.map(({ content, ...entry }) => entry)
  });
}

async function main() {
  try {
    const result = await verifySchema();
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error.code || 'SCHEMA_VERIFICATION_FAILED');
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  MIGRATIONS,
  MigrationControlError,
  createdTables,
  EXPECTED_SCHEMA_MANIFEST,
  featureDisabled,
  inspectTable,
  migrationInventory,
  normalizeSql,
  verifyStructuralSchema,
  verifySchema
};
