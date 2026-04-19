# KeiAI Architecture Decision Records

- 결정 기록: 아키텍처의 방향이 바뀔 때 기록합니다 (예: N:M → 1:N, 새로운 어댑터, 새로운 동기화 전략)
- 기록 대상 아님: 일반적인 버그 수정, 간단한 UI 조정 또는 전체 설계에 영향을 미치지 않는 구현 세부 사항
- 형식: 각 항목은 `## NNN: 제목` 형식을 사용하며 맥락/문제/대안/결정/결과 필드를 포함합니다.
- 중복 대신 업데이트: 이전 ADR이 대체되는 경우, 해당 ADR의 상태를 `폐기`로 표시하고 새 ADR을 참조합니다.

---

## 001: 로어북/스크립트를 N:M 참조에서 1:N Deep Copy로 변경

- 상태: 채택
- 맥락: 로어북과 스크립트는 캐릭터, 채팅, 모듈 등 여러 종류의 부모가 소유할 수 있다. 초기에는 N:M 참조 + Reference Counting으로 메모리 관리를 설계했다.
- 문제: E2EE 환경에서 N:M 참조된 로어북을 삭제할 때, 루트 소유자를 특정할 수 없어 cascade delete가 불가능하다. 부모가 여러 종류(캐릭터, 채팅, 모듈)이므로 "누가 진짜 주인인지" 판별이 안 된다.
- 대안 검토:
    - Reference Counting → 삭제 시 루트 소유자 특정 불가, 동기화 환경에서 정합성 깨지기 쉬움
    - 별도 맵핑 테이블 → "누가 무엇을 쓰는지" 메타데이터가 평문 노출
- 결정: 1:N Deep Copy 방식. 공유 시 독립된 복사본을 생성하고, 부모 삭제 시 소유한 자식을 일괄 cascade delete.
- 결과: 데이터 중복은 늘지만 소유권이 명확해지고, E2EE 환경에서도 안전한 삭제가 보장된다.
- 참고: 캐릭터, 채팅, 모듈 같은 엔티티는 최종 부모가 루트(settings) 하나뿐이므로 N:M 참조를 허용한다. 로어북/스크립트만 부모 종류가 다양하기 때문에 1:N Deep Copy를 적용.

---

## 002: 에셋 테이블을 DB 어댑터에서 분리

- 상태: 채택
- 맥락: 에셋 테이블도 PocketBase와 동기화되는 EncryptedRecord 기반 테이블이므로, 다른 데이터 테이블과 같은 DB 어댑터에 넣을 수 있었다.
- 문제: 에셋 레지스터리가 에셋 테이블에 종속되어야 한다. 에셋 레지스터리는 에셋 테이블의 "암호화되지 않은 캐시" 역할을 하며, 에셋 테이블 변경 시 레지스터리도 같이 업데이트되어야 한다. 또한 에셋 관련 이벤트(업로드 큐, 삭제 큐 트리거 등)는 일반 데이터 동기화 이벤트와 독립적으로 동작해야 한다.
- 결정: 에셋 테이블을 별도의 어댑터/sync 엔진으로 분리. 에셋 고유의 이벤트 시스템과 레지스터리 연동을 독립적으로 관리.
- 결과: 에셋 sync 엔진이 데이터 sync 엔진과 독립적으로 동작하며, 에셋 특유의 라이프사이클(업로드 큐, 삭제 큐, LRU 캐시)을 깔끔하게 관리할 수 있다.

---

## 003: Tauri 환경의 유저 테이블 3중 저장 (IDB + SQLite + Stronghold)

- 상태: 채택
- 맥락: Tauri 환경에서 일반 데이터는 SQLite에 저장되지만, `CryptoKey` 객체는 Web Crypto API의 Structured Clone을 통해서만 저장 가능하므로 SQLite에 넣을 수 없다. 따라서 유저 테이블(마스터 키 포함)만 IDB를 사용해야 한다.
- 문제: IDB는 SQLite보다 훨씬 잘 날아간다(브라우저 캐시 정리, 스토리지 압박 등). 만약 IDB만 쓰면, IDB가 날아갔을 때 SQLite에 영원히 잠자는 데이터만 남게 된다 — 마스터 키가 없으면 복호화가 불가능하므로.
- 결정:
    - `IDB`: CryptoKey 객체 포함 유저 레코드 (primary)
    - `SQLite`: 유저 레코드 (키 없이, 메타데이터 미러)
    - `Stronghold`(Keychain): userId + masterKey raw bytes 백업
    - `getUser`: IDB에서 먼저 찾고, 없으면 Stronghold에서 (id, masterKey)를 복구
- 결과: IDB가 날아가도 Stronghold에서 마스터 키를 복구하여 SQLite의 데이터에 다시 접근할 수 있다. 웹 환경은 IDB 하나만 쓰고, 날아가면 로그인으로 복구.

---

## 004: 크로스 플랫폼을 위한 어댑터 패턴

- 상태: 채택
- 맥락: 하나의 코드베이스로 웹, 데스크탑(Tauri), 모바일을 동시에 지원해야 했다.
- 결정: 9개의 어댑터 인터페이스를 정의하고, 각각 Web/Tauri 구현을 `isTauri()` 런타임 디스패치로 선택. 서비스 레이어는 어댑터 인터페이스만 의존하므로 플랫폼 차이를 모른다.
- 대상: DB, KV, Storage, User, HTTP, Clipboard, Dialog, Notification, Window
- 결과: 서비스/스토어/UI 코드는 플랫폼에 무관하게 동일. 새 플랫폼 추가 시 어댑터 구현만 추가하면 된다.

---

## 005: 도메인 타입의 Refs/Content 분리로 데이터 정합성 보호

- 상태: 채택
- 맥락: 캐릭터 데이터에는 자식 레퍼런스(chatRefs, lorebookRefs 등)와 편집 가능한 콘텐츠(systemPrompt, greetingMessage 등)가 같은 객체에 공존한다.
- 문제: 상위 레이어(UI/Store)에서 데이터를 업데이트할 때, 레퍼런스를 실수로 덮어쓰거나 망가뜨릴 위험이 있다.
- 결정: 타입을 `CharacterDataRefs`와 `CharacterDataContent`로 분리. 상위 레이어의 업데이트 메서드는 `Content` 타입만 허용하고, Refs 조작은 전용 메서드(addChatRef, removeChatRef 등)를 통해서만 가능하게 제한.
- 결과: 타입 시스템이 잘못된 데이터 조작을 컴파일 타임에 차단. 데이터 정합성의 첫 번째 방어선.

