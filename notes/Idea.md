🏛️ E2EE + BYOK AI 채팅 앱 핵심 아키텍처 설계도 (Local-First 기반)

1. 로컬-퍼스트 (Local-First) 및 게스트 모드 아키텍처

- 오프라인 우선 진행: 앱을 켜면 서버 연결 여부와 상관없이 먼저 'Guest ID'와 메모리용 '마스터 키(M)'를 로컬에서 즉시 발급 (IndexedDB 저장). 유저는 로그인 없이 즉각 앱 사용 가능.
- 서버 연동 (Link Account): 이후 유저가 가입(로그인)을 결심하면, 아래의 인증 흐름을 통해 그동안 게스트로 썼던 폰의 마스터 키 M을 서버용 패키지로 포장하여 서버에 업로드 연동함.
- 데이터 레이어 분리:
    1. Local DB (Storage Layer): Dexie(웹), Tauri DB 등 Adapter 패턴 적용. 무조건 AES-GCM으로 암호화된 Byte Array 형태로만 저장 및 조회.
    2. Svelte Store (In-Memory Layer): 평문 변환 및 처리를 담당. 3계층(Global, Active Character, Active Chat)으로 나뉘며 방을 벗어나면 평문은 Garbage Collect 됨.
    3. UI / Prompt Engine: 스토어에 복호화되어 있는 JSON 데이터를 자유롭게 조작(정규식, 삽입 등). 로컬 DB 조작은 의식하지 않음.

2. 키 생성 및 인증 (Authentication & Key Derivation)

- 기본 원칙: 유저의 비밀번호 하나로 서버 로그인(인증)과 클라이언트 암호화(복호화)를 완벽하게 분리.
- 회원가입 흐름 (Link Account):
    1. 클라이언트에서 무작위 솔트(Salt) 16바이트 생성.
    2. 비밀번호 + 솔트를 KDF(PBKDF2 등, 60만 번 반복)에 돌려 512비트 생성.
    3. 절반으로 쪼개어 **X (로그인용 신분증)**와 Y (금고 열쇠) 획득.
    4. 기존에 오프라인/게스트로 쓰던 마스터 키 M (AES-GCM)을 Y로 암호화하여 M(Y) 생성.
    5. 서버 DB 저장: 아이디, 솔트, X, M(Y) (서버는 비밀번호, Y, M을 절대 모름).

3. 세션 유지 및 클라이언트 보안 (Session & Client Security)

- API 로그인 상태 유지:
    - 매 요청마다 X를 보내지 않음.
    - [1차 통신] 이메일을 보내 salt 획득 -> [로컬 연산] X, Y 조립 -> [2차 통신] X를 보내 인증 토큰(JWT 등) 발급. 이후 통신은 이 토큰으로 처리.
    - 만약 다른 기기에서 로그인 시, 서버에서 받은 M(Y)를 Y로 풀어 M을 획득 후 로컬 DB의 기존 게스트 데이터들을 새 M으로 몽땅 재암호화(Merge) 진행.
- 마스터 키(M) 로컬 보관:
    - M을 raw bytes가 아닌 `CryptoKey` 객체 자체를 IndexedDB에 저장 (Structured Clone 활용).
    - XSS 공격자가 IndexedDB를 읽어도 opaque한 CryptoKey 핸들만 얻으며, `extractable: false`이면 `exportKey()`가 에러를 던져 raw bytes 탈취가 불가능.
    - extractable 여부는 유저의 계정 상태에 따라 달라지는 라이프사이클로 관리:
        - 게스트: `extractable: true` — 나중에 M(Y)를 만들 능력이 있어야 하므로 추출 가능.
        - 회원가입 직후: `login()` 흐름이 M을 `extractable: false`로 재임포트 → IndexedDB에 덮어씀 (lockMasterKey).
        - 비밀번호 변경: 로컬 CryptoKey(non-extractable)를 건드리지 않고, 서버의 M(Y)를 old 비밀번호로 언래핑해 raw M 획득 → 재래핑.
        - 계정 연결 해제(탈퇴/unlink): 서버 M(Y)에서 raw M을 획득한 뒤 로컬 CryptoKey를 `extractable: true`로 교체 (unlockMasterKey) → 게스트 상태로 복귀, 로컬 데이터는 그대로 유지.

4. 데이터 저장 메커니즘 (Data at Rest)

