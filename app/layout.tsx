import type { Metadata, Viewport } from 'next';
import './globals.css';
import './marking-theme.css';
export const metadata:Metadata={title:'로또 6/45 | 번호 조합과 기록',description:'과거 당첨 조합 제외와 최근 출현 빈도로 만드는 로또 6/45 번호 조합. 당첨 예측 서비스가 아닙니다.',manifest:'/manifest.webmanifest',icons:{icon:'/favicon.png?v=17',apple:[{url:'/icon-180.png?v=17',sizes:'180x180',type:'image/png'}]},appleWebApp:{capable:true,title:'로또 6/45',statusBarStyle:'default'}};
// Always request current application HTML after an automatic update reload.
export const dynamic='force-dynamic';
export const revalidate=0;
export const viewport:Viewport={width:'device-width',initialScale:1,viewportFit:'cover',themeColor:'#f3f4f7'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="ko"><head><style>{'html,body{background:#f3f4f7;color-scheme:light}'}</style></head><body>{children}</body></html>}