---

## 006: 스토어를 readonly로 내보내고 조작은 하위 레이어 메서드만 허용

- 상태: 채택
- 맥락: Svelte Store는 `.set()`/`.update()`로 누구나 직접 조작 가능하다.
- 문제: UI 컴포넌트에서 스토어를 직접 `.set()`하면 서비스 레이어의 암호화/검증 로직을 우회하게 되어 데이터 정합성이 깨진다.
- 결정:
    - `stores/state.ts`: 모든 writable 스토어 선언 (내부용)
    - `stores/index.ts`: `readonly()`로 감싸서 re-export (UI용)
    - 스토어 조작은 action 함수(loadCharacters, selectChat 등)를 통해서만 가능
    - action 함수는 서비스 레이어를 호출한 후 결과로 스토어를 업데이트
- 결과: 서비스 → 스토어 → UI의 단방향 데이터 흐름이 강제된다. UI 개발 시 스토어 활용만 하면 되므로 생산성도 향상.

---

## 007: CRUD 메서드의 일관된 정합성 패턴

- 상태: 채택
- 맥락: Entity를 생성/수정/삭제할 때 여러 테이블을 동시에 조작해야 한다 (예: 캐릭터 생성 → DB 쓰기 + 부모의 refs 배열 업데이트 + 스토어 반영).
- 문제: 중간에 실패하면 일부만 반영되어 데이터 불일치가 발생한다.
- 결정: 모든 CRUD에 일관된 패턴 적용:
    ```
    1. Create Record in DB
    2. Add to parent's refs
       → If parent's refs update fails, roll back DB
    3. Update Store
    ```
    DB 쓰기는 Dexie 트랜잭션으로 원자성 보장. 부모 refs 업데이트 실패 시 롤백.
- 결과: 어떤 엔티티든 같은 패턴으로 CRUD가 구현되어 예측 가능하고, 중간 실패 시에도 정합성이 유지된다.

---

## 008: 백그라운드 생성 & Store 독립적 Generation Pipeline

- 상태: 폐기 → ADR 026으로 대체
- 맥락: RisuAI에서 채팅을 보내면 생성이 끝날 때까지 꼼짝없이 기다려야 했다. 스트리밍 렌더링도 매끄럽지 못했다.
- 불편했던 점:
    - 생성 중 다른 채팅방으로 이동 불가
    - 스트리밍이 뚝뚝 끊기는 UX
    - 1970줄짜리 단일 함수에 모든 로직이 하드코딩
- 결정:
    - 생성 시점에 필요한 모든 컨텍스트(캐릭터, 프리셋, 로어북, 스크립트)를 스냅샷하여 Store와 완전 독립
    - `generationTasks` 스토어에 chatId로 keyed Map으로 저장 — 유저가 방을 이동해도 백그라운드 생성 지속
    - `displayMessages` derived store로 확정 메시지 + 생성 중 메시지를 단일 리스트로 합성
    - morphdom + 디바운스로 스트리밍 렌더링 최적화
- 결과: 채팅 A에서 생성을 시작하고 채팅 B로 이동 가능. 돌아오면 생성 결과가 반영되어 있다. 스트리밍도 부드럽게 표시.

---

## 009: 에셋 시스템 — ID 전략의 진화

- 상태: 채택 (UUID 방식)
- 맥락: 에셋 ID를 어떻게 매길 것인가에 대한 고민.
- 검토 과정:
    1. SHA-256(평문) → 중복 제거는 되지만, DB 테이블에 평문 해시가 노출되어 "누가 어떤 에셋을 가졌는지" 메타데이터 유출
    2. HMAC-SHA256(MasterKey, UUID) → 에셋 ID를 은닉할 수 있지만, 복잡도 증가
    3. UUID → "로컬에서 중복을 그렇게까지 경계할 이유가 있나? 개인이 같은 봇을 백 번씩 임포트하진 않는다." 삭제 시 소유자가 명확하므로 cascade delete가 깔끔함
- 결정: 로컬 ID는 UUID. 서버 업로드 시:
    - 프라이빗/인레이: 에셋을 M으로 암호화 후, 평문의 해시값을 URL로 사용. 암호화 키는 AssetFields에 저장.
    - 퍼블릭: 평문 해시를 URL로 사용, 데이터도 평문.
- 결과: 로컬 ID 체계가 단순해지고, 삭제가 완벽해짐. 서버에서의 프라이버시는 암호화로 보장.

---

## 010: 에셋 레지스터리 = 에셋 테이블의 평문 캐시 + 삭제 큐

- 상태: 채택
- 맥락: 에셋 접근/eviction/삭제를 위해 에셋의 상태(kind, status, hash 등)를 빠르게 조회해야 하지만, 에셋 테이블은 암호화되어 있어 매번 복호화해야 한다.
- 설계 진화:
    1. 처음: 에셋 테이블에 status 필드 추가 필요성 인식 — 삭제 시 remote 에셋만 서버에 delete 요청해야 하므로
    2. 다음: status에 'deleted'를 넣으면 안 됨 — status는 "CDN에 올바른 버전이 존재하는가"를 나타내야 하므로
    3. 최종: 레지스터리에 `isDeleted` 플래그 추가 → 영속적인 삭제 큐로 활용
- 결정: 에셋 레지스터리는 에셋 테이블의 준영속적 평문 캐시. 에셋 정보 수정 시 테이블 먼저 수정 → 레지스터리에도 있으면 같이 수정. `isDeleted=true`인 항목은 sync 엔진의 삭제 큐로 사용.
- 핵심 불변식: "활성 레지스터리(isDeleted 제외)는 항상 로컬 스토리지에 있는 것의 subset이어야 한다."

---

## 011: 인레이 에셋 GC를 하지 않는 이유