- 점진적 동기화 & 지연 로딩 (Progressive Sync / Lazy Load):
    - 무거운 복호화 및 DB 트래픽을 피하기 위해 모든 엔티티(캐릭터, 채팅)는 `Summary(요약)` 필드와 `Data(본문)` 필드로 쪼개어 각각 암호화.
    - 메인 화면에선 가벼운 Summary만 복호화해 렌더링. 특정 방에 진입할 때만 깊은 Data와 수백 개의 Messages를 복호화해 인메모리에 올림.
- 유저의 API 키 (BYOK):
    - 클라이언트가 마스터 키 M으로 암호화하여 DB에 전송. 개발자 서버 탈취 시에도 API 키는 안전함.
- 채팅 메시지 등 기타 데이터:
    - 모든 데이터는 스키마리스 JSON 형태로 묶어, M과 무작위 IV를 사용해 암호화(Ciphertext).
    - 서버 DB와 로컬 DB 모두 오직 암호문과 IV만 저장. 새 기능(프리셋, 로어북 등)을 추가할 때 테이블 스키마 변경 부담이 없음.

5. 백엔드 연동 및 동기화 전략 (PocketBase)

- 서버의 역할 (Blind Data Store):
    - 서버(PocketBase)는 데이터 내용(평문)을 전혀 모르는 단순 바이트 배열 창고 및 로그인 문지기로만 동작.
    - 보안이나 데이터 가공 로직을 서버에 둘 필요가 없어 개발 비용이 극단적으로 낮음.
- 커스텀 로그인 훅 (Authentication Flow):
    - 포켓베이스 내장 `authWithPassword`를 활용하되, 클라이언트에서 미리 "Salt"를 받아 파생키(X, Y)를 계산해야 함.
    - `GET /api/salt/:email`: 비밀번호 인증 없이 이메일로 Salt만 반환하는 커스텀 JS 훅 구축.
    - 받아온 Salt로 클라이언트에서 X를 계산 후, 진짜 비밀번호 대신 X를 전송해 포켓베이스를 속임(안전하게 E2EE 구현).
- 블라인드 동기화 춤 (Blind Sync Dance):
    - 로컬 DB와 포켓베이스 DB의 테이블 스키마는 동일(BaseRecord 형태).
    - [업로드/Push]: 오프라인에 쌓인 `lastSyncTime` 이후의 암호문 바이트 배열들을 서버에 그대로 Upsert.
    - [다운로드/Pull]: 타 기기에서 업로드된 서버의 최신 암호문들을 가져와 로컬 DB 덮어쓰기 (LWW: Last-Write-Wins 기반).
    - `Realtime Subscription` 웹소켓을 활용해 클라이언트 간 즉시 푸시/알림 가능.

6. 하이브리드 AI 프록싱 (API Routing)

- 토글 기능 지원 (유저 선택권 보장):
    - 직접 요청 (Direct): 클라이언트 ➡️ OpenAI/Claude. 개발자 서버를 아예 거치지 않는 궁극의 프라이버시 (CORS 에러 감수).
    - 프록시 요청 (Proxy): 클라이언트 ➡️ 엣지 프록시 ➡️ OpenAI/Claude.
- 프록시 서버 보안 원칙 (Stateless):
    - Vercel Edge Functions, Cloudflare Workers 등 인메모리 환경 사용.
    - DB 연결 없음, 로깅(console.log) 없음. 요청을 포워딩만 하고 메모리 즉시 소멸. 코드 오픈소스로 신뢰 확보.

7. 최악의 시나리오 대비 (계정 복구)

- 비상 복구키(Recovery Code) 발급:
    - 가입 시 16자리 무작위 문자열 발급 (유저가 직접 아날로그 보관).
    - 앞 8자리 (암호화용 Z): M을 잠가서 **M(Z)**로 서버에 보관.
    - 뒤 8자리 (인증 토큰): 단방향 해시로 서버에 저장.
- 비밀번호 분실 시 흐름:
    1. 이메일 인증으로 본인 확인.
    2. 유저가 복구키 전체 입력 ➡️ 인증 토큰(뒤 8자리)을 서버로 보내 API 업데이트 권한 획득.
    3. 클라이언트에서 앞 8자리로 M(Z)를 풀어 M 획득 (AES-GCM 무결성 검증 통과 시 성공).
    4. 새로운 비밀번호 입력 ➡️ 새로운 KDF(새 솔트, X, Y) 생성 ➡️ 기존 M을 새로운 Y로 묶어 서버 덮어쓰기. (과거 데이터 완벽 보존).

8. 데이터 스키마 설계 철학 (Schema Design Philosophy)

