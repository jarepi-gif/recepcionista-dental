const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

test('open inbox observes approval after pending and keeps contact-specific blocks',async()=>{
 const source=fs.readFileSync(require.resolve('../inbox-public/app.js'),'utf8');
 const code=source.slice(source.indexOf('let humanTemplate='),source.indexOf("$('attention-filter').onchange"));
 const elements=new Map();const $=id=>{if(!elements.has(id))elements.set(id,{disabled:false,hidden:false,textContent:''});return elements.get(id);};
 let now=100000,status='pending',checks=0;
 const context=vm.createContext({$,Date:{now:()=>now},sending:false,api:async()=>{checks++;return {status,body:'Texto aprobado'};},post:async()=>{throw Error('No mutation expected');},notice:message=>{throw Error(message);}});
 vm.runInContext(code,context);
 const contact={phone:'one',mode:'human',lastInboundSid:'SM1',commercial:{whatsappFollowupConsent:{evidence:'Permiso por llamada'}}};
 const render=c=>context.renderHumanContact(c,false);
 const settle=()=>new Promise(resolve=>setImmediate(resolve));
 render(contact);await settle();assert.equal(checks,1);assert.equal($('human-template-send').disabled,true);
 status='approved';now+=10000;render(contact);await settle();assert.equal(checks,1);
 now+=20000;render(contact);await settle();assert.equal(checks,2);assert.equal($('human-template-send').disabled,false);assert.match($('human-template-status').textContent,/Aprobada/);
 render({...contact,phone:'two',commercial:{}});await settle();assert.equal(checks,3);assert.equal($('human-template-send').disabled,true);assert.match($('human-template-hint').textContent,/permiso/);
 render({...contact,phone:'three',commercial:{...contact.commercial,doNotContact:true}});await settle();assert.equal($('human-template-send').disabled,true);assert.match($('human-template-hint').textContent,/rechazó/);
 render({...contact,phone:'four',humanTemplate:{sid:'SMsent',baselineInboundSid:'SM1'}});await settle();assert.equal($('human-template-send').disabled,true);assert.match($('human-template-hint').textContent,/ya enviada/);
});