- 상태: 채택
- 맥락: RisuAI는 앱 초기화 시 purge 함수로 모든 캐릭터를 순회하며 에셋 참조를 세고 미사용 에셋을 삭제한다.
- 문제:
    - E2EE 환경에서는 모든 캐릭터를 복호화해야 참조를 셀 수 있어 극도로 비효율적
    - 인레이 에셋은 채팅 내부에 `{{inlay::uuid}}` 텍스트로 참조되므로 모든 메시지를 파싱해야 함
    - 동기화 환경에서 레퍼런스 카운트의 정합성 유지가 어려움
- 결정: 인레이 에셋은 GC하지 않는다. 대신 갤러리 브라우저 UI를 제공하여 유저가 직접 감상 및 수동 관리.
- 결과: 복잡한 GC 로직 없이도 인레이 에셋을 안전하게 관리. 갤러리 기능은 UX 부가가치도 제공.

---

## 012: ID 생성을 crypto.randomUUID에서 PocketBase 호환 포맷으로 변경

- 상태: 채택
- 맥락: 초기에는 `crypto.randomUUID()`로 레코드 ID를 생성했다 (표준 UUID v4, 36자 하이픈 포함).
- 문제: PocketBase가 요구하는 ID 포맷이 있다 — 15자 소문자 + 숫자. UUID 형식은 PocketBase에서 거부되거나 호환 문제가 발생한다.
- 결정: `generateId()` 함수를 만들어 15자 소문자+숫자 조합의 ID를 생성. PocketBase와 로컬 DB에서 동일한 ID를 사용.
- 결과: 로컬에서 생성한 레코드가 PocketBase에 그대로 sync 가능. ID 변환 없이 양쪽에서 동일한 ID 체계 사용.

---

## 013: 가입 시 비대칭 키(Identity Keypair) 생성 및 보관

- 상태: 채택
- 맥락: 현재 KeiAI는 단일 사용자의 암호화 세션(Master Key M)에 의존한다. 하지만 향후 '멀티 유저 룸(다중 접속 채팅)' 기능을 추가하려면 사용자 간에 안전하게 '방 키(Room Key)'를 교환할 수 있는 기능이 필요하다.
- 문제: 나중에 멀티플레이 기능을 구현할 때 비대칭 키를 도입하면, 기존에 가입한 유저들은 공개키가 서버에 없다. 이 경우 다른 유저가 해당 유저를 그룹 채팅에 초대하려면, 상대방이 먼저 로그인해서 키를 생성하고 업로드하기를 기다려야 하는 심각한 UX 병목(Migration Headache)이 발생한다.
- 결정:
    - 회원가입(Link Account) 시점에 즉시 비대칭 키 쌍(ECDH 등)을 생성.
    - `Identity Public Key`: 평문으로 서버에 저장 (누구나 조회하여 이 유저를 초대할 수 있게 함).
    - `Identity Private Key`: 사용자의 Master Key(`M`)로 암호화하여 서버에 저장 (사용자가 다른 기기에서 복구할 수 있게 함).
- 결과: 지금 당장 멀티 유저 기능을 구현하지 않더라도, 모든 유저가 '초대 가능한 상태'가 되어 향후 기능 확장 시 데이터 마이그레이션이나 유저의 추가 액션 없이 즉시 다중 접속 기능을 활성화할 수 있다.

---

## 014: 범용적인 런타임 태스크 아키텍처 (Runtime Task Architecture)

- 상태: 폐기 → ADR 026으로 대체
- 맥락: 초기에는 채팅 생성 루틴(`GenerationTask`)만 처리했다. 하지만 향후 그룹 챗, 번역, 요약, Tool Calling 등 다양한 비동기 작업을 범용적으로 처리할 수 있는 구조가 필요했다.
- 문제:
    - 기존 `generationTasks`는 채팅에 강결합되어 있어 다른 종류의 작업을 추가하기 어려웠다.
    - 실행 제어(`AbortController`)와 최종 결과 저장(`createMessage`) 로직이 스토어 레이어에 섞여 있어 책임 분리가 불분명했다.
- 결정:
    - **Self-Describing Task**: `RuntimeTask` 타입을 도메인 중립적으로 설계하고, `meta` 필드(Discriminated Union)를 통해 태스크가 직접 자신의 종류(chat, translation 등)를 설명하게 함.
    - **Mapping-Aware Generic Store**: `runtimeTasks` 스토어는 `taskId`를 키로 사용하는 순수 상태 저장소로 통일. `chatTaskIds` 같은 도메인 매핑은 스토어 내부에서 자동으로 관리하여 UI 조회 편의성 제공.
    - **Pipeline Layer Responsibility**: 실행 제어(`AbortController`)와 도메인별 최종화 로직(DB 저장 등)을 스토어에서 분리하여 파이프라인 레이어(`runtime/task/*`)로 이동.
- 결과:
    - 채팅 외의 새로운 작업(번역, 요약 등) 추가 시 `meta` 타입 확장과 전용 파이프라인 구현만으로 간단히 확장 가능.
    - 스토어는 순수하게 "현재 화면에 보여줄 상태"만 관리하고, 파이프라인은 "작업의 실행과 결과"를 담당하여 관심사가 명확히 분리됨.

---

## 015: 암호화 비용 감소를 위한 서비스 레이어 EncryptedWriteQueue

- 상태: 채택 (수정됨)
- 맥락: 사용자가 채팅을 입력하거나 설정을 바꿀 때마다 서비스 레이어에서 암호화 후 `localDB`에 저장 요청이 발생한다.
- 문제:
    - 고빈도 쓰기 환경에서의 실제 병목은 디스크 I/O가 아니라 **매 쓰기마다 수행되는 AES-256-GCM 암호화**였다.
    - UI 렌더링에 필요한 최신 데이터와 DB에 지연 기록된 데이터 간의 정합성(Read-Your-Writes)이 깨질 위험이 있다.
