const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const policy=require('../inbox-public/manual-template-policy');
const {blocked}=require('../inbox-human-template');
test('November 20 through 22 includes Mexico City boundaries, preserves 12 through 16, and excludes gaps',()=>{
 const yes=['2026-11-12T00:00:00-06:00',...['13','14','15'].map(d=>'2026-11-'+d+'T12:00:00-06:00'),'2026-11-16T23:59:59.999-06:00','2026-11-20T00:00:00-06:00','2026-11-21T12:00:00-06:00','2026-11-22T23:59:59.999-06:00'];
 const no=['2026-11-11T23:59:59.999-06:00','2026-11-17T00:00:00-06:00','2026-11-18T12:00:00-06:00','2026-11-19T23:59:59.999-06:00','2026-11-23T00:00:00-06:00','invalid',undefined];
 for(const lastInbound of yes){assert.equal(policy.allowed({lastInbound}),true);const data={lastInbound,mode:'human',commercial:{}};assert.ok(blocked(data));assert.equal(blocked(data,{consentConfirmed:true}),null);}
 for(const lastInbound of no)assert.equal(policy.allowed({lastInbound}),false);
});
for(const date of ['2026-11-14','2026-11-21'])test('dated access preserves refusal and classifications without inventing consent: '+date,()=>{
 const d={mode:'aura',lastInbound:date+'T12:00:00-06:00',commercial:{}};const original=JSON.stringify(d);
 assert.equal(policy.allowed(d),true);assert.equal(JSON.stringify(d),original);assert.ok(blocked(d,{consentConfirmed:true}));
 assert.ok(blocked({...d,mode:'human'}));assert.equal(blocked({...d,mode:'human'},{consentConfirmed:true}),null);
 for(const commercial of [{doNotContact:true},{followUp:{status:'declined'}},...['test','supplier','duplicate'].map(classification=>({classification}))]){
  assert.equal(policy.allowed({...d,commercial}),false);assert.ok(blocked({...d,mode:'human',commercial},{consentConfirmed:true}));
 }
 assert.equal(policy.allowed({lastInbound:'2026-10-31',commercial:{manualTemplateAccess:{enabled:true}}}),true);
});
test('browser and server share policy and page loads policy before application',()=>{
 const sandbox={window:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../inbox-public/manual-template-policy'),'utf8'),sandbox);
 for(const lastInbound of ['2026-11-12T06:00:00Z','2026-11-14T06:00:00Z','2026-11-17T05:59:59Z','2026-11-17T06:00:00Z','2026-11-20T06:00:00Z','2026-11-23T05:59:59Z','2026-11-23T06:00:00Z','bad'])assert.equal(sandbox.window.TheraManualAccess.allowed({lastInbound}),policy.allowed({lastInbound}));
 const page=fs.readFileSync(require.resolve('../inbox-public/index.html'),'utf8');assert.ok(page.indexOf('manual-template-policy.js')<page.indexOf('/inbox-assets/app.js'));
});
