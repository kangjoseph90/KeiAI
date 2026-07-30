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
  - 회원가입(Link Account) 시점에 즉시 비대칭 키 쌍(RSA-OAEP)을 생성.
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

- 상태: 채택 (ADR 030으로 의미 수정: 현재 write queue는 로컬 평문 병합 큐)
- 맥락: 사용자가 채팅을 입력하거나 설정을 바꿀 때마다 서비스 레이어에서 암호화 후 `localDB`에 저장 요청이 발생한다.
- 문제:
  - 고빈도 쓰기 환경에서의 실제 병목은 디스크 I/O가 아니라 **매 쓰기마다 수행되는 AES-256-GCM 암호화**였다.
  - UI 렌더링에 필요한 최신 데이터와 DB에 지연 기록된 데이터 간의 정합성(Read-Your-Writes)이 깨질 위험이 있다.
- 접근법 검토:
  1. Adapter 레벨 Write-Buffer: DB 기록 직전에 디바운싱하면 **암호화는 매번 실행**되므로 실제 병목을 해소하지 못함. 또한 어댑터가 암호화 관심사를 알게 되어 계층 책임이 오염됨.
  2. Service 레이어 WriteQueue: 서비스 레이어에서 **평문 상태로 병합**하고, flush 시점에 한 번만 로컬 DB에 기록. 어댑터는 순수 pass-through로 유지.
- 결정:
  - **서비스 레이어 write queue** (`services/content/write_queue.ts`): `entries` Map에 평문 필드를 보관하며 400ms 디바운스 + 2초 max-wait. 연속된 수정은 평문 상태에서 머지되고, flush 시 로컬 DB에 평문 `data` payload로 기록한다.
  - **일관성 보장(Read-Your-Writes)**: 서비스의 `get()`/`update()` 메서드가 `encryptedWriteQueue.peek()`로 대기 중인 평문을 우선 반환. DB 조회 없이 즉각적인 UI 반영 달성.
  - **목록 조회 시 일괄 flush**: `list()` 등 전체 레코드 조회 전에 `flushTable()`로 해당 테이블의 대기 중인 쓰기를 모두 완료한 뒤 DB에서 읽음.
  - **생성은 즉시 기록**: `create()` 메서드는 큐를 우회하여 즉시 `localDB.putRecord()` 수행. 신규 레코드의 영속성을 보장.
  - **라이프사이클 안전장치**: `pagehide`, `beforeunload`, `visibilitychange(hidden)` 이벤트에서 `flushAll()` 호출. 실패 시 재스케줄링(retry).
  - **에셋/유저 어댑터 제외**: 단발성 이벤트(로그인, 파일 업로드) 중심이므로 디바운싱 대상에서 제외.
- 결과:
  - 연속 수정 시 발생하던 수십 건의 디스크 쓰기가 **단 1건으로 통합**되어 성능 대폭 상승.
  - 암호화는 ADR 030에 따라 sync engine 경계로 이동했고, 어댑터 레이어는 순수 저장소 인터페이스로 유지됨.
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
  - **TTS**: API 핸들러 비통일 → 핸들러별 클래스 (`OpenAITTSHandler`, `ElevenLabsTTSHandler`)
  - **로컬 공통**: Transformers.js 런타임의 pipeline 로딩·캐시는 `lib/inference/transformers.ts`에서 공유하고, 프로토콜별 변환은 각 handler가 담당
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

> 독립 테이블 결정은 ADR 041에서 대체되었다. 다중 CharJS와 `${charjsId}:${chatId}` VM 격리 원칙은 유지한다.

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

- 상태: 채택 (ADR 034로 변수 초기화 의미 수정)
- 맥락: ADR 008에서 Task가 스트리밍 콘텐츠를 들고 있다가 완료 시 persist하는 구조를 채택했고, ADR 014에서 범용 RuntimeTask 아키텍처를 설계했다. 두 접근 모두 파이프라인 완료 후 메시지를 DB에 기록하는 방식이었다.
- 문제:
  - Task가 content, thought, toolCalls를 들고 있어 파이프라인 중간에 앱이 종료되면 데이터가 날아간다.
  - persist 로직이 파이프라인의 마지막 단계에 몰려 있어, abort 시 저장 여부 결정, reroll 시 기존 메시지와 병합 등 책임이 무거웠다.
  - RuntimeTask의 범용 설계(Self-Describing, taskId 키, Mapping-Aware Store)가 실제 사용에서 과도했다. 현재는 채팅 생성만 존재한다.
  - Variable 시스템이 미구현 상태였다.
- 결정:
  - 즉시 영속: `runChat` 시작 시 빈 메시지를 DB에 생성. 스트리밍 청크마다 `updateMessage`로 swipe를 갱신. abort/에러 발생 시에도 이미 기록된 내용이 DB에 남는다.
  - Thin Task: `ChatTask`는 status, messageId, controller만 추적. content를 들지 않는다. `displayMessages` derived store는 DB 메시지에 status 오버레이만 추가한다. 가상 메시지/가상 swipe 생성은 없다.
  - Variable 시스템: 각 swipe에 `variables: Record<string, string>` 저장. 최초 설계에서는 `chat.data.defaultVariables`와 이전 swipe variables를 병합하려 했으나, ADR 034 이후에는 room enabled characters의 `defaultVariables`를 seed로 사용하고 이전 active swipe variables를 덮어쓴다. 샌드박스에서 `getVar`/`setVar`로 접근.
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
- 맥락: ADR 015에서 write queue를 도입했다. write queue는 `deepMerge`로 연속된 부분 업데이트를 평문 상태에서 병합한 뒤 flush 시 한 번만 로컬 DB에 기록한다. 이는 객체 필드에는 완벽하게 동작한다.
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

---

## 028: Summary/Data 분리 패턴 폐기 — 단일 테이블 통합

- 상태: 채택
- 맥락: Character, Chat, Preset 세 엔티티가 Summary/Data 두 테이블로 분리되어 있었다. 목록 화면에서 가벼운 Summary만 복호화하고, 상세 화면에서 무거운 Data를 별도 로드하는 최적화 의도였다.
- 문제:
  - 실제 데이터 크기가 작다 (캐릭터당 ~20KB). AES-GCM 복호화 속도 ~500MB/s 기준 50개 캐릭터 전체 복호화에 ~2ms로, 분리의 성능 이득이 무의미.
  - 테이블 6개가 추가되고, 서비스마다 `updateSummary`/`updateData`/`update` 세 메서드가 필요하며, writeQueue 엔트리가 2배로 늘어남.
  - LorebookService, ModuleService가 이미 단일 테이블 패턴으로 잘 동작 중.
