const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {apply,ID,AUDIT,START,END,NOVEMBER_7_BATCH,inRange}=require('../inbox-manual-access-20261102');
const {blocked,install,NAME,BODY}=require('../inbox-human-template');
const key=p=>'thera-inbox-'+crypto.createHash('sha256').update(p).digest('hex').slice(0,32);
const access={manualTemplateAccess:{enabled:true}};
function templateClient(approval='approved'){
 const contents=()=>({approvalFetch:()=>({fetch:async()=>({whatsapp:{status:approval}})})});
 contents.list=async()=>[{sid:'HXtest',friendlyName:NAME,types:{'twilio/text':{body:BODY}}}];
 return {content:{v1:{contents}}};
}
test('explicit permission at manual send is scoped to enabled contacts and keeps opt-outs',()=>{
 const d={mode:'human',commercial:access};assert.ok(blocked(d));assert.equal(blocked(d,{consentConfirmed:true}),null);
 assert.ok(blocked({mode:'human',commercial:{}},{consentConfirmed:true}));
 for(const commercial of [{...access,doNotContact:true},{...access,followUp:{status:'declined'}}])assert.ok(blocked({mode:'human',commercial},{consentConfirmed:true}));
 assert.ok(blocked({...d,mode:'aura'},{consentConfirmed:true}));
});
for(const [batch,older,last] of [[undefined,'2026-10-30T23:59:59-06:00','2026-11-02T23:59:59-06:00'],[NOVEMBER_7_BATCH,'2026-11-06T23:59:59-06:00','2026-11-09T23:59:59-06:00']])test('range only enables present contacts without inventing consent: '+(batch?.id||ID),async()=>{
 const start=batch?.start||START,end=batch?.end||END,audit=batch?'thera-manual-access-batch-'+batch.id:AUDIT;
 assert.equal(inRange({lastInbound:start},batch),true);assert.equal(inRange({lastInbound:last},batch),true);
 for(const lastInbound of [older,end,'invalid'])assert.equal(inRange({lastInbound},batch),false);
 const rows=[{phone:'one',mode:'aura',lastInbound:start,commercial:{},recovery:{status:'queued'}},{phone:'two',mode:'human',lastInbound:last,commercial:{whatsappFollowupConsent:{evidence:'Real previous permission'}}},{phone:'excluded',lastInbound:start,commercial:{doNotContact:true}},{phone:'older',lastInbound:older,mode:'aura'},{phone:'later',lastInbound:end,mode:'aura'}];
 const records=new Map(rows.map(data=>[key(data.phone),{revision:'1',data:structuredClone(data)}]));let writes=0;
 const documents=n=>({fetch:async()=>{if(!records.has(n))throw {status:404};return structuredClone(records.get(n));},update:async({data})=>{writes++;const r={revision:'2',data:structuredClone(data)};records.set(n,r);return r;}});
 documents.create=async({uniqueName,data})=>{const r={revision:'1',data};records.set(uniqueName,r);return r;};
 const store={documents,list:async()=>rows,client:templateClient()};const result=await apply(store,new Date(),batch);assert.equal(result.matched,3);assert.equal(result.updated,2);assert.equal(result.manualReady,2);assert.equal(result.excluded,1);assert.equal(result.patientMessagesSent,0);
 const one=records.get(key('one')).data;assert.equal(one.mode,'human');assert.equal(one.recovery.status,'human');assert.equal(one.commercial.manualTemplateAccess.enabled,true);assert.equal(one.commercial.whatsappFollowupConsent,undefined);assert.equal(records.get(key('two')).data.commercial.whatsappFollowupConsent.evidence,'Real previous permission');assert.equal(records.get(key('older')).data.mode,'aura');
 const before=writes;delete one.commercial.manualTemplateAccess;records.get(key('one')).data=one;
 const again=await apply(store,new Date(),batch);assert.equal(again.previouslyCompleted,true);assert.equal(writes,before);assert.equal(records.get(key('one')).data.commercial.manualTemplateAccess,undefined);assert.equal(records.get(audit).data.targets.length,3);assert.equal(records.get(key('later')).data.mode,'aura');
});
for(const scope of [{commercial:structuredClone(access)},{lastInbound:'2026-11-14T12:00:00-06:00',commercial:{}}])test('server records permission only for explicit approved request: '+(scope.lastInbound||'prior access'),async()=>{
 let row={phone:'+525500000001',mode:'human',lastInboundSid:'SM1',...scope},sends=0,updates=0;
 const client=templateClient();client.messages={create:async()=>{sends++;return {sid:'SMsent',status:'queued'};}};
 const claims=new Map();const documents=k=>({update:async({data})=>claims.set(k,data)});documents.create=async({uniqueName,data})=>{if(claims.has(uniqueName))throw {status:409};claims.set(uniqueName,data);};
 const store={documents,ensure:async()=>({data:structuredClone(row)}),mutate:async(_,fn)=>{updates++;row=fn(row);return row;}};
 let handler;install({app:{get(){},post(path,fn){if(path.endsWith('/send'))handler=fn;}},route:fn=>fn,client,store,from:'official',locked:async(_,fn)=>fn(),phoneNumber:p=>p});
 const res={status(n){this.code=n;return this;},json(v){this.body=v;}};const request={phone:row.phone,requestId:'a'.repeat(32)};
 await handler({body:request},res);assert.equal(res.code,409);assert.equal(sends,0);assert.equal(updates,0);assert.equal(row.commercial.whatsappFollowupConsent,undefined);
 await handler({body:{...request,consentConfirmed:true}},res);assert.equal(sends,1);assert.equal(row.commercial.whatsappFollowupConsent.source,'owner_confirmed_at_manual_send');assert.doesNotMatch(row.commercial.whatsappFollowupConsent.evidence,/teléfono|telefónica/);
 await handler({body:{...request,requestId:'b'.repeat(32),consentConfirmed:true}},res);assert.equal(sends,1);assert.equal(res.code,409);
});
test('unapproved provider state never records a manual permission confirmation',async()=>{
 const row={phone:'test',mode:'human',commercial:access};let handler,writes=0,sends=0;
 const client=templateClient('pending');client.messages={create:async()=>{sends++;}};
 install({app:{get(){},post(p,fn){if(p.endsWith('/send'))handler=fn;}},route:fn=>fn,client,store:{ensure:async()=>({data:row}),mutate:async()=>{writes++;}},locked:async(_,fn)=>fn(),phoneNumber:p=>p});
 const res={status(n){this.code=n;return this;},json(){}};
 await handler({body:{phone:'test',requestId:'a'.repeat(32),consentConfirmed:true}},res);assert.equal(res.code,409);assert.equal(writes,0);assert.equal(sends,0);
});
for(const scope of [{commercial:access},{lastInbound:'2026-11-14T12:00:00-06:00',commercial:{}}])test('manual access UI requires confirmation: '+(scope.lastInbound||'prior access'),async()=>{
 const vm=require('node:vm'),fs=require('node:fs');const source=fs.readFileSync(require.resolve('../inbox-public/app.js'),'utf8');
 const code=source.slice(source.indexOf('let humanTemplate='),source.indexOf("$('attention-filter').onchange"));
 const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,{disabled:false,hidden:false,textContent:''});return elements.get(id);};
 let confirmed=false,posts=0,prompt='';const c={phone:'test',mode:'human',...scope};
 const context=vm.createContext({TheraManualAccess:require('../inbox-public/manual-template-policy'),$,sending:false,selected:'test',Date,api:async()=>({status:'approved',body:BODY}),crypto:{randomUUID:()=> 'a'.repeat(32)},post:async(_,data)=>{posts++;assert.equal(data.consentConfirmed,true);return {status:'queued'};},confirm:text=>{prompt=text;return confirmed;},notice(){},refreshMessages:async()=>{}});
 vm.runInContext(code,context);context.renderHumanContact(c,false);await new Promise(resolve=>setImmediate(resolve));assert.equal($('human-template-send').disabled,false);assert.match($('human-template-hint').textContent,/confirmarás/);
 await $('human-template-send').onclick();assert.match(prompt,/autorizó/);assert.equal(posts,0);
 confirmed=true;await $('human-template-send').onclick();assert.equal(posts,1);
});