- 핵심 원칙: 평문에는 "찾기 위한 최소한의 키(FK)"만 노출하고, "무엇을 어떻게 쓰는지"는 전부 암호화된 Data Blob 안에 숨긴다. 메모리에는 관련된 것을 전부 올려두되, 실행은 활성화된 것만 한다.
- Summary / Data 분리:
    - 모든 엔티티의 암호화 Blob은 두 테이블로 나뉠 수 있음: Summary(목록용 최소 정보)와 Data(무거운 본문).
    - 두 테이블은 같은 id를 공유. Summary는 목록 화면 진입 시 일괄 로드, Data는 해당 엔티티를 열었을 때만 로드.
    - 분리 기준: "주요 네비게이션 목록이 있고 + Data가 무거운" 경우에만 적용. 나머지는 단일 EncryptedRecord로 간결하게.
    - 분리 적용 대상: 캐릭터, 채팅, 프롬프트 프리셋, 페르소나 (아바타 표시 + 수십 개 축적 가능).
    - 단일 테이블 대상: 로어북, 스크립트, 모듈, 플러그인, 설정.
- 부모-자식 관계에서의 원칙:
    - 부모 엔티티가 자식의 미리보기 데이터를 복사해서 들고 있으면 안 된다 (데이터 중복 방지).
    - 미리보기가 필요하면 항상 자식의 Summary 테이블을 쿼리.

9. 관계 패턴 (Relationship Patterns)

- 통일 원칙: "목록을 보여주는 쪽(부모)이 자식의 ID 리스트, 순서, 폴더 정보, 상태를 소유한다."
- 공유 타입:
    - OrderedRef: { id, sortOrder, folderId? } — 1:N 자식 참조용.
    - ResourceRef extends OrderedRef: { id, sortOrder, folderId?, enabled } — N:M 공유 자원 참조용.
    - FolderDef: { id, name, sortOrder, color?, parentId? } — 폴더 정의 (부모 Blob에 저장).
    - AssetEntry: { name, assetId } — 에셋 이름→ID 매핑 (엔티티별 매니페스트).
- 소유 관계 (1:N, Deep Copy):
    - 부모의 암호화 Blob에 OrderedRef[] 또는 ResourceRef[]로 자식 ID를 소유.
    - 삭제 시 cascade: 부모 삭제 → 소유 자식 일괄 soft-delete.
    - 대상: 로어북, 스크립트는 항상 부모가 소유 (공유 시 Deep Copy).
    - 소유 트리:
        - settings → 캐릭터, 모듈, 플러그인, 페르소나, 프리셋, 로어북, 스크립트
        - 캐릭터 → 채팅, 페르소나, 로어북, 스크립트, 모듈, 플러그인 등 하위 엔티티 관리 (실제 소유는 최상위 Settings 또는 독립적, 연결은 Refs)
        - 채팅 → (소유하는 하위 자원 없음. 관련된 로어북/스크립트는 채팅의 소유자(ownerId/characterId)를 따르거나, 채팅 자체의 ownerId를 가지도록 구조 변경됨. 현재는 characterId를 따라감)
        - 모듈 → 로어북, 스크립트
        - 페르소나 → 로어북, 스크립트, 모듈
    - 유일한 FK 예외: messages.chatId — 고볼륨 + createdAt 정렬 + softDeleteByIndex 벌크 삭제.
- 참조 관계 (N:M, Shared Reference):
    - 소비자의 암호화 Blob에 ResourceRef[]로 참조만 보유. 삭제 영향 없음.
    - enabled 플래그: 동일 자원이라도 컨텍스트마다 개별 ON/OFF.
    - 대상: 모듈, 플러그인, 페르소나, 프리셋.
    - 예: characterData.moduleRefs (참조), characterData.lorebookRefs (소유).
- 폴더 관리:
    - 자식의 소속 폴더: refs[].folderId로 표현.
    - 폴더 정의: 부모의 Blob에 FolderDef[] 배열 (이름, 색, 중첩 등). 매우 소량.
    - 예: settings.folders.characters, characterData.chatFolders.
- 참조 무결성: Loose Coupling.
    - E2EE 환경에서는 FOREIGN KEY ON DELETE CASCADE 불가능.
    - 참조 자원 삭제 시 참조자의 Blob 일괄 수정 불필요 → Graceful Degradation + Self-Healing.
    - DB에는 진실의 원천(Source of Truth)만 저장. 파생값 저장하지 않음.

10. 공유 자원 메모리 관리 (Reference Counting)