- 대안 검토:
  - 분리 유지 → 복잡도 비용만 지속, 실익 없음
  - 단일 테이블 통합 → LorebookService 패턴과 일관성 확보, 코드 대폭 감소
- 결정: 단일 테이블로 통합. `characterSummaries`/`characterData` → `characters`, `chatSummaries`/`chatData` → `chats`, `presetSummaries`/`presetData` → `presets`. Content/Refs 인터페이스 분리(`XxxContent` + `XxxRefs` → `XxxFields`)는 유지하여 `updateContent()` 안전 진입점 제공.
- 결과:
  - 테이블 6개 → 3개, 서비스 메서드 3배 → 1배 감소
  - `.data.` 프로퍼티 접근 전부 제거, 모든 필드 최상위 직접 접근
  - `getDetail()` → `get()`, `updateSummary()`/`updateData()` → 단일 `update()`로 통합
  - `lastMessagePreview` 필드 제거 (메시지 편집 시마다 chat 레코드를 불필요하게 갱신하던 오버헤드 해소)
- 참고: ADR 005 (Refs/Content 분리)

---

## 029: 프롬프트 빌더의 PagedMessages 기반 Lazy History 로딩

- 상태: 채택
- 맥락: 메시지는 고볼륨 데이터이며, `runChat`은 프롬프트 생성을 위해 최근 메시지를 읽어야 한다. 기존 구조는 서비스 레이어의 페이지네이션 API를 직접 호출해 최대 1000개 메시지를 eager load한 뒤 `buildPrompt`에 배열로 전달했다.
- 문제:
  - `runChat`이 "프롬프트에 필요한 히스토리 범위"를 결정하게 되어, 프롬프트 템플릿 책임이 파이프라인에 새어 나왔다.
  - 긴 채팅에서 불필요한 메시지 복호화가 발생할 수 있다.
  - 향후 토큰 예산, tokenizer 기반 context trimming, 파이프라인 변환을 lazy하게 적용하려면 배열 기반 `Message[]` 인터페이스가 병목이 된다.
- 결정:
  - **`PagedMessages` 도입**: `services/content/paged_messages.ts`에 전체 채팅 메시지를 대상으로 하는 readonly/transient 가상 배열을 둔다. `at()`, `slice()`, `toArray()`를 async API로 제공하며 음수 인덱스를 지원한다.
  - **서비스 레이어 소유**: `PagedMessages`는 Store에 의존하지 않고 `MessageService`만 사용한다. 내부 page cache는 인스턴스 생명주기 동안만 유지한다.
  - **양방향 페이지 로드 최적화**: 앞쪽 페이지는 `getMessagesAfter`, 뒤쪽 페이지는 `getMessagesBefore`를 사용하여 큰 offset 스캔을 줄인다.
  - **프롬프트 빌더 lazy화**: `buildPrompt`는 async 함수가 되고, `Message[]` 대신 `PagedMessages`를 입력받는다. `history` 템플릿 엔트리를 처리할 때만 필요한 범위를 `messages.slice()`로 로드한다.
  - **생성 중 target 제외**: `runChat`은 시작 시 빈 char 메시지를 즉시 생성한다. 따라서 프롬프트 히스토리는 마지막 target placeholder를 제외한 completed-message view 기준으로 해석한다.
- 결과:
  - `runChat`은 프롬프트 히스토리 범위를 직접 결정하지 않고, 동일한 `PagedMessages` 인스턴스를 파이프라인과 프롬프트 빌더에 전달한다.
  - 프롬프트 템플릿이 실제로 요구하는 히스토리만 복호화한다.
  - `Chat` 레코드에서 `messageCount`, `lastMessageId` 같은 파생 메타데이터를 관리할 필요가 줄어든다. 메시지 수와 마지막 메시지 접근은 `PagedMessages`가 서비스 쿼리로 계산한다.
  - 이후 tokenizer/context budgeting, request pipeline 적용, 스크립트 기반 메시지 접근을 lazy하게 확장할 수 있는 기반이 생겼다.
- 참고: ADR 015 (EncryptedWriteQueue), ADR 026 (즉시 영속 메시지와 Thin Task 트래커), ADR 027 (Record 기반 중첩 구조)

---

## 030: 로컬 평문 저장소와 동기화 경계 암호화

- 상태: 채택
- 맥락: 초기 설계는 로컬 DB와 서버 DB 모두 암호문을 저장하고, 서비스 레이어가 매 읽기/쓰기마다 복호화/암호화를 수행하는 모델이었다. 그러나 로컬 퍼스트 앱에서 로컬 DB는 앱의 작업 공간이며, write queue, deepMerge, 스트리밍 메시지 부분 업데이트, 에셋 레지스트리 관리가 모두 평문 도메인 객체를 전제로 훨씬 단순하게 동작한다.
- 문제:
  - 로컬 암호화 저장은 XSS/로컬 침해에 대한 실질 방어를 크게 늘리지 못하는 반면, 모든 CRUD와 테스트에 암복호화 비용과 실패 경로를 강제했다.
  - `masterKey`가 없는 로컬 전용/게스트 작업과, `masterKey`가 반드시 필요한 클라우드 동기화 작업의 경계가 흐려졌다.
  - PocketBase relation/FK/cascadeDelete를 쓰면 서버가 도메인 관계를 알게 되고, 클라이언트 소유의 참조 무결성 모델과 충돌한다.
- 결정:
  - 로컬 DB(Dexie/SQLite)와 로컬 asset registry는 평문 JSON을 저장한다.
  - 암호화 경계는 sync engine으로 올린다. Push 시 로컬 payload를 M으로 암호화해 PocketBase의 `encryptedData + encryptedDataIV`에 저장하고, Pull 시 복호화해 로컬 평문 DB에 반영한다.
  - `getActiveSession()`은 로컬 작업용 userId를 제공하고, `getSyncSession()`은 서버 동기화에 필요한 masterKey를 요구한다.
  - PocketBase 도메인 테이블은 FK/relation/cascadeDelete 없이 plain `userId`와 encrypted payload만 가진 blind sync table로 둔다. 현재 단계에서는 증분 마이그레이션을 추가하지 않고 `1773000000_init_keiai_schema.js`를 canonical clean schema로 직접 수정한다.
- 결과:
  - 서비스 레이어와 write queue가 평문 도메인 객체를 기준으로 단순해진다.
  - 서버는 여전히 application plaintext를 보지 못한다.
  - 로컬 디바이스 침해에 대한 방어는 OS/브라우저 저장소 격리와 앱 세션 관리에 맡기며, E2EE의 주된 경계는 네트워크/서버/타 기기 동기화로 명확해진다.
  - 서버 FK가 사라진 만큼 orphan 정리, soft delete, cascade는 앱 서비스와 sync 훅의 명시 로직 및 테스트가 책임진다.
