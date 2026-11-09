'use client';
import {useEffect,useRef,useState} from 'react';
import {estimateNetPrize,validatePrizeDraws,PRIZE_CRITERIA,TAX_GUIDE,RESULTS_PAGE} from '@/lib/prize-results.mjs';
import {latestExpected} from '@/lib/lotto.mjs';
import type {PrizeResponse} from '@/lib/prize-results.mjs';
import type {PrizePanelProps} from './DeferredPrizeResults';
const money=(value:number)=>`${value.toLocaleString('ko-KR')}원`;
let cached:PrizeResponse|null=null;
export default function PrizeResults({Ball}:PrizePanelProps){
 const [data,setData]=useState<PrizeResponse|null>(cached),[round,setRound]=useState<number|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const alive=useRef(true),inFlight=useRef(false);
 async function refresh(){
  if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');
  try{
   const response=await fetch('/api/prizes',{cache:'no-store',signal:AbortSignal.timeout(12000)});
   if(!response.ok)throw Error('unavailable');
   const body=await response.json() as PrizeResponse;
   const draws=validatePrizeDraws(body.draws);
   if(!['live','saved'].includes(body.status)||!['live','cached','conflict'].includes(body.verification)||!Number.isFinite(Date.parse(body.checkedAt)))throw Error('invalid');
   const next={...body,draws};if(cached&&next.draws.length<cached.draws.length)throw Error('regression');
   cached=next;if(alive.current)setData(next);
  }catch{if(alive.current)setError('당첨내역을 새로 불러오지 못했어. 연결을 확인하고 다시 시도해줘.')}
  finally{inFlight.current=false;if(alive.current)setBusy(false)}
 }
 useEffect(()=>{alive.current=true;void refresh();const visible=()=>{if(document.visibilityState==='visible')void refresh()};document.addEventListener('visibilitychange',visible);return()=>{alive.current=false;document.removeEventListener('visibilitychange',visible)}},[]);
 const latest=data?.draws.at(-1),draw=data?.draws.find(item=>item.round===(round??latest?.round));
 const current=draw?.round??0;
 return <section className="prize-results" aria-labelledby="prize-heading" aria-busy={busy}>
  <div className="section-title prize-title"><h2 id="prize-heading">당첨내역</h2><button className="text-button" disabled={busy} onClick={()=>void refresh()}>{busy?'확인 중…':'당첨내역 새로고침'}</button></div>
  {error&&<p className="prize-message" role="alert">{error}{data?' 마지막 확인 내역을 보여줄게.':''}</p>}
  {!data&&!error&&<p className="prize-message" role="status">공식 당첨내역을 확인하고 있어…</p>}
  {data&&draw&&latest&&<>
   <div className="prize-navigation">
    <button aria-label="이전 회차" disabled={current===1} onClick={()=>setRound(current-1)}>‹</button>
    <label><span className="sr-only">당첨내역 회차 선택</span><select value={current} onChange={event=>setRound(Number(event.target.value))}>{[...data.draws].reverse().map(item=><option key={item.round} value={item.round}>{item.round}회 · {item.date}</option>)}</select></label>
    <button aria-label="다음 회차" disabled={current===latest.round} onClick={()=>setRound(current+1)}>›</button>
    <button className="prize-latest" disabled={current===latest.round} onClick={()=>setRound(null)}>최신</button>
   </div>
   <article className="panel prize-draw" aria-label={`${draw.round}회 당첨번호`}>
    <div className="prize-draw-heading"><strong>{draw.round}회 당첨번호</strong><time dateTime={draw.date}>{draw.date} 추첨</time></div>
    <div className="prize-balls"><div className="prize-main-balls">{draw.numbers.map(n=><Ball key={n} n={n}/>)}</div><span className="prize-plus" aria-hidden="true">+</span><div className="prize-bonus"><Ball n={draw.bonus}/><span>보너스</span></div></div>
   </article>
   {latest.round<latestExpected()&&<p className="prize-message" role="status">최신 회차를 아직 확인하지 못했어. {latest.round}회까지의 검증된 내역을 보여줄게.</p>}
   <p className="prize-unit">당첨금·세후 금액은 <strong>1게임 기준</strong></p>
   <div className="prize-ranks">{draw.ranks.map(row=>{
    const estimated=estimateNetPrize(row.amount),none=row.winners===0;
    return <article key={row.rank} className={`panel prize-rank prize-rank-${row.rank}`} aria-label={`${row.rank}등 당첨내역`}>
     <div className="prize-rank-heading"><h3>{row.rank}등</h3><span>{PRIZE_CRITERIA[row.rank-1]}</span><strong>{row.winners.toLocaleString('ko-KR')}<small> 게임 당첨</small></strong></div>
     {none?<p className="prize-none">당첨 없음 · 지급 당첨금 없음</p>:<dl className="prize-money"><div><dt>당첨금 <span>세전</span></dt><dd>{money(row.amount)}</dd></div><div className="prize-net"><dt>세후 예상</dt><dd>{money(estimated.net)}</dd></div><div className="prize-tax"><dt>예상 세금</dt><dd>{estimated.tax===0?'비과세':money(estimated.tax)}</dd></div></dl>}
    </article>;
   })}</div>
   <div className="prize-notes">
    <p>당첨자 수는 공식 발표의 <strong>당첨게임 수</strong>야. 한 사람이 여러 게임에 당첨될 수 있어.</p>
    <p>세후 예상액은 모든 회차에 <strong>현행 세율</strong>을 적용한 참고 금액이야. 과거 실제 수령액과는 다를 수 있어.</p>
    <details><summary>세후 예상액 계산 기준</summary><p>200만원 이하는 비과세. 200만원을 넘으면 3억원까지의 금액에 22%, 3억원 초과분에 33%를 적용해. 200만원을 공제하고 계산하는 방식은 아니야.</p><p>지방소득세 포함. 복권 구입비와 지급기관의 원 단위 정산은 반영하지 않았어. 실제 수령액은 지급기관에서 확인해줘.</p><a href={TAX_GUIDE} target="_blank" rel="noopener noreferrer">동행복권 세금 안내 ↗</a></details>
    <p className="prize-source-status" role="status">{data.verification==='conflict'?'공식 기록 변경 감지 · 마지막 검증본':data.status==='live'?'공식 기록 확인 완료':'공식 연결 미확인 · 마지막 검증본'}<br/>1–{latest.round}회 · 확인 {new Date(data.checkedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})} (한국시간)</p>
    <a href={RESULTS_PAGE} target="_blank" rel="noopener noreferrer">동행복권 공식 당첨결과 ↗</a>
   </div>
  </>}
 </section>;
}