- 적용 대상: 로어북, 스크립트 등 여러 소스(캐릭터, 챗, 페르소나, 모듈)가 동시에 참조할 수 있는 N:M 공유 자원.
- 메모리 데이터 타입:
    - `Map<assetId, { data: T, enabled: boolean, refs: Set<sourceEntityId> }>` 형태.
    - data: 복호화된 실제 JSON 데이터.
    - enabled: 프롬프트 엔진이 실행할지 여부 (메모리 적재 여부와는 무관).
    - refs: 이 자원을 물고 있는 엔티티 ID 집합 (참조 카운팅).
- 라이프사이클:
    - 로드(Load): 소스 엔티티가 활성화되면, Data Blob 내 참조 ID들을 추출 → Map에 없으면 DB에서 복호화 적재, 있으면 refs.add(sourceId).
    - 토글(Toggle): entry.enabled = true/false (메모리 내 불리언 플립). DB 저장은 비동기.
    - 언로드(Unload): refs.delete(sourceId) → refs.size === 0이면 Map에서 완전 삭제.
- 핵심 원칙: 연결된 공유 자원은 전부 메모리에 올리되, 프롬프트 엔진은 enabled === true인 것만 실행한다.
    - 로어북/스크립트는 전부 텍스트(JSON)이므로 수천 개의 항목이라 해도 수 MB 수준 → 메모리 부담 무시.
    - 토글 시 DB 복호화 없이 즉시 반영 → UX 체감 속도 극대화.
    - 비활성화(enabled=false)된 자원도 메모리에 남아있으므로 UI에서 내용물 열람 가능.

11. 모듈 시스템 (Module System)

- 모듈의 정의: 로어북, 스크립트 등을 하나로 묶은 그룹 컨테이너. 모듈은 로어북/스크립트를 소유(Own)한다 (Deep Copy).
- DB 스키마: 단일 EncryptedRecord (modules 테이블).
- ModuleFields 내부 구조:
    - name, description.
    - lorebookRefs: ResourceRef[] (소유).
    - scriptRefs: ResourceRef[] (소유).
- 참조 방식: 모듈 자체는 N:M 공유 자원. 소비자의 Data Blob에 moduleRefs: ResourceRef[] (참조).
- 삭제 캐스케이드: 모듈 삭제 → 소유 로어북/스크립트 일괄 삭제.
- 이중 토글 (Two-Layer Toggle):
    - 소비자 레벨: moduleRefs에서 모듈 자체 ON/OFF.
    - 모듈 내부 레벨: 모듈 안의 개별 로어북/스크립트 ON/OFF.
    - 모듈이 OFF → 안의 자원들 통째로 프롬프트 엔진 스킵.
- 같은 자원이 직접 소유 + 모듈 소유로 중복되는 경우: 별개의 Deep Copy이므로 각각 독립.

12. 프롬프트 프리셋 (Prompt Presets)

- 정의: 프롬프트 조립 순서(Template), Jailbreak, Authors Note, 샘플링 파라미터 등을 묶은 설정 프리셋. RisuAI의 botPresets에 대응.
- DB 스키마: Summary + Data 분리 (promptPresetSummaries / promptPresetData).
    - 유저가 수십 개의 프리셋을 만들어 고를 수 있으므로 목록 네비게이션이 중요.
- 참조 방식: N:M 공유 자원. 소비자의 Data Blob에 promptPresetId: string으로 참조.
- PromptPresetDataFields 주요 내용:
    - templateOrder: 프롬프트 조립 순서 (system, jailbreak, description, lorebook, chat, memory 등).
    - authorsNote, jailbreakPrompt.
    - temperature, topP, topK, frequencyPenalty, presencePenalty, maxTokens.
    - maxContextTokens, memoryTokensRatio.

13. 에셋 시스템 (Asset System)

- 핵심 원칙: E2EE 세계(암호화 + blind sync)와 에셋 세계(평문 + CDN/로컬)는 완전히 분리. 둘 사이는 오직 ID 문자열 참조로만 연결.
- 에셋 분류 체계:
    - 일반 에셋 (Regular): 캐릭터 아바타, 배경, 감정 이미지 등. ID = SHA-256 해시 (콘텐츠 기반 중복 방지).
        - Private: 로컬 전용, 기기간 동기화 ✗. 게스트 모드 기본값.
        - Public: CDN 공개. 허브(Hub)에 공유한 봇에 적용. 다른 유저가 CDN을 통해 접근 가능.
    - 인레이 에셋 (Inlay): 유저 업로드 또는 AI 생성 에셋. 항상 Private. 메시지 텍스트 내 {{inlay::hash}} 파싱으로 렌더링.