- 참고: ADR 015 (EncryptedWriteQueue), ADR 028 (단일 테이블 통합), docs/schema.md, docs/asset-system-v3.md

---

## 031: 로컬 정체성 기반 계정 시스템 v2

- 상태: 채택
- 맥락: ADR 030 이후 로컬 DB는 평문 작업 공간이 되었고, 마스터 키 `M`의 주된 책임은 로컬 at-rest 암호화가 아니라 클라우드 동기화 payload, 복구, 미래 공유 룸 키 보관이 되었다. 기존 이메일 기반 PB 인증과 `isGuest` 플래그는 이 모델에서 제품 의미와 구현 의미가 어긋나기 시작했다.
- 문제:
  - 이메일은 복구 수단으로 쓰지 않으므로 필수 식별자로 둘 이유가 약하다.
  - 게스트/등록 유저의 차이는 별도 정체성이 아니라 "동기화 서버와 연결되어 있는가"의 상태에 가깝다.
  - 공식 서버와 셀프호스트 서버를 모두 지원하려면 서버가 유저 정체성을 생성하지 않고, 로컬 정체성을 보관하는 형태가 더 자연스럽다.
- 결정:
  - 앱 최초 실행 시 로컬에서 `userId`, extractable `M`, Identity Key Pair를 생성한다. 이 셋이 유저 정체성의 기준이다.
  - `M`은 불변이며 항상 extractable로 유지한다. local DB가 평문인 현재 모델에서 non-extractable 라이프사이클은 보안 이득보다 복잡도가 크다.
  - `isGuest` 필드는 제거한다. 동기화 상태는 `username?: string`과 PB auth 상태로 파생한다. `syncServerUrl`은 연결 상태가 아니라 계정 작업 대상 서버 설정이다.
    - `username === undefined`: local-only 또는 서버만 선택된 상태
    - `syncServerUrl !== undefined && username === undefined`: sync server selected, account not linked
    - `username !== undefined && !pb.authStore.isValid`: linked, disconnected
    - `username !== undefined && pb.authStore.isValid`: connected
  - 공식 서버도 별도 플래그로 저장하지 않고 `syncServerUrl === DEFAULT_SYNC_SERVER_URL` 비교로만 판별한다.
  - PB auth identity는 이메일 대신 유저가 고른 unique `username`을 사용한다. 등록 시 `id = userId`, `username`, `password = X`를 저장하고, 로그인 시 `authWithPassword(username, X)`를 호출한다. 로그인 성공 후 서버 `record.id`를 canonical `userId`로 사용한다.
  - 이메일은 선택 필드로만 남기며, 복구는 복구 코드와 페어링 플로우가 담당한다.
  - 새 기기 연결은 단일 `pairingCode`를 사용한다. QR은 같은 코드를 자동 입력하는 수단이며, 수동 입력 fallback과 별도 보안 경로를 만들지 않는다.
  - 로그인 salt 조회는 `/api/account/salt`에서 항상 `{ salt }`만 반환한다. 존재하지 않는 username에는 서버 secret 기반 deterministic dummy salt를 반환해 username enumeration을 줄인다.
  - `/api/account/salt`, `/api/pairing`, `/api/recovery/*` 계열 endpoint에는 rate limit과 one-time/TTL 정책을 둔다.
- 결과:
  - 계정 생성, 서버 이전, 셀프호스팅, 복구가 모두 로컬 정체성 중심으로 정렬된다.
  - 유저는 앱을 즉시 local-only로 사용할 수 있고, 나중에 어떤 동기화 서버든 같은 `userId + M`으로 연결할 수 있다.
  - 서버는 여전히 application plaintext와 `M`을 알 수 없고, PB는 로그인 토큰 발급과 opaque blob 저장소 역할만 수행한다.
- 참고: docs/account-system-v2.md, ADR 030

---

## 032: Asset System v3 — 암호화 에셋 카탈로그와 서버 호환성 단순화

- 상태: 채택
- 맥락: 기존 에셋 시스템은 private/public/inlay 구분, promote API, delete API, owner 기반 catalog refCount, 고정 salt 기반 키 유도 등 여러 개념이 섞여 있었다. 공식 서버 CDN 공유와 셀프호스트 호환성을 동시에 지원하려면 물리 파일 저장, 논리 에셋 참조, 로컬 캐시 상태를 더 명확히 분리해야 했다.
- 문제:
  - public/private 구분은 서버가 에셋 의미를 알거나 plaintext/public 파일을 다루는 방향으로 흐르기 쉬워 zero-knowledge 원칙과 충돌한다.
  - 클라이언트가 upload/delete/promote/ref API를 직접 조합하면 ref accounting이 누락되기 쉽고, sync 데이터와 서버 catalog가 서로 다른 truth가 된다.
  - 셀프호스트 서버에서도 공식 서버와 같은 PB 코드로 동작해야 하므로, 공식 CDN에만 특화된 상태 모델은 장기적으로 부담이 된다.
  - 동일 원본 이미지 dedup을 위해서는 파일 내용 기반 주소화가 필요하지만, 서버가 plaintext를 볼 수는 없다.
- 결정:
  - 모든 에셋은 암호화한다. public/private 구분과 promote API를 제거하고, 에셋 kind는 `resource | inlay`로 단순화한다.
  - 수렴 암호화(convergent encryption)를 사용한다.
    - `plaintextHash = SHA-256(plaintext)`
    - `encKey = HKDF-SHA256(plaintextHash, "kei-asset-enc")`
    - `iv = HKDF-SHA256(encKey, "kei-asset-iv")[0:12]`
    - `ciphertext = AES-256-GCM(plaintext, encKey, iv)`
    - `hash = SHA-256(ciphertext)`
  - `assets` 테이블은 논리 에셋의 SOT로 둔다. `hash`와 `status`는 서버 hook이 ref/usage를 계산할 수 있도록 평문 필드로 저장하고, `kind`와 `encKey`는 `encryptedData` 안에 저장한다.
  - `assetRegistry`는 디바이스 로컬 캐시 인덱스로만 둔다. LRU eviction, remote/local 필터링, kind 기반 캐시 정책을 빠르게 처리하기 위해 `kind`, `status`, `size`, `accessedAt`을 중복 저장하지만, source of truth는 항상 `assets`이다.
  - 서버는 `asset_catalog(hash, size, data)`와 `asset_usage(userId, hash, refCount, size)`를 가진다.
  - 클라이언트는 physical upload만 `PUT /api/assets/{hash}`로 수행한다. hard quota는 이 upload API에서만 검사한다.
  - `assets` sync write는 quota/catalog 존재 여부로 거부하지 않는다. sync는 blind sync로 유지하고, PB hook은 `status=remote && !isDeleted && hash` 전이를 보고 `asset_usage` ledger만 갱신한다. catalog가 없으면 usage를 만들지 않고, 읽기 시 404 placeholder로 degrade한다.
  - 삭제는 클라이언트가 `assets.isDeleted = true`를 동기화하는 것으로 표현한다. 별도 remote delete/ref API는 두지 않는다. 서버 GC는 `asset_usage`에 참조가 없는 catalog 항목을 주기적으로 제거한다.
  - 공식 서버와 셀프호스트는 같은 PB schema/hook/API를 사용한다. 차이는 다운로드 경로뿐이다: 공식 서버는 CDN, 셀프호스트는 PB authenticated download endpoint.
