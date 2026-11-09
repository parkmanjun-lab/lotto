export const SOURCE = 'https://www.dhlottery.co.kr/lt645/selectPstLt645Info.do?srchLtEpsd=all';
export const FIRST = Date.UTC(2002,11,7);
export const WEEK = 7*86400000;
export function key(numbers) { return [...numbers].sort((a,b)=>a-b).join('-'); }
export function validNumbers(a) { return Array.isArray(a) && a.length===6 && new Set(a).size===6 && a.every(n=>Number.isInteger(n)&&n>=1&&n<=45); }
export function validateDraws(input, now=Date.now()) {
  if(!Array.isArray(input)||!input.length||input.length>10000) throw Error('회차 데이터가 없거나 형식이 잘못됐어.');
  const draws=input.map(d=>({round:d.round,date:d.date,numbers:[...(d.numbers||[])],bonus:d.bonus})).sort((a,b)=>a.round-b.round);
  draws.forEach((d,i)=>{
    const expected=new Date(FIRST+i*WEEK).toISOString().slice(0,10);
    if(d.round!==i+1 || d.date!==expected || !validNumbers(d.numbers) || !Number.isInteger(d.bonus)||d.bonus<1||d.bonus>45||d.numbers.includes(d.bonus)|| Date.parse(d.date+'T11:45:00Z')>now) throw Error('회차 누락 또는 잘못된 번호가 있어.');
    d.numbers.sort((a,b)=>a-b);
  });
  return draws;
}
export function normalizeOfficial(raw,now=Date.now()) {
  if(!Array.isArray(raw?.data?.list)) throw Error('공식 응답 형식이 달라졌어.');
  return validateDraws(raw.data.list.map(d=>({round:Number(d.ltEpsd),date:String(d.ltRflYmd).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'),numbers:Array.from({length:6},(_,i)=>Number(d[`tm${i+1}WnNo`])),bonus:Number(d.bnsWnNo)})),now);
}
export function frequencies(draws,windowSize) {
  if(!Number.isInteger(windowSize)||windowSize<1||windowSize>draws.length) throw Error('분석 기간을 확인해줘.');
  const counts=Array(46).fill(0);
  for(const d of draws.slice(-windowSize)) for(const n of d.numbers) counts[n]++;
  return counts;
}
export function randomUnit() {
  const values=new Uint32Array(1); globalThis.crypto.getRandomValues(values); return values[0]/4294967296;
}
export function combinations(numbers,size) {
  const out=[];
  function visit(start,pick){if(pick.length===size){out.push([...pick]);return;}for(let i=start;i<=numbers.length-(size-pick.length);i++){pick.push(numbers[i]);visit(i+1,pick);pick.pop();}}
  visit(0,[]);return out;
}
export function recentPatterns(draws,windowSize=50) {
  frequencies(draws,windowSize);
  const latest=new Set(draws.at(-1).numbers),leaders=[],eligible=[];
  for(let size=2;size<=5;size++){
    const map=new Map();
    for(const d of draws.slice(-windowSize)) for(const seq of combinations(d.numbers,size)){
      const k=key(seq),entry=map.get(k)||{numbers:[...seq].sort((a,b)=>a-b),count:0,size};entry.count++;map.set(k,entry);
    }
    const max=Math.max(0,...[...map.values()].map(v=>v.count));
    if(max<2)continue;
    const top=[...map.values()].filter(v=>v.count===max).sort((a,b)=>{for(let i=0;i<size;i++)if(a.numbers[i]!==b.numbers[i])return a.numbers[i]-b.numbers[i];return 0;});
    const safe=[...map.values()].filter(p=>p.count>=2&&p.numbers.filter(n=>latest.has(n)).length<=PREVIOUS_DRAW_LIMIT);
    const safeMax=Math.max(0,...safe.map(p=>p.count));
    const safeTop=safe.filter(p=>p.count===safeMax).sort((a,b)=>{for(let i=0;i<size;i++)if(a.numbers[i]!==b.numbers[i])return a.numbers[i]-b.numbers[i];return 0;});
    const displayed=new Map();
    for(const p of [...top,...safeTop])displayed.set(key(p.numbers),{...p,blocked:p.numbers.filter(n=>latest.has(n)).length>PREVIOUS_DRAW_LIMIT});
    leaders.push(...displayed.values());eligible.push(...safeTop.map(p=>({...p,blocked:false})));
  }
  return {leaders,eligible};
}
export const PREVIOUS_DRAW_LIMIT=2;
export const DIVERSITY_LIMITS=Object.freeze({number:4,pair:2});
export const MULTI_WINDOWS=Object.freeze([20,50,100]);
export const FILTER_WINDOW=50;
export const GENERATION_METHOD='pattern-soft-v7';
export const PATTERN_LIMITS=Object.freeze({maxConsecutiveRun:2,minSum:80,maxSum:200,minOdd:1,maxOdd:5});
export const SOFT_WEIGHTS=Object.freeze({mixed:1.2,repeatedGroupMax:1.2,numberFrequencyMax:1.2,maximum:1.728});
// One ranking partitions all 45 numbers, including ties, into disjoint groups.
export function recent50Groups(draws){
  const counts=frequencies(draws,FILTER_WINDOW);
  const ranked=Array.from({length:45},(_,i)=>({number:i+1,count:counts[i+1]})).sort((a,b)=>b.count-a.count||a.number-b.number);
  const upper=ranked.slice(0,15).map(r=>r.number),middle=ranked.slice(15,30).map(r=>r.number),lower=ranked.slice(30).map(r=>r.number);
  return{window:FILTER_WINDOW,fromRound:draws.at(-FILTER_WINDOW).round,toRound:draws.at(-1).round,ranked,upper,middle,lower};
}
export function mixedGroups(numbers,groups){return Object.fromEntries(['upper','middle','lower'].map(group=>[group,numbers.filter(n=>groups[group].includes(n))]));}
export function matchesPatternLimits(numbers){
  if(!validNumbers(numbers))return false;
  const sorted=[...numbers].sort((a,b)=>a-b),sum=sorted.reduce((a,b)=>a+b,0),odd=sorted.filter(n=>n%2===1).length;
  if(sum<PATTERN_LIMITS.minSum||sum>PATTERN_LIMITS.maxSum||odd<PATTERN_LIMITS.minOdd||odd>PATTERN_LIMITS.maxOdd)return false;
  let run=1;for(let i=1;i<sorted.length;i++){run=sorted[i]===sorted[i-1]+1?run+1:1;if(run>PATTERN_LIMITS.maxConsecutiveRun)return false;}
  return true;
}
export function isIndividuallyEligible(numbers,draws){
  return matchesPatternLimits(numbers)&&draws.length>0&&numbers.filter(n=>draws.at(-1).numbers.includes(n)).length<=PREVIOUS_DRAW_LIMIT&&!draws.some(d=>key(d.numbers)===key(numbers));
}
function checkedUnit(rng){const unit=rng();if(!Number.isFinite(unit)||unit<0||unit>=1)throw Error('난수 생성에 실패했어.');return unit;}
function randomIndex(length,rng){
  const range=4294967296,limit=Math.floor(range/length)*length;
  for(let attempt=0;attempt<64;attempt++){const value=Math.floor(checkedUnit(rng)*range);if(value<limit)return value%length;}
  throw Error('난수 생성에 실패했어. 다시 조회해줘.');
}
// Rejection sampling removes finite-32-bit modulo bias. No anchor requirement.
function uniformTicket(rng){
  const pool=Array.from({length:45},(_,i)=>i+1),pick=[];
  for(let i=0;i<6;i++)pick.push(pool.splice(randomIndex(pool.length,rng),1)[0]);
  return pick.sort((a,b)=>a-b);
}
export function softPreferenceDetails(numbers,profile){
  const groups=mixedGroups(numbers,profile.groups),mixed=groups.upper.length>0&&groups.lower.length>0;
  const anchor=profile.anchors.find(p=>p.size<=3&&p.numbers.every(n=>numbers.includes(n)));
  const mixedMultiplier=mixed?SOFT_WEIGHTS.mixed:1;
  const groupMultiplier=anchor?1+(SOFT_WEIGHTS.repeatedGroupMax-1)*Math.min(1,anchor.score/12):1;
  const meanNumberScore=numbers.reduce((sum,n)=>sum+profile.numberWeights[n],0)/numbers.length;
  const numberMultiplier=1+(SOFT_WEIGHTS.numberFrequencyMax-1)*meanNumberScore/Math.max(...profile.numberWeights);
  return{weight:mixedMultiplier*groupMultiplier*numberMultiplier,mixedMultiplier,groupMultiplier,numberMultiplier,anchor};
}

function choose(n,k){let v=1;for(let i=1;i<=k;i++)v=v*(n-i+1)/i;return v;}
function consistencyScore(periodCounts,size,focus){
  const baseline=choose(6,size)/choose(45,size),periods=Object.keys(periodCounts).map(Number);
  let total=0,weights=0,present=0;
  for(const w of periods){const weight=w===focus?2:1;total+=weight*((periodCounts[w]+20*baseline)/(w+20))/baseline;weights+=weight;if(periodCounts[w]>0)present++;}
  return Math.min(12,Math.max(.05,total/weights))*(.75+.25*present/periods.length);
}
export function multiPeriodProfile(draws,windowSize=50){
  frequencies(draws,windowSize);
  const groups=recent50Groups(draws);
  const periods=[...new Set([...MULTI_WINDOWS,windowSize])].filter(w=>w<=draws.length).sort((a,b)=>a-b);
  const countMaps=new Map(),numberCounts={};
  for(const w of periods){
    numberCounts[w]=frequencies(draws,w);const map=new Map();
    for(const d of draws.slice(-w))for(let size=2;size<=5;size++)for(const seq of combinations(d.numbers,size)){
      const k=key(seq);map.set(k,(map.get(k)||0)+1);
    }countMaps.set(w,map);
  }
  const latest=new Set(draws.at(-1).numbers),anchors=[];
  for(const[k,count]of countMaps.get(windowSize)){
    if(count<2)continue;const numbers=k.split('-').map(Number);
    if(numbers.filter(n=>latest.has(n)).length>PREVIOUS_DRAW_LIMIT)continue;
    const periodCounts=Object.fromEntries(periods.map(w=>[w,countMaps.get(w).get(k)||0]));
    anchors.push({numbers,count,size:numbers.length,blocked:false,periodCounts,score:consistencyScore(periodCounts,numbers.length,windowSize)});
  }
  anchors.sort((a,b)=>b.score-a.score||b.count-a.count||key(a.numbers).localeCompare(key(b.numbers)));
  const numberWeights=Array.from({length:46},(_,n)=>n===0?0:consistencyScore(Object.fromEntries(periods.map(w=>[w,numberCounts[w][n]])),1,windowSize));
  return{periods,anchors,numberWeights,groups};
}
export function generateDetailed(draws,windowSize=50,count=10,rng=randomUnit){
  const checked=validateDraws(draws);
  if(!MULTI_WINDOWS.includes(windowSize))throw Error('추천 기준은 최근 20·50·100회 중 선택해줘.');
  if(!Number.isInteger(count)||count<1||count>10)throw Error('조합 수는 1~10개여야 해.');
  const profile=multiPeriodProfile(checked,windowSize),latest=new Set(checked.at(-1).numbers),past=new Set(checked.map(d=>key(d.numbers)));
  const deadline=performance.now()+1200;
  const failure=()=>Error(`번호 패턴·직전 번호·과거 일치·겹침 제한을 지키는 ${count}조합을 만들지 못했어. 제한은 완화하지 않았어. 다시 조회해줘.`);
  for(let restart=0;restart<30;restart++){
    const used=Array(46).fill(0),pairUsage=new Map(),seen=new Set(past),result=[];
    for(let attempt=0;attempt<400&&result.length<count;attempt++){
      if(performance.now()>=deadline)throw failure();
      const pick=uniformTicket(rng),k=key(pick),pairs=combinations(pick,2);
      if(!matchesPatternLimits(pick)||seen.has(k)||pick.filter(n=>latest.has(n)).length>PREVIOUS_DRAW_LIMIT||pick.some(n=>used[n]>=DIVERSITY_LIMITS.number)||pairs.some(p=>(pairUsage.get(key(p))||0)>=DIVERSITY_LIMITS.pair))continue;
      const preference=softPreferenceDetails(pick,profile);
      // Positive acceptance for every otherwise legal ticket: no silent hard-filter fallback.
      if(checkedUnit(rng)>=preference.weight/SOFT_WEIGHTS.maximum)continue;
      seen.add(k);for(const n of pick)used[n]++;for(const p of pairs){const pairKey=key(p);pairUsage.set(pairKey,(pairUsage.get(pairKey)||0)+1);}
      const anchor=preference.anchor;
      result.push({numbers:pick,...(anchor?{anchor:[...anchor.numbers],anchorCount:anchor.count,anchorPeriods:{...anchor.periodCounts}}:{}),method:GENERATION_METHOD,filterRound:profile.groups.toRound,frequencyGroups:mixedGroups(pick,profile.groups),preferenceWeight:preference.weight,mixedMultiplier:preference.mixedMultiplier,groupMultiplier:preference.groupMultiplier,numberMultiplier:preference.numberMultiplier});
    }
    if(result.length===count)return result;
  }
  throw failure();
}

export function generate(draws,windowSize=50,count=10,rng=randomUnit){return generateDetailed(draws,windowSize,count,rng).map(r=>r.numbers);}
export function latestExpected(now=Date.now()) { return Math.max(0,Math.floor((now-(FIRST+12*3600000))/WEEK)+1); }
