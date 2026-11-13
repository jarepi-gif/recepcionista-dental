const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const policy=require('../inbox-public/manual-template-policy');
const {blocked}=require('../inbox-human-template');
test('November 14 access includes the whole Mexico City day and excludes adjacent days',()=>{
 const yes=['2026-11-14T00:00:00-06:00','2026-11-14T23:59:59.999-06:00'];
 const no=['2026-11-13T23:59:59.999-06:00','2026-11-15T00:00:00-06:00','invalid',undefined];
 for(const lastInbound of yes)assert.equal(policy.allowed({lastInbound}),true);
 for(const lastInbound of no)assert.equal(policy.allowed({lastInbound}),false);
});
test('dated access preserves refusal and classification exclusions, and does not create consent or change modes',()=>{
 const d={mode:'aura',lastInbound:'2026-11-14T12:00:00-06:00',commercial:{}};const original=JSON.stringify(d);
 assert.equal(policy.allowed(d),true);assert.equal(JSON.stringify(d),original);assert.ok(blocked(d,{consentConfirmed:true}));
 assert.ok(blocked({...d,mode:'human'}));assert.equal(blocked({...d,mode:'human'},{consentConfirmed:true}),null);
 for(const commercial of [{doNotContact:true},{followUp:{status:'declined'}},...['test','supplier','duplicate'].map(classification=>({classification}))]){
  assert.equal(policy.allowed({...d,commercial}),false);assert.ok(blocked({...d,mode:'human',commercial},{consentConfirmed:true}));
 }
 assert.equal(policy.allowed({lastInbound:'2026-10-31',commercial:{manualTemplateAccess:{enabled:true}}}),true);
});
test('browser and server share policy and page loads policy before application',()=>{
 const sandbox={window:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../inbox-public/manual-template-policy'),'utf8'),sandbox);
 for(const lastInbound of ['2026-11-14T06:00:00Z','2026-11-15T05:59:59Z','2026-11-15T06:00:00Z','bad'])assert.equal(sandbox.window.TheraManualAccess.allowed({lastInbound}),policy.allowed({lastInbound}));
 const page=fs.readFileSync(require.resolve('../inbox-public/index.html'),'utf8');assert.ok(page.indexOf('manual-template-policy.js')<page.indexOf('/inbox-assets/app.js'));
});