- 결과:
  - 서버는 에셋 이미지 plaintext를 보지 못하고, 에셋 공유/동기화는 `hash + encKey` 메타데이터로 표현된다.
  - 같은 원본 이미지가 같은 ciphertext/hash를 만들기 때문에 서버 catalog dedup이 자연스럽게 가능하다.
  - 클라이언트 코드가 `local -> upload -> remote -> sync` 흐름으로 단순화되고, ref accounting은 서버 hook 한 곳으로 모인다.
  - 셀프호스트 서버도 공식 서버와 동일한 hook/schema로 동작하며, 서버 이전은 remote ciphertext를 확보해 새 서버에 재업로드한 뒤 `assets` 레코드를 push하는 동일 절차로 처리할 수 있다.
  - 수렴 암호화 특성상 confirmation attack 가능성은 있지만, 공격자가 원본 파일 후보를 이미 가지고 있어야 하며 이미지 에셋 dedup/경량 공유의 이득이 더 크다고 판단했다.
- 참고: docs/asset-system-v3.md, ADR 030

---

## 033: Refs 배열 → EntityListConfig Record 전환

- 상태: 채택
- 맥락: 모든 엔티티 참조(OrderedRef, ResourceRef, FolderDef)가 배열로 관리되고 있었다. deepMerge는 배열을 통째로 덮어쓰기 때문에, 동기화 충돌 시 한쪽 변경이 전부 날아가는 문제가 있었다.
- 문제:
  - 배열 기반 refs는 deepMerge 시 전체 덮어쓰기 발생 → 동시에 다른 자식을 추가/수정하면 한쪽이 손실.
  - refs와 folders가 별도 필드(`lorebookRefs`, `folders.lorebooks`)로 분산되어 응집도 낮음.
  - `.find(r => r.id === id)` 조회가 O(n).
- 결정: **EntityListConfig<R> 도입 — refs + folders를 엔티티 타입별로 그룹화하고 Record로 전환**

  ```typescript
  interface EntityListConfig<R extends OrderedRef = OrderedRef> {
    refs?: Record<string, R>;
    folders?: Record<string, FolderDef>;
  }
  ```

  - 필드명 변경: `lorebookRefs` → `lorebooks`, `moduleRefs` → `modules` 등.
  - FolderRef 배열 → Record<string, FolderDef> 전환.
  - `generateSortOrder`, `sortByRefs` 시그니처를 Record 대응으로 변경.
  - Create/Delete/Update 패턴:
    - 추가: `{ lorebooks: { refs: { [id]: { id, sortOrder } } } }`
    - 삭제: `{ lorebooks: { refs: { [id]: undefined } } }` (deepMerge가 키 삭제)
    - 수정: `{ lorebooks: { refs: { [id]: { ...existing, ...changes } } } }`

- 결과:
  - deepMerge가 키별 머지 → 동시에 다른 자식 수정 시 충돌 없음.
  - refs와 folders가 동일 EntityListConfig 내부에 응집.
  - `refs[id]` 조회 O(1).
  - 롤백이 간결: 전체 배열 백업 대신 키 하나만 복원.
- 참고: ADR 022 (DeepPartial), ADR 027 (Record 기반 중첩 구조)

---

## 034: Room 중심 멀티 캐릭터/페르소나 채팅 모델

- 상태: 채택
- 맥락: 기존 모델은 `User -> Character -> Chat -> Message` 계층이었다. 이 구조는 "한 채팅 = 한 캐릭터"일 때는 단순하지만, 여러 캐릭터와 여러 페르소나가 같은 대화 공간에 등장하는 순간 `chatId`만으로 파이프라인/템플릿/스크립트 실행 컨텍스트를 결정할 수 없어진다. 또한 캐릭터 스튜디오와 채팅 화면이 강하게 결합되어, 캐릭터 자원을 편집하기 위해 항상 특정 채팅을 전제로 해야 했다.
- 문제:
  - 그룹 대화에서는 채팅이 캐릭터에 소유되는 것이 아니라 방(Room)에 소속되어야 한다.
  - 유저 메시지의 화자 페르소나와 AI 응답 캐릭터는 메시지마다 달라질 수 있다.
  - input/display/request/output 파이프라인은 실행 범위마다 필요한 "최선의 컨텍스트"가 다르다.
  - 캐릭터/페르소나 삭제 시 모든 메시지를 전역 스캔해 참조를 정리하면 성능과 동기화 비용이 커진다.
  - greeting은 여러 캐릭터가 있는 방에서도 한 채팅의 초기 상태로 자연스럽게 표현되어야 한다.
