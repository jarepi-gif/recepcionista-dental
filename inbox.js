const crypto = require('node:crypto');
const path = require('node:path');
const twilio = require('twilio');
const workflow = require('./attention-workflow');
const {isFullName,containsConversationWords,cleanNameHistory}=require('./aura-cro-policy');

const PREFIX = 'thera-inbox-';
const WINDOW = 24 * 60 * 60 * 1000;
function phoneNumber(value) {
  const phone = String(value || '').replace(/^whatsapp:/, '');
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error('Número inválido');
  return `whatsapp:${phone}`;
}
function key(phone) { return PREFIX + crypto.createHash('sha256').update(phone).digest('hex').slice(0,32); }
function equal(a,b) { const x=Buffer.from(a || ''), y=Buffer.from(b || ''); return x.length===y.length && crypto.timingSafeEqual(x,y); }

class InboxStore {
  constructor(client) { this.client=client; this.documents=client.sync.v1.services('default').documents; }
  async ensure(phone, name='') {
    phone=phoneNumber(phone);
    try { return await this.documents(key(phone)).fetch(); }
    catch(e) {
      if(e.status!==404) throw e;
      try { return await this.documents.create({uniqueName:key(phone),data:{phone,name,mode:'aura',lastInbound:null,humanSids:[]}}); }
      catch(createError) { if(createError.status===409) return this.documents(key(phone)).fetch(); throw createError; }
    }
  }
  async mutate(phone, fn) {
    phone=phoneNumber(phone);
    for(let attempt=0;attempt<5;attempt++) {
      const doc=await this.ensure(phone);
      try { return (await this.documents(key(phone)).update({ifMatch:doc.revision,data:fn({...doc.data})})).data; }
      catch(e) { if(e.status!==412) throw e; }
    }
    throw new Error('La conversación cambió; vuelve a intentar');
  }
  async inbound(body) {
    const name=String(body.ProfileName || '').slice(0,120);
    return this.mutate(body.From, data=>({...data,name:data.nameVerified && isFullName(data.name)?data.name:name || data.name,lastInbound:body.MessageSid && data.lastInboundSid===body.MessageSid?data.lastInbound:new Date().toISOString(),lastInboundSid:body.MessageSid,preview:String(body.Body || '[Archivo recibido]').slice(0,160)}));
  }
  async mode(phone) { return (await this.ensure(phone)).data.mode; }
  async list() { return (await this.documents.list({limit:1000})).filter(d=>d.uniqueName?.startsWith(PREFIX)).map(d=>d.data).sort((a,b)=>String(b.lastInbound||'').localeCompare(String(a.lastInbound||''))); }
}

