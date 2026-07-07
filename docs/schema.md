# KeiAI 데이터 스키마 설계 철학

> Local-first + E2EE + 멀티 캐릭터/페르소나 + 멀티룸을 위한 현재 canonical 데이터 모델

---

## 1. 핵심 원칙

KeiAI의 로컬 DB와 서버 DB는 같은 모양을 목표로 하지 않는다.

- **로컬 DB**는 앱이 빠르게 실행하기 좋은 도메인 테이블 구조를 유지한다.
- **서버 DB**는 내용을 모르는 blind sync store로 동작한다.
- 로컬에서는 평문 도메인 JSON을 저장하고, 서버로 나갈 때 sync engine이 암호화한다.
- 서버는 컨텐츠 payload를 해석하지 않고, 권한/동기화/에셋 accounting에 필요한 최소 필드만 평문으로 본다.

이 분리는 의도적이다.

```
Service -> Local Adapter (plaintext domain tables)
        -> Sync Engine (scope routing + encryption)
        -> PocketBase (opaque encrypted records)
```

### Workflow File namespaces

Workflow files are synchronized string resources stored in the `files` table. A file address and
its encryption/sync ownership are separate concepts.

```text
address:    namespace + namespaceId + path
data scope: scopeType + scopeId
```

- `global`: `namespaceId=userId`, always user-scoped.
- `room`: `namespaceId=roomId`, inheriting the room record's user/room data scope.
- `chat`: `namespaceId=chatId`, inheriting the chat record's user/room data scope.

`FileRecord.ownerId` stores `namespaceId`; `namespace`, `path`, and string `content` live in the
encrypted domain payload. Room/chat file records cascade when their namespace owner is deleted.

---

## 2. Scope 기반 로컬 레코드

모든 동기화 대상 로컬 레코드는 같은 기본 메타데이터를 가진다.

```typescript
export type DataScopeType = 'user' | 'room';

export interface DataScope {
    scopeType: DataScopeType;
    scopeId: string; // userId or roomId
}

export interface DataRecord extends DataScope {
    id: string;
    createdAt: number;
    updatedAt: number;
    isDeleted: boolean;
    assetEntries?: AssetEntries;
    data: Record<string, unknown>;
}
```

- `scopeType='user'`: 개인 금고. `scopeId=userId`.
- `scopeType='room'`: 멀티룸 공유 금고. `scopeId=roomId`.
- 모든 동기화 대상 레코드는 `DataRecord` 구조를 따른다.
- 로컬 DB는 모든 레코드를 plaintext JSON으로 저장한다.
- `assetEntries`: 레코드가 소유한 에셋 해시 목록.
- `data`: 도메인별 필드들이 담긴 JSON 객체.

---

## 3. 로컬 도메인 테이블

로컬은 도메인별 테이블을 유지한다. 모든 테이블은 `DataRecord` 기반이다.

| 테이블 | 역할 | 주요 인덱스/필드 |
|---|---|---|
| `settings` | 개인 설정과 최상위 목록 | scope |
| `rooms` | 개인 room 또는 멀티룸 room record | scope |
| `characters` | 캐릭터 | scope |
| `personas` | 페르소나 | scope |
| `chats` | room에 속한 채팅 | scope, `roomId` |
| `messages` | chat에 속한 메시지 | scope, `chatId`, `[chatId+sortOrder]` |
| `lorebooks` | owner가 소유하는 로어북 | scope, `ownerId` |
| `scripts` | owner가 소유하는 스크립트 | scope, `ownerId` |
| `charjs` | owner가 소유하는 CharJS | scope, `ownerId` |
| `modules` | 개인 모듈 | user scope |
| `presets` | 개인 프리셋 | user scope |
| `plugins` | 개인 플러그인 | user scope |
| `translations` | 메시지/스와이프 번역 | scope, `chatId`, `messageId`, `swipeId` |
| `files` | Workflow string 파일 | scope, `ownerId` |
| `tool_calls` | 로컬 tool call 상태 | local only |

멀티룸에서도 모듈/프리셋/플러그인은 기본적으로 개인 설정을 사용한다. 멀티룸에 공유되는 컨텐츠는 room scope의 room/chat/message/character/persona/lorebook/script/charjs/asset 계열이다.

---

## 4. 개인 모델과 멀티룸 모델

개인 모드는 전역 자원을 room/chat이 약하게 참조한다.

```
User
├─ Settings
├─ Character
├─ Persona
├─ Module / Preset / Plugin
└─ Room
   ├─ Room -> Character refs
   └─ Chat
      ├─ Chat -> Persona refs
      └─ Message
```

멀티룸 모드는 room이 공유 컨텐츠의 보안 경계다.

