# KeiAI Migration System — Island Model

## 핵심 원칙

**서버는 섬이다.** Kei 기본 서버와 셀프호스트 PocketBase 서버는 서로 다른 섬이다. 유저는 한 시점에 하나의 섬에만 속한다.

**로그인/가입은 섬 안의 행동이다.** username/password 로그인, 복구 코드, 페어링은 현재 섬의 계정 인증일 뿐이다. 섬을 옮기는 마이그레이션과 섞지 않는다.

**섬 전환은 짐을 싸는 작업이다.** 섬을 바꿀 때는 현재 `remote` 에셋을 모두 로컬 파일로 확보한 뒤, 모든 에셋을 `local` 상태로 전환한다. 새 섬으로의 업로드는 전환 이후 sync가 처리한다.

**실패하면 아무 일도 일어나지 않아야 한다.** 마이그레이션 준비 단계에서 실패하면 user record와 asset record를 변경하지 않는다. 로컬에 임시로 받은 파일은 캐시로 남아도 되지만, canonical 상태는 기존 섬을 유지한다.

---

## 1. Island Model

```
Kei Island (기본 섬)
  ├─ 공식 PB 서버
  ├─ 공식 CDN asset catalog
  ├─ 경량 봇 카드 import/export 가능
  └─ 비로그인 상태에서도 공식 CDN remote asset을 lazy fetch 가능

Self-host Island (셀프호스트 섬)
  ├─ 사용자가 지정한 PB 서버
  ├─ 해당 PB 서버의 private asset catalog
  ├─ asset download에 PB 인증 필요
  └─ 경량 봇 카드는 import 시 binary를 받아 local로 고정
```

섬은 `UserRecord.selfHostUrl?: string`으로만 구분한다.

| 상태                        | 의미          |
| --------------------------- | ------------- |
| `selfHostUrl === undefined` | Kei 기본 섬   |
| `selfHostUrl !== undefined` | 셀프호스트 섬 |

별도의 `isSelfHost` 플래그는 두지 않는다. URL 존재 여부가 곧 섬 상태다.

서버의 `users` 테이블에는 `selfHostUrl`을 저장하지 않는다. 이 값은 **로컬 유저 설정**이며, 어떤 서버에 동기화할지 결정하는 클라이언트 전용 상태다.

---

## 2. 마이그레이션과 인증의 분리

마이그레이션은 현재 유저의 섬을 바꾸는 작업이다. 계정 생성, 로그인, 복구, 페어링은 현재 섬 안에서만 수행된다.

```
섬 전환:
  current island → assets remote-to-local → user.selfHostUrl 변경

인증:
  current island의 PB 서버 → username/password 또는 recovery/pairing
```

### 분리해야 하는 이유

- 가입 성공 후 마이그레이션 실패 시 서버 계정만 생성되고 로컬 상태가 애매해질 수 있다.
- 로그인 성공 후 에셋 마이그레이션 실패 시 이미 인증 상태가 바뀌어 재시도 조건이 꼬일 수 있다.
- 나중에 다시 로그인할 때 "이미 존재하는 계정"으로 처리되어 마이그레이션 없이 들어가면 에셋이 깨질 수 있다.

따라서 UI도 두 행동을 분리한다.

| 행동                            | 담당         |
| ------------------------------- | ------------ |
| 셀프호스트 서버로 이동          | Migration UI |
| 셀프호스트 서버에서 가입/로그인 | Account UI   |
| Kei 기본 서버로 복귀            | Migration UI |
| Kei 서버에서 가입/로그인        | Account UI   |

---

## 3. Migration Lock

마이그레이션 중에는 모든 sync와 asset eviction을 멈춘다.

이 상태는 단순 인메모리 boolean이 아니다. 여러 브라우저 탭이 같은 로컬 DB를 공유할 수 있으므로, **userId 단위의 cross-tab migration lock**이어야 한다.

```ts
interface MigrationLock {
  userId: string;
  startedAt: number;
  ownerId: string; // tab/window instance id
}
```

권장 저장 위치는 `appKV` 또는 동등한 cross-tab readable local store다. 탭 간 즉시 전파가 필요하면 `BroadcastChannel`을 보조로 사용한다.