function installInbox(app, env=process.env, clientOverride=null) {
  const enabled=env.INBOX_ENABLED==='true';
  if(!enabled) return {enabled:false};
  if(!env.INBOX_SECRET || env.INBOX_SECRET.length<32 || !env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.INBOX_PUBLIC_URL) throw new Error('Configuración incompleta de bandeja');
  const origin=new URL(env.INBOX_PUBLIC_URL).origin;
  const client=clientOverride||twilio(env.TWILIO_ACCOUNT_SID,env.TWILIO_AUTH_TOKEN);
  const from=phoneNumber(env.TWILIO_WHATSAPP_NUMBER);
  const store=new InboxStore(client);
  const push=require('./inbox-push').createPushService(client,origin);
  async function alertInbound(body,input={}) {
    if(!/^[SM]M[a-fA-F0-9]{32}$/.test(String(body.MessageSid||'')))throw new Error('Identificador inválido de mensaje');
    const documents=store.documents,claim='thera-alert-event-'+body.MessageSid;
    try{await documents.create({uniqueName:claim,data:{state:'pending',phone:body.From},ttl:172800});}
    catch(e){if(e.status!==409)throw e;return {...(await documents(claim).fetch()).data,duplicate:true};}
    const alerts=require('./commercial-alerts');
    const result=await alerts.sendCommercialAlert({event:input.event||alerts.inboundInterestEvent(body.Body)||'HUMAN_HANDOFF_REQUIRED',patient:input.patient||body.ProfileName||'Nombre por confirmar',patientPhone:body.From,treatment:input.treatment||alerts.inboundTreatment(body.Body),action:`Ver conversación: ${origin}/bandeja?phone=${encodeURIComponent(body.From)}`},{env,client});
    await documents(claim).update({data:{state:result.status,sid:result.sid,phone:body.From}});
    return {sid:result.sid,status:result.status};
  }
  const locks=new Map();
  async function locked(phone,fn) {
    const previous=locks.get(phone)||Promise.resolve();
    const work=previous.catch(()=>{}).then(fn); locks.set(phone,work);
    try { return await work; } finally { if(locks.get(phone)===work) locks.delete(phone); }
  }
  const failures=new Map();
  function signedCookie() {
    const payload=Buffer.from(JSON.stringify({until:Date.now()+12*60*60*1000})).toString('base64url');
    return payload+'.'+crypto.createHmac('sha256',env.INBOX_SECRET).update(payload).digest('base64url');
  }
  function authorized(req) {
    const cookie=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('thera_inbox='))?.slice(12);
    if(!cookie) return false;
    const [payload,sig]=cookie.split('.');
    if(!equal(sig,crypto.createHmac('sha256',env.INBOX_SECRET).update(payload||'').digest('base64url'))) return false;
    try { return JSON.parse(Buffer.from(payload,'base64url')).until>Date.now(); } catch { return false; }
  }
  function auth(req,res,next) {
    res.set('Cache-Control','no-store');
    if(!authorized(req)) return res.status(401).json({error:'Inicia sesión para ver las conversaciones.'});
    if(req.method!=='GET' && (req.headers.origin!==origin || req.headers['x-inbox-request']!=='1')) return res.status(403).json({error:'Solicitud inválida.'});
    next();
  }
  const route=fn=>async(req,res)=>{try {await fn(req,res);} catch(e) {console.error('Inbox:',e.code || e.status || 'error');res.status(503).json({error:'No se pudo completar la operación. El mensaje no está confirmado; actualiza la conversación antes de volver a enviar.'});}};
  app.get('/bandeja',(req,res)=>{
    res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});
    res.sendFile(path.join(__dirname,'inbox-public','index.html'));
  });
  app.get('/inbox-sw.js',(req,res)=>{res.set({'Cache-Control':'no-cache','Service-Worker-Allowed':'/'});res.sendFile(path.join(__dirname,'inbox-public','inbox-sw.js'));});
  app.use('/inbox-assets',require('express').static(path.join(__dirname,'inbox-public'),{dotfiles:'deny'}));
  app.post('/api/inbox/session',(req,res)=>{
    res.set('Cache-Control','no-store');
    const ip=req.ip; const entry=failures.get(ip); if(entry && entry.until>Date.now() && entry.count>=8) return res.status(429).json({error:'Demasiados intentos. Espera 15 minutos.'});
    if(req.headers.origin!==origin || !equal(String(req.body.password||''),env.INBOX_SECRET)) {
      const next=entry && entry.until>Date.now()?entry:{count:0,until:Date.now()+15*60*1000}; next.count++;failures.set(ip,next); if(failures.size>1000) for(const [k,v] of failures) if(v.until<Date.now()) failures.delete(k);
      return res.status(401).json({error:'Clave incorrecta.'});
    }
    failures.delete(ip);res.set('Set-Cookie',`thera_inbox=${signedCookie()}; HttpOnly; Secure; SameSite=Strict; Path=/api/inbox; Max-Age=43200`);res.json({ok:true});
  });
  app.use('/api/inbox',auth);
  const recovery=require('./recovery').createRecovery({client,store,from,env,push,locked});
  app.get('/api/inbox/recovery',route(async(req,res)=>{const settings=await recovery.settings();res.json({settings,template:await recovery.templateStatus(settings),report:await recovery.report(),message:recovery.BODY});}));
  app.post('/api/inbox/recovery/settings',route(async(req,res)=>{try{res.json(await recovery.configure(req.body));}catch(e){if(!e.code&&!e.status)return res.status(400).json({error:e.message});throw e;}}));
  app.post('/api/inbox/recovery/enroll',route(async(req,res)=>{res.json(await recovery.enroll(phoneNumber(req.body.phone),true));}));
  app.post('/api/inbox/recovery/recent',route(async(req,res)=>{res.json(await recovery.enrollRecent());}));
  app.post('/api/inbox/recovery/run',route(async(req,res)=>{await recovery.tick();res.json(await recovery.report());}));
  app.post('/api/inbox/logout',(req,res)=>{res.set('Set-Cookie','thera_inbox=; HttpOnly; Secure; SameSite=Strict; Path=/api/inbox; Max-Age=0');res.json({ok:true});});
  app.get('/api/inbox/commercial-summary',route(async(req,res)=>{res.json(workflow.metrics(await store.list()));}));
  app.post('/api/inbox/commercial',route(async(req,res)=>{
    const phone=phoneNumber(req.body.phone);
    try {const conversation=await store.mutate(phone,data=>({...data,commercial:workflow.validateManual(data.commercial,req.body)}));res.json({conversation});}
    catch(e){if(e.message&& !e.status && !e.code)return res.status(400).json({error:e.message});throw e;}
  }));
  app.get('/api/inbox/conversations',route(async(req,res)=>{res.json({conversations:await store.list()});}));
  app.get('/api/inbox/push-key',route(async(req,res)=>{res.json({publicKey:(await push.keys()).publicKey});}));
  app.post('/api/inbox/push-subscription',route(async(req,res)=>{await push.subscribe(req.body.subscription);res.json({ok:true});}));
  app.post('/api/inbox/push-test',route(async(req,res)=>{res.json(await push.send({title:'Avisos de Thera activados',body:'Sonido y vibración dependen de los ajustes de tu celular.',eventId:'test-'+Date.now(),url:origin+'/bandeja'}));}));
  app.post('/api/inbox/alerts/recover',route(async(req,res)=>{
    const phone=phoneNumber(req.body.phone);const messages=await client.messages.list({from:phone,to:from,limit:10});const latest=messages.sort((a,b)=>b.dateCreated-a.dateCreated)[0];if(!latest)return res.status(404).json({error:'No hay mensajes recibidos para esa conversación.'});
    const data=(await store.ensure(phone)).data;res.json(await alertInbound({From:phone,Body:latest.body,MessageSid:latest.sid,ProfileName:data.name}));
  }));
  app.get('/api/inbox/alerts/status',route(async(req,res)=>{
    const sid=String(req.query.sid||'');if(!/^[SM]M[a-fA-F0-9]{32}$/.test(sid))return res.sendStatus(400);
    const message=await client.messages(sid).fetch();const recipient=phoneNumber(env.THERA_ALERT_RECIPIENT);
    const canonical=value=>String(value).replace(/\D/g,'').replace(/^521(?=\d{10}$)/,'52');
    if(canonical(message.to)!==canonical(recipient))return res.sendStatus(403);res.json({sid:message.sid,status:message.status,errorCode:message.errorCode,errorMessage:message.errorMessage});
  }));
  app.get('/api/inbox/alert-template',route(async(req,res)=>{
    const result=await require('./inbox-alert-template').templateStatus(client);
    const recipient=String(env.THERA_ALERT_RECIPIENT||'').replace(/\D/g,'').replace(/^521(?=\d{10}$)/,'52');
    res.json({...result,recipientIsDoctor:recipient==='525664676808'});
  }));
  app.post('/api/inbox/alert-template',route(async(req,res)=>{res.json(await require('./inbox-alert-template').prepareTemplate(client));}));
  app.post('/api/inbox/repair-names',route(async(req,res)=>{
    let repaired=0;for(const conversation of await store.list()) {
      if(conversation.name!=='Nombre por confirmar' && containsConversationWords(conversation.name)) {
        await store.mutate(conversation.phone,data=>({...data,name:'Nombre por confirmar',nameVerified:false}));repaired++;
      }
    }
    res.json({ok:true,repaired});
  }));
  app.post('/api/inbox/recover',route(async(req,res)=>{
    const recent=await client.messages.list({to:from,limit:200});
    const patients=new Map();for(const message of recent) if(message.from?.startsWith('whatsapp:') && !patients.has(message.from)) patients.set(message.from,message);
    for(const [phone,message] of patients) await store.mutate(phone,data=>({...data,lastInbound:(!data.lastInbound||new Date(data.lastInbound)<message.dateSent)?message.dateSent.toISOString():data.lastInbound,preview:data.preview||String(message.body||'[Archivo recibido]').slice(0,160)}));
    res.json({ok:true,recovered:patients.size});
  }));
  app.get('/api/inbox/messages',route(async(req,res)=>{
    const phone=phoneNumber(req.query.phone);const doc=await store.ensure(phone);
    const results=await Promise.all([client.messages.list({from:phone,to:from,limit:100}),client.messages.list({from,to:phone,limit:100})]);
    const messages=results.flat().sort((a,b)=>a.dateCreated-b.dateCreated).map(m=>({sid:m.sid,body:m.body,status:m.status,errorCode:m.errorCode,time:m.dateCreated,media:Number(m.numMedia),actor:m.from===phone?'patient':(doc.data.humanSids||[]).includes(m.sid)?'human':'aura'}));
    res.json({conversation:doc.data,messages,canSend:Date.now()-new Date(doc.data.lastInbound).getTime()<WINDOW});
  }));
  app.get('/api/inbox/media',route(async(req,res)=>{
    const sid=String(req.query.sid||'');const index=Number(req.query.index||0);
    if(!/^[SM]M[a-fA-F0-9]{32}$/.test(sid)||!Number.isInteger(index)||index<0||index>9)return res.sendStatus(400);
    const message=await client.messages(sid).fetch();
    if(message.from!==from&&message.to!==from)return res.sendStatus(403);
    const media=await client.messages(sid).media.list({limit:10});if(!media[index])return res.sendStatus(404);
    const uri=media[index].uri.replace(/\.json$/,'');
    const response=await require('axios').get('https://api.twilio.com'+uri,{auth:{username:env.TWILIO_ACCOUNT_SID,password:env.TWILIO_AUTH_TOKEN},responseType:'stream',timeout:15000,maxRedirects:0});
    res.set({'Content-Type':media[index].contentType||'application/octet-stream','Content-Disposition':'attachment; filename="archivo-paciente"','X-Content-Type-Options':'nosniff'});
    response.data.on('error',()=>res.destroy());response.data.pipe(res);
  }));
  app.post('/api/inbox/mode',route(async(req,res)=>{
    const phone=phoneNumber(req.body.phone);const mode=req.body.mode;if(!['human','aura'].includes(mode))return res.status(400).json({error:'Modo inválido.'});
    const conversation=await locked(phone,()=>store.mutate(phone,data=>({...data,mode,commercial:data.commercial?{...data.commercial,handoff:data.commercial.handoff?{...data.commercial.handoff,status:mode==='human'?'in_progress':data.commercial.handoff.status,handledAt:mode==='human'?new Date().toISOString():data.commercial.handoff.handledAt}:undefined}:data.commercial})));res.json({conversation});
  }));
  app.post('/api/inbox/send',route(async(req,res)=>{
    const phone=phoneNumber(req.body.phone);const body=String(req.body.body||'').trim();const requestId=String(req.body.requestId||'');
    if(!body || body.length>1500 || !/^[a-zA-Z0-9-]{20,80}$/.test(requestId))return res.status(400).json({error:'Mensaje inválido (máximo 1500 caracteres).'});
    await locked(phone,async()=>{
      const doc=(await store.ensure(phone)).data;
      if(doc.mode!=='human')return res.status(409).json({error:'Toma la conversación antes de responder.'});
      if(Date.now()-new Date(doc.lastInbound).getTime()>=WINDOW || !doc.lastInbound)return res.status(409).json({error:'Han pasado 24 horas. Se requiere una plantilla aprobada.'});
      // Claim durable before sending: uncertain sends must never be automatically retried.
      const claim='thera-send-'+crypto.createHash('sha256').update(phone+requestId).digest('hex');
      try {await store.documents.create({uniqueName:claim,data:{phone,state:'pending'},ttl:172800});}
      catch(e){if(e.status!==409)throw e;return res.status(409).json({error:'Este envío ya fue procesado. Actualiza para comprobar su estado.'});}
      const message=await client.messages.create({from,to:phone,body});
      await store.mutate(phone,data=>({...data,humanSids:[...(data.humanSids||[]),message.sid].slice(-100),preview:body.slice(0,160)}));
      await store.documents(claim).update({data:{phone,state:message.status,sid:message.sid}});
      res.json({sid:message.sid,status:message.status});
    });
  }));
  return {
    enabled:true,store,alertInbound,notifyInbound:push.notifyInbound,recovery,
    async context(phone, currentSid) {
      const rows=await Promise.all([client.messages.list({from:phone,to:from,limit:14}),client.messages.list({from,to:phone,limit:14})]);
      const history=cleanNameHistory(rows.flat().filter(m=>m.sid!==currentSid && m.body && !['failed','undelivered'].includes(m.status)).sort((a,b)=>a.dateCreated-b.dateCreated).slice(-14).map(m=>({role:m.from===phone?'user':'assistant',content:m.body})));
      while(history.length && history[0].role!=='user') history.shift();
      return history;
    },
    validate(req) {return twilio.validateRequest(env.TWILIO_AUTH_TOKEN,req.headers['x-twilio-signature']||'',origin+req.originalUrl,req.body);},
    async respond(req,res,body) {
      return locked(req.body.From,async()=>{
        const response=new twilio.twiml.MessagingResponse();
        if(await store.mode(req.body.From)!=='human') response.message(body);
        res.type('text/xml').send(response.toString());
      });
    }
  };
}
module.exports={installInbox,InboxStore,phoneNumber,key,equal};
