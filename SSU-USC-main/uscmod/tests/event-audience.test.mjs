import test from "node:test";
import assert from "node:assert/strict";
import {matchesEventAudience,eventAudienceLabel} from "../shared/event-audience.mjs";
const event={audience:"Selected Group",audienceScope:"program",audienceCollege:"College of Arts and Sciences",audienceProgram:"Bachelor of Science in Information Technology"};
const profile={college:event.audienceCollege,program:event.audienceProgram};
test("targeted event audience",()=>{assert.equal(matchesEventAudience(event,profile),true);assert.equal(matchesEventAudience(event,{...profile,program:"Bachelor of Science in Psychology"}),false);assert.equal(matchesEventAudience(event,{...profile,college:"College of Engineering"}),false);assert.equal(matchesEventAudience(event,null),false);assert.equal(matchesEventAudience({...event,audienceScope:"college"},{...profile,program:"other"}),true);assert.equal(matchesEventAudience({...event,audienceScope:"program",audienceProgram:""},profile),false);assert.equal(matchesEventAudience({audience:"All Students"},null),true);assert.equal(matchesEventAudience({audience:"Selected Group"},null),true);});

test("targeted audience is displayed without restricting the event listing",()=>{assert.equal(eventAudienceLabel(event),event.audienceProgram+" · "+event.audienceCollege);assert.equal(eventAudienceLabel({...event,audienceScope:"college"}),event.audienceCollege);assert.equal(eventAudienceLabel({audience:"Registered Group Only"}),"All Students");assert.equal(eventAudienceLabel({...event,sourceType:"program"}),"All Students");});