- 결정:
  - 개인 채팅 계층을 `User -> Room -> Chat -> Message`로 변경한다.
  - `Room -> Character`는 `EntityListConfig<ResourceRef>` 약한 참조로 둔다. 캐릭터 레코드는 유저 전역 소유 자원이며, 방 삭제가 캐릭터를 삭제하지 않는다.
  - `Chat -> Persona`는 `EntityListConfig<ResourceRef>` 약한 참조로 둔다. 전역 active persona는 제거하고, 채팅마다 selected/default persona를 저장한다.
  - `Chat`은 `defaultCharacterId`, `selectedCharacterId`, `defaultPersonaId`, `selectedPersonaId`를 가진다.
  - `MessageSwipe`는 `speakerId`, `speakerName`을 가진다. `role`이 `user`이면 `speakerId`는 persona id, `assistant`이면 character id로 해석한다. 별도 `speakerKind`는 두지 않는다.
  - `runChat(chatId)`은 별도 character 인자를 받지 않고, 채팅 레코드의 `selectedCharacterId ?? defaultCharacterId`와 `selectedPersonaId ?? defaultPersonaId`를 사용한다. 없거나 disabled ref이면 실패한다.
  - input/display/request/output 파이프라인과 템플릿은 범위별 "가장 구체적인 컨텍스트"를 주입한다.
    - input: default character + selected persona.
    - runChat/prompt/output: selected/default character + selected/default persona.
    - display: 메시지가 assistant이고 active swipe에 speakerId가 있으면 그 캐릭터, user이면 그 페르소나. 없으면 default ids.
    - history: 메시지마다 active swipe의 `role + speakerId + speakerName`으로 context를 덮어쓴다.
  - 템플릿/파이프라인은 매 호출마다 필요한 macro/handler를 수집한다. 별도 장기 캐시된 collect 결과에 의존하지 않는다.
  - greeting은 채팅당 하나의 assistant message로 동기화하고, 각 캐릭터 greeting은 같은 message 안의 swipe로 저장한다. greeting swipe id는 character greeting id를 그대로 사용한다.
  - 변수는 채팅 레코드가 아니라 active swipe에 저장한다. 새 swipe는 room enabled character들의 `defaultVariables`를 sortOrder 순서로 merge한 뒤, 이전 active swipe variables를 덮어쓴 값으로 시작한다.
  - stale weak refs는 진입 시 self-healing한다. `selectRoom`은 room의 stale character/chat refs를 정리하고, `selectChat`은 stale/disabled persona 및 selected/default ids를 정리한다. 메시지의 `speakerId/speakerName`은 히스토리 정보이므로 정리하지 않는다.
- 결과:
  - 한 채팅 안에서 여러 캐릭터와 여러 페르소나가 자연스럽게 공존할 수 있다.
  - 캐릭터 스튜디오는 `character/:id` 독립 화면으로 분리되고, 룸/채팅은 약한 참조를 통해 해당 자원으로 이동한다.
  - 파이프라인과 템플릿은 "chatId 단일 컨텍스트" 대신 호출 범위의 context를 기준으로 실행된다.
  - 메시지 히스토리는 당시 화자 이름을 보존하므로, 캐릭터/페르소나 삭제 이후에도 표시가 안정적으로 degrade된다.
  - 서비스/스토어 테스트는 room/chat/message/ref 정합성, selected/default 정책, greeting/variables, history context 주입을 회귀 방지 대상으로 삼는다.
- 참고: ADR 026 (즉시 영속 메시지와 Thin Task 트래커), ADR 027 (Record 기반 중첩 구조), ADR 029 (PagedMessages), ADR 033 (EntityListConfig), docs/schema.md

---

## 035: 로컬 Scope 기반 컨텐츠 DB와 서버 Generic Encrypted Records

- 상태: 채택
- 맥락: 멀티 유저 룸을 도입하려면 개인 컨텐츠(`user` 소유)와 멀티룸 컨텐츠(`room` 소유)를 동시에 다뤄야 한다. 초기 검토에서는 로컬 DB에도 `multi_characters`, `multi_chats`, `multi_messages`처럼 별도 멀티 테이블을 추가하는 방식을 고려했다.
- 문제:
  - 로컬 테이블을 개인/멀티로 나누면 `MessageService`, `PagedMessages`, `RecordBuffer`, 템플릿/파이프라인, 변수/greeting 로직이 모두 local/multi 분기를 알아야 한다.
  - 특히 메시지 페이지네이션과 record buffer는 같은 도메인 연산을 두 테이블에 대해 반복해야 하므로 코드량과 테스트 부담이 크게 늘어난다.
  - 반대로 서버 측은 zero-knowledge sync 저장소이므로, 도메인별 테이블(`characters`, `messages`, `lorebooks` 등)을 그대로 유지할 필요가 약하다. 서버는 권한과 동기화 메타만 알면 되고, 실제 도메인 payload는 암호문 blob이다.
- 대안 검토:
  - 로컬/서버 모두 도메인별 local/multi 테이블 분리 → 권한 경계는 명확하지만 클라이언트 도메인 코드가 폭발한다.
  - 로컬/서버 모두 단일 generic records 테이블 → 서버는 단순하지만 로컬 도메인 쿼리, 페이지네이션, 인덱싱이 불편하다.
  - 로컬은 도메인 테이블 유지 + scope 격리, 서버는 generic encrypted records → 로컬 실행성과 서버 blind sync 모델을 각각 최적화할 수 있다.
- 결정:
  - 로컬 DB는 도메인별 테이블(`characters`, `rooms`, `chats`, `messages`, `lorebooks`, `scripts`, `charjs`, `assets` 등)을 유지하되, 모든 레코드는 `DataRecord` 구조로 통일한다.

    ```typescript
    export type DataScopeType = "user" | "room";

    export interface DataRecord {
      id: string;
      scopeType: DataScopeType;
      scopeId: string; // userId or roomId
      createdAt: number;
      updatedAt: number;
      isDeleted: boolean;
      assetEntries?: AssetEntries;
      data: Record<string, unknown>;
    }
    ```

  - 개인 컨텐츠는 `scopeType='user'`, `scopeId=userId`로 저장한다.
  - 멀티룸 컨텐츠는 `scopeType='room'`, `scopeId=roomId`로 저장한다.
  - 서비스/스토어/프롬프트/파이프라인은 호출자가 요청한 scope의 로컬 도메인 DB를 본다. `PagedMessages`와 `RecordBuffer`는 local/multi 테이블 분기를 알지 않고 scope 필터만 사용한다.
  - 멀티룸에서 개인 캐릭터/페르소나/자원을 사용하려면 약한 참조가 아니라 snapshot import를 수행한다. import된 레코드는 새 id와 `scopeType='room'`, `scopeId=roomId`를 가진 독립 컨텐츠가 된다.
  - 서버 sync 저장소는 도메인별 테이블 대신 generic encrypted record 테이블을 사용한다.

    ```text
    records
      id, userId, kind, updatedAt, isDeleted, encryptedData, encryptedDataIV

    multi_room_records
      id, roomId, kind, updatedAt, isDeleted, encryptedData, encryptedDataIV
    ```

  - sync engine은 로컬 레코드의 `scopeType`을 기준으로 암호화 키와 서버 테이블을 선택한다.
    - `scopeType='user'`: master key `M`으로 암호화하고 `records`에 push/pull한다.
    - `scopeType='room'`: active room key로 암호화하고 `multi_room_records`에 push/pull한다.
  - 서버의 멀티룸 권한은 `multi_room_records.roomId`와 `multi_room_members`의 accepted membership으로 검사한다. 개인 records는 기존처럼 `userId === auth.id`를 기준으로 검사한다.
  - `multi_room_index`와 `multi_room_members`는 컨텐츠가 아니라 디렉터리/권한/키 교환 메타이므로 별도 테이블로 유지한다.
  - 에셋도 같은 `DataRecord` 소유 모델을 사용한다. 개인 에셋은 `scopeType='user'`, 멀티룸 에셋은 `scopeType='room'`이다.
  - 다만 에셋은 서버 generic content records에 포함하지 않는다. 에셋은 blob 저장, upload queue, registry, hash/status 라이프사이클이 있으므로 별도 asset adapter/sync 모델을 유지한다. 서버도 `assets`와 `multi_room_assets`를 둔다.

