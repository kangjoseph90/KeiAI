# KeiAI 데이터 스키마 설계 철학

> E2EE(종단간 암호화) 기반 AI 롤플레잉 클라이언트의 데이터 아키텍처 원칙

---

## 1. 저장소 구조: 단일 테이블 구조

모든 엔티티는 **하나의 테이블**에 저장된다. 로컬 테이블은 하나의 평문 JSON 필드(`data`)를 보관하고, PocketBase 동기화 테이블은 같은 내용을 암호화한 JSON Blob(`encryptedData` + `encryptedDataIV`)을 보관한다.

- 엔티티의 모든 데이터(목록용 메타데이터 + 상세 본문)가 단일 JSON에 포함된다.
- 로컬에서는 평문 JSON으로 저장하고, 서버로 나갈 때만 AES-GCM으로 암호화된 JSON Blob으로 변환한다.
- 부모 엔티티가 자식의 미리보기 데이터를 복사해서 들고 있으면 **안 된다**. 미리보기가 필요하면 항상 자식의 테이블을 쿼리한다.

---

## 2. 관계 설계: 소유와 참조

KeiAI의 현재 개인 채팅 모델은 다음 계층을 기준으로 한다.

```
User
├─ Settings
├─ Character
│  ├─ Lorebook
│  ├─ Script
│  └─ CharJS
├─ Persona
├─ Preset
├─ Module
│  ├─ Lorebook
│  ├─ Script
│  └─ CharJS
├─ Plugin
└─ Room
   └─ Chat
      └─ Message
```

### 2-1. 소유 관계 (`=>`)

소유 관계는 부모 삭제 시 자식을 함께 삭제한다. 로컬 DB에서는 고볼륨 자식만 인덱스로 찾고, 소량 자식 목록은 부모 JSON 내부의 `EntityListConfig`로 관리한다.

```
RoomRecord      { ..., data: { chats: EntityListConfig, characters: ResourceRef map } }
ChatRecord      { ..., roomId: string, data: { personas: ResourceRef map, lorebooks: EntityListConfig } }
MessageRecord   { ..., chatId: string, sortOrder: string }
LorebookRecord  { ..., ownerId: string }
ScriptRecord    { ..., ownerId: string }
CharJSRecord    { ..., ownerId: string }
```

- `Room => Chat`: `chats.roomId` 로컬 인덱스로 빠르게 조회한다. 동시에 `room.chats`는 UI 순서/폴더를 소유한다.
- `Chat => Message`: 메시지는 고볼륨 데이터이므로 `messages.[chatId+sortOrder]` 인덱스를 사용한다. `chat.messages` 같은 대형 ref 목록은 만들지 않는다.
- `Character/Chat/Module => Lorebook/Script/CharJS`: 자원은 부모별 deep copy이며 `ownerId`로 cascade delete한다.
- `Settings => Character/Persona/Preset/Module/Plugin`: 최상위 개인 자원은 `settings`의 `EntityListConfig`가 목록 순서와 폴더를 소유한다.

### 2-2. 약한 참조 (`->`)

참조 관계는 대상 삭제 시 cascade하지 않는다. 참조자는 ID와 순서/활성화 상태만 들고, 대상이 없으면 진입 시 조용히 정리하거나 실행에서 제외한다.

```typescript
// RoomFields
{
  characters: {
    refs: {
      "char_alpha": { id: "char_alpha", sortOrder: "a0", enabled: true },
      "char_beta":  { id: "char_beta",  sortOrder: "a1", enabled: false }
    },
    folders: {}
  }
}

// ChatFields
{
  personas: {
    refs: {
      "persona_main": { id: "persona_main", sortOrder: "a0", enabled: true }
    },
    folders: {}
  },
  defaultCharacterId: "char_alpha",
  selectedCharacterId: "char_beta",
  defaultPersonaId: "persona_main",
  selectedPersonaId: "persona_main"
}
```

- `Room -> Character`: 방에 들어온 캐릭터 목록. 캐릭터 레코드는 유저 전역 자원이며 방은 참조만 보유한다.
- `Chat -> Persona`: 채팅별 유저 참가자 목록. 전역 active persona는 없다.
- `Character/Preset/Room/Chat -> Module`: 모듈은 실행 컨텍스트별로 켜고 끄는 공유 자원이다.
- `MessageSwipe -> Persona/Character`: `speakerId`와 `speakerName`만 저장한다. 이 참조는 정리하지 않는다. 대상이 삭제되어도 과거 메시지는 `speakerName`으로 표시하고 기본 아바타로 degrade한다.

---

## 3. 참조 무결성: 느슨한 결합 (Loose Coupling)

E2EE + 로컬 퍼스트 환경에서는 서버 RDB의 `FOREIGN KEY ... ON DELETE CASCADE`에 의존하지 않는다. 대신 **Graceful Degradation (관대한 실패 처리)** 전략을 따른다.

### 원칙

- 소유 관계는 서비스 레이어가 명시적으로 cascade soft-delete한다.
- 약한 참조는 대상 삭제 시 참조자들을 전역 스캔하지 않는다.
- 삭제된 참조를 만나면 **조용히 무시(Skip)**하고, 진입 시점에 필요한 범위만 정리한다 **(Self-Healing)**.
- 메시지의 `speakerId/speakerName`은 히스토리 보존 정보이므로 stale cleanup 대상이 아니다.

### Self-Healing 지점

| 진입점 | 정리 대상 |
|---|---|
| `selectRoom(roomId)` | `room.characters`, `room.chats` stale refs |
| `selectChat(chatId)` | `chat.personas`, `selected/default persona`, `selected/default character` stale/disabled refs |
| `removeRoomCharacter` / `setRoomCharacterEnabled(false)` | active chat의 selected/default character |
| `removeChatPersona` / `setChatPersonaEnabled(false)` | selected/default persona |