- 단일 테이블: 일반 에셋과 인레이 에셋을 하나의 assets 테이블에 저장. 모든 에셋의 ID = SHA-256 콘텐츠 해시 (중복 방지 통일). kind 필드로 구분.
- 저장 방식: 모든 로컬 에셋은 평문 바이너리로 저장 (암호화 ✗). 빠른 접근 + 동기화 불필요.
- AssetRecord 스키마 (EncryptedRecord가 아닌 별도 인터페이스):
    - id (SHA-256 해시), userId, kind ('regular' | 'inlay'), visibility ('private' | 'public').
    - mimeType, data (Blob, 평문 바이너리).
    - cdnUrl (public 전환 후 CDN 주소), selfHostedUrl (셀프호스팅 PB 업로드 시).
- 에셋 참조 패턴:
    - 직접 참조 (ID): avatarAssetId 등 시스템이 직접 로드하는 필드.
    - 이름 기반 참조: AssetEntry[] 매니페스트로 name→assetId 매핑. AI/스크립트가 {{asset::이름}} 형태로 호출.
    - 인레이 참조: 메시지 텍스트에 {{inlay::hash}} 형태. 채팅 내 이미지.
    - 이름 충돌 없음: 매니페스트는 엔티티 스코프이므로 글로벌 이름 충돌 불가.
- 런타임 에셋 캐시: Store에 activeAssets(Map<assetId, ObjectURL>)와 assetNameMap(Map<name, assetId>) 유지. 레이어 전환 시 revokeObjectURL 호출.
- 게스트 모드: Public 에셋 개념 없음. 모든 에셋은 Private.
- 로그인 모드: Private → Public 전환 가능 (CDN 업로드). 인레이 → Public 전환 불가.
- 셀프호스팅 모드: Private/인레이 에셋도 자기 PocketBase 서버에 업로드 가능 (개인 CDN 효과로 기기간 동기화).
- 동기화 정리: Private/인레이 에셋은 기기간 동기화 ✗. 동기화를 원하면 Public 전환 또는 셀프호스팅 사용.

14. 멀티 채팅방 확장 (Multi-User Room — 미래)

- 핵심 원칙: "개인 금고(Personal Vault)"와 "공유 방(Shared Room)"은 완전히 다른 보안 도메인. 유저의 명시적 행위(업로드)를 통해서만 데이터가 경계를 넘어감.
- 보안 모델: Room Key 방식 (Signal Sender Keys, Matrix Megolm 유사).
    - 방 생성자가 Room Key 생성 → 참가자의 공개키로 Room Key를 암호화하여 전달.
    - 방 안의 모든 데이터(메시지, 공유 봇)는 Room Key로 암호화. 서버는 Room Key를 모름.
- Room Key 저장: 기존 E2EE 철학에 따라 EncryptedRecord로 저장 (roomKeys 테이블, FK: roomId). MasterKey로 암호화 → blind sync 대상.
- 개인 자산 공유 흐름: 유저가 "이 캐릭터를 방에 올릴게" → 로컬 금고에서 복호화 → Room Key로 재암호화 → 서버에 업로드. 원본은 그대로 보존 (사본 격리).

15. 전체 테이블 목록 (Table Registry)

- 암호화 테이블 (EncryptedRecord 기반, blind sync 대상):
    - users — 특수 (CryptoKey 저장)
    - characterSummaries / characterData — Summary + Data 분리 (소유: chatRefs, lorebookRefs, scriptRefs. 참조: moduleRefs. 에셋: assets)
    - chatSummaries / chatData — Summary + Data 분리 (characterId 평문 FK 보유. 소유 자원 직접 없음. 참조: moduleRefs, lorebookRefs, scriptRefs)
    - messages — 단일, 평문 FK: chatId (createdAt 정렬, softDeleteByIndex 벌크 삭제)
    - personaSummaries / personaData — Summary + Data 분리 (소유: lorebookRefs, scriptRefs. 참조: moduleRefs)
    - promptPresetSummaries / promptPresetData — Summary + Data 분리
    - modules — 단일 (소유: lorebookRefs, scriptRefs)
    - plugins — 단일
    - lorebooks — 단일 (항상 부모 소유, Deep Copy)
    - scripts — 단일 (항상 부모 소유, Deep Copy)
    - settings — 단일 (최상위 엔티티 refs[] + folders + 앱 설정)
    - roomKeys — 단일, FK: roomId (미래)
- 에셋 테이블 (평문, 동기화 대상 아님):
    - assets — 별도 인터페이스 (kind: regular/inlay, visibility: private/public)
