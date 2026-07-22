# KeiAI Connection System

## 목적

Connection system은 로컬 사용자가 이 기기에서 사용할 KeiAI server와 Web proxy를 결정한다.
두 설정은 `UserRecord.connections`에 저장되는 user-device scope의 local-only 상태이며 서버로
동기화하지 않는다.

```ts
interface UserConnectionSettings {
  server: {
    mode: "default" | "custom";
    customUrl?: string;
  };
  proxy: {
    mode: "default" | "custom" | "off";
    customUrl?: string;
  };
}
```

`customUrl`은 mode가 비활성화되어도 유지한다. 사용자가 custom mode로 돌아오면 이전 입력을
재사용할 수 있다.

## 책임

`ConnectionService`는 다음을 담당한다.

- custom server의 `/api/capabilities` 호환성 검증
- custom proxy의 `/spec` 호환성 검증
- server 변경 전 remote asset localization
- connection 설정의 로컬 영속화와 runtime 적용
- 실패 시 canonical 상태의 보상 rollback
- server transition 동안 sync와 asset eviction 정지
- 현재 runtime 목적지가 공식 Kei server/proxy인지 판별

`stores/connection.ts`는 UI action, 진행 상태, 성공한 `activeUser` 결과 반영만 담당한다.
rollback과 business invariant는 store에 두지 않는다.

`stores/auth.ts`와 `AuthService`는 현재 선택된 server 안의 가입, 로그인, 복구, pairing,
로그아웃만 담당한다. 인증 흐름은 server 선택을 변경하지 않는다.

## Runtime 활성화

앱 부트와 사용자 전환에서 `UserService.setActiveUser()`가 두 connection을 함께 적용한다.

```text
UserRecord load
→ session activation
→ server mode 해석 후 pb.baseUrl 갱신
→ proxy mode 해석 후 HTTP adapter snapshot 갱신
→ 이후 auth/sync/network 작업 시작
```

네이티브 Tauri HTTP는 CORS 우회가 필요 없으므로 proxy 설정과 관계없이 항상 direct다.

## Server transition

Server URL이 실제로 변경될 때 다음 프로토콜을 따른다.

```text
1. 대상 URL과 capabilities 검증
2. server transition lock
3. sync와 asset eviction 중지
4. 현재 server의 remote asset을 모두 local file로 확보
5. asset status를 local로 commit
6. UserRecord.connections.server commit
7. pb.baseUrl 교체 및 이전 server auth 제거
8. sync와 eviction 재개, lock 해제
```

prepare가 실패하면 asset status와 connection 설정을 변경하지 않는다. Asset status commit 후
UserRecord commit이 실패하면 asset status를 remote로 복구한다. Runtime 적용 후 예상하지 못한
실패가 발생하면 이전 connection 설정과 runtime을 복구한다.

Server mode만 달라지고 해석된 URL이 같다면 asset localization과 auth clear 없이 설정만 갱신한다.

## Proxy 변경

```text
1. mode와 URL 검증
2. custom mode면 GET /spec 검증
3. UserRecord.connections.proxy commit
4. HTTP adapter runtime snapshot 교체
```

HTTP adapter의 초기 runtime은 `direct`다. `default` mode는 빌드의 `PROXY_URL`이 있으면 proxy를
사용하고, 없으면 direct로 해석한다. `custom` mode는 유효한 URL과 `/spec` 검증이 필요하며 실패
시 direct로 fallback하지 않는다.

Custom proxy 검증은 protocol 호환성만 확인한다. API key와 요청 본문이 proxy를 통과하므로 UI는
별도의 trust warning을 항상 표시한다.

## Identity와 capability

```ts
isKeiServer();
isKeiProxy();
```

두 함수는 저장된 mode가 아니라 현재 적용된 runtime 목적지를 판별한다. 공식 인프라에만 허용할
정책에 사용한다.

```ts
isKeiDefaultServer();
isKeiDefaultProxy();
```

두 함수는 `config.ts`의 빌드 기본값을 판별하며 Connections UI의 `Kei Cloud`, `Kei Proxy`,
`Default` label에 사용한다.

기능 지원 여부는 공식 server identity와 분리한다. Server `/api/capabilities` 응답은 향후 auth,
record sync, asset storage, multi-room 등 개별 서비스 capability를 광고할 수 있다.

## 불변식

1. Connection 설정은 local-only이며 PB user profile payload에 포함하지 않는다.
2. UI와 handler는 직접 URL을 해석하지 않는다.
3. 네트워크 요청 hot path는 로컬 저장소를 읽지 않는다.
4. 사용자 활성화 전에 이전 사용자의 runtime connection을 새 요청에 사용하지 않는다.
5. Server와 Proxy 설정은 같은 lifecycle을 공유하지만 변경 프로토콜은 독립적이다.
6. Server 변경 실패 시 기존 server와 remote asset 의미를 유지한다.
7. Proxy `custom` 검증 실패는 direct 전송으로 fallback하지 않는다.
8. 실제 실행 정책은 mode가 아니라 runtime identity와 capability를 사용한다.
