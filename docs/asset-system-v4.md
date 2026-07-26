# KeiAI Asset System V4

Asset System V4는 V3의 synced asset record 폭증 문제를 해결하기 위한 설계다. V3에서는 모든 에셋을 동기화 가능한 UUID 레코드로 저장했다. 이 방식은 `assetId` 하나로 접근하기 쉬웠지만, 에셋이 추가될 때마다 삭제 후에도 soft delete/tombstone 대상 레코드가 계속 남았다. 캐릭터 import, 이미지 생성, 채팅 inlay 업로드처럼 에셋 생성이 쉬운 경로에서는 이 문제가 빠르게 커진다.

V4의 핵심은 다음과 같다.

```text
에셋 참조의 진실은 부모 레코드 안에 둔다.
서버와 sync가 필요한 최소 manifest만 assetEntries로 노출한다.
로컬 registry는 캐시와 binary sync를 위한 파생 인덱스로만 사용한다.
```

## 설계 배경

처음에는 hash 기반 에셋 레코드와 refCount를 검토했다. 하지만 refCount는 분산 시스템에서 애매하다. 같은 owner가 오프라인 기기 A와 B에서 같은 에셋을 삭제하면 두 번 decrement될 수 있고, PN-counter를 써도 "무엇을 삭제했는가"가 표현되지 않는다.

hash별 owner set도 검토했다. 이 방식은 refCount보다 낫지만 owner set이 결국 파생 인덱스가 된다. owner set에 `character:123`이 있어도 그 캐릭터가 현재 hash를 실제로 live 참조하는지는 캐릭터 레코드의 `avatar`, `assets`, `inlays`를 다시 봐야 한다. add/remove merge, stale owner, hot row 문제도 남는다.

owner별 manifest table도 생각했다. 하지만 owner마다 manifest row가 하나씩 생기면 source of truth가 부모 레코드와 manifest row 두 곳으로 나뉜다. 어차피 owner의 에셋 목록은 부모 레코드가 알고 있으므로, manifest를 부모 레코드 안으로 넣는 쪽이 더 단순하다.

## 데이터 모델

부모 레코드는 sync-visible top-level field로 `assetEntries`를 가진다.

```ts
export type AssetEntries = Record<string, "local" | "remote">;
```

이 필드는 encrypted `data` payload 밖에 있다. 서버는 도메인 plaintext를 보지 않지만, hash와 status만 보고 usage accounting을 할 수 있다.

실제 참조 정보는 부모 도메인 필드에 있다.

```ts
interface AssetFields {
  name: string;
  hash: string;
  encKey: string;
  mimeType: string;
}

interface AssetRef extends OrderedRef, AssetFields {}
```

예시는 다음과 같다.

```ts
character.avatar?: AssetFields;
character.assets: EntityListConfig<AssetRef>;
chat.inlays: EntityListConfig<AssetRef>;
message.attachments?: string[]; // chat.inlays ref id 목록
```

`AssetRef.id`는 전역 asset id가 아니다. `EntityListConfig` 안에서 쓰는 레이아웃/참조 id다. 실제 바이너리 식별자는 `hash`이고, 복호화에는 `encKey`를 쓴다.

## Local Registry

로컬 registry는 source of truth가 아니라 캐시, render URL, eviction, binary sync 대상 조회를 위한 인덱스다.

```ts
interface AssetRegistryRecord {
  id: string; // `${scopeType}:${scopeId}:${ownerTable}:${ownerId}:${hash}`
  scopeType: DataScopeType;
  scopeId: string;
  ownerTable: TableName;
  ownerId: string;
  hash: string;
  encKey: string;
  status: "local" | "remote";
  size: number;
  accessedAt: number;
}
```

registry를 hash unique하게 두면 status reconcile과 cascade delete 때 같은 hash를 가진 모든 owner를 찾아야 한다. 그래서 로컬 dedup 일부를 포기하고 `scope + owner + hash`를 identifier로 둔다. 이러면 owner 삭제 시 해당 owner의 registry/storage를 지우면 되고, scope 삭제 시 해당 scope만 지우면 된다.

