'use client';
import {useEffect,useState,type ComponentType} from 'react';
export type PrizePanelProps={Ball:ComponentType<{n:number,small?:boolean}>};
let loaded:ComponentType<PrizePanelProps>|null=null;
let pending:Promise<ComponentType<PrizePanelProps>>|null=null;
function load(){return pending??(pending=import('./PrizeResults').then(module=>{loaded=module.default;return loaded}).catch(error=>{pending=null;throw error}))}
export default function DeferredPrizeResults(props:PrizePanelProps){
 const [Panel,setPanel]=useState<ComponentType<PrizePanelProps>|null>(()=>loaded),[failed,setFailed]=useState(false),[attempt,setAttempt]=useState(0);
 useEffect(()=>{let active=true;if(!Panel){setFailed(false);void load().then(component=>{if(active)setPanel(()=>component)}).catch(()=>{if(active)setFailed(true)})}return()=>{active=false}},[Panel,attempt]);
 if(Panel)return <Panel {...props}/>;
 return <section className="panel prize-loading" role="status"><h2>당첨내역</h2><p>{failed?'내용을 불러오지 못했어. 다시 시도해줘.':'당첨내역을 불러오는 중…'}</p>{failed&&<button className="text-button" onClick={()=>setAttempt(value=>value+1)}>다시 불러오기</button>}</section>;
}
