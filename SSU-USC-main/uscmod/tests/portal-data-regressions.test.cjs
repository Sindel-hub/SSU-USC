const test = require('node:test');
const assert = require('node:assert/strict');
const { historyFixture } = require('./helpers/officer-history-fixture.cjs');

test('promoted officers with student claims can read surveys and record survey activity', async () => {
  const f = historyFixture();
  await f.assign('first', 'Public Information Officer');
  const input = {title:'Synthetic priorities',description:'Test survey',opensAt:f.now,closesAt:f.now+86400000,departments:['College of Engineering'],questions:[{label:'Priority?',type:'single',options:['A','B']}]};
  const {id} = await f.h.needsAssessmentManage(f.req('first',{action:'save',input},'student'));
  assert.equal((await f.h.needsAssessmentList(f.req('first',{},'student'))).surveys[0].id,id);
  assert.equal((await f.h.needsAssessmentResponses(f.req('first',{surveyId:id},'student'))).responses.length,0);
  const activity = await f.h.officerActivityList(f.req('first',{},'student'));
  assert.equal(activity.items[0].module,'Needs Assessment');
  assert.equal(activity.items[0].action,'Survey created');
  await assert.rejects(f.h.needsAssessmentList(f.req('other',{},'student')), {code:'permission-denied'});
  await assert.rejects(f.h.needsAssessmentManage(f.req('other',{action:'save',input},'student')), {code:'permission-denied'});
  f.records.get('users/first').isActive=false;
  await assert.rejects(f.h.needsAssessmentList(f.req('first',{},'student')), {code:'permission-denied'});
});

test('legacy officer survey writes produce activity without inventing an assignment', async () => {
  const f = historyFixture();
  Object.assign(f.records.get('users/first'),{role:'officer',officePosition:'Public Information Officer',officerPermissionSource:'position-default'});
  const input={title:'Legacy survey',opensAt:f.now,closesAt:f.now+86400000,departments:['College of Engineering'],questions:[{label:'Priority?',type:'single',options:['A','B']}]};
  await f.h.needsAssessmentManage(f.req('first',{action:'save',input},'student'));
  const activity=await f.h.officerActivityList(f.req('first',{},'student'));
  assert.equal(activity.items.length,1);
  assert.equal(f.reports()[0].assignmentId,null);
  // Pre-tracking drafts belong to their original author, even without an assignment ID.
  const id=activity.items[0].recordId;
  delete f.records.get('needs_assessment_surveys/'+id).officerAssignmentId;
  await f.h.needsAssessmentManage(f.req('first',{action:'save',surveyId:id,input},'student'));
  Object.assign(f.records.get('users/second'),{role:'officer',officePosition:'Public Information Officer',officerPermissionSource:'position-default'});
  await assert.rejects(f.h.needsAssessmentManage(f.req('second',{action:'save',surveyId:id,input},'student')), {code:'permission-denied'});
});