- 접근법 검토:
    1. Adapter 레벨 Write-Buffer: DB 기록 직전에 디바운싱하면 **암호화는 매번 실행**되므로 실제 병목을 해소하지 못함. 또한 어댑터가 암호화 관심사를 알게 되어 계층 책임이 오염됨.
    2. Service 레이어 EncryptedWriteQueue: 서비스 레이어에서 **평문 상태로 병합**하고, flush 시점에 단 한 번만 암호화. 어댑터는 순수 pass-through로 유지.
- 결정:
    - **서비스 레이어 `EncryptedWriteQueue`** (`services/content/write_queue.ts`): `entries` Map에 평문 필드를 보관하며 400ms 디바운스 + 2초 max-wait. 연속된 수정은 평문 상태에서 머지되고, flush 시 한 번만 `encrypt()` → `localDB.putRecord()` 실행.
    - **일관성 보장(Read-Your-Writes)**: 서비스의 `get()`/`update()` 메서드가 `encryptedWriteQueue.peek()`로 대기 중인 평문을 우선 반환. DB 조회 없이 즉각적인 UI 반영 달성.
    - **목록 조회 시 일괄 flush**: `list()` 등 전체 레코드 조회 전에 `flushTable()`로 해당 테이블의 대기 중인 쓰기를 모두 완료한 뒤 DB에서 읽음.
    - **생성은 즉시 기록**: `create()` 메서드는 큐를 우회하여 즉시 암호화 + `localDB.putRecord()` 수행. 신규 레코드의 영속성을 보장.
    - **라이프사이클 안전장치**: `pagehide`, `beforeunload`, `visibilitychange(hidden)` 이벤트에서 `flushAll()` 호출. 실패 시 재스케줄링(retry).
    - **에셋/유저 어댑터 제외**: 단발성 이벤트(로그인, 파일 업로드) 중심이므로 디바운싱 대상에서 제외.
- 결과:
    - 연속 수정 시 발생하던 수십 건의 암호화 + 디스크 쓰기가 **단 1건으로 통합**되어 성능 대폭 상승.
    - 어댑터 레이어는 암호화 관심사 없이 순수 저장소 인터페이스로 유지되어 계층 책임이 깔끔하게 분리됨.
    - 한계: `deepMerge`는 배열을 재귀 병합하지 않고 통째로 덮어쓴다. 따라서 배열 필드에 대해 연속된 부분 업데이트가 발생하면 write queue의 자동 병합이 의도대로 동작하지 않는다. 이 문제의 해결은 ADR 027을 참조.

---

## 016: 멀티스텝 툴 호출을 위한 "한 태스크 = 한 네트워크 요청" 원칙

- 상태: 채택
- 맥락: LLM이 도구 호출(Tool Calling)을 수행할 때, 여러 단계의 도구 실행과 응답이 필요한 멀티스텝 시나리오가 발생한다.
- 문제:
    - 파이프라인 내부에서 자동으로 루프를 돌며 여러 번의 네트워크 요청을 보낼 경우, 무한 루프 위험과 제어 불가능한 API 비용 발생 가능성이 있다.
    - 생성 도중 앱이 종료되거나 네트워크가 끊기면 중간 단계의 상태가 유실될 수 있다.
    - 사용자가 AI의 도구 사용 과정을 실시간으로 검토하거나 개입하기 어렵다.
- 결정:
    - **Single Request per Task**: `runChat` 파이프라인은 한 번의 네트워크 요청과 응답으로 태스크를 종료함을 원칙으로 한다.
    - **State Persistence**: 도구가 필요한 경우 응답을 `pending` 상태의 도구 호출과 함께 DB에 즉시 저장하고 파이프라인을 종료한다.
    - **User-in-the-loop**: UI는 DB의 `pending` 상태를 감지하여 사용자에게 승인/인터랙션 UI를 제공한다.
    - **Interaction-Driven Resumption**: 사용자의 승인 후 도구가 실행되면, 그 결과를 컨텍스트에 포함하여 새로운 `runChat` 태스크를 시작한다.
- 결과:
    - 모든 중간 단계가 DB에 기록되어 영속성이 보장된다 (Stateful Multi-step).
    - 사용자가 모든 도구 실행을 통제할 수 있어 안전하고 투명한 UX를 제공한다.
    - 파이프라인 코드가 단순해지고 유지보수가 용이해진다.

---

## 017: 토크나이저 시스템 — 6 인코딩 통합 + 단일 라이브러리 전략

- 상태: 채택
- 맥락: RisuAI는 js-tiktoken 기반으로 OpenAI 인코딩(cl100k, o200k, p50k 등)만 지원하며, 다른 모델(Claude, Llama, DeepSeek 등)은 대략적인 추정치로 처리했다. KeiAI는 주요 모델별 정확한 토큰 카운팅을 목표로 했다.
- 문제:
    - 초기 설계에서 11개 인코딩 × 4개 라이브러리(js-tiktoken, @dqbd/tiktoken WASM, @mlc-ai/web-tokenizers, @huggingface/transformers)를 매핑했으나, 번들 크기와 유지보수 비용이 과도했다.
    - OpenAI 레거시 인코딩(cl100k, p50k, r50k, gpt2)과 니치 인코딩(novelai, novellist, cohere)은 최신 모델에서 사실상 사용되지 않음.
    - Gemma/Mistral은 SentencePiece(.model) + HuggingFace JSON(.json) 두 형식이 필요 — Web은 SentencePiece, Tauri(Rust)는 JSON을 사용.
- 검토 과정:
    1. 11개 인코딩 전체 지원 → 레거시 제거가 목표 중 하나이므로 과잉
    2. js-tiktoken(순수 JS) vs @dqbd/tiktoken(WASM) → WASM이 빠르지만, o200k_base가 HuggingFace JSON으로도 제공됨을 발견
    3. Xenova/gpt-4o에서 o200k_base tokenizer.json 발견 → @mlc-ai/web-tokenizers의 `fromJSON()`으로 로드 가능 → tiktoken 계열 라이브러리 자체가 불필요