### 이유

- 삭제 시점에 모든 참조자를 일괄 로드 → 수정 → 서버 재동기화하는 것은 성능적으로 재앙적이다.
- 고아 참조(Orphaned Reference)는 기능적 오류를 일으키지 않으며, 자연스럽게 정리된다.
- 메시지 히스토리는 당시의 화자 이름을 보존해야 하므로, 참조 정리보다 표시 안정성이 우선이다.

---

## 4. 런타임 선택과 컨텍스트 정책

현재 선택된 캐릭터/페르소나는 채팅 레코드에 저장된다.

- `selectedPersonaId`: 유저 메시지를 보낼 페르소나.
- `defaultPersonaId`: 표시/템플릿의 기본 유저 컨텍스트.
- `selectedCharacterId`: 다음 AI 응답을 생성할 캐릭터.
- `defaultCharacterId`: input/display 템플릿과 speaker-less 컨텍스트의 기본 캐릭터.

`runChat(chatId)`은 별도 `characterId` 인자를 받지 않는다. 내부에서 `chat.selectedCharacterId ?? chat.defaultCharacterId`와 `chat.selectedPersonaId ?? chat.defaultPersonaId`를 해석하고, 둘 중 하나라도 없거나 비활성 ref면 `INVALID_INPUT`으로 실패한다.

파이프라인/템플릿/프롬프트는 **가장 구체적인 컨텍스트**를 사용한다.

| 범위 | 캐릭터 컨텍스트 | 페르소나 컨텍스트 |
|---|---|---|
| 유저 input pipeline/template | `defaultCharacterId` | `selectedPersonaId` |
| AI response / prompt / output | `selectedCharacterId ?? defaultCharacterId` | `selectedPersonaId ?? defaultPersonaId` |
| assistant message display | active swipe `speakerId`가 있으면 그 캐릭터, 없으면 `defaultCharacterId` | `defaultPersonaId` |
| user message display | `defaultCharacterId` | active swipe `speakerId`가 있으면 그 페르소나, 없으면 `defaultPersonaId` |
| history block | 각 메시지 active swipe의 `role + speakerId + speakerName`으로 message context 주입 |

이 정책 덕분에 `{{char}}`, `{{user}}`, `{{description}}`, `{{userdescription}}`, `{{speaker}}`, `{{speakername}}`, `{{speakerid}}` 같은 템플릿 매크로는 실행 범위에 맞는 가장 좁은 context를 기준으로 해석된다.

---

## 5. 변수와 Greeting

### 변수

변수는 채팅 레코드가 아니라 **메시지 active swipe**에 저장된다.

- `getChatDefaultVariables(chatId)`: room의 enabled character refs를 `sortOrder` 순서로 읽고 각 캐릭터의 `defaultVariables`를 merge한다.
- `getChatVariables(chatId)`: default variables + 마지막 메시지 active swipe variables.
- `getChatVariablesBefore(chatId, sortOrder)`: default variables + 해당 sortOrder 이전 메시지 active swipe variables.
- 새 swipe 생성은 `prepareNextSwipe(message, { variables, speakerId, speakerName })`를 통해 수행한다.

캐릭터 기본 변수는 "채팅 초기 시드"이며, 채팅별 기본 변수 필드는 따로 두지 않는다.

### Greeting

Greeting은 채팅당 하나의 assistant message로 동기화한다.

- `chat.greetingMessageId`가 greeting message를 가리킨다.
- 각 캐릭터 greeting은 같은 message 안의 swipe로 들어간다.
- greeting swipe id는 character greeting id를 그대로 사용한다.
- swipe에는 `speakerId`, `speakerName`, `variables`를 함께 저장한다.
- 방의 enabled character만 greeting sync 대상이다.

---

## 6. 엔티티 목록

| 엔티티 | 테이블 | 로컬 인덱스 | JSON 내부 소유/참조 |
|---|---|---|---|
| **User** | `users` | — | — |
| **Settings** | `settings` | — | `characters`, `personas`, `presets`, `modules`, `plugins` |
| **Room** | `rooms` | — | `chats`(OrderedRef), `characters`(ResourceRef) |
| **Character** | `characters` | — | `lorebooks`, `scripts`, `charjs`, `modules` |
| **Chat** | `chats` | `roomId` | `lorebooks`, `personas`, `selected/default persona/character ids` |
| **Message** | `messages` | `chatId`, `[chatId+sortOrder]` | `swipes`, `activeSwipeId` |
| **Persona** | `personas` | — | 에셋/설정 |
| **Lorebook** | `lorebooks` | `ownerId` | `entries` |
| **Script** | `scripts` | `ownerId` | `rules` |
| **CharJS** | `charjs` | `ownerId` | `code` |
| **Module** | `modules` | — | `lorebooks`, `scripts`, `charjs` |
| **Plugin** | `plugins` | — | hooks 및 args |
| **Prompt Preset** | `presets` | — | prompt blocks, model config, preset-owned scripts |
| **Translation** | `translations` | `chatId`, `messageId`, `swipeId` | 번역 payload |
| **Tool Call** | local only | `chatId`, `messageId`, `swipeId` | tool call state |

---

## 7. 한 줄 요약

```
로컬에는 "찾기 위한 최소한의 키"만 인덱스로 노출하고,
서버에는 "무엇을 어떻게 쓰는지"를 전부 암호화된 Blob 안에 숨긴다.
룸은 캐릭터를 참조하고, 채팅은 페르소나를 참조하며,
메시지는 당시의 화자 정보를 swipe에 남긴다.
```
