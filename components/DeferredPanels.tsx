'use client';
import {useEffect,useState,type ComponentType} from 'react';
import type {OptionalPanelProps} from './optional-panel-types';
let loaded:ComponentType<OptionalPanelProps>|null=null;
let pending:Promise<ComponentType<OptionalPanelProps>>|null=null;
function load(){return pending??(pending=import('./OptionalPanels').then(module=>{loaded=module.default;return loaded}).catch(error=>{pending=null;throw error}))}
export default function DeferredPanels(props:OptionalPanelProps&{onReady?:()=>void}){
 const[Panel,setPanel]=useState<ComponentType<OptionalPanelProps>|null>(()=>loaded),[failed,setFailed]=useState(false),[attempt,setAttempt]=useState(0);
 useEffect(()=>{let active=true;if(!Panel){setFailed(false);void load().then(component=>{if(active)setPanel(()=>component)}).catch(()=>{if(active)setFailed(true)})}return()=>{active=false}},[Panel,attempt]);
 useEffect(()=>{if(Panel)props.onReady?.()},[Panel,props.onReady]);
 if(Panel)return <Panel {...props}/>;
 return <div className="deferred-panel" role="status">{failed?<><p>내용을 불러오지 못했어. 연결을 확인한 뒤 다시 시도해줘. 추천과 보관 번호는 그대로야.</p><button className="text-button" onClick={()=>setAttempt(value=>value+1)}>다시 불러오기</button></>:<p>내용을 불러오는 중…</p>}</div>
}
