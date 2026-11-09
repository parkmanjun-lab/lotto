# Cloudflare 배포 (Workers + D1)

- Worker: `lotto-notes` → https://lotto-notes.personal-lab-d0ro.workers.dev
- D1: `lotto-notes-db` (APAC), id `98752310-8f73-4e56-ba2a-efc0f45a4d1a`, 바인딩 `DB`
- 변수: `ADMIN_CANONICAL_ORIGIN`(위 주소), `ADMIN_TRUST_CF_CONNECTING_IP=1`, `RECOMMENDATION_RECORDING_ENABLED=1`
- 관리자: 아이디 `admin`. 비밀번호는 저장소에 두지 않습니다.
- 실행 위치: `placement.region = aws:ap-southeast-1` (D1 primary가 SIN). 한국 요청이 무료 플랜에서 SEA·LAX로 들어오는 경우가 있어,
  Worker를 D1 옆에서 실행해야 관리자 화면이 빠릅니다. 응답 헤더 `cf-placement: remote-SIN`으로 확인합니다.
- `/api/*` 응답에는 `Server-Timing` 헤더(D1 질의 수와 시간)가 붙습니다.

## 다시 배포하기

```bash
npm ci
npm run build
D1_DATABASE_ID=98752310-8f73-4e56-ba2a-efc0f45a4d1a \
WORKER_VARS='{"ADMIN_CANONICAL_ORIGIN":"https://lotto-notes.personal-lab-d0ro.workers.dev","ADMIN_TRUST_CF_CONNECTING_IP":"1","RECOMMENDATION_RECORDING_ENABLED":"1"}' \
node scripts/build-embedded-worker.mjs
CLOUDFLARE_ACCOUNT_ID=<계정 ID> npx wrangler deploy --config dist/embedded/wrangler.json
```

`build-embedded-worker.mjs`는 `dist/client`의 정적 파일을 Worker 안에 넣습니다.
Claude 클라우드 세션은 프록시가 API 토큰을 넣기 때문에 Workers 정적 자산 업로드(JWT 인증)가 401로 실패합니다. 그래서 이 방법을 씁니다.

## 데이터

백업의 `database/` 폴더(추천 기록, 방문 IP)는 이 저장소에 넣지 않습니다.
빈 D1에 복원할 때는 `restore-into-empty-database.sql`에서 `BEGIN TRANSACTION;`과 `COMMIT;` 두 줄(트리거 안의 BEGIN은 제외)만 지운 뒤
`npx wrangler d1 execute lotto-notes-db --remote --file <파일>`로 실행합니다.
관리자 행(`lotto_admin`, id=1)이 없으면 관리자 로그인과 추천 기록 접수가 503으로 실패합니다.