- 결과:
  - 로컬 실행 계층은 개인 모드와 멀티룸 모드를 같은 도메인 서비스, 같은 페이지네이션, 같은 buffer 위에서 실행할 수 있다.
  - 서버는 도메인 구조를 알지 않는 generic encrypted sync store가 되며, 새 컨텐츠 타입 추가 시 서버 schema 변경이 줄어든다.
  - sync engine은 암호화 경계, 서버 스키마 변환 경계, scope 라우팅 경계가 되어 더 무거워진다. 대신 이 복잡도를 sync 한 곳에 모으고, 서비스/스토어/UI가 서버 테이블과 암호화 방식을 모르게 한다.
  - 모든 로컬 컨텐츠 쿼리는 scope 필터를 반드시 포함해야 한다. 이를 누락하면 다른 유저 또는 다른 room의 데이터가 섞일 수 있으므로, 어댑터 API 차원에서 scope-aware 쿼리를 강제해야 한다.
  - 로컬 DB shape와 서버 DB shape가 의도적으로 달라진다. 로컬은 실행하기 좋은 도메인 DB, 서버는 동기화하기 좋은 blind encrypted store로 본다.
- 참고: ADR 029 (PagedMessages), ADR 030 (로컬 평문 저장소와 동기화 경계 암호화), ADR 031 (로컬 정체성 기반 계정 시스템 v2), ADR 032 (Asset System v3), ADR 034 (Room 중심 멀티 캐릭터/페르소나 채팅 모델)

---

## 036: Scope 기반 동기화 라우팅과 멀티룸 메타 동기화

- 상태: 채택
- 맥락: ADR 035로 로컬 컨텐츠 레코드는 `scopeType/scopeId`를 가지게 되었고, 서버는 개인 컨텐츠와 멀티룸 컨텐츠를 서로 다른 encrypted collection에 저장한다. 기존 동기화 엔진은 "로컬 테이블 = 서버 테이블"과 "테이블별 cursor"를 가정했기 때문에 scope 기반 라우팅과 맞지 않았다.
- 문제:
  - 같은 로컬 테이블(`characters`, `messages`, `assets`) 안에 user scope와 room scope 레코드가 공존한다.
  - 서버는 개인 컨텐츠를 `records/assets`, 룸 컨텐츠를 `multi_room_records/multi_room_assets`에 저장한다.
  - 동기화 cursor가 테이블별이면 scope 전환 시 cursor 의미가 흐려지고, 여러 로컬 테이블을 하나의 서버 collection으로 push/pull하기 어렵다.
  - 룸 삭제는 room session이 닫힌 뒤에도 tombstone push가 필요하다. 이때 room key는 메모리 session에 없을 수 있다.