```
User Session
└─ opened Multi Room Session
   ├─ Room key
   ├─ Room scoped Character / Persona
   ├─ Room scoped Chat / Message
   ├─ Room scoped Lorebook / Script / CharJS
   └─ Room scoped Asset
```

개인 캐릭터/페르소나를 멀티룸에 올릴 때는 약한 참조가 아니라 **snapshot import**를 한다. 즉 원본 개인 레코드를 복사해 새 room scope 레코드로 만든다. 이후 개인 원본과 멀티룸 사본은 독립적으로 수정된다.

---

## 5. 소유와 참조

### 소유 관계

소유 관계는 부모 삭제 시 서비스 레이어가 자식을 cascade soft-delete한다.

| 관계 | 표현 |
|---|---|
| Room => Chat | `ChatRecord.roomId`, `RoomFields.chats` |
| Chat => Message | `MessageRecord.chatId`, `[chatId+sortOrder]` |
| Character => Lorebook/Script/CharJS | child `ownerId=characterId` |
| Chat => Lorebook | child `ownerId=chatId` |
| Module => Lorebook/Script/CharJS | child `ownerId=moduleId` |

고볼륨 자식은 인덱스로 찾고, UI 순서/폴더는 부모 JSON의 `EntityListConfig`가 가진다.

### 약한 참조

약한 참조는 대상 삭제 시 cascade하지 않는다. 참조자는 id, sortOrder, enabled 정도만 들고, 대상이 없으면 진입 시 정리하거나 실행에서 제외한다.

| 참조 | 의미 |
|---|---|
| `Room -> Character` | 방에 참여한 캐릭터 목록 |
| `Chat -> Persona` | 채팅별 유저 페르소나 목록 |
| `Character/Preset/Room/Chat -> Module` | 실행 컨텍스트별 모듈 활성화 |
| `MessageSwipe -> speakerId/speakerName` | 당시 화자 히스토리 |

`MessageSwipe.speakerId`는 정리하지 않는다. 대상 캐릭터/페르소나가 삭제되어도 메시지는 `speakerName`으로 표시하고 아바타만 기본값으로 degrade한다.

---

## 6. Room 중심 채팅 모델

현재 개인 채팅 모델은 `User -> Character -> Chat -> Message`가 아니라 `User -> Room -> Chat -> Message`다.

`RoomFields`:

```typescript
{
    chats: EntityListConfig<OrderedRef>;
    characters: EntityListConfig<ResourceRef>;
}
```

`ChatFields`:

```typescript
{
    personas: EntityListConfig<ResourceRef>;
    lorebooks: EntityListConfig<OrderedRef>;
    defaultCharacterId?: string;
    selectedCharacterId?: string;
    defaultPersonaId?: string;
    selectedPersonaId?: string;
    greetingMessageId?: string;
}
```

`MessageSwipe`:

```typescript
{
    id: string;
    content: string;
    speakerId?: string;
    speakerName?: string;
    variables?: Record<string, string>;
}
```

- `role='user'`이면 `speakerId`는 persona id로 해석한다.
- `role='assistant'`이면 `speakerId`는 character id로 해석한다.
- 별도 `speakerKind`는 두지 않는다. role이 이미 그 의미를 가진다.

---

## 7. 런타임 선택과 컨텍스트 정책

현재 선택된 페르소나/캐릭터는 채팅 레코드에 저장된다.

- `selectedPersonaId`: 유저 메시지를 보낼 페르소나.
- `defaultPersonaId`: 표시/템플릿의 기본 유저 컨텍스트.
- `selectedCharacterId`: 다음 AI 응답을 생성할 캐릭터.
- `defaultCharacterId`: input/display 템플릿과 speaker-less 컨텍스트의 기본 캐릭터.

`runChat(chatId)`은 별도 `characterId` 인자를 받지 않는다. 내부에서 selected/default ids를 해석하고, 필요한 값이 없거나 disabled ref이면 실패한다.

파이프라인/템플릿/프롬프트는 **범위에서 가장 구체적인 컨텍스트**를 사용한다.

| 범위 | 캐릭터 컨텍스트 | 페르소나 컨텍스트 |
|---|---|---|
| user input pipeline/template | `defaultCharacterId` | `selectedPersonaId` |
| runChat / prompt / output | `selectedCharacterId ?? defaultCharacterId` | `selectedPersonaId ?? defaultPersonaId` |
| assistant message display | active swipe `speakerId`, 없으면 `defaultCharacterId` | `defaultPersonaId` |
| user message display | `defaultCharacterId` | active swipe `speakerId`, 없으면 `defaultPersonaId` |
| history block | 각 메시지 active swipe의 `role + speakerId + speakerName`으로 context 주입 | 동일 |

이 정책 때문에 `{{char}}`, `{{user}}`, `{{description}}`, `{{userdescription}}`, `{{name}}`, `{{speaker}}`, `{{speakername}}`, `{{speakerid}}`, `{{slot}}`은 호출 범위의 context를 기준으로 해석된다.