## Service Layer

에셋을 추가/삭제하는 책임은 content domain service에 있다. 캐릭터, 페르소나, 모듈, 채팅 서비스가 자기 레코드의 에셋 목록을 알고 있으므로 이 레이어가 `assetEntries`를 집계한다.

에셋 추가는 다음 흐름이다.

```text
File 입력
-> AssetService.write()
-> local registry/storage 생성
-> AssetFields 반환
-> 부모 refs/avatar/inlays 갱신
-> assetEntries에 hash 추가
```

light import처럼 `AssetFields`만 들어오는 경로는 파일이 없으므로 부모 manifest에 remote 참조만 기록한다.

create 경로에서 기존 `assetEntries[hash]`가 있으면 status를 바꾸지 않는다. 기존 값이 `remote`이면 서버가 이미 보유한 상태일 수 있으므로 존중하고, 기존 값이 `local`이면 새 light/remote 정보를 신뢰해 `remote`로 올리지 않는다. 잘못 evict하면 로컬에만 있던 바이너리를 잃을 수 있기 때문이다.

삭제 경로에서는 삭제 후 부모 레코드가 더 이상 해당 hash를 참조하지 않으면 `assetEntries`에서 제거하고, 해당 owner/hash의 registry/storage도 삭제한다.

## Sync And Server

V4에는 별도 asset metadata sync가 없다. Data sync engine이 부모 레코드와 함께 `assetEntries`를 동기화하고, Asset sync engine은 binary upload만 담당한다.

Data sync는 remote record를 적용할 때 `assetEntries` 변화를 보고 local registry를 reconcile 한다.

```text
새 hash 등장       -> owner/hash registry 보정
hash 사라짐       -> owner/hash registry 삭제
status 변경       -> registry status 갱신
```

Asset sync는 registry에서 `local` asset을 찾아 ciphertext를 업로드한다. 업로드 성공 후 `markRemote()`로 registry와 부모 `assetEntries[hash] = 'remote'`를 맞춘다.

서버 hook은 `records` / `multi_room_records`의 `assetEntries` diff를 계산한다.

```text
remote hash 추가 -> asset_usage +1
remote hash 제거 -> asset_usage -1
local hash       -> usage 대상 아님
```

metadata sync는 바이너리가 없다고 거부하지 않는다. 바이너리 업로드 경로에서만 hash 검증과 quota 검사를 한다. catalog가 아직 없는 remote hash는 usage size 0으로 남고, 바이너리가 업로드되어 `asset_catalog`가 생기면 pending usage를 lazy reconcile 한다. 멀티룸 에셋은 room owner가 비용을 낸다.

현재 chat-owned asset(inlay)은 binary upload와 서버 usage 집계에서 제외한다. Inlay sync는 서버 dedup 효율이 낮으므로, 추후 paid feature로 별도 설정을 통해 열 수 있다.

## Inlay

V4에서 inlay는 chat-owned asset이다. 모델 이미지 생성, 사용자 업로드, 스크립트 생성 등 inlay 생성 경로의 가장 안정적인 context가 chat이기 때문이다.

메시지는 inlay payload를 직접 소유하지 않고 chat inlay ref id만 참조한다.

```ts
chat.inlays: EntityListConfig<AssetRef>;
message.attachments?: string[];
```

이 결정으로 inlay의 cascade delete 기준이 닫힌다. chat 삭제 시 `deleteOwnerAssets(chat)`로 해당 chat의 inlay registry/storage를 정리할 수 있다.

## Render And Macros

렌더링은 `AssetReadLocator`로 닫힌다.

```ts
type AssetReadLocator = AssetLocator & { encKey: string };
```

resource asset은 이름으로 접근한다.

```text
{{img::name}}
{{asset::name}}
{{raw::name}}
{{path::name}}
{{bg::name}}
```

이름 macro는 렌더 context의 owner별 asset index를 통해 `AssetReadLocator`로 해석된다.

