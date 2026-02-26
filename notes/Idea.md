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
    - 메모리에 풀려있는 진짜 열쇠 M은 `extractable: false` 옵션을 걸어 생성/임포트(Web Crypto API).
    - XSS 같은 악성 스크립트가 로컬에서 키의 Raw Byte를 탈취하는 것을 원천 차단.

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
    - 분리 적용 대상: 캐릭터, 채팅, 프롬프트 프리셋.
    - 단일 테이블 대상: 로어북, 스크립트, 모듈, 페르소나, 설정.
- 부모-자식 관계에서의 원칙:
    - 부모 엔티티가 자식의 미리보기 데이터를 복사해서 들고 있으면 안 된다 (데이터 중복 방지).
    - 미리보기가 필요하면 항상 자식의 Summary 테이블을 쿼리.

9. 관계 패턴 (Relationship Patterns)

- 1:N 관계 (부모 → 자식): 자식 테이블의 평문 FK 컬럼으로 표현.
    - 예: ChatSummaryRecord.characterId, MessageRecord.chatId.
    - 이유: "이 캐릭터의 채팅 목록", "이 채팅방의 메시지 목록"처럼 부모 기준으로 자식을 빠르게 쿼리해야 하므로 DB 인덱스 필수.
    - 트레이드오프: 서버에 "이 유저의 A 캐릭터에 채팅방이 3개" 같은 메타데이터가 노출됨. 쿼리 성능을 위한 최소한의 양보.
- N:M 관계 (공유 자원 참조): 소비자(부모)의 암호화된 Data Blob 내부에 Array<{ id, enabled }> 형태로 저장.
    - 예: ChatDataFields.lorebookRefs, CharacterDataFields.scriptRefs.
    - 이유: 별도 맵핑 테이블로 만들면 "누가 무엇을 쓰는지" 메타데이터가 평문 노출. Blob 안에 숨김.
    - enabled 플래그: 같은 로어북이라도 A 채팅방에서는 켜고, B 채팅방에서는 끌 수 있도록 참조하는 쪽에서 개별 관리.
- 참조 무결성: Loose Coupling (느슨한 결합).
    - E2EE 환경에서는 FOREIGN KEY ON DELETE CASCADE 불가능.
    - 공유 자원 삭제 시 참조자의 Data Blob을 일괄 복호화/수정하지 않음 (성능 재앙).
    - 대신 Graceful Degradation + Self-Healing: 삭제된 참조를 만나면 조용히 무시하고, 기회가 될 때 슬쩍 정리.
    - DB에는 진실의 원천(Source of Truth)만 저장. refCount 같은 파생값(Derived Value)은 저장하지 않음 (동기화/크래시 시 어긋남).

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

- 모듈의 정의: 로어북, 스크립트 등을 하나로 묶은 그룹 컨테이너(플레이리스트). 새로운 데이터를 소유(Own)하는 것이 아니라, 기존 공유 자원들을 묶어서 참조(Group & Reference).
- DB 스키마: 단일 EncryptedRecord (modules 테이블).
- ModuleFields 내부 구조:
    - name, description.
    - lorebookRefs: Array<{ id, enabled }>.
    - scriptRefs: Array<{ id, enabled }>.
- 참조 방식: 소비자(캐릭터, 챗 등)의 Data Blob에 moduleRefs: Array<{ id, enabled }> (N:M 원칙).
- 이중 토글 (Two-Layer Toggle):
    - 소비자 레벨: moduleRefs에서 모듈 자체 ON/OFF.
    - 모듈 내부 레벨: 모듈 안의 개별 로어북/스크립트 ON/OFF.
    - 모듈이 OFF → 안의 자원들 통째로 프롬프트 엔진 스킵. 하지만 메모리에는 남아있어 UI에서 열람 가능.
- 같은 자원이 직접 참조 + 모듈 참조로 중복되는 경우: 어느 한 출처라도 활성(enabled=true)이면 프롬프트 엔진에서 실행.

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
    - 인레이 에셋 (Inlay): 유저 업로드 또는 AI 생성 에셋. ID = UUID. 항상 Private. 메시지 텍스트 내 {{inlay::id}} 파싱으로 렌더링.
- 단일 테이블: 일반 에셋과 인레이 에셋을 하나의 assets 테이블에 저장. ID 체계(SHA-256 vs UUID)가 달라 충돌 없음. kind 필드로 구분.
- 저장 방식: 모든 로컬 에셋은 평문 바이너리로 저장 (암호화 ✗). 빠른 접근 + 동기화 불필요.
- AssetRecord 스키마 (EncryptedRecord가 아닌 별도 인터페이스):
    - id (hash 또는 UUID), userId, kind ('regular' | 'inlay'), visibility ('private' | 'public').
    - mimeType, data (Blob, 평문 바이너리).
    - cdnUrl (public 전환 후 CDN 주소), selfHostedUrl (셀프호스팅 PB 업로드 시).
- 에셋 참조: 캐릭터/모듈의 Data Blob에 에셋 ID 목록, 메시지 텍스트에 {{inlay::uuid}} 형태.
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
    - users — 특수 (평문 MasterKey 저장)
    - characterSummaries / characterData — Summary + Data 분리
    - chatSummaries / chatData — Summary + Data 분리, FK: characterId
    - messages — 단일, FK: chatId
    - promptPresetSummaries / promptPresetData — Summary + Data 분리
    - personas — 단일
    - lorebooks — 단일
    - scripts — 단일
    - modules — 단일
    - settings — 단일
    - roomKeys — 단일, FK: roomId (미래)
- 에셋 테이블 (평문, 동기화 대상 아님):
    - assets — 별도 인터페이스 (kind: regular/inlay, visibility: private/public)