- 결정:
    - **6개 인코딩만 지원**: o200k_base(OpenAI), claude(Anthropic), llama3(Meta+파생), deepseek(DeepSeek), gemma(Google), mistral(Mistral)
    - **Web**: `@mlc-ai/web-tokenizers` 단일 라이브러리. JSON vocab은 `fromJSON()`, SentencePiece는 `fromSentencePiece()`로 통일. Worker 스레드에서 lazy-load + 캐시.
    - **Tauri**: Rust 네이티브. `tiktoken-rs`(o200k_base, 데이터 내장) + `tokenizers` 크레이트(나머지 5개, JSON 파일 필요).
    - **토큰 데이터**: git에 포함하지 않고 `postinstall` 스크립트로 HuggingFace에서 다운로드. gated 모델은 ungated mirror(NousResearch, unsloth, Xenova) 활용.
- 결과:
    - Web 번들에서 tiktoken 계열 라이브러리 완전 제거. 단일 WASM 라이브러리로 6개 인코딩 모두 처리.
    - Tauri는 네이티브 속도로 토큰 카운팅 (10-30x 빠름).
    - 새 인코딩 추가 시: `LLMTokenizer` 타입 + worker SPECS + Rust match arm + 다운로드 URL만 추가하면 됨.

---

## 018: 프록시 API 키 제거 — CORS + SSRF Guard로 대체

- 상태: 채택
- 맥락: 프록시 Worker에 `PROXY_API_KEY` 공유 시크릿을 두고, 앱 빌드 시 `VITE_PROXY_API_KEY`로 번들에 삽입하여 "앱을 쓰는 사람만" 프록시에 접근하게 하려 했다.
- 문제:
    - Vite의 `VITE_` 변수는 빌드 시 JS 번들에 **평문으로 하드코딩**됨. 브라우저 DevTools의 Network 탭이나 번들 소스에서 즉시 추출 가능.
    - Tauri 바이너리도 문자열 검색으로 키 추출 가능.
    - 결국 "클라이언트에 하드코딩된 시크릿"은 시크릿이 아님. casual abuse 방지 수준의 속도 범프에 불과.
    - `.env`/`.dev.vars` 간 키 동기화 부담, 테스트에서 인증 헤더 누락으로 인한 false failure 발생.
    - 비로그인 유저도 프록시를 사용해야 하므로 사용자별 인증 적용 불가.
- 결정:
    - `PROXY_API_KEY` / `VITE_PROXY_API_KEY` 완전 제거.
    - 대신 두 가지 실질적 방어로 대체:
        1. **CORS `ALLOWED_ORIGINS`**: 브라우저 요청을 origin 기반으로 제한 (이미 존재).
        2. **SSRF Guard**: 내부 IP(127.x, 10.x, 192.168.x, 172.16-31.x, 169.254.x), localhost, IPv6, cloud metadata 엔드포인트를 403으로 차단.
    - 프로덕션 배포 후 Cloudflare Rate Limiting 규칙 추가 권장.
- 결과:
    - 환경 변수 관리 단순화 (`.env`에는 `VITE_PROXY_URL`만, `.dev.vars`에는 `ALLOWED_ORIGINS`만).
    - 허위 보안감 제거. 실질적 방어(CORS + SSRF)에 집중.
    - 테스트 코드 단순화 (인증 관련 테스트 3개 제거, 나머지에서 헤더 불필요).

---

## 019: 런타임 추상화 제거 및 디렉토리 재구성

- 상태: 채택
- 맥락: `runtime/` 디렉토리에 ChatContext 클래스, PromptBuilder 클래스, selectProvider 등이 있었고, `shared/` 디렉토리에 타입과 유틸리티가 혼재되어 있었다.
- 문제:
    - ChatContext는 런타임 상태를 클래스에 묶었지만, 실제로는 함수 호출 시작 시 스냅샷을 찍고 끝까지 쓰는 패턴이라 클래스의 이점이 없었다.
    - PromptBuilder도 내부 상태가 불필요 — 입력 → 출력의 순수 함수로 충분.
    - `shared/`에 types, errors, defaults, ID 생성 등이 뒤섞여 있어 역할 경계가 모호했다.
    - `runtime/`이 generation, scripts, LLM providers를 모두 포함하여 단일 책임을 위반.
- 결정:
    - ChatContext 클래스 제거 → `runChat()` 함수가 직접 데이터 스냅샷을 로드하여 파이프라인 실행.
    - PromptBuilder 클래스 → `buildPrompt()` 순수 함수로 변환.
    - `shared/` → `types/` (타입 정의) + `utils/` (순수 유틸리티)로 분리.
    - `runtime/` → `tasks/` (채팅 파이프라인) + `llm/` (프로바이더, 프롬프트 빌더) + `scripts/` (스크립트 엔진)으로 분리.
- 결과:
    - 각 디렉토리가 단일 책임을 가지며, import 경로만으로 모듈의 역할을 알 수 있다.
    - 클래스 기반 추상화가 제거되어 테스트가 단순해지고 데이터 흐름이 명확해진다.
    - 순수 함수 중심이라 mock 없이 테스트 가능한 범위가 넓어졌다.

---

## 020: 모델 타입 시스템 — BuiltInModel/CustomModel 판별 유니온 + Provider/Handler 분리

- 상태: 채택
- 맥락: LLM 모델 설정이 Preset의 flat 필드(model, temperature, topP 등)에 흩어져 있었다. 내장 모델과 사용자 정의 모델의 구분이 없었고, 프로바이더(API 제공자)와 핸들러(와이어 프로토콜)가 혼동되었다.
- 문제:
    - flat 필드 방식은 모델 전환 시 파라미터 초기화가 어렵고, 모델별 지원 파라미터 목록을 표현할 수 없다.
    - RisuAI는 300+ 모델을 하드코딩하되 커스텀 모델은 별도 경로로 처리하여 이원화 문제가 있다.
    - DeepSeek처럼 "프로바이더는 deepseek, 핸들러는 openai_compatible" 같은 경우를 기존 구조로 표현 불가.
- 대안 검토:
    - TypeScript enum → E2EE JSON 직렬화 시 숫자로 변환되어 의미 상실, 트리셰이킹 불리
    - 단일 모델 타입 + isCustom 플래그 → 타입 안전성 약함, 분기가 모든 곳에 퍼짐
