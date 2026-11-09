import type {ComponentType} from 'react';
import type {Draw,frequencies,multiPeriodProfile,recent50Groups} from '@/lib/lotto.mjs';
export type OptionalPanelProps={appVersion:string;kind:'stats'|'filter'|'method'|'install';draws:Draw[];windowSize:number;status:string;checked:string;timingMarks:{initialized:number|null,interactive:number|null,restored?:boolean};Icon:ComponentType<{name:string}>;Ball:ComponentType<{n:number,small?:boolean}>;getCounts:typeof frequencies;getProfile:typeof multiPeriodProfile;getGroups:typeof recent50Groups};