inlay는 chat-local id로 접근한다.

```text
{{inlay::inlayRefId}}
```

이 macro는 `chat.inlays.refs[inlayRefId]`를 찾아 locator를 구성한다. inlay id는 전역 asset id가 아니라 해당 chat 안의 ref id다.

`AssetView`와 hydrate 경로도 locator를 받아 `AssetService.read(locator)`를 호출한다. 로컬 캐시에 없으면 서버에서 ciphertext를 fetch하고, `encKey`로 복호화한 뒤 remote registry/storage에 저장하고 render URL을 반환한다.

## Porter

Porter도 전역 asset id를 버린다.

```ts
interface KeiAssetPayload {
  data?: Uint8Array;
  hash?: string;
  encKey?: string;
}
```

패키지의 일반 assets는 `Record<layoutId, KeiAssetPayload>` 형태이고, avatar는 별도 payload로 둔다.

```text
baked export -> data + hash + encKey
light export -> hash + encKey
```

import 시 baked payload는 `File`로 materialize되어 `AssetService.write()`를 탄다. 따라서 로컬 바이너리와 registry가 새로 생기고, image preprocess도 이 경로에서 수행된다. light payload는 파일이 없으므로 `AssetFields`로 들어와 remote 참조로 기록된다.

## Multimedia Extension

Asset V4의 바이너리 저장 계약은 이미지에 한정되지 않는다. `AssetFields.mimeType`을
canonical media discriminator로 사용하며, 런타임에서는 MIME top-level type을
`image | audio | video | other`로 분류한다. 별도의 동기화 필드나 서버가 읽어야 하는
media type은 추가하지 않는다.

- 이미지: PNG/JPEG는 기존처럼 WebP 전처리를 적용하고, WebP/GIF는 원본 바이트를 유지한다.
- 오디오/비디오: 원본 바이트와 MIME type을 유지한다.
- 이름 기반 매크로: `asset`, `media`, `img`, `image`, `audio`, `video`는 실제 MIME type에
  따라 `<img>`, `<audio controls>`, `<video controls>` 중 하나를 렌더한다.
- inlay 매크로: `{{inlay::refId}}`도 같은 MIME 기반 렌더링 규칙을 사용한다.
- 앱의 에셋 목록은 공용 `MediaGalleryDialog`를 사용한다. 선택한 항목을 크게 표시하고
  이전/다음 버튼, 좌우 방향키, 하단 썸네일 목록으로 같은 owner context의 에셋을 탐색한다.
- 채팅 프롬프트: attachment를 provider-neutral `image | audio | video` content part로
  구성한다.
- 모델 capability: `image_input`, `audio_input`, `video_input`을 독립적으로 광고한다.
  지원하지 않는 part는 provider handler 호출 전에 명시적인 text marker로 변환한다.
- Provider mapping:
  - OpenAI-compatible: `image_url`, `input_audio`, `video_url`
  - Google: `inlineData`
  - Anthropic: image block만 직렬화하며 audio/video는 capability에서 unsupported로 둔다.

`mimeType`이 없는 구형 resource locator는 표시 호환성을 위해 image로 간주한다. 반면
프롬프트 첨부는 실제 `AssetRef.mimeType`이 image/audio/video로 분류되는 경우에만 포함해
알 수 없는 바이너리가 모델 요청으로 전달되지 않도록 한다.

## Tradeoffs

V4의 가장 큰 단점은 read identifier가 길다는 것이다.

```text
scopeType, scopeId, ownerTable, ownerId, hash, encKey
```

하지만 이 값들은 모두 부모 레코드가 이미 가지고 있다. 그래서 UI/render 코드가 조금 길어지더라도 별도 asset row를 조회하거나 전역 id를 추적하지 않아도 된다.

또 다른 tradeoff는 로컬 registry/storage의 hash dedup을 일부 포기한다는 점이다. 대신 owner 단위 lifecycle, status reconcile, cascade delete, inlay sync 정책이 단순해진다.