- 결정:
    - **판별 유니온**: `BuiltInModel` (provider가 `BuiltInProvider` 타입) vs `CustomModel` (provider가 `'custom'`). TypeScript 타입 가드로 안전하게 분기.
    - **문자열 유니온**: `LLMHandler`, `BuiltInProvider`, `LLMFlags`, `Parameter` 등 모두 `type X = 'a' | 'b' | ...` 형태. JSON 직렬화 안전, 트리셰이킹 유리.
    - **Provider ≠ Handler**: Provider = API 제공자(키/URL 라우팅), Handler = 와이어 프로토콜(StreamHandler 클래스 선택). 1:1이 아님.
    - **ModelConfig**: Preset에 저장되는 모델 참조. `{id, provider, parameters}`. ID 컨벤션: `provider::modelId` (내장) 또는 `custom::nanoid` (커스텀).
    - **BUILT_IN_MODELS 카탈로그**: `types/models.ts`에 내장 모델 배열로 정의. 내장과 커스텀 모두 동일한 `LLMModel` 인터페이스를 구현.
    - **StreamHandler 무상태**: 모든 설정(apiKey, baseUrl, modelId, params, capabilities)은 생성자로 주입. 내부에서 Settings/Store 참조 금지.
- 결과:
    - 내장 모델과 커스텀 모델이 동일한 타입 경로를 공유하여 UI/로직 이원화 없음.
    - `selectHandler(ModelConfig, AppSettings)`가 유일한 팩토리 — 모델 해석 → 연결 정보 → Handler 생성을 한 곳에서 처리.
    - 프리셋의 모델 설정이 `chatModel: ModelConfig` + `auxModel: ModelConfig`로 구조화되어 다중 모델 아키텍처(메인/보조/번역/요약)로의 확장이 용이.

---

## 021: provider-handler 계층 — "같은 인터페이스로 통신 가능하면 같은 클래스"

- 상태: 채택
- 맥락: LLM 외에 TTS, Embedding 등 다양한 AI 프로토콜을 지원해야 하며, 각각 여러 프로바이더(OpenAI, Google, ElevenLabs, 로컬 ONNX 등)를 지원해야 한다.
- 원칙: **같은 와이어 프로토콜(또는 런타임 인터페이스)로 통신 가능하면 같은 클래스를 공유한다.**
    - API: 분기 단위 = Handler(와이어 프로토콜). URL과 API Key만 교체.
    - 로컬: 분기 단위 = Runtime(실행환경). 모델 파일만 교체.
- 적용:
    - **LLM**: `openai_compatible` 핸들러 하나로 OpenAI, DeepSeek, Mistral 등 공유 → `OpenAILLMStreamHandler`
    - **Embedding**: LLM과 동일 패턴 → `OpenAIEmbeddingHandler`
    - **TTS**: API 핸들러 비통일 → 핸들러별 클래스 (`OpenAITTSStreamHandler`, `ElevenLabsTTSStreamHandler`)
    - **로컬 공통**: ONNX Runtime 하나로 여러 모델 커버 (`OnnxTTSHandler`, `OnnxEmbeddingHandler`)
- 공통 선택 패턴: `selectXXXHandler(modelConfig, settings)` → `resolveModel()` → `resolveConnection()` → Handler/Runtime 기반 클래스 생성
- 결과: 새 provider 추가 시 기존 handler와 호환되면 URL만 추가, 새 handler면 클래스 하나만 추가. 프로토콜 레이어(LLM/TTS/Embedding)와 태스크 레이어(chat/translate/summarize)가 명확히 분리.

---

## 022: DeepPartial을 이용한 타입 안전한 중첩 데이터 업데이트

- 상태: 채택
- 맥락: AppSettings나 CharacterDataFields와 같은 객체는 여러 단계로 중첩된 구조를 가지고 있다. 기존에는 Partial<T>를 사용하거나 전체 객체를 재구성하여 업데이트를 수행했다.
- 문제: 
    - `Partial<T>`는 1단계 깊이의 필드만 선택적으로 허용하므로, 중첩된 객체(예: `settings.openai.apiKey`)의 일부만 변경하려 해도 부위별로 분해했다가 다시 조립해야 하는 번거로움이 있었다.
    - 업데이트 로직이 서비스 레이어마다 파편화되어 있어 유지보수가 어렵고 타입 안정성이 떨어졌다.
- 결정:
    - **DeepPartial<T> 도입**: 재귀적으로 모든 하위 필드를 optional로 만드는 `DeepPartial` 유틸리티 타입을 `$lib/utils/defaults.ts`에 정의하고 전역적으로 사용.
    - **deepMerge 기반 업데이트**: 서비스 레이어의 `update` 메서드들이 `DeepPartial<T>`를 입력으로 받고, `deepMerge` 유틸리티를 사용해 기존 데이터와 병합하도록 표준화.
- 결과:
    - `CharacterService.update(id, { data: { variables: { key: 'value' } } })`와 같이 깊은 경로의 필드만 안전하고 간결하게 업데이트 가능.
    - 대규모 설정 객체 관리 시 타입 정의가 누락되거나 잘못된 구조로 업데이트되는 실수를 컴파일 타임에 방지.
- 참고: `$lib/utils/defaults.ts`의 `deepMerge`는 배열은 덮어쓰고 객체만 재귀적으로 병합하는 규칙을 따른다.

---

## 023: 순수 함수형 파이프라인 및 인스턴스 수집(Collection) 설계

- 상태: 채택
- 맥락: RisuAI의 기존 Lua 스크립팅 모델은 상태 다이렉트 변조(Direct Mutation)를 허용해 앱 전체의 상태 정합성을 무너뜨렸고 UI와 강결합 되어 있었다.
- 문제: 
    - 샌드박스와 메인 앱의 스파게티 결합 방지 필요성.
    - 스크립트 인스턴스들을 무한정 띄워두면 메모리 누수(Memory Leak)가 발생.
