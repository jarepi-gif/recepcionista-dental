const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {apply,ID,AUDIT,START,END,inRange}=require('../inbox-manual-access-20261102');
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
test('range only enables present contacts from October 31 through November 2 without inventing consent',async()=>{
 assert.equal(inRange({lastInbound:START}),true);assert.equal(inRange({lastInbound:'2026-11-02T23:59:59-06:00'}),true);
 for(const lastInbound of ['2026-10-30T23:59:59-06:00',END,'invalid'])assert.equal(inRange({lastInbound}),false);
 const rows=[{phone:'one',mode:'aura',lastInbound:START,commercial:{},recovery:{status:'queued'}},{phone:'two',mode:'human',lastInbound:START,commercial:{whatsappFollowupConsent:{evidence:'Real previous permission'}}},{phone:'excluded',lastInbound:START,commercial:{doNotContact:true}},{phone:'older',lastInbound:'2026-10-30',mode:'aura'}];
 const records=new Map(rows.map(data=>[key(data.phone),{revision:'1',data:structuredClone(data)}]));let writes=0;
 const documents=n=>({fetch:async()=>{if(!records.has(n))throw {status:404};return structuredClone(records.get(n));},update:async({data})=>{writes++;const r={revision:'2',data:structuredClone(data)};records.set(n,r);return r;}});
 documents.create=async({uniqueName,data})=>{const r={revision:'1',data};records.set(uniqueName,r);return r;};
 const store={documents,list:async()=>rows,client:templateClient()};const result=await apply(store);assert.equal(result.matched,3);assert.equal(result.updated,2);assert.equal(result.manualReady,2);assert.equal(result.excluded,1);assert.equal(result.patientMessagesSent,0);
 const one=records.get(key('one')).data;assert.equal(one.mode,'human');assert.equal(one.recovery.status,'human');assert.equal(one.commercial.manualTemplateAccess.enabled,true);assert.equal(one.commercial.whatsappFollowupConsent,undefined);assert.equal(records.get(key('two')).data.commercial.whatsappFollowupConsent.evidence,'Real previous permission');assert.equal(records.get(key('older')).data.mode,'aura');
 const before=writes;delete one.commercial.manualTemplateAccess;records.get(key('one')).data=one;
 const again=await apply(store);assert.equal(again.previouslyCompleted,true);assert.equal(writes,before);assert.equal(records.get(key('one')).data.commercial.manualTemplateAccess,undefined);assert.equal(records.get(AUDIT).data.targets.length,3);
});
test('server only records permission after explicit approved manual request and prevents repeat sends',async()=>{
 let row={phone:'+525500000001',mode:'human',lastInboundSid:'SM1',commercial:structuredClone(access)},sends=0,updates=0;
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
test('manual access UI asks permission in confirmation and does nothing when cancelled',async()=>{
 const vm=require('node:vm'),fs=require('node:fs');const source=fs.readFileSync(require.resolve('../inbox-public/app.js'),'utf8');
 const code=source.slice(source.indexOf('let humanTemplate='),source.indexOf("$('attention-filter').onchange"));
 const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,{disabled:false,hidden:false,textContent:''});return elements.get(id);};
 let confirmed=false,posts=0,prompt='';const c={phone:'test',mode:'human',commercial:access};
 const context=vm.createContext({$,sending:false,selected:'test',Date,api:async()=>({status:'approved',body:BODY}),crypto:{randomUUID:()=> 'a'.repeat(32)},post:async(_,data)=>{posts++;assert.equal(data.consentConfirmed,true);return {status:'queued'};},confirm:text=>{prompt=text;return confirmed;},notice(){},refreshMessages:async()=>{}});
 vm.runInContext(code,context);context.renderHumanContact(c,false);await new Promise(resolve=>setImmediate(resolve));assert.equal($('human-template-send').disabled,false);assert.match($('human-template-hint').textContent,/confirmarás/);
 await $('human-template-send').onclick();assert.match(prompt,/autorizó/);assert.equal(posts,0);
 confirmed=true;await $('human-template-send').onclick();assert.equal(posts,1);
});
