# KeiAI 데이터 스키마 설계 철학

> E2EE(종단간 암호화) 기반 AI 롤플레잉 클라이언트의 데이터 아키텍처 원칙

---

## 1. 저장소 구조: 단일 테이블 구조

모든 엔티티는 **하나의 테이블**에 저장된다. 로컬 테이블은 하나의 평문 JSON 필드(`data`)를 보관하고, PocketBase 동기화 테이블은 같은 내용을 암호화한 JSON Blob(`encryptedData` + `encryptedDataIV`)을 보관한다.

- 엔티티의 모든 데이터(목록용 메타데이터 + 상세 본문)가 단일 JSON에 포함된다.
- 로컬에서는 평문 JSON으로 저장하고, 서버로 나갈 때만 AES-GCM으로 암호화된 JSON Blob으로 변환한다.
- 부모 엔티티가 자식의 미리보기 데이터를 복사해서 들고 있으면 **안 된다**. 미리보기가 필요하면 항상 자식의 테이블을 쿼리한다.

---

## 2. 관계 설계: 1:N vs N:M

### 2-1. 1:N (부모 → 자식)

**자식 테이블의 로컬 인덱스 컬럼**으로 표현한다.

```
ChatRecord     { ..., characterId: string }   ← 로컬 평문 (인덱싱 가능)
MessageRecord  { ..., chatId: string }         ← 로컬 평문 (인덱싱 가능)
```

- **이유:** "이 캐릭터의 채팅 목록", "이 채팅방의 메시지 목록"처럼 **부모 기준으로 자식을 빠르게 쿼리**해야 하므로 DB 인덱스가 필수적이다.
- **서버 측 원칙:** PocketBase에는 도메인 FK를 두지 않는다. 서버는 `userId`와 sync timestamp만으로 블라인드 동기화를 수행하고, `characterId`, `chatId` 같은 관계 정보는 로컬 인덱스 또는 암호화된 payload 내부에 둔다.

### 2-2. N:M (공유 자원 참조)

**소비자(부모)의 JSON payload 내부**에 `Array<{ id, enabled }>` 형태로 저장한다.

```typescript
// ChatFields (로컬 JSON / 서버 암호화 payload 내부)
{
  lorebookRefs: [
    { id: "lb_harrypotter", enabled: true },
    { id: "lb_medieval",    enabled: false }
  ],
  scriptRefs: [
    { id: "sc_translator", enabled: true }
  ]
}
```

- **이유:** 로어북, 스크립트 같은 공유 자원은 여러 캐릭터/채팅/페르소나가 동시에 참조할 수 있다(N:M). 이를 별도 맵핑 테이블로 만들면 *"누가 무엇을 쓰는지"* 라는 메타데이터가 평문으로 노출된다.
- **활성화 상태(`enabled`)도 함께 저장:** 같은 로어북이라도 A 채팅방에서는 켜고, B 채팅방에서는 끌 수 있어야 하므로, 참조하는 쪽에서 개별적으로 `enabled` 플래그를 관리한다.

---

## 3. 참조 무결성: 느슨한 결합 (Loose Coupling)

E2EE + 로컬 퍼스트 환경에서는 서버 RDB의 `FOREIGN KEY ... ON DELETE CASCADE`에 의존하지 않는다. 대신 **Graceful Degradation (관대한 실패 처리)** 전략을 따른다.

### 원칙
- 공유 자원(로어북, 스크립트)이 삭제되어도, 이를 참조하는 엔티티들의 payload를 일괄 수정하지 **않는다**.
- 삭제된 참조를 만나면 **조용히 무시(Skip)**하고, 기회가 될 때(예: 설정 화면을 열었을 때) 슬쩍 정리한다 **(Self-Healing)**.

### 이유
- 삭제 시점에 모든 참조자를 일괄 로드 → 수정 → 서버 재동기화하는 것은 성능적으로 재앙적이다.
- 고아 참조(Orphaned Reference)는 기능적 오류를 일으키지 않으며, 자연스럽게 정리된다.

```typescript
// 로딩 시 방어 코드 (Self-Healing 예시)
const fetched = await Promise.all(refs.map(r => LorebookService.get(r.id)));
const valid = refs.filter((r, i) => fetched[i] !== null);
// valid만 사용하고, 저장 시 자연스럽게 고아 ID가 탈락
```

---

## 4. 메모리 관리: Reference Counting

채팅 세션이 활성화되면, 관련된 공유 자원(로어북, 스크립트)들이 메모리에 올라간다. 여러 소스(캐릭터, 챗, 페르소나, 모듈)가 **같은 공유 자원을 동시에 참조**할 수 있으므로, 참조 카운팅으로 생명주기를 관리한다.

### 메모리 데이터 타입

```typescript
interface ActiveResourceEntry<T> {
  data: T;            // 실제 데이터
  enabled: boolean;   // 프롬프트 엔진이 실행할지 여부
  refs: Set<string>;  // 이 자원을 물고 있는 엔티티 ID 집합
}

const activeResources = new Map<string, ActiveResourceEntry<any>>();
```

### 라이프사이클

| 이벤트 | 동작 |
|---|---|
| **캐릭터/챗/페르소나 로드** | Blob에서 참조된 자원 ID들을 추출 → Map에 없으면 DB에서 복호화하여 적재, 있으면 `refs.add(sourceId)` |
| **토글 (켜기/끄기)** | `entry.enabled = true/false` (메모리 내 불리언 플립, DB 저장은 비동기) |
| **캐릭터/챗/페르소나 언로드** | `refs.delete(sourceId)` → `refs.size === 0`이면 Map에서 완전 삭제 |

### 핵심 원칙

> **연결된 공유 자원은 전부 메모리에 올리되, 프롬프트 엔진은 `enabled === true`인 것만 실행한다.**

- 로어북/스크립트는 전부 텍스트(JSON)이므로 수천 개의 항목이라 해도 수 MB 수준 → 메모리 부담 무시 가능
- 토글 시 DB 복호화 없이 즉시 반영 → UX 체감 속도 극대화

---

## 5. 엔티티 목록 (현재 + 확장 예정)

| 엔티티 | 테이블 | 로컬 인덱스 | JSON 내부 참조 |
|---|---|---|---|
| **User** | `users` | — | — |
| **Character** | `characters` | — | `lorebookRefs`, `scriptRefs` |
| **Chat** | `chats` | `characterId` | `lorebookRefs`, `scriptRefs`, `activePersonaId`, `promptPresetId` |
| **Message** | `messages` | `chatId` | (JSON 내부에 `swipes[]`, `activeSwipeIndex` 등) |
| **Persona** | `personas` | — | `lorebookRefs` |
| **Lorebook** | `lorebooks` | — | (JSON 내부에 `entries[]`) |
| **Script** | `scripts` | — | (JSON 내부에 `rules[]`) |
| **Prompt Preset** | `presets` | — | (JSON 내부에 프롬프트 조립 순서 등) |
| **Settings** | `settings` | — | (JSON 내부에 전역 설정) |

---

## 6. 한 줄 요약

```
로컬에는 "찾기 위한 최소한의 키"만 인덱스로 노출하고,
서버에는 "무엇을 어떻게 쓰는지"를 전부 암호화된 Blob 안에 숨긴다.
메모리에는 관련된 것을 전부 올려두되, 실행은 활성화된 것만 한다.
```