lock은 canonical domain data가 아니라 local coordination state다. 서버에 동기화하지 않는다.

### lock 획득

```
acquireMigrationLock(userId):
  existing = getMigrationLock(userId)
  if existing exists and not expired:
    throw MIGRATION_ALREADY_RUNNING

  write lock { userId, startedAt, ownerId }
  broadcast lock acquired
```

동일 유저에 대해 lock은 하나만 존재한다. 다른 탭은 lock이 있는 동안 sync tick, asset upload, LRU eviction을 수행하지 않는다.

### lock 해제

```
releaseMigrationLock(userId, ownerId):
  existing = getMigrationLock(userId)
  if existing.ownerId === ownerId:
    delete lock
    broadcast lock released
```

owner가 아닌 탭은 lock을 해제하지 않는다. 단, 앱 crash나 탭 종료로 lock이 남을 수 있으므로 TTL을 둔다.

권장 TTL:

| 항목              | 값                                         |
| ----------------- | ------------------------------------------ |
| 기본 TTL          | 30분                                       |
| 진행 중 heartbeat | 30초마다 `startedAt` 또는 `updatedAt` 갱신 |
| expired lock      | 다음 lock 획득 시 제거 가능                |

### lock 적용 범위

- 자동 sync tick 중지
- realtime 구독 중지 또는 무시
- write queue flush 중지
- asset upload worker 중지
- asset LRU eviction 중지

특히 에셋 localization을 `AssetService.read()` 경로로 수행한다면 LRU eviction도 반드시 lock을 확인해야 한다. 마이그레이션이 remote asset을 읽어 local file로 확보하는 도중, 다른 탭의 eviction이 같은 asset cache를 삭제하면 prepare 단계가 불안정해질 수 있다.

로컬 DB 쓰기 자체를 전역 차단하지는 않는다. 단, 마이그레이션 UI는 완료 전까지 사용자의 일반 편집 동작을 막는 것이 안전하다.

---

## 4. Migration Protocol

섬 전환은 항상 같은 프로토콜을 따른다.

```
1. validate target island
2. acquire migration lock
3. prepare: 모든 remote asset ciphertext 확보
4. commit: asset status를 local로 전환 + user.selfHostUrl 변경
5. release migration lock
```

### 4.1 Prepare

현재 유저의 live asset 중 `status === 'remote'`인 항목을 모두 찾는다.

각 asset에 대해:

```
1. appStorage에 평문 파일이 있으면 통과
2. 없으면 현재 섬의 source에서 ciphertext 다운로드
3. sha256(ciphertext) === asset.hash 검증
4. encKey로 복호화
5. appStorage에 평문 저장
6. assetRegistry 갱신
```

이 단계에서는 `assets` 테이블의 `status`를 바꾸지 않는다.

### 4.2 Commit

모든 prepare가 성공한 뒤에만 하나의 commit 단계로 들어간다.

```
transaction:
  assets where userId=currentUser and status='remote'
    → status='local'

  user.selfHostUrl = nextSelfHostUrl
```

`nextSelfHostUrl` 값:

| 전환            | 값            |
| --------------- | ------------- |
| Kei → Self-host | 입력한 PB URL |
| Self-host → Kei | `undefined`   |

### 4.3 Resume

commit 이후 sync를 재개한다.

전환 직후 모든 asset은 `local`이므로, 현재 섬에서 로그인되어 있다면 asset sync worker가 새 서버에 업로드하고 성공 후 `remote`로 바꾼다.

현재 섬에서 로그인되어 있지 않다면 `local` 상태를 유지한다.

---

## 5. 전환 시나리오

### 5.1 Kei → Self-host

```
사용자: 셀프호스트 모드로 이동
  → PB URL 입력
  → 서버 ping으로 유효성 확인
  → migration lock 획득
  → Kei remote assets를 모두 local로 확보
  → assets.status = local
  → user.selfHostUrl = PB URL
  → migration lock 해제
```

이후 사용자는 셀프호스트 섬에서 가입/로그인/복구/페어링을 수행한다.

로그인되어 있으면 local asset이 셀프호스트 PB로 업로드된다. 로그인되어 있지 않으면 모든 asset은 local 상태로 유지된다.

### 5.2 Self-host → Kei

