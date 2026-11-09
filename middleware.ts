import {NextResponse,type NextRequest} from 'next/server';
export function middleware(request:NextRequest){
 const response=request.headers.get('sec-fetch-dest')==='iframe'?new NextResponse('Forbidden',{status:403}):NextResponse.next();
 response.headers.set('X-Frame-Options','DENY');
 response.headers.set('Content-Security-Policy',"frame-ancestors 'none'");
 response.headers.set('Cache-Control','private, no-store, max-age=0');
 response.headers.set('Referrer-Policy','no-referrer');
 return response;
}
export const config={matcher:['/admin/:path*','/api/admin/:path*']};
