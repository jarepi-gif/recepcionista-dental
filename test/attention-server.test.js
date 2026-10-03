'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {spawn}=require('node:child_process');
test('complete scheduling and contextual diagnostics run through actual HTTP handler with zero patient sends',async()=>{
 const port=39323,origin='https://example.com',password='local-diagnostic-secret-at-least-32-characters';
 const child=spawn(process.execPath,['server.js'],{cwd:require('node:path').join(__dirname,'..'),env:{...process.env,PORT:String(port),INBOX_ENABLED:'true',INBOX_SECRET:password,INBOX_PUBLIC_URL:origin,TWILIO_ACCOUNT_SID:'AC'+'0'.repeat(32),TWILIO_AUTH_TOKEN:'local-test-auth',TWILIO_WHATSAPP_NUMBER:'+525579113424',ANTHROPIC_API_KEY:'local-dummy-not-a-real-key'}});
 let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
 try{
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error(logs||'Server not ready')),8000);child.stdout.on('data',b=>{if(b.toString().includes('Servidor corriendo')){clearTimeout(timeout);resolve();}});child.on('exit',()=>{clearTimeout(timeout);reject(new Error(logs));});});
  const base=`http://127.0.0.1:${port}/api/inbox/`;const login=await fetch(base+'session',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({password})});assert.equal(login.status,200);const headers={'Content-Type':'application/json',Origin:origin,'X-Inbox-Request':'1',Cookie:login.headers.get('set-cookie').split(';')[0]};
  for(const input of [
   {message:'Jaime Augusto Reyes Pinzon 5664676808 lunes 11 am',history:[{role:'assistant',content:'Compártenos tu nombre completo, día y horario para la valoración.'}],expected:/pendiente de confirmación/},
   {message:'Precio de implantes para un diente',history:[],expected:/36,000/},
   {message:'Dónde se encuentran',history:[],expected:/google.com\/maps\/search/},
   {message:'Lo voy a comentar con mi familia',history:[],expected:/Dr. Jaime te contacte/},
   {message:'¡Hola! Quiero más información',history:[],expected:/Plaza Centtral Interlomas/}
  ]){
   const r=await fetch(base+'check-response',{method:'POST',headers,body:JSON.stringify(input)});const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));assert.equal(data.patientMessagesSent,0);assert.match(data.responseXml,input.expected,logs);
  }
 }finally{child.kill('SIGTERM');}
});