```
사용자: 셀프호스트 모드 해제
  → 확인 dialog
  → migration lock 획득
  → self-host remote assets를 모두 local로 확보
  → assets.status = local
  → user.selfHostUrl = undefined
  → migration lock 해제
```

Kei 계정 로그인 여부는 마이그레이션 조건이 아니다. Kei로 돌아온 뒤 사용자가 로그인하면 local asset이 공식 서버로 업로드된다.

### 5.3 Self-host A → Self-host B

직접 전환을 지원하지 않는다.

```
Self-host A → Kei → Self-host B
```

셀프호스트 서버 간 직접 이동은 상태 공간을 늘리고, 실패 복구와 인증 경계를 복잡하게 만든다. 모든 이동은 Kei 기본 섬을 허브로 사용한다.

---

## 6. Asset Semantics

`remote`는 전역 상태가 아니라 **현재 섬에서 재획득 가능한 상태**다.

| 현재 섬   | `remote` 의미                                   |
| --------- | ----------------------------------------------- |
| Kei       | 공식 CDN/catalog에 ciphertext 존재              |
| Self-host | 현재 `selfHostUrl` PB catalog에 ciphertext 존재 |

섬 전환 시 기존 `remote` 의미는 더 이상 유효하지 않으므로 모두 `local`로 재평가한다.

### Import

| 현재 섬   | 경량 봇 카드 import                                      |
| --------- | -------------------------------------------------------- |
| Kei       | `hash + encKey`를 기록하고 `status: remote`로 lazy fetch |
| Self-host | 공식 CDN에서 binary를 받아 `status: local`로 저장        |

Self-host 섬에서는 외부 hash를 직접 `remote`로 기록하지 않는다. 그 hash가 현재 self-host PB catalog에 있다는 보장이 없기 때문이다.

### Export

| 현재 섬   | Export 방식                              |
| --------- | ---------------------------------------- |
| Kei       | 모든 asset이 remote이면 경량 export 가능 |
| Self-host | binary 포함 export                       |

Kei 섬은 경량 공유와 CDN lazy fetch가 가능한 섬이다. Self-host 섬은 독립성과 소유권을 얻는 대신 경량 공유 편의성을 내려놓는다.

---

## 7. Login Guard

로그인은 현재 섬 안에서만 유효하다.

로그인 성공 후 서버 record에서 `userId`를 얻었을 때, 같은 `userId`의 로컬 유저가 이미 존재하면 섬이 일치해야 한다.

```
currentIsland = activeUser.selfHostUrl
serverUserId = authResult.record.id
localUser = appUser.getUser(serverUserId)

if localUser exists:
  if localUser.selfHostUrl !== currentIsland:
    reject login
```

### 필요한 이유

예시:

```
로컬 유저 A: selfHostUrl = https://pb-a.example
로컬 유저 B: selfHostUrl = undefined

현재 active user = A
사용자가 B의 username/password로 로그인 시도
```

서버 인증만 보면 로그인은 성공할 수 있다. 하지만 로컬에는 이미 B가 Kei 섬 유저로 존재한다. 이 상태에서 A의 셀프호스트 섬 컨텍스트로 B를 저장하면 로컬 identity와 asset source가 꼬인다.

따라서 로컬에 같은 `userId`가 있는 경우, 그 유저의 `selfHostUrl`과 현재 섬이 다르면 로그인하지 않는다.

권장 에러:

> 이 계정은 다른 동기화 서버에 연결된 로컬 사용자입니다. 해당 사용자로 전환한 뒤 다시 시도하세요.

---

## 8. Failure Model

### Prepare 실패

예:

- asset download 404
- PB 인증 만료
- hash 검증 실패
- 복호화 실패
- 로컬 storage 쓰기 실패

처리:

```
assets.status 변경 없음
user.selfHostUrl 변경 없음
sync 재개
사용자에게 실패 asset 수와 재시도 안내
```

Prepare 중 이미 다운로드된 파일은 캐시로 남아도 된다. canonical 상태가 바뀌지 않았기 때문에 다음 재시도에서 재사용할 수 있다.

### Commit 실패

Commit은 짧은 로컬 DB transaction이어야 한다. 실패하면 transaction rollback으로 기존 상태를 유지한다.

