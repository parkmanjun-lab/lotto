'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import type {RecommendationBatch,RecommendationList,RecommendationResult} from '@/lib/recommendation-types';
import {VISIT_DEVICE_LABELS,VISIT_OS_LABELS,VISIT_BROWSER_LABELS,VISIT_DISPLAY_MODE_LABELS} from '@/lib/visit-environment';

export type RecommendationQuery={round:number|null,matched:boolean};
type Props={onAuthorizationLost:()=>void,query:RecommendationQuery,onQueryChange:(query:RecommendationQuery)=>void};
const kst=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'medium'});
const count=new Intl.NumberFormat('ko-KR');
const totals=['batchCount','combinationCount','pending','deletedBeforeResult','losing','rank1','rank2','rank3','rank4','rank5','matchedCombinationCount'] as const;
const isCount=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const isRound=(value:unknown):value is number=>isCount(value)&&value>0;
const isTimestamp=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&Number.isFinite(new Date(value).getTime());
const isNumbers=(value:unknown):value is number[]=>Array.isArray(value)&&value.length===6&&value.every(n=>isRound(n)&&n<=45)&&new Set(value).size===6;
function category(labels:Record<string,string>,value:unknown){return typeof value==='string'&&Object.hasOwn(labels,value)?labels[value]:'미확인'}
function timestamp(value:number|string){const date=new Date(value);return Number.isFinite(date.getTime())?kst.format(date)+' KST':'확인 시각 미상'}
function officialSource(value:string){try{const url=new URL(value);return url.protocol==='https:'&&['dhlottery.co.kr','www.dhlottery.co.kr'].includes(url.hostname)&&!url.username&&!url.password?url.href:null}catch{return null}}
function validResult(value:RecommendationResult){
 if(!value||!isNumbers(value.numbers))return false;
 if(value.status==='pending')return value.rank===null&&value.matchedCount===null&&value.bonusMatch===null;
 if(!isCount(value.matchedCount)||value.matchedCount>6||typeof value.bonusMatch!=='boolean')return false;
 return value.status==='losing'?value.rank===null:value.status==='matched'&&isRound(value.rank)&&value.rank<=5;
}
function validBatch(value:RecommendationBatch){return value&&isRound(value.id)&&typeof value.batchId==='string'&&isTimestamp(value.acceptedAt)&&isTimestamp(value.cutoffAt)&&isRound(value.targetRound)&&/^\d{4}-\d{2}-\d{2}$/.test(value.targetDate)&&isRound(value.analyzedRound)&&[20,50,100].includes(value.window)&&typeof value.appVersion==='string'&&typeof value.generationMethod==='string'&&value.source==='client_submission'&&(value.ip===null||typeof value.ip==='string')&&Array.isArray(value.combinations)&&value.originalCombinationCount===10&&typeof value.detailsPruned==='boolean'&&typeof value.privacyExpired==='boolean'&&value.combinations.length>0&&value.combinations.length<=10&&(value.detailsPruned?value.combinations.every(result=>result.status==='matched'):value.combinations.length===10)&&value.combinations.every(validResult)&&(value.draw===null||(value.draw.round===value.targetRound&&isNumbers(value.draw.numbers)&&isRound(value.draw.bonus)&&value.draw.bonus<=45&&!value.draw.numbers.includes(value.draw.bonus)&&typeof value.draw.date==='string'))}
function validList(value:RecommendationList):boolean{
 if(!value||!Array.isArray(value.batches)||value.batches.length>25||!value.batches.every(validBatch)||!value.summary||!totals.every(key=>isCount(value.summary[key])))return false;
 const summary=value.summary,matched=summary.rank1+summary.rank2+summary.rank3+summary.rank4+summary.rank5;
 return summary.combinationCount===summary.batchCount*10&&summary.matchedCombinationCount===matched&&summary.combinationCount===summary.pending+summary.deletedBeforeResult+summary.losing+matched&&!!value.history&&['live','saved'].includes(value.history.status)&&['live','cached','conflict'].includes(value.history.verification)&&typeof value.processingPending==='boolean'&&typeof value.history.checkedAt==='string'&&typeof value.history.source==='string'&&typeof value.history.message==='string'&&(value.acceptedSince===null||isTimestamp(value.acceptedSince))&&isTimestamp(value.asOf)&&(value.nextCursor===undefined||value.nextCursor===null||(typeof value.nextCursor==='string'&&/^[1-9]\d*$/.test(value.nextCursor)))&&Array.isArray(value.availableRounds)&&value.availableRounds.every(isRound)&&(value.selectedRound===null||isRound(value.selectedRound));
}
function Numbers({numbers}:{numbers:number[]}){return <span className="admin-combination-numbers" aria-label={numbers.join(', ')}>{numbers.map(number=><span key={number} aria-hidden="true" className={'ball small c'+Math.ceil(number/10)}>{number}</span>)}</span>}
function Result({result}:{result:RecommendationResult}){return <span className={'admin-result admin-result--'+result.status}>{result.status==='pending'?'결과 대기':result.status==='matched'?`${result.rank}등 일치`:'낙첨'}{result.status!=='pending'&&<small>본번호 {result.matchedCount}개{result.bonusMatch?' · 보너스 일치':''}</small>}</span>}
function Batch({batch,matchedOnly}:{batch:RecommendationBatch,matchedOnly:boolean}){
 const combinations=batch.combinations.map((result,index)=>({result,index})).filter(({result})=>!matchedOnly||result.status==='matched');
 return <article className="admin-batch" aria-label={`${batch.targetRound}회 추천 접수 ${timestamp(batch.acceptedAt)}`}>
  <div className="admin-batch-header"><h3>대상 {batch.targetRound}회</h3><span>{batch.targetDate} 추첨</span></div>
  <p className="admin-batch-meta"><strong>IP {batch.privacyExpired?'보존기간 경과':batch.ip||'주소 확인 불가'}</strong><time dateTime={new Date(batch.acceptedAt).toISOString()}>접수 {timestamp(batch.acceptedAt)}</time></p>
  <p className="admin-environment">{batch.privacyExpired?<>기기 환경: 10일 보존기간 경과로 제거됨</>:<>기기(추정): {category(VISIT_DEVICE_LABELS,batch.device)} · OS(추정): {category(VISIT_OS_LABELS,batch.os)}<br/>브라우저(추정): {category(VISIT_BROWSER_LABELS,batch.browser)} · 실행: {category(VISIT_DISPLAY_MODE_LABELS,batch.displayMode)}</>}</p>
  {batch.draw?<p className="admin-official-draw">{batch.draw.round}회 공식 본번호 {batch.draw.numbers.join(' · ')} / 보너스 {batch.draw.bonus}</p>:<p className="admin-notice">대상 {batch.targetRound}회 공식 결과가 없어 아직 비교하지 않았어.</p>}
  <ol className="admin-combinations" aria-label={matchedOnly?'당첨 등수 일치 조합':'접수된 10개 추천 조합'}>{combinations.map(({result,index})=><li className="admin-combination" key={index} value={index+1}><span className="sr-only">조합 {index+1}. </span><Numbers numbers={result.numbers}/><Result result={result}/></li>)}</ol>
  <details className="admin-batch-details"><summary>분석 기준·접수 정보</summary><p>분석 기준 {batch.analyzedRound}회 · 최근 {batch.window}회 분석<br/>당첨 비교 대상은 {batch.targetRound}회만 적용해.</p><p>앱 버전: {batch.appVersion}<br/>생성 방식(클라이언트 보고): {batch.generationMethod}</p><p>최초 접수 {batch.originalCombinationCount}조합{matchedOnly?` 중 ${combinations.length}조합 등수 일치`:''}.{batch.detailsPruned&&' 10일이 지난 낙첨 원본은 제거되어 등수 일치 조합만 남아 있어. 전체 접수 집계는 유지돼.'} 접수된 번호·분석 정보만으로 생성 알고리즘 실행이나 실제 구매를 증명할 수 없어.</p></details>
 </article>;
}

