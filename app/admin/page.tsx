'use client';
import {useEffect,useRef,useState} from 'react';
import AdminRecommendations,{type RecommendationQuery} from '@/components/AdminRecommendations';
import {VISIT_DEVICE_LABELS as deviceLabels,VISIT_OS_LABELS as osLabels,VISIT_BROWSER_LABELS as browserLabels} from '@/lib/visit-environment';
type AdminState={state:'unavailable'|'forbidden'|'locked'|'ready',csrf?:string};
type Visit={id:string|number,ip:string|null,at:number,device?:string|null,os?:string|null,browser?:string|null,display_mode?:string|null};
function category(labels:Record<string,string>,value:unknown){return typeof value==='string'&&Object.hasOwn(labels,value)?labels[value]:'미확인'}
export default function AdminPage(){
 const [state,setState]=useState<AdminState|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[visits,setVisits]=useState<Visit[]>([]),[cursor,setCursor]=useState<string|number|null>(null);
 const [recommendationsKey,setRecommendationsKey]=useState<number|null>(null);
 const [recommendationQuery,setRecommendationQuery]=useState<RecommendationQuery>({round:null,matched:false});
 const submitting=useRef(false);
 const generation=useRef(0),current=useRef({state,busy});current.current={state,busy};
 function clearView(){generation.current++;setRecommendationsKey(null);setVisits([]);setCursor(null);setState(null);setBusy(false)}
 async function refreshState(loadRecords=true,loadRecommendations=true,preserveLogin=false){
  const keepLogin=preserveLogin&&current.current.state?.state==='locked',request=++generation.current;
  setRecommendationsKey(null);setBusy(keepLogin);setVisits([]);setCursor(null);if(!keepLogin)setState(null);
  try{const r=await fetch('/api/admin/state',{cache:'no-store'});const d=await r.json() as AdminState;if(!['unavailable','forbidden','locked','ready'].includes(d.state))throw Error();if(request!==generation.current)return null;if(d.state==='ready'&&document.visibilityState==='hidden'){setState(null);setBusy(false);return null}setState(d);setBusy(false);if(loadRecommendations&&d.state==='ready')setRecommendationsKey(request);if(loadRecords&&d.state==='ready')void loadVisits(undefined,request);return d}
  catch{if(request===generation.current){setState({state:'unavailable'});setBusy(false)}return null}
 }
 async function loadVisits(before?:string|number,request=generation.current){setBusy(true);try{const r=await fetch('/api/admin/visits'+(before!==undefined?'?before='+encodeURIComponent(String(before)):''),{cache:'no-store'});if(!r.ok)throw Error();const d=await r.json() as {visits:Visit[],nextCursor?:string|number|null};if(!Array.isArray(d.visits)||!d.visits.every(v=>v&&Number.isFinite(v.at)&&(typeof v.id==='string'||typeof v.id==='number')&&(v.ip===null||typeof v.ip==='string')))throw Error();if(request!==generation.current)return;setVisits(v=>before!==undefined?[...v,...d.visits]:d.visits);setCursor(d.nextCursor??null)}catch{if(request!==generation.current)return;setMessage('기록을 불러오지 못했어. 로그인을 확인한 뒤 다시 시도해줘.');await refreshState(false)}finally{if(request===generation.current)setBusy(false)}}
 useEffect(()=>{
  void refreshState();
  const recheck=()=>{
   // Password-manager overlays may hide the page. Keep the locked form mounted,
   // but never keep authenticated records visible while authorization is checked.
   if(current.current.state?.state==='locked'){
    if(document.visibilityState==='visible'&&!current.current.busy&&!submitting.current)void refreshState(true,true,true);
    return;
   }
   clearView();if(document.visibilityState==='visible')void refreshState();
  };
  document.addEventListener('visibilitychange',recheck);window.addEventListener('pageshow',recheck);
  const timer=setInterval(()=>{if(document.visibilityState==='visible'&&current.current.state?.state==='ready'&&!current.current.busy&&![...document.querySelectorAll<HTMLInputElement>('input[type=password]')].some(input=>input.value))void refreshState()},60000);
  return()=>{generation.current++;clearInterval(timer);document.removeEventListener('visibilitychange',recheck);window.removeEventListener('pageshow',recheck)};
 },[]);
 async function submit(e:React.FormEvent<HTMLFormElement>,action:string){
  e.preventDefault();if(busy||submitting.current||!state?.csrf)return;submitting.current=true;
  const form=e.currentTarget,data=new FormData(form),request=++generation.current;
  let succeeded=false;
  setRecommendationsKey(null);if(action!=='login')setState(null);setVisits([]);setCursor(null);setBusy(true);setMessage('');
  try{
   const body:Record<string,string>={csrf:state.csrf};
   for(const name of ['username','password','confirmPassword','currentPassword'])if(data.has(name))body[name]=String(data.get(name)||'');
   const r=await fetch('/api/admin/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});
   if(request!==generation.current)return;succeeded=r.ok;
   if(!r.ok)setMessage(r.status===429?'시도가 많아 잠시 쉬어야 해. 15분 후 다시 시도해줘.':r.status===400?'입력값과 비밀번호 확인을 다시 봐줘.':r.status===403?'인증 또는 요청 확인에 실패했어. 다시 로그인해줘.':'처리하지 못했어. 비밀번호와 연결 상태를 확인해줘.');
   else setMessage(action==='password'?'비밀번호를 바꿨어. 이전 로그인 세션은 해제했어.':action==='logout'?'로그아웃했어.':'로그인했어.');
  }catch{if(request===generation.current)setMessage('연결하지 못했어. 잠시 후 다시 시도해줘.')}
  finally{
   // A successful login removes the filled form only after the response. On a
   // failed login, refresh CSRF in place so AutoFill and a manual retry still work.
   if(action!=='login')form.reset();
   if(request===generation.current)await refreshState(true,true,action==='login'&&!succeeded);
   submitting.current=false;
  }
 }
 const savedUsername=<label>관리자 아이디<input name="username" type="text" autoComplete="username" defaultValue="admin" required maxLength={64} autoCapitalize="none" spellCheck={false}/></label>;
 const passwordFields=<><label>새 비밀번호<input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128}/></label><label>새 비밀번호 확인<input name="confirmPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={128}/></label><p className="range">12자 이상으로 직접 정해줘. 채팅에 적었던 비밀번호는 재사용하지 않는 게 좋아.</p></>;
 return <main className="app admin-app"><header className="header compact-header"><a className="brand" href="/">← 로또 6/45</a><h1>관리자</h1></header><section className="panel"><h2>접속 기록 관리</h2><p className="range">관리자 아이디와 비밀번호로만 열 수 있어.</p>{!state&&<p role="status">접근 권한 확인 중…</p>}{state?.state==='forbidden'&&<p className="admin-notice">관리자 요청을 확인할 수 없어. 새로고침 후 다시 로그인해줘.</p>}{state?.state==='unavailable'&&<p className="admin-notice">관리자 기능을 준비 중이거나 연결을 확인할 수 없어. 비밀번호 등록과 기록 조회는 잠겨 있어.</p>}{state?.state==='locked'&&<form id="admin-login" method="post" action="/api/admin/login" autoComplete="on" aria-busy={busy} onSubmit={e=>submit(e,'login')}>{savedUsername}<label htmlFor="admin-login-password">관리자 비밀번호<input id="admin-login-password" name="password" type="password" autoComplete="current-password" required maxLength={128} aria-describedby="admin-password-help"/></label><button type="submit" className="admin-primary" disabled={busy}>{busy?'로그인 확인 중…':'관리자 로그인'}</button><p className="range" id="admin-password-help">로그인 후 기기에서 비밀번호 저장을 물으면 저장해줘. 다음에는 암호 자동 완성으로 입력할 수 있어.</p><details className="admin-save-help"><summary>저장 안내가 안 뜨면</summary><p className="range">아이폰 암호 앱에 이 사이트 주소와 사용자 이름 admin, 관리자 비밀번호를 직접 추가해줘. 홈 화면 앱에서 잘 안 되면 Safari에서 이 주소를 열어 로그인해줘. admin은 실제 관리자 아이디야. ChatGPT 로그인 없이 관리자 비밀번호로 인증해.</p></details></form>}{state?.state==='ready'&&<form onSubmit={e=>submit(e,'logout')}><button className="saved-action" disabled={busy}>관리자 로그아웃</button></form>}{message&&<p className="admin-notice" role="status">{message}</p>}</section>
 {state?.state==='ready'&&<>{recommendationsKey!==null&&<AdminRecommendations key={recommendationsKey} query={recommendationQuery} onQueryChange={setRecommendationQuery} onAuthorizationLost={()=>{setMessage('추천 기록 조회 인증을 다시 확인해야 해. 다시 로그인하거나 새로고침해줘.');void refreshState(false,false)}}/>}<section className="panel"><div className="section-title"><h2>최근 10일 접속</h2><button className="text-button" disabled={busy} onClick={()=>loadVisits()}>새로고침</button></div><p className="range">한국 시간(KST) · 설정 완료 이후 기록만 표시해. IP는 Cloudflare 프록시가 전달한 관측값이며 원본 방문자 주소를 검증한 값이 아니야. 사람이나 기기를 확정하지 못해. 기기·OS·브라우저는 추정값이며 변경 전 기록은 미확인으로 보여.</p><div className="admin-records">{visits.map(v=><article key={v.id}><strong>{v.ip||'주소 확인 불가'}</strong><time>{new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'medium'}).format(new Date(v.at))}</time><span className="admin-environment">기기(추정): {category(deviceLabels,v.device)} · OS(추정): {category(osLabels,v.os)}<br/>브라우저(추정): {category(browserLabels,v.browser)} · 실행: {v.display_mode==='standalone'?'홈 화면 앱':v.display_mode==='browser'?'일반 브라우저':'미확인'}</span></article>)}</div>{!visits.length&&!busy&&<p className="admin-notice">아직 표시할 접속 기록이 없어.</p>}{cursor!==null&&<button className="saved-action" disabled={busy} onClick={()=>loadVisits(cursor)}>이전 기록 더 보기</button>}<p className="range">10일 이전 기록은 조회에서 제외하고 방문 또는 관리 화면 조회 때 정리해. 접속이 없을 때 즉시 삭제되는 방식은 아니야.</p></section><details className="panel admin-password"><summary>비밀번호 변경</summary><form id="admin-password-change" method="post" action="/api/admin/password" autoComplete="on" onSubmit={e=>submit(e,'password')}>{savedUsername}<label>현재 비밀번호<input name="currentPassword" type="password" autoComplete="current-password" required maxLength={128}/></label>{passwordFields}<button className="admin-primary" disabled={busy}>비밀번호 변경</button></form></details></>}
 <footer><a href="/privacy">접속 기록 안내</a><a href="/">추천 화면으로</a></footer></main>
}