### Resume 실패

Resume 실패는 마이그레이션 실패가 아니다. 이미 섬 전환은 완료되었고, 이후 sync 재시도 정책이 처리한다.

---

## 9. UI Flow

### 기본 상태 → 셀프호스트

```
설정 > 셀프호스트 모드로 이동
  ├─ PB URL 입력
  ├─ 서버 확인
  ├─ 마이그레이션 안내
  ├─ 진행률 표시
  │   ├─ remote asset 수
  │   ├─ 다운로드 완료 수
  │   └─ 실패 asset
  └─ 완료 후 셀프호스트 섬으로 이동
```

완료 후 같은 화면에서 가입/로그인을 유도할 수 있지만, 마이그레이션의 일부로 묶지 않는다.

### 셀프호스트 → 기본 상태

```
설정 > 셀프호스트 모드 해제
  ├─ "에셋을 모두 이 기기에 가져온 뒤 기본 모드로 돌아갑니다" 확인
  ├─ 진행률 표시
  └─ 완료 후 Kei 섬으로 이동
```

Kei 로그인은 선택 사항이다. 로그인되어 있지 않으면 local-only 상태로 돌아온다.

---

## 10. Invariants

```
1. user.selfHostUrl is local-only.
   서버 users 테이블에는 저장하지 않는다.

2. 섬 전환은 인증과 독립이다.
   createAccount/signIn/recover/pairing은 migration을 수행하지 않는다.

3. 섬 전환은 항상 remote → local 전환이다.
   전환 중 어떤 서버에도 asset을 업로드하지 않는다.

4. 마이그레이션 중인 userId에 대해서 sync, asset upload, LRU eviction은 no-op이다.
   이 판단은 cross-tab migration lock을 기준으로 한다.

5. assets.status='remote'는 현재 섬에서만 의미가 있다.
   selfHostUrl 변경 시 기존 remote status는 모두 무효화된다.

6. prepare가 모두 성공하기 전에는 canonical DB 상태를 바꾸지 않는다.

7. local에 같은 userId가 존재하면 login 결과의 섬이 일치해야 한다.

8. Self-host A → Self-host B 직접 전환은 지원하지 않는다.
   반드시 Self-host A → Kei → Self-host B 순서로 이동한다.
```

---

## 11. 구현 메모

### UserRecord

```ts
interface UserRecord {
  id: string;
  name: string;
  username?: string;
  avatar: string;
  email?: string;
  selfHostUrl?: string;
  masterKey: CryptoKey;
  identityKeyPair: CryptoKeyPair;
}
```

기존 `syncServerUrl` 개념은 `selfHostUrl`로 좁힌다. `undefined`는 공식 Kei 서버를 뜻한다.

### MigrationService

```ts
class MigrationService {
  static async enterSelfHost(url: string): Promise<void>;
  static async leaveSelfHost(): Promise<void>;
}
```

이 서비스는 인증을 호출하지 않는다. URL ping, sync pause/resume, asset prepare, local commit만 담당한다.

### MigrationLockService

```ts
class MigrationLockService {
  static async acquire(userId: string): Promise<MigrationLock>;
  static async release(lock: MigrationLock): Promise<void>;
  static async isLocked(userId: string): Promise<boolean>;
  static subscribe(callback: () => void): () => void;
}
```

이 서비스는 `appKV` 같은 cross-tab readable store에 lock을 저장하고, `BroadcastChannel`로 탭 간 변경을 전파한다.

SyncManager, AssetSyncService, AssetService LRU eviction은 userId별 lock을 확인하고, lock이 있으면 작업을 시작하지 않는다.

### AuthService

AuthService는 현재 active user의 `selfHostUrl`을 기준으로 PB baseUrl을 결정한다.

로그인 성공 후 같은 `userId`의 로컬 유저가 있으면 `selfHostUrl` 일치 여부를 검사한다.

### AssetService

AssetService는 현재 섬에 따라 import/export 전략을 바꾼다.

```ts
if (isSelfHostIsland()) {
  importLightweightCardAsLocalBinary();
  exportCardWithBinaryAssets();
} else {
  importLightweightCardAsRemoteRefs();
  exportLightweightCardWhenPossible();
}
```