export default function AdminRecommendations({onAuthorizationLost,query,onQueryChange}:Props){
 const [data,setData]=useState<RecommendationList|null>(null),[batches,setBatches]=useState<RecommendationBatch[]>([]),[rounds,setRounds]=useState<number[]>([]);
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[retryCursor,setRetryCursor]=useState<string|undefined>();
 const request=useRef(0),active=useRef(false),controller=useRef<AbortController|null>(null),authorizationLost=useRef(onAuthorizationLost);
 useEffect(()=>{authorizationLost.current=onAuthorizationLost},[onAuthorizationLost]);
 const invalidate=useCallback(()=>{request.current++;controller.current?.abort()},[]);
 const load=useCallback(async(before?:string)=>{
  const id=++request.current;controller.current?.abort();const abort=new AbortController();controller.current=abort;
  setLoading(true);setError('');setRetryCursor(before);
  if(before===undefined){setData(null);setBatches([])}
  const timeout=setTimeout(()=>abort.abort(),20000);
  try{
   const params=new URLSearchParams();if(query.round!==null)params.set('round',String(query.round));if(query.matched)params.set('matched','1');if(before)params.set('before',before);
   const response=await fetch('/api/admin/recommendations'+(params.size?'?'+params.toString():''),{cache:'no-store',credentials:'same-origin',signal:abort.signal});
   if(!active.current||id!==request.current)return;
   if(response.status===401||response.status===403){authorizationLost.current();return}
   if(!response.ok)throw Error(response.status===429?'rate_limited':'unavailable');
   const value=await response.json() as RecommendationList;
   if(!active.current||id!==request.current)return;
   if(!validList(value)||value.selectedRound!==query.round)throw Error('invalid_response');
   setData(value);setRounds(value.availableRounds);
   setBatches(previous=>before===undefined?value.batches:[...previous,...value.batches.filter(batch=>!previous.some(item=>item.id===batch.id))]);
  }catch(reason){
   if(!active.current||id!==request.current)return;
   setError(reason instanceof Error&&reason.message==='rate_limited'?'조회 요청이 많아 잠시 기다린 뒤 다시 시도해줘.':'추천 기록을 불러오지 못했어. 잠시 후 다시 시도해줘.');
  }finally{clearTimeout(timeout);if(active.current&&id===request.current)setLoading(false)}
 },[query]);
 useEffect(()=>{let cancelled=false;active.current=true;queueMicrotask(()=>{if(!cancelled)void load()});return()=>{cancelled=true;active.current=false;invalidate()}},[load,invalidate]);
 function changeQuery(next:RecommendationQuery){if(next.round===query.round&&next.matched===query.matched)return;invalidate();setData(null);setBatches([]);setError('');setLoading(true);onQueryChange(next)}
 const summary=data?.summary,source=data?officialSource(data.history.source):null;
 const heading=query.matched?'당첨 일치 기록':'보존 중인 전체 추천 기록';
 // Keep the selected public draw visible while a fresh authenticated request reloads the available rounds.
 const selectableRounds=query.round===null||rounds.includes(query.round)?rounds:[query.round,...rounds].sort((a,b)=>b-a);
 return <section className="panel admin-recommendations" aria-labelledby="admin-recommendations-heading">
  <div className="section-title"><h2 id="admin-recommendations-heading">추천 기록·당첨 비교</h2><button type="button" className="text-button" disabled={loading} onClick={()=>void load()}>추천 기록 새로고침</button></div>
  <p className="range">접수 시 10조합을 대상 회차 공식 본번호 6개와 보너스로 비교해. 등수 일치는 실제 구매나 당첨자 확인을 뜻하지 않아.</p>
  <div className="admin-recommendation-filters"><label>대상 회차<select aria-label="추천 대상 회차" value={query.round??''} onChange={event=>changeQuery({...query,round:event.target.value?Number(event.target.value):null})}><option value="">전체 회차</option>{selectableRounds.map(round=><option key={round} value={round}>{round}회</option>)}</select></label><div className="admin-recommendation-modes" role="group" aria-label="추천 기록 보기"><button type="button" className="saved-action" aria-pressed={!query.matched} onClick={()=>changeQuery({...query,matched:false})}>전체 추천 기록</button><button type="button" className="saved-action" aria-pressed={query.matched} onClick={()=>changeQuery({...query,matched:true})}>당첨 일치 기록</button></div></div>
  {data&&summary&&<><h3>{query.round===null?'전체 회차':`${query.round}회`} 접수 전체 요약</h3><p className="range">분모: 접수 {count.format(summary.batchCount)}묶음의 {count.format(summary.combinationCount)}조합 전체. 아래 목록의 페이지와 당첨 일치 필터에 관계없이 집계해. 보존기간이 지난 낙첨 원본도 집계에 남아 있어 목록 수와 다를 수 있어.</p><dl className="admin-summary-grid">{([['전체 조합',summary.combinationCount],['1등 일치',summary.rank1],['2등 일치',summary.rank2],['3등 일치',summary.rank3],['4등 일치',summary.rank4],['5등 일치',summary.rank5],['낙첨',summary.losing],['결과 대기',summary.pending],['판정 전 삭제',summary.deletedBeforeResult]] as const).map(([label,value])=><div className="admin-summary-item" key={label}><dt>{label}</dt><dd>{count.format(value)}</dd></div>)}</dl><div className="admin-history-status"><p>{data.history.verification==='conflict'?'공식 자료 충돌 · 새 결과 비교 보류':data.history.status==='saved'?'공식 원본 최신 확인 실패 · 마지막 검증본으로 비교':'공식 원본 확인본으로 비교'}<br/>공식 자료 확인: {timestamp(data.history.checkedAt)}<br/>접수 집계 기준: {timestamp(data.asOf)}</p>{data.history.message&&<p>{data.history.message}</p>}{data.history.verification==='conflict'&&<p>공식 자료의 변경을 확인해야 해. 이미 확정된 비교 결과는 보존하고 새 등수 판정을 멈춘 상태야.</p>}{data.processingPending&&<p>일부 접수 기록의 결과 비교를 처리 중이야. 다음 새로고침에서 이어서 반영해. 아직 처리되지 않은 조합은 결과 대기로 표시돼.</p>}<p>대상 회차 결과가 자료에 없으면 결과 대기로 남아. {source&&<a href={source} target="_blank" rel="noreferrer">동행복권 공식 결과</a>}</p></div></>}
  <h3>{heading}</h3>{query.matched&&<p className="range">대상 회차에서 1~5등 조건과 일치한 추천만 표시해. 요약은 낙첨·결과 대기를 포함한 전체 접수를 기준으로 해.</p>}
  <div className="admin-recommendation-list" aria-busy={loading}>{batches.map(batch=><Batch key={batch.id} batch={batch} matchedOnly={query.matched}/>)}</div>
  {loading&&<p role="status" className="admin-notice">추천 기록 불러오는 중…</p>}
  {error&&<div className="admin-notice" role="alert"><p>{error}</p><button type="button" className="saved-action" disabled={loading} onClick={()=>void load(retryCursor)}>추천 기록 다시 시도</button></div>}
  {!loading&&!error&&data&&!batches.length&&<p className="admin-notice">{query.matched?'선택한 회차에 당첨 등수와 일치한 추천 기록이 없어.':'선택한 회차에 보존 중인 추천 원본이 없어.'}</p>}
  {data?.nextCursor&&!error&&<button type="button" className="saved-action" disabled={loading} onClick={()=>void load(data.nextCursor)}>이전 추천 기록 더 보기</button>}
  <p className="admin-notice">보관 정책 미확정 · 아래 기간 안내는 검토용 초안이야.</p>
  <p className="range">IP는 프록시가 전달한 관측값이며 사람·기기를 식별한 값이 아니야. 기기·OS·브라우저는 추정 범주야. 일반 기록과 낙첨 원본은 10일 보관해. 1~5등 당첨 일치 번호·회차·등수·접수 시각·IP·기기 환경은 사이트 운영 종료까지 보관하며 삭제를 요청할 수 있어. 10일이 지난 결과 대기는 IP·기기 환경을 지우고 번호를 결과 확인까지 보관해. 만료 자료의 실제 정리는 요청이 들어올 때 제한된 수량씩 진행돼 지연될 수 있어. 회차별 비식별 전체 집계는 유지해. 예전 추천이나 보관함 번호가 소급 등록되지는 않아.</p>
 </section>;
}