- 결정:
    - **순수 함수형 데이터 가공 (Pipeline)**: 상태를 직접 수정하지 않고 데이터(`T`)를 받아 재가공해 반환(`T`)하는 파이프라인 패턴 적용. 내장/커스텀 Phase에 대한 타입 오버로딩 강제.
    - **단방향 통지 (EventBus)**: 사이드 이펙트(알림, 메인 앱 트리거)는 역참조 없이 단방향 Fire-and-Forget 방식 채택하여 `await` 인한 무한 지연 차단.
    - **TTL 기반 캐시 & 동적 수집 (Collect)**: 샌드박스 인스턴스는 영구 상주하지 않고 유효 기간(TTL) 단위로 캐싱. 파이프라인 가동 시 특정 scope(`chatId`)에 연결된 활성 인스턴스들을 깨우며 핸들러를 "수집(Collect)"하여 순차 실행함.
- 결과: 메인 앱의 상태 정합성을 완벽하게 보장하면서 플러그인/모딩 스크립트 통합이 가능해짐. 메모리에 불피요한 샌드박스가 좀비오버되지 않는 견고한 자원 관리 체계 확립.

---

## 024: CharJS 엔진 — QuickJS 샌드박스 인스턴스 풀, 동시성 제어, 이벤트 시스템

- 상태: 채택
- 맥락: ADR 023에서 순수 함수형 파이프라인과 TTL 캐시를 설계했으나, 실제 런타임(QuickJS WASM)의 동시성·데드락·권한 문제는 미해결이었다. 여러 메시지 컴포넌트가 동일 캐릭터의 `display` 핸들러를 병렬 호출하는 시나리오에서 QuickJS 컨텍스트가 스레드 안전하지 않아 크래시가 발생할 수 있었다.
- 문제:
    - **동시성**: QuickJS 컨텍스트는 단일 스레드 전용. `callFunction`이 동시에 실행되면 use-after-free 크래시 발생.
    - **데드락**: 파이프라인 핸들러에서 다른 파이프라인을 재실행(`runPipeline`)하거나, 두 인스턴스가 서로의 이벤트를 트리거하면 순환 대기로 교착.
    - **UI 프리즈**: 핸들러가 무한 루프로 이벤트를 발생시키면 브라우저 메인 스레드가 마이크로태스크에 갇혀 렌더링 불가.
    - **권한**: 저수준 API(LLM 호출, 네트워크 접근 등)를 샌드박스에 노출해야 하지만, 악의적 스크립트로부터 보호 필요.
- 대안 검토:
    - **RisuAI 방식** (Access Key + 트리거 화이트리스트 + 모드별 Mutex): 검증된 방식이나 키 전파 로직이 복잡하고, 동일 모드 내에서는 여전히 직렬화 필요.
    - **Phase별 API 제한**: `display` 핸들러에서 LLM API를 차단하는 등. 개발자 자유도를 과도하게 제한하며, 3초 타임아웃이 이미 안전망 역할을 함.
    - **API 주입 기반 권한**: `allowLowLevel=false`면 저수준 API를 아예 주입하지 않음. 런타임에 권한 변경이 불가능.
- 결정:
    - **인스턴스별 Mutex**: 각 `CharJSInstance`에 `Mutex`(FIFO 큐 기반 비동기 락)를 두어 `invokeHandler`를 직렬화. `callFunction`이 동시에 실행되지 않음.
    - **`runPipeline` 제거**: 샌드박스 API에서 파이프라인 재실행을 제거하여 자기 재진입(self-re-entry) 데드락 근원 차단.
    - **Fire-and-Forget 이벤트**: `emitEvent`는 `setTimeout(macrotask)`로 핸들러를 디스패치하고 `await`하지 않음. 마이크로태스크가 아닌 매크로태스크를 사용하여 브라우저가 렌더 기회를 갖고, `await` 체인이 없어 순환 대기가 불가능.
    - **런타임 권한 확인**: 모든 API를 항상 주입하고, 저수준 API는 호출 시점에 `requirePermission()`으로 권한 확인. 권한은 캐릭터/모듈 임포트 시에만 설정(런타임 변경 불가).
    - **인스턴스 키**: `${ownerId}:${chatId}` — 캐릭터와 모듈은 각각 독립 인스턴스. 동일 채팅에서 캐릭터와 모듈의 핸들러는 서로 다른 Mutex로 병렬 실행 가능.
- 결과:
    - 데드락 없는 샌드박스 실행 보장.
    - 3초 핸들러 타임아웃 + 16MB 메모리 제한으로 악의적/오류 스크립트로부터 앱 보호.
    - 캐릭터와 모듈은 독립 인스턴스이므로 서로의 핸들러를 블로킹하지 않음.
    - 단점: 동일 캐릭터 내 display/output 핸들러는 같은 Mutex로 직렬화됨. 향후 다중 코드 블록 분할(ADR 025)로 해결 가능.
- 참고: ADR 023 (파이프라인 설계), ADR 025 (다중 CharJS 코드 블록 — 예정)

---

## 025: CharJS 아키텍처 개편 및 테이블 독립화

- 상태: 채택
- 맥락: ADR 024에서 인스턴스별 Mutex를 도입했으나, 하나의 캐릭터/모듈에 코드가 하나뿐이라 모든 핸들러(display, output, 이벤트 등)가 같은 스크립트와 하나의 Mutex를 공유했다. 이는 유지보수를 어렵게 하고, 특정 기능(UI 가공 vs 데이터 통신) 단위의 on/off를 불가능하게 만들었다.
- 문제: 
    - 관심사가 다른 핸들러들이 같은 직렬화 큐에 있어 파이프라인/이벤트 병목 발생.
    - 코드 슬롯 구성을 통해 `{ display: ... }` 구조로 쪼개는 것은 자유도를 제한하고 확장성이 낮음.
- 결정: **CharJS를 독립 테이블로 분리 및 1:N 참조 전환**
    - `charjs` 테이블을 신설하여 스크립트를 도메인 독립적인 레코드로 분리(`name`, `enabled`, `code`).
    - 캐릭터와 모듈 상태에 단일 스크립트가 아닌 `charjsRefs` (배열)를 두어, 무한히 많은 독립 스크립트를 장착할 수 있도록 구조 개편.
    - 샌드박스 인스턴스 격리 키는 `${charjsId}:${chatId}`로 부여. 서로 다른 CharJS 데이터는 동일한 채팅방이라도 각기 다른 QuickJS 런타임/컨텍스트를 가져 완전한 병렬 처리를 보장.
    - 성능 병목 방지를 위해 N개의 CharJS 평가(Evaluation)를 `Promise.all`로 병렬 로드하고 Pending Promise 캐싱을 사용해 Race Condition 차단.
