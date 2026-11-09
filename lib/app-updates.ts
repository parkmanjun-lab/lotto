import {validNumbers} from './lotto.mjs';

// This key is session-only. Never write or clear the user's saved-number store.
export const UPDATE_STORE='lotto-notes:update-session:v1';
export type ResumeTicket={numbers:number[],window:number,round:number,at:string,[key:string]:unknown};
export type ResumeState={results:ResumeTicket[],windowSize:number,tab:string,selected:string[],scrollY:number};
type Session={schema:1,attempted:string[],lastAttempt:number,resume:{at:number,state:ResumeState}|null};
export type SessionStore=Pick<Storage,'getItem'|'setItem'>;
const VERSION=/^[a-f0-9]{24}$/;
const blank=():Session=>({schema:1,attempted:[],lastAttempt:0,resume:null});
function optionalTicketFields(ticket:ResumeTicket){
 const t=ticket as Record<string,unknown>;
 const groupNumbers=(x:unknown)=>Array.isArray(x)&&x.length<=45&&x.every(n=>Number.isInteger(n)&&n>=1&&n<=45);
 if(t.anchor!==undefined&&!groupNumbers(t.anchor))return false;
 if(t.preferenceWeight!==undefined&&(typeof t.preferenceWeight!=='number'||!Number.isFinite(t.preferenceWeight)))return false;
 if(t.frequencyGroups!==undefined){const g=t.frequencyGroups as Record<string,unknown>;if(!g||typeof g!=='object'||!['upper','middle','lower'].every(k=>groupNumbers(g[k])))return false}
 for(const field of ['anchorCount','filterRound'])if(t[field]!==undefined&&(typeof t[field]!=='number'||!Number.isInteger(t[field])||(t[field] as number)<0))return false;
 if(t.anchorPeriods!==undefined&&(!t.anchorPeriods||typeof t.anchorPeriods!=='object'||Array.isArray(t.anchorPeriods)||!Object.values(t.anchorPeriods).every(n=>typeof n==='number'&&Number.isInteger(n)&&n>=0)))return false;
 return t.method===undefined||typeof t.method==='string';
}
export function validResume(value:unknown):value is ResumeState{
 if(!value||typeof value!=='object')return false;
 const s=value as ResumeState;
 return Array.isArray(s.results)&&(s.results.length===0||s.results.length===10)&&s.results.every(t=>t&&validNumbers(t.numbers)&&Number.isInteger(t.round)&&t.round>0&&[10,20,50,100].includes(t.window)&&typeof t.at==='string'&&optionalTicketFields(t))&&[20,50,100].includes(s.windowSize)&&['generate','saved','stats','prizes'].includes(s.tab)&&Array.isArray(s.selected)&&s.selected.length<=100&&s.selected.every(k=>typeof k==='string'&&k.length<=32)&&Number.isFinite(s.scrollY)&&s.scrollY>=0&&s.scrollY<1e7;
}
function readSession(storage:SessionStore):Session{
 const raw=storage.getItem(UPDATE_STORE);if(!raw)return blank();
 // Invalid or excessively large recovery state is ignored; saved numbers are separate.
 if(raw.length>150000)return blank();
 let data:Session;try{data=JSON.parse(raw)}catch{return blank()}
 if(data?.schema!==1||!Array.isArray(data.attempted)||data.attempted.length>32||!data.attempted.every(v=>typeof v==='string'&&VERSION.test(v))||!Number.isFinite(data.lastAttempt))return blank();
 if(data.resume&&(!Number.isFinite(data.resume.at)||!validResume(data.resume.state)))data.resume=null;
 return data;
}
export function restoreUpdateState(storage:SessionStore):ResumeState|null{
 try{
  const session=readSession(storage),resume=session.resume;
  if(!resume)return null;
  // Consume only the recovery payload, preserving the anti-loop journal.
  try{storage.setItem(UPDATE_STORE,JSON.stringify({...session,resume:null}))}catch{/* Readable recovery data is still usable when storage becomes read-only. */}
  // Keep valid unsaved numbers for this tab session, including long offline gaps.
  return resume.state;
 }catch{return null}
}
export function stageUpdate(storage:SessionStore,target:string,state:ResumeState,now=Date.now()):'ready'|'repeat'|'storage-failed'{
 if(!VERSION.test(target)||!validResume(state))return 'storage-failed';
 try{
  const session=readSession(storage);
  if(session.attempted.includes(target)||(session.lastAttempt>0&&now-session.lastAttempt<60000))return 'repeat';
  // One atomic write saves both the exact current UI and the reload-loop marker.
  const encoded=JSON.stringify({schema:1,attempted:[...session.attempted,target].slice(-32),lastAttempt:now,resume:{at:now,state}});
  if(encoded.length>150000)return 'storage-failed';
  storage.setItem(UPDATE_STORE,encoded);
  return storage.getItem(UPDATE_STORE)===encoded?'ready':'storage-failed';
 }catch{return 'storage-failed'}
}
export type UpdateController={check:()=>Promise<void>,activity:()=>void,notify:()=>void,dispose:()=>void};
export function createUpdateController(options:{
 version:string;fetchVersion:()=>Promise<unknown>;storage:()=>SessionStore;
 capture:()=>ResumeState;canApply:()=>boolean;visible:()=>boolean;
 reload:()=>void;notice:(message:string)=>void;
 now?:()=>number;idleMs?:number;
}):UpdateController{
 const now=options.now??Date.now,idleMs=options.idleMs??1200;
 let stopped=false,checking=false,reloading=false,pending:string|null=null,timer:ReturnType<typeof setTimeout>|null=null,lastActivity=now();
 const clear=()=>{if(timer!==null){clearTimeout(timer);timer=null}};
 function notify(){
  clear();if(stopped||reloading||checking||!pending||!options.visible()||!options.canApply())return;
  timer=setTimeout(apply,Math.max(0,idleMs-(now()-lastActivity)));
 }
 function apply(){
  timer=null;if(stopped||reloading||checking||!pending||!options.visible()||!options.canApply())return;
  if(now()-lastActivity<idleMs){notify();return}
  let outcome:'ready'|'repeat'|'storage-failed';
  try{outcome=stageUpdate(options.storage(),pending,options.capture(),now())}catch{outcome='storage-failed'}
  if(outcome==='ready'){
   reloading=true;
   try{options.reload()}catch{options.notice('업데이트를 적용하지 못했어. 현재 번호는 그대로 두었어. 나중에 앱을 다시 열어줘.')}
  }else if(outcome==='storage-failed'){
   pending=null;options.notice('현재 번호를 안전하게 보존할 수 없어 업데이트를 미뤘어. 중요한 번호를 복사한 뒤 다시 열어줘.');
  }else{
   pending=null;options.notice('새 버전 반영을 기다리고 있어. 현재 번호는 그대로야. 잠시 뒤 앱을 다시 열어줘.');
  }
 }
 async function check(){
  if(stopped||reloading||checking||!options.visible())return;
  checking=true;pending=null;clear();
  try{
   const value=await options.fetchVersion();
   if(stopped)return;
   const version=(value as {version?:unknown})?.version;
   if(typeof version!=='string'||!VERSION.test(version))return;
   pending=version===options.version?null:version;
  }catch{/* Offline or failed authentication never interrupts the current app. */}
  finally{checking=false;notify()}
 }
 return {check,notify,activity(){lastActivity=now();notify()},dispose(){stopped=true;pending=null;clear()}};
}