---

## 8. 변수와 Greeting

### 변수

변수는 채팅 레코드가 아니라 message swipe에 저장된다.

- `getChatDefaultVariables(chatId)`: room enabled character들의 `defaultVariables`를 sortOrder 순서로 merge한다.
- `getChatVariables(chatId)`: default variables + 마지막 active swipe variables.
- `getChatVariablesBefore(chatId, sortOrder)`: default variables + 해당 sortOrder 이전 active swipe variables.
- `prepareNextSwipe(message, variables, replace, speakerId?, speakerName?)`가 다음 active swipe를 만든다.

캐릭터 기본 변수는 채팅 초기 시드다. 별도 `chatDefaultVariables` 필드는 두지 않는다.

### Greeting

Greeting은 채팅당 하나의 assistant message로 동기화한다.

- `chat.greetingMessageId`가 greeting message를 가리킨다.
- 각 캐릭터 greeting은 같은 message 안의 swipe로 들어간다.
- greeting swipe id는 character greeting id를 그대로 사용한다.
- swipe에는 `speakerId`, `speakerName`, `variables`를 함께 저장한다.
- room enabled character만 greeting sync 대상이다.

---

## 9. 서버 동기화 스키마

서버는 로컬 도메인 테이블을 그대로 복제하지 않는다.

### 개인 컨텐츠

`records`

| 필드 | 설명 |
|---|---|
| `id` | 로컬 record id |
| `userId` | owner user id |
| `kind` | 로컬 테이블 이름 |
| `createdAt`, `updatedAt`, `isDeleted` | sync metadata |
| `encryptedData`, `encryptedDataIV` | master key로 암호화된 도메인 payload |

### 멀티룸 컨텐츠

`multi_room_records`

| 필드 | 설명 |
|---|---|
| `id` | 로컬 record id |
| `roomId` | room scope id |
| `kind` | 로컬 테이블 이름 |
| `createdAt`, `updatedAt`, `isDeleted` | sync metadata |
| `encryptedData`, `encryptedDataIV` | room key로 암호화된 도메인 payload |

### 멀티룸 메타

`multi_room_index`

| 필드 | 설명 |
|---|---|
| `id` | room id |
| `ownerUserId` | 방장 user id |
| `visibility` | `public` 또는 `private` |
| `publicName` | 공개 검색용 이름 |
| `createdAt`, `updatedAt`, `isDeleted` | metadata |

`multi_room_members`

| 필드 | 설명 |
|---|---|
| `id` | membership id |
| `roomId` | room id |
| `userId` | member user id |
| `status` | `pending`, `accepted`, `revoked` |
| `encryptedRoomKey` | member identity public key로 감싼 room key |
| `createdAt`, `updatedAt`, `isDeleted` | metadata |

`multi_room_index`와 `multi_room_members`는 컨텐츠가 아니라 디렉터리/권한/키 교환 메타다. room payload는 들어가지 않는다.

---

## 10. Sync Routing

Data sync는 scope를 기준으로 서버 collection과 암호화 키를 고른다.

| 로컬 scope | 서버 collection | 키 |
|---|---|---|
| `user` | `records` | user master key |
| `room` | `multi_room_records` | room key |

Asset sync도 같은 routing을 사용한다.

| 로컬 scope | 서버 collection | 키 |
|---|---|---|
| `user` | `assets` | user master key |
| `room` | `multi_room_assets` | room key |

Cursor는 scope별로 둔다.

```
lastSync_records_user_${userId}
lastSync_records_room_${roomId}
lastSync_assets_user_${userId}
lastSync_assets_room_${roomId}
lastSync_multi_meta_${userId}
```

active user session이 있으면 user scope를 동기화한다. active room session이 있으면 room scope도 추가로 동기화한다.

---

## 11. 참조 무결성과 Self-Healing

E2EE + local-first 환경에서는 서버 FK cascade에 기대지 않는다.

- 소유 관계는 서비스 레이어가 명시적으로 cascade soft-delete한다.
- 약한 참조는 삭제 시 전역 스캔하지 않는다.
- stale ref는 진입 시 필요한 범위에서 조용히 정리한다.
- 메시지 speaker 정보는 히스토리이므로 정리하지 않는다.

| 진입점 | 정리 대상 |
|---|---|
| `selectRoom(roomId)` | room stale character/chat refs |
| `selectChat(chatId)` | chat stale/disabled persona refs, selected/default ids |
| character/persona ref disable/remove | 관련 selected/default ids |

---

## 12. 한 줄 요약

```
로컬은 실행하기 좋은 도메인 DB,
서버는 동기화하기 좋은 blind encrypted store,
둘 사이의 번역은 sync engine이 담당한다.
```