- 결과:
    - 스크립트 단위로 목적(기능)을 철저히 분리하고, 불필요한 기능만 독립적으로 끌 수 있는 유연한 모플/모딩 환경 완성.
    - 한 스크립트 내 구문/무한루프 에러가 다른 스크립트 컨텍스트에 전이되지 않는 격리성 달성.
    - `pendingInstances` 도입과 비동기 병렬 초기화를 통해 스트리밍 렌더링(Cold Start) 시 CPU 블록 완화 달성.
- 참고: ADR 024 (CharJS 엔진), ADR 023 (파이프라인 설계)

---

## 026: 즉시 영속 메시지와 Thin Task 트래커

- 상태: 채택
- 맥락: ADR 008에서 Task가 스트리밍 콘텐츠를 들고 있다가 완료 시 persist하는 구조를 채택했고, ADR 014에서 범용 RuntimeTask 아키텍처를 설계했다. 두 접근 모두 파이프라인 완료 후 메시지를 DB에 기록하는 방식이었다.
- 문제:
    - Task가 content, thought, toolCalls를 들고 있어 파이프라인 중간에 앱이 종료되면 데이터가 날아간다.
    - persist 로직이 파이프라인의 마지막 단계에 몰려 있어, abort 시 저장 여부 결정, reroll 시 기존 메시지와 병합 등 책임이 무거웠다.
    - RuntimeTask의 범용 설계(Self-Describing, taskId 키, Mapping-Aware Store)가 실제 사용에서 과도했다. 현재는 채팅 생성만 존재한다.
    - Variable 시스템이 미구현 상태였다.
- 결정:
    - 즉시 영속: `runChat` 시작 시 빈 메시지를 DB에 생성. 스트리밍 청크마다 `updateMessage`로 swipe를 갱신. abort/에러 발생 시에도 이미 기록된 내용이 DB에 남는다.
    - Thin Task: `ChatTask`는 status, messageId, controller만 추적. content를 들지 않는다. `displayMessages` derived store는 DB 메시지에 status 오버레이만 추가한다. 가상 메시지/가상 swipe 생성은 없다.
    - Variable 시스템: 각 swipe에 `variables: Record<string, string>` 저장. 새 swipe는 `deepMerge(chat.data.defaultVariables, 이전 swipe의 variables)`로 초기화. 샌드박스에서 `getVar`/`setVar`로 접근.
    - Reroll 단순화: `targetMessageId: string` 대신 `reroll: boolean` 플래그. 파이프라인이 `getMessagesBefore`로 마지막 메시지를 찾아 새 swipe를 추가.
- 결과:
    - 파이프라인 중단 시 데이터 유실 없음.
    - persist 로직이 제거되어 파이프라인 코드가 단순해짐.
    - displayMessages 로직이 대폭 단순화됨.
    - Variable이 swipe 단위로 영속되어 채팅 세션 간에 유지됨.
- 참고: ADR 008 (폐기), ADR 014 (폐기), ADR 015 (EncryptedWriteQueue), ADR 016 (한 태스크 = 한 네트워크 요청)

---

## 027: deepMerge 한계 극복을 위한 Record 기반 중첩 구조

- 상태: 채택
- 맥락: ADR 015에서 EncryptedWriteQueue를 도입했다. write queue는 `deepMerge`로 연속된 부분 업데이트를 평문 상태에서 병합한 뒤 flush 시 한 번만 암호화한다. 이는 객체 필드에는 완벽하게 동작한다.
- 문제:
    - `deepMerge`의 병합 규칙: 객체는 재귀 병합, 배열은 통째로 덮어쓰기.
    - swipes가 `MessageSwipe[]` 배열이었을 때, 스트리밍 루프의 content 업데이트와 CharJS 핸들러의 setVar가 같은 swipe를 동시에 수정하면, 나중에 온 업데이트가 전체 swipes 배열을 덮어써서 이전 변경사항이 유실되는 레이스 컨디션이 발생했다.
    - 이 문제를 피하기 위해 스트리밍 루프에서 매 청크마다 `getMessage`로 최신 상태를 읽어와야 했고, 이는 DB 읽기 + AES-256-GCM 복호화 비용을 매 청크마다 발생시켰다.
    - toolCalls 역시 `ToolCallAbstract[]` 배열이어서, 자동 승인 등 여러 toolCall이 동시에 resolve되는 시나리오에서 동일한 문제가 예상되었다.
- 결정:
    - 배열을 `Record<string, T>`로 변환하여 deepMerge가 항목 단위로 재귀 병합하도록 변경.
    - `swipes: MessageSwipe[]` → `swipes: Record<string, MessageSwipe>`, `activeSwipeIndex` → `activeSwipeId`
    - `toolCalls: ToolCallAbstract[]` → `toolCalls: Record<string, ToolCallAbstract>`
    - 각 항목에 `id: string` 필드 추가로 Record 키와 동기화.
    - UI에서 순서가 필요한 경우 `Object.values(obj).sort((a, b) => a.createdAt - b.createdAt)`로 정렬.
- 결과:
    - 스트리밍 루프에서 `getMessage` 호출 제거. write queue가 부분 업데이트를 자동 병합하므로 읽기-수정-쓰기 사이클이 불필요.
    - setVar/스트리밍/resolveToolCall 등 서로 다른 출처의 동시 업데이트가 write queue에서 안전하게 병합됨.
    - 부분 업데이트 코드가 간결해짐: `updateMessage(id, { swipes: { [swipeId]: { content: 'hello' } } })`
- 원칙: 앞으로 새로운 중첩 데이터 구조를 설계할 때, 항목 단위 부분 업데이트가 필요한 경우 배열이 아닌 Record를 사용해야 한다. 배열은 항목 전체를 항상 교체하는 경우(예: 레퍼런스 목록, 폴더 정의 등)에만 사용.
- 참고: ADR 015 (EncryptedWriteQueue), ADR 026 (즉시 영속 메시지)