- 결정:
  - `DataSyncEngine`은 로컬 `SYNC_TABLES` 전체를 scope별로 수집한 뒤, 서버 collection 하나로 라우팅한다.
    - user scope: `records`, key = user master key.
    - room scope: `multi_room_records`, key = room key.
  - 서버 record에는 `kind` 필드를 둔다. pull 시 `kind`를 기준으로 로컬 도메인 테이블에 분배한다.
  - cursor는 테이블별이 아니라 scope별로 둔다.
    - `lastSync_records_user_${userId}`
    - `lastSync_records_room_${roomId}`
    - `lastSync_assets_user_${userId}`
    - `lastSync_assets_room_${roomId}`
  - active user session은 항상 user scope를 동기화한다. active room session이 있으면 room scope도 추가로 동기화한다.
  - `AssetSyncEngine`도 같은 scope routing을 따른다. 다만 upload queue, registry, storage blob 라이프사이클이 있으므로 data sync와 분리된 엔진으로 유지한다.
    - user scope: `assets`
    - room scope: `multi_room_assets`
  - `MultiSyncEngine`은 컨텐츠가 아닌 plaintext room metadata만 동기화한다.
    - `multi_room_index`: room directory/search/owner metadata.
    - `multi_room_members`: membership status와 public-key-wrapped room key.
    - cursor: `lastSync_multi_meta_${userId}`.
  - room session 변화(`openRoom`, `closeRoom`, room create/delete/leave`) 후에는 room-aware sync engines(Data/Asset)의 realtime subscription을 갱신하고 즉시 pull/push를 시도한다.
  - room deletion은 `MultiRoomDeleteMarkerRecord`로 표현한다. 삭제 호출 시 room key를 로컬 marker에 저장하고 room scope 레코드/에셋을 soft delete한다. Data/Asset sync가 각각 tombstone push를 완료하면 `dataDone/assetDone`을 표시하고, 둘 다 완료되면 marker를 제거한다. 실패 marker는 무한 재시도하지 않도록 최대 시도 횟수를 둔다.
- 결과:
  - 서비스 레이어는 서버 collection 이름과 암호화 키 선택을 몰라도 된다.
  - sync engine이 암호화 경계, scope routing 경계, 서버 스키마 변환 경계를 책임진다.
  - 개인 데이터와 멀티룸 데이터가 로컬에서는 같은 도메인 모델로 동작하고, 서버에서는 권한/키 경계에 맞게 분리된다.
  - 멀티룸 메타데이터는 plaintext이지만, room content와 asset payload는 room key로 암호화된다.
- 참고: ADR 030, ADR 032, ADR 035, docs/schema.md, docs/asset-system-v3.md

---

## 037: 멀티룸 멤버십, 삭제, owner-paid asset 정책

- 상태: 채택
- 대체: ADR 036의 `MultiRoomDeleteMarkerRecord` 기반 room deletion 정책과, 멀티룸 범위에서 ADR 032의 "hard quota는 `PUT /api/assets/{hash}`에서만 적용" 문구를 대체한다.
- 맥락: 멀티룸은 local-first/E2EE 컨텐츠를 유지하되, 서버가 접근권, 삭제, asset quota를 명확히 판단해야 한다. delete marker 방식은 room 삭제와 나가기/추방 상태를 섞고 sync 엔진을 복잡하게 만들었다.
- 결정:
  - `multi_room_index`는 room lifecycle의 source of truth다. room 삭제는 `multi_room_index.isDeleted = true`로 표현한다.
  - `multi_room_members`는 user-room relationship ledger다. `isDeleted`를 두지 않고 `pending | accepted | revoked | left` status만 사용한다.
  - `revoked`는 ban이 아니라 현재 접근권 회수다. `left`는 사용자의 자발적 이탈이다.
  - room content 접근 조건은 다음 하나로 통일한다.
    ```text
    index exists
    index.isDeleted === false
    membership.status === "accepted"
    ```
  - 서버 endpoint는 sync 권한만으로 허용하면 안 되는 전환에만 둔다.
    - `join-request`: non-owner가 자기 membership을 `pending`으로 upsert.
    - `leave`: non-owner가 자기 membership을 `left`로 변경.
    - `delete`: owner-only. `multi_room_records`/`multi_room_assets`를 즉시 hard delete하고 index tombstone을 남김.
    - room asset upload: accepted member가 업로드하되 quota는 room owner 기준으로 검사.
  - room create, invite, revoke, reject, index update, accepted member의 content write는 sync에 의존한다.
  - 클라이언트는 inaccessible room content를 로컬에 남기지 않는다. sync 이벤트와 앱 로드 시 `purgeInaccessibleRoomContent()`가 이 invariant를 best-effort로 복구한다. index/member metadata는 purge 근거로 보존한다.
  - 멀티룸 asset 비용은 owner가 부담한다. `multi_room_assets.roomId -> multi_room_index.ownerUserId`로 usage owner를 찾고, upload와 metadata live-ref 전이 모두 owner quota를 기준으로 검사한다.
- 결과:
  - room 삭제와 user relationship 상태가 분리된다.
  - delete marker와 room-key tombstone push가 사라져 sync 엔진이 단순해진다.
  - 서버 content 접근권은 accepted membership 하나로 판단된다.
  - room delete는 서버 records/assets를 즉시 제거하고, asset usage hook이 owner usage/refCount를 감소시킨다.
- 한계:
  - `revoked -> pending` 재신청 허용 여부는 제품 정책으로 남겨둔다.
  - local purge는 durable queue가 아니라 best-effort repair다.
  - create는 local-first sync라 서버 원자성은 없다.
  - 서버 asset GC는 `asset_usage` orphan catalog/blob 정리에 의존한다.
- 참고: ADR 032, ADR 035, ADR 036, docs/schema.md, docs/asset-system-v3.md

---

## 038: Asset System V4 - Parent-owned Asset Entries

- 상태: 채택
- 대체: ADR 032의 synced asset record 모델을 대체한다.
- 맥락: Asset System V3는 모든 에셋을 동기화 가능한 UUID 레코드로 저장했다. 이 방식은 id 기반 접근과 로컬 라이프사이클은 단순했지만, 에셋 생성마다 soft delete/tombstone 대상 레코드가 계속 늘어나는 문제가 있었다.
- 검토한 대안:
  - hash + refCount: 분산 환경에서 같은 owner가 같은 에셋을 여러 기기에서 삭제하는 경우를 안전하게 표현하기 어렵다.
  - hash + owner set: refCount 문제는 피하지만 owner set이 파생 인덱스가 된다. 실제 live 참조 여부는 결국 부모 레코드를 다시 봐야 한다.
  - owner별 manifest table: owner마다 manifest row가 하나씩 생겨 source of truth가 부모 레코드와 manifest row 두 곳으로 나뉜다.
- 결정:
  - 에셋 참조의 source of truth는 부모 데이터 레코드에 둔다.
  - 부모 레코드는 sync-visible top-level field로 `assetEntries: Record<hash, 'local' | 'remote'>`를 가진다.
  - 별도 synced asset metadata row는 제거한다. Data sync engine이 부모 레코드와 `assetEntries`를 동기화하고, Asset sync engine은 binary upload만 담당한다.
  - 서버 hook은 `records` / `multi_room_records`의 `assetEntries` diff를 보고 `remote` hash만 `asset_usage`에 반영한다.
  - inlay asset은 chat-owned asset으로 정의한다.
  - 로컬 registry는 source of truth가 아니라 캐시/바이너리 sync 인덱스이며, identifier는 `scope + owner + hash`를 포함한다.
- 결과:
  - synced asset row 폭증 문제가 제거된다.
  - 서버는 zero-knowledge model을 유지하면서 `assetEntries`만으로 usage accounting과 GC 근거를 얻는다.
  - content service가 자기 owner 레코드의 asset CRUD와 `assetEntries` 집계를 책임진다.
  - read path는 `scope/owner/hash/encKey`를 요구해 길어졌지만, 이 값들은 모두 부모 레코드에서 바로 얻을 수 있다.
- 한계:
  - 같은 hash를 여러 owner가 들고 있을 때 로컬 registry/storage dedup은 포기한다.
  - 렌더/UI 경로에 `AssetReadLocator`가 전달되므로 v3의 id 기반 접근보다 코드가 장황해질 수 있다.
- 참고: docs/asset-system-v4.md, ADR 032, ADR 035, ADR 036, ADR 037, docs/schema.md

---

## 039: Scope-neutral content routes and Multi Room workspace

- 상태: 채택
- 맥락: user scope와 room scope는 같은 로컬 도메인 테이블과 같은 UI를 사용한다. URL에 scope를 중복 표현하면 room, chat, character, persona 경로가 각각 user/multi 변형으로 늘어나고 Studio 링크도 부모 room 경로에 결합된다.
- 결정:
  - content URL은 scope를 표현하지 않는다.
    - `#/room/{roomId}`
    - `#/room/{roomId}/chat/{chatId}`
    - `#/character/{characterId}`
    - `#/persona/{personaId}`
  - route 복구 전에 로컬 레코드의 `scopeType/scopeId` 메타데이터만 조회한다. room scope이면 `selectMultiRoom(scopeId)`로 membership과 room key를 검증한 뒤 기존 selector를 호출한다.
  - metadata resolver는 도메인 payload를 반환하지 않으며 기존 `canAccessScope()`를 우회하지 않는다.
  - `#/multi-room`은 content route가 아니라 Multi Room 생성, 발견, 가입 요청, 멤버십 관리를 위한 최상위 workspace다.
  - 로컬 레코드가 없는 새 기기에서는 character/persona id만으로 부모 room을 추론하지 않는다. 해당 경우 명시적인 not-found 복구 상태를 표시한다.
- 결과:
  - 일반 room과 Multi Room이 같은 chat/Studio route와 화면을 공유한다.
  - 새로고침 시 room-scoped content도 로컬 metadata를 통해 room session을 복구할 수 있다.
  - URL 구조는 단순하게 유지되지만, 아직 로컬에 없는 room-scoped Studio 딥링크는 지원하지 않는다.
- 참고: ADR 035, ADR 036, ADR 037

---

## 040: EntityList 기반 커스텀 토글 시스템

- 상태: 채택
- 맥락: Risu는 커스텀 토글 그룹을 `group`과 `groupEnd` 표식이 섞인 선형 목록으로 표현한다. KeiAI에는 이미 계층형 `EntityListConfig` 모델과 렌더러가 있지만, 기존 토글 구현은 정렬 로직을 중복해서 구현하고 현재 값을 범용 `globalVariables` 맵에 저장하고 있었다.
- 결정:
  - Preset과 Module은 각각 자신의 토글 정의와 현재 값을 `EntityListConfig<ToggleItem>` 형태로 소유한다.
  - 값을 가지는 각 컨트롤은 현재 값을 직접 저장한다. 별도의 값 맵이나 기본값 대체 규칙은 두지 않는다.
  - 새로 만들거나 가져온 컨트롤은 체크박스 `false`, Select의 첫 번째 옵션, 빈 문자열 중 해당 타입에 맞는 값으로 초기화한다.
  - 룸 패널과 정의 편집기는 `EntityList`를 재사용한다. 런타임은 browse 모드, 편집기는 manage 모드를 사용한다.
  - Risu의 선형 그룹은 가져올 때 계층형 폴더로 변환하고, 내보낼 때 대응하는 `groupEnd`를 포함한 선형 표현으로 되돌린다.
  - `getglobalvar::toggle_*`는 `gettoggle::*`로 변환하며, 그 밖의 `getglobalvar` 호출은 `null`로 폐기한다.
  - 범용 global variable API와 관련 워크플로 노드는 제거한다. Chat variable은 별도 시스템으로 유지한다.
  - Kei Preset과 Module 패키지 버전은 1을 유지하며, 이전 Kei payload 구조와의 호환은 제공하지 않는다.
- 결과:
  - 토글 계층, 드래그 앤 드롭, 폴더, 런타임 접기 상태와 값이 하나의 네이티브 모델을 사용한다.
  - Module 토글의 현재 값은 해당 Module을 사용하는 모든 위치에서 공유된다.

---

## 041: Lorebook, Regex Script, CharJS 부모 인라인화

- 상태: 채택
- 맥락: 세 자원은 한 Character, Chat, Module 또는 Preset에 종속되어 독립 공유되지 않았지만 별도 테이블, 서비스, owner 인덱스, writable store, 동기화 tombstone을 가졌다. 부모는 다시 정렬과 폴더를 위한 refs를 보유해 동일한 소유 목록이 두 곳에 분산되었다.
- 결정:
  - Lorebook, regex script, CharJS를 부모의 `EntityListConfig<Item>`에 내용과 레이아웃 정보가 결합된 항목으로 저장한다.
  - `lorebooks`, `scripts`, `charjs` 로컬 테이블과 독립 서비스, owner cascade, sync kind를 제거한다.
  - Studio 목록은 부모 레코드에서 파생하며 별도 writable child store를 사용하지 않는다.
  - CharJS collector는 ID를 다시 조회하지 않고 인라인 객체를 VM pool에 전달한다. VM 격리 키 `${charjsId}:${chatId}:${kind}:${mode}`는 유지한다.
  - Kei package도 별도 child 배열 없이 부모 payload 안에 자원을 인라인한다. 이전 payload 및 로컬 데이터 호환은 제공하지 않는다.
- 결과:
  - 자원 추가·수정·삭제는 부모 레코드 한 번의 갱신이며 child tombstone을 만들지 않는다.
  - 동기화 충돌 단위와 암호화 단위는 부모 전체가 된다.
  - 부모 삭제는 인라인 자원을 별도로 cascade하지 않는다.
- 참고: ADR 025, ADR 033, docs/schema.md

---

## 042: 메시지 미디어를 AgentPart inlay로 통합

- 상태: 채택
- 맥락: 메시지의 텍스트·도구 호출은 순서가 있는 `AgentPart[]`에 저장되지만 미디어는 별도 `attachments` 배열에 저장되어, 멀티모달 모델 출력의 원래 순서를 표현할 수 없었다.
- 결정:
  - 메시지 미디어는 `{ type: 'inlay', ids: string[] }` AgentPart로 저장한다.
  - `MessageSwipe.attachments`는 제거하고 사용자 첨부와 모델 생성 미디어 모두 같은 part 구조를 사용한다.
  - LLM 스트림은 provider-neutral한 ordered multimodal `parts`만 제공한다. `LLMOutputPart`는 text, thought, image/audio/video, tool request를 포함하고, 입력용 `LLMContentPart`는 여기에 tool response를 추가한다. Agent executor는 binary media를 chat inlay로 저장한 뒤 inlay part로 변환한다.
  - 한 LLM 응답에서 발생한 tool request들은 `{ type: 'tool_calls', calls: [...] }` AgentPart 하나로 저장한다. 같은 batch의 request는 assistant 메시지 하나로, response는 user 메시지 하나로 복원하여 병렬 호출과 다음 agent turn의 순차 호출을 구분한다.
  - thought part는 향후 provider별 thought signature를 보존하기 위해 `LLMMessage`에 포함할 수 있지만, signature 지원 전에는 handler가 provider request에서 제외한다. 일반 text로 변환해 재전송하지 않는다.
  - Agent 프롬프트의 `message` 블록은 템플릿 결과를 `AgentPart`로 역직렬화한 뒤 LLM 메시지로 변환한다. 입력 slot은 비재귀적으로 삽입하여 upstream의 serialized text에 포함된 매크로를 실행하지 않으며, text/inlay/thought/tool_calls를 모두 보존한다.
  - 워크플로우의 `AgentPart Filter`는 serialized AgentPart 문자열을 받아 text/thought/inlay/tool_calls 중 선택된 종류만 순서대로 다시 직렬화한다.
  - 메시지의 visible 구간은 마지막 text part부터 그 이후까지이며, 마지막 text 바로 앞의 연속된 inlay도 포함한다. 그보다 앞선 part는 접히는 step/trace로 렌더링한다.
  - 히스토리는 `last_text`, `visible`, `full_trace` 세 모드를 제공한다. `last_text`는 마지막 text part 하나, `visible`은 펼쳐진 범위의 text/inlay, `full_trace`는 전체 실행 기록을 사용한다. inlay는 해당 위치에서 `LLMContentPart` image/audio/video로 복원한다.
- 결과:
  - 사용자 첨부와 생성 미디어가 하나의 순서 보존 메시지 모델을 사용한다.
  - 이미지 전용 응답도 유효한 Agent 출력으로 취급된다.
  - display 전용 TTS·번역 결과는 AgentPart와 별도의 기능별 display 공간에 둔다.

---
