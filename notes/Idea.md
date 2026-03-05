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
  - 단일 Go 바이너리라 Oracle Cloud 평생 무료 VPS(A1 인스턴스)에 올리는 것만으로 서버 비용 제로 달성 가능.
- 커스텀 로그인 훅 (Authentication Flow):
  - 포켓베이스 내장 `authWithPassword`를 활용하되, 클라이언트에서 미리 "Salt"를 받아 파생키(X, Y)를 계산해야 함.
  - `GET /api/salt/:email`: 비밀번호 인증 없이 이메일로 Salt만 반환하는 커스텀 JS 훅 구축. (오픈소스로 공개하여 신뢰 확보)
  - 받아온 Salt로 클라이언트에서 X를 계산 후, 진짜 비밀번호 대신 X를 전송해 포켓베이스를 속임(안전하게 E2EE 구현).
- 블라인드 동기화 춤 (Blind Sync Dance):
  - 로컬 DB와 포켓베이스 DB의 테이블 스키마는 동일(BaseRecord 형태).
  - [업로드/Push]: 오프라인에 쌓인 `lastSyncTime` 이후의 암호문 바이트 배열들을 서버에 그대로 Upsert.
  - [다운로드/Pull]: 타 기기에서 업로드된 서버의 최신 암호문들을 가져와 로컬 DB 덮어쓰기 (LWW: Last-Write-Wins 기반).
  - `Realtime Subscription` 웹소켓을 활용해 클라이언트 간 즉시 푸시/알림 가능.
- 스케일업 전략 (단계별 확장):
  - 1단계 (파일 외부 위임): 오라클 디스크가 꽉 차기 시작하면, PocketBase 관리자 설정에서 `Use S3 storage`를 켜고 Cloudflare R2(또는 Backblaze B2)를 연결. 무거운 이미지 파일들이 오라클을 거치지 않고 외부 스토리지로 빠짐.
  - 2단계 (BYOD 위임): BYOD를 통해 헤비 유저의 암호화 데이터 동기화를 유저 본인의 구글 드라이브/WebDAV로 넘겨 서버 부하를 유저에게 분산.
  - 3단계 (유료 VPS 이사): 텍스트 DB(`pb_data.db`)만으로도 용량이 부족해질 만큼 규모가 커지면(수익이 충분한 시점), 유료 VPS를 결제하고 DB 파일만 그대로 복사하여 이사. PocketBase 단일 바이너리 특성상 마이그레이션 비용 최소.

6. 하이브리드 AI 프록싱 (API Routing)

- 토글 기능 지원 (유저 선택권 보장):
  - 직접 요청 (Direct): 클라이언트 ➡️ OpenAI/Claude. 개발자 서버를 아예 거치지 않는 궁극의 프라이버시 (CORS 에러 감수).
  - 프록시 요청 (Proxy): 클라이언트 ➡️ 엣지 프록시 ➡️ OpenAI/Claude.
- 프록시 서버 보안 원칙 (Stateless):
  - Cloudflare Workers 인메모리 환경 사용 (하루 10만 건까지 무료, 글로벌 엣지 자동 적용).
  - DB 연결 없음, 로깅(console.log) 없음. 요청을 포워딩만 하고 메모리 즉시 소멸.
  - 이 코드는 오픈소스로 공개하여 "키를 엿보지 않는다"는 것을 누구나 검증 가능하게 함. 유저가 직접 자신의 Cloudflare 계정에 1-Click Deploy 하여 쓸 수도 있음.

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
  - 분리 적용 대상: 캐릭터, 채팅, 프롬프트 프리셋. (목록 네비게이션 중심)
  - 단일 테이블 대상: 페르소나, 로어북, 스크립트, 모듈, 플러그인, 설정.
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
    - settings → 캐릭터, 페르소나, 프리셋, 모듈, 플러그인 (최상위 노드로서 각 엔티티의 ID 리스트와 폴더 정보 소유)
    - 캐릭터 → 채팅(chatRefs로 소유), 로어북, 스크립트 단독 소유
    - 채팅 → 로어북 단독 소유 (채팅 고유의 설정 가능)
    - 모듈 → 로어북, 스크립트 단독 소유
    - 페르소나 → (추가 자원 소유 없음, 자체 설정과 에셋만 존재)
  - FK 및 정렬 예외 사항 (messages):
    - messages.chatId — 고볼륨 트래픽으로 인해 [chatId+sortOrder] 조합의 인덱스 추가 사용 (O(1) 쓰기 및 빠른 페이지네이션)
    - chatSummaries/Data.characterId — 캐릭터 삭제 시 종속된 채팅을 일괄 정리하기 위한 보조 장치
- 참조 관계 (N:M, Shared Reference):
  - 소비자의 암호화 Blob에 ResourceRef[]로 참조만 보유. 삭제 영향 없음.
  - enabled 플래그: 동일 자원이라도 컨텍스트마다 개별 ON/OFF.
  - 대상: 모듈, 플러그인 (프리셋과 페르소나는 직접 string ID 지정).
  - 예: characterData.moduleRefs (참조), characterData.lorebookRefs (소유).
- 폴더 관리:
  - 자식의 소속 폴더: refs[].folderId로 표현.
  - 폴더 정의: 부모의 Blob에 FolderDef[] 배열 (이름, 색, 중첩 등). 매우 소량.
  - 예: settings.folders.characters, characterData.chatFolders.
- 참조 무결성: Loose Coupling.
  - E2EE 환경에서는 FOREIGN KEY ON DELETE CASCADE 불가능.
  - 참조 자원 삭제 시 참조자의 Blob 일괄 수정 불필요 → Graceful Degradation + Self-Healing.
  - DB에는 진실의 원천(Source of Truth)만 저장. 파생값 저장하지 않음.

10. 모듈 시스템 (Module System)

- 모듈의 정의: 로어북, 스크립트 등을 하나로 묶은 그룹 컨테이너. 모듈은 로어북/스크립트를 소유(Own)한다 (Deep Copy).
- DB 스키마: 단일 EncryptedRecord (modules 테이블).
- ModuleFields 내부 구조:
  - name, description.
  - lorebookRefs: OrderedRef[] (소유).
  - scriptRefs: OrderedRef[] (소유).
- 참조 방식: 모듈 자체는 N:M 공유 자원. 소비자의 Data Blob에 moduleRefs: ResourceRef[] (참조).
- 삭제 캐스케이드: 모듈 삭제 → 소유 로어북/스크립트 일괄 삭제.
- 이중 토글 (Two-Layer Toggle):
  - 소비자 레벨: moduleRefs에서 모듈 자체 ON/OFF.
  - 모듈 내부 레벨: 모듈 안의 개별 로어북/스크립트 ON/OFF.
  - 모듈이 OFF → 안의 자원들 통째로 프롬프트 엔진 스킵.
- 같은 자원이 직접 소유 + 모듈 소유로 중복되는 경우: 별개의 Deep Copy이므로 각각 독립.

11. 프롬프트 프리셋 (Prompt Presets)

- 정의: 프롬프트 조립 순서(Template), Jailbreak, Authors Note, 샘플링 파라미터 등을 묶은 설정 프리셋. RisuAI의 botPresets에 대응.
- DB 스키마: Summary + Data 분리 (promptPresetSummaries / promptPresetData).
  - 유저가 수십 개의 프리셋을 만들어 고를 수 있으므로 목록 네비게이션이 중요.
- 참조 방식: N:M 공유 자원. 소비자의 Data Blob에 promptPresetId: string으로 참조.
- PromptPresetDataFields 주요 내용:
  - templateOrder: 프롬프트 조립 순서 (system, jailbreak, description, lorebook, chat, memory 등).
  - authorsNote, jailbreakPrompt.
  - temperature, topP, topK, frequencyPenalty, presencePenalty, maxTokens.
  - maxContextTokens, memoryTokensRatio.

12. 에셋 시스템 (Asset System)

- 핵심 원칙: E2EE 세계(암호화 + blind sync)와 에셋 세계(평문 바이너리 + 스토리지)는 완전히 분리. 둘 사이는 오직 UUID 문자열 참조로만 연결.
- 에셋 분류 체계:
  - 프라이빗 에셋 (Private): 유저 개인 소유 에셋. 캐릭터 아바타, 배경, 감정 이미지 등.
    - Local-First: 로컬 스토리지(OPFS 또는 Tauri FS)에 평문 바이너리로 저장. 오프라인에서도 즉시 렌더링.
    - 동기화(Sync): 로그인 시 E2EE 암호화하여 오브젝트 스토리지에 업로드. 파일명은 HMAC-SHA256(MasterKey, UUID)로 은닉 (Blind Hash). 용량 제한 있음.
    - 용량 제한: 무료 유저에게 총 동기화 용량 제한 (예: 50MB). 초과 시 동기화만 중지, 로컬 작동은 정상.
  - 인레이 에셋 (Inlay): 채팅 중 생성되는 에셋. 유저 업로드 사진, AI 생성 이미지 등.
    - 기본 동기화 OFF: 로컬 스토리지에만 평문 저장.
    - 설정에서 동기화 ON 시: 프라이빗 에셋과 동일 취급 (E2EE + Blind Hash → 오브젝트 스토리지). 동기화 용량을 소모함.
    - 삭제하지 않음: 인레이 에셋은 별도의 갤러리 브라우저 UI를 통해 유저가 직접 감상 및 수동 관리.
  - 퍼블릭 에셋 (Public): Hub(커뮤니티)에 공개된 에셋. CDN(Cloudflare R2)에 평문으로 저장.
    - 생성 경로: 유저가 Hub에 봇/모듈을 공유할 때 프라이빗 에셋이 퍼블릭으로 전환 (CDN 업로드).
    - 소비 방식: 다른 유저가 Hub에서 다운로드 시 CDN remoteUrl을 <img src>에 직접 바인딩. 바이너리를 로컬에 복사하지 않음 (Thin Client).
    - CDN 파일명 = SHA-256(원본 바이너리). 크로스 유저 중복 제거 가능.
    - 영구 유지: 한번 CDN에 올라간 퍼블릭 에셋은 영구 보존.
- ID 체계:
  - 모든 에셋의 로컬 ID = UUID. 셋 다 같은 체계를 쓰므로 엔티티(캐릭터 등)는 종류에 관계없이 assetId: string 하나만 보유.
  - 서버 파일명(프라이빗/인레이): UUID 그대로 사용. UUID는 내용과 무관한 랜덤 문자열이므로 별도 변환 없이도 프라이버시 완벽 보장.
  - CDN 파일명(퍼블릭): SHA-256(바이너리). 크로스 유저 중복 제거용.
- 에셋 테이블 (assets, EncryptedRecord):
  - 모든 종류(프라이빗/인레이/퍼블릭)를 단일 테이블에 저장. Blind Sync 대상.
  - id: UUID.
  - encryptedData 내부: kind ('private' | 'inlay' | 'public'), mimeType, remoteUrl?.
    - remoteUrl이 없으면 → 아직 로컬 전용 에셋.
    - private/inlay의 remoteUrl → 암호화 오브젝트 스토리지 경로 (`/{userId}/{uuid}`).
    - public의 remoteUrl → CDN URL (평문).
- 에셋 상태 (두 가지):
  - 로컬 에셋: remoteUrl 없음. 로컬 스토리지에만 존재. 절대 evict 불가.
  - 리모트 에셋: remoteUrl 있음. 로컬 스토리지는 LRU 캐시. evict 가능.
- 에셋 스토리지 (IStorageAdapter):
  - 영속 에셋 + 리모트 에셋 캐시를 구분 없이 같은 위치에 저장.
  - 파일 조회 키 = UUID.
- 캐시 레지스트리 (로컬 전용, 동기화 안 함):
  - {uuid, lastAccessedAt, size} 형태의 경량 테이블 또는 K-V Store.
  - 캐시 레지스트리에 있는 것만 evict 대상. 없는 것 = 영속 에셋 = 절대 삭제 불가.
  - LRU Watermark 전략: 총 캐시 > High Watermark(예: 500MB) → lastAccessedAt 오름차순으로 Low Watermark(예: 400MB)까지 삭제.
- 전환 규칙:
  - 프라이빗 → 퍼블릭: 가능 (Hub 공유 시).
    - SHA-256(바이너리) 계산 → CDN 업로드 (이미 있으면 스킵).
    - 에셋 레코드 업데이트: kind → 'public', remoteUrl → CDN URL. UUID는 그대로 유지 (ID 변경 없음!).
    - 로컬 스토리지 바이너리 삭제 → 캐시 레지스트리에 등록 → evict 가능 → 동기화 용량 회수.
  - 퍼블릭 → 프라이빗: 불가. 한번 공개된 에셋은 CDN에 영구 유지.
  - 인레이 → 퍼블릭: 불가. 인레이는 보트가 아닌 유저 개인의 채팅 콘테츠에 속한 에셋이다. 옵션은 프라이빗 오브젝트 스토리지에 암호화하여 동기화할 수 있는가 여부이다.
- 에셋 삭제:
  - 프라이빗: 소유 엔티티(캐릭터, 페르소나 등) 삭제 시 매니페스트의 UUID 목록으로 cascaed 삭제. 로컬 스토리지에서도 즉시 하드 삭제 (용량 확보).
  - 인레이: 삭제하지 않는다. 갤러리 브라우저에서 수동 관리.
  - 퍼블릭: CDN에 영구 보관. 삭제 없음.
- 에셋 참조 패턴:
  - 직접 참조 (ID): avatarAssetId 등 엔티티가 직접 로드하는 필드. 항상 UUID.
  - 이름 기반 참조: AssetEntry[] 매니페스트로 name → assetId(UUID) 매핑. AI/스크립트가 {{asset::이름}} 형태로 호출.
  - 인레이 참조: 메시지 텍스트에 {{inlay::uuid}} 형태. 채팅 내 이미지.
- 런타임 에셋 로딩:
  - 로컬 스토리지에 있으면: IStorageAdapter.getRenderUrl(uuid) → 로컬 URL 렌더링. 캐시 레지스트리 lastAccessedAt 갱신.
  - 로컬에 없고 remoteUrl 있으면:
    - private/inlay: remoteUrl에서 암호화 Blob 다운로드 → 복호화 → 스토리지 저장 + 캐시 레지스트리 등록 → 렌더링.
    - public: CDN remoteUrl을 <img src>에 직접 바인딩. 다운로드 없음. 브라우저 캐시 사용.
- 동기화 저장소 분리:
  - 퍼블릭 에셋 → Cloudflare R2 + CDN (Egress 무료, 대량 조회에 최적).
  - 프라이빗/인레이 에셋 → PB 서버 디스크 (초기) 또는 Backblaze B2 (스케일 시). CDN 불필요.
- BYOD (Bring Your Own Drive):
  - 유저 개인 클라우드 스토리지(구글 드라이브, WebDAV, S3 호환) 연동 옵션.
  - E2EE 암호화 + Blind Hash된 Blob을 유저의 개인 드라이브에 직접 동기화.
  - 운영자 서버 비용 제로, 유저 무제한 용량. 궁극의 프라이버시 보장.
- 게스트 모드: 퍼블릭 에셋은 CDN URL로 사용 가능. 프라이빗/인레이는 로컬 전용. 동기화 불가.
- 로그인 모드: 프라이빗 에셋 동기화 활성화 (용량 제한). 프라이빗 → 퍼블릭 전환 가능.

13. 허브 & 익스포트 전략 (Hub & Export Strategy)

- Hub 업로드 (공유):
  - 유저가 봇/모듈을 Hub에 공유 시, 관련 프라이빗 에셋이 퍼블릭으로 전환 (CDN 업로드).
  - 봇 설정(JSON)은 CDN URL을 참조하는 형태로 Hub 서버에 제출.
  - 프라이빗 동기화 용량이 회수되므로, 공유가 곧 용량 확보 수단.
- Hub 다운로드 (임포트):
  - 다른 유저가 Hub에서 봇을 다운로드 시, 로컬 DB에는 CDN URL 참조만 저장.
  - 에셋 바이너리를 로컬에 복사하지 않으므로 즉시 임포트 완료 (Thin Client).
  - 브라우저 네트워크 캐시가 자동으로 이미지를 캐싱하여 빠른 렌더링.
  - 원본 작성자가 에셋 삭제 시 → "로컬에 영구 소장(Convert to Private)" 버튼으로 유저가 선택적 백업 가능.
- 파일 Export (로컬 파일로 내보내기):
  - V2 Character Card Spec 호환: 대표 썸네일 PNG 메타데이터에 범용 JSON 삽입.
  - 에셋 처리: 프라이빗 에셋은 Base64 인라인, 퍼블릭 에셋은 CDN URL 유지.
  - Export 옵션 2가지:
    1. "가볍게 내보내기 (링크 전용)": 퍼블릭 에셋은 URL로만 남겨 파일 가볍게.
    2. "독립형 내보내기 (영구 보관)": 모든 에셋을 Base64로 인라인 포함.
  - KeiAI 확장 필드: keiai_extensions에 로어북 모듈 참조, 동기화 속성 등 고급 설정 저장. 타 플랫폼에서는 무시되나 KeiAI에서는 완전 복원.
- 파일 Import (로컬 파일 불러오기):
  - V2 PNG/JSON, .charx(Risu), KeiAI 확장 포맷 지원.
  - 인라인 에셋(Base64)은 프라이빗 에셋으로 로컬 DB에 저장.
  - URL 참조 에셋은 URL 그대로 유지 (Thin Client).
  - 모든 Import 데이터는 로컬 DB에만 저장 (서버 통신 없음, 오프라인 가능).

14. 수익 모델 (Revenue Model)

- 핵심 철학: "로컬에서 노는 건 무료. 클라우드 서비스는 유료." 서버 비용이 극소이므로 소수의 결제 유저만으로도 손익분기.
- Free (무료):
  - 앱 다운로드 및 1기기 로컬 사용 무제한.
  - 프라이빗 에셋 동기화 용량 제한 (예: 50MB).
  - Hub 봇 다운로드/업로드 무제한 (퍼블릭 에셋은 CDN 비용이 낮으므로).
- Pro 구독 (월 $4~5):
  - 프라이빗 에셋 동기화 용량 확대 (예: 5~10GB).
  - BYOD (Bring Your Own Drive) 연동 기능.
  - 인레이 에셋 동기화 옵션 해금.
  - 프리미엄 테마, 채팅 말풍선 스킨 등 코스메틱.
- 용량 확보 선순환 (Flywheel):
  - 무료 유저의 동기화 용량이 꽉 참 → 두 가지 선택:
    1. Hub에 봇 공유 (프라이빗→퍼블릭 전환) → 프라이빗 용량 회수 + 커뮤니티 성장.
    2. Pro 구독으로 용량 확대 → 수익 창출.
  - 어느 쪽이든 플랫폼에 이득인 완벽한 선순환 구조.
- 쿼터 관리 (Quota Enforcement):
  - 용량 검증은 반드시 서버(PocketBase)에서 수행. 클라이언트는 오픈소스이므로 조작 가능.
  - 서버 유저 레코드: tier ('free' | 'pro'), quotaLimit (bytes), usedBytes (서버가 직접 카운트).
  - 업로드 시: usedBytes + newFileSize > quotaLimit이면 거부. 클라이언트가 보내는 값은 일절 신뢰하지 않음.
  - 삭제/승급 시: usedBytes 감소 (서버가 실제 파일 크기 기준으로 계산).
- 구독 해지 시 (Pro → Free, 용량 초과 상태):
  - 핵심 원칙: 유저의 기존 데이터를 절대 삭제하지 않는다.
  - 기존 에셋 다운로드/접근: 정상 동작.
  - 새 에셋 업로드(동기화): 차단. 로컬에서는 정상 작동.
  - 에셋 삭제 및 Hub 공유(용량 회수): 가능.
  - 클라이언트 안내: "동기화 용량 초과. 새 에셋의 동기화가 일시 중지되었습니다. [Pro 구독으로 용량 확대] [Hub에 공유하여 용량 확보]"

15. 멀티 채팅방 확장 (Multi-User Room — 미래)

- 핵심 원칙: "개인 금고(Personal Vault)"와 "공유 방(Shared Room)"은 완전히 다른 보안 도메인. 유저의 명시적 행위(업로드)를 통해서만 데이터가 경계를 넘어감.
- 보안 모델: Room Key 방식 (Signal Sender Keys, Matrix Megolm 유사).
  - 방 생성자가 Room Key 생성 → 참가자의 공개키로 Room Key를 암호화하여 전달.
  - 방 안의 모든 데이터(메시지, 공유 봇)는 Room Key로 암호화. 서버는 Room Key를 모름.
- Room Key 저장: 기존 E2EE 철학에 따라 EncryptedRecord로 저장 (roomKeys 테이블, FK: roomId). MasterKey로 암호화 → blind sync 대상.
- 개인 자산 공유 흐름: 유저가 "이 캐릭터를 방에 올릴게" → 로컬 금고에서 복호화 → Room Key로 재암호화 → 서버에 업로드. 원본은 그대로 보존 (사본 격리).

16. 전체 테이블 목록 (Table Registry)

- 암호화 테이블 (EncryptedRecord 기반, blind sync 대상):
  - users — 특수 (CryptoKey 보관용)
  - characterSummaries / characterData — Summary + Data 분리 (소유: chatRefs, lorebookRefs, scriptRefs. 참조: moduleRefs. 에셋: assets)
  - chatSummaries / chatData — Summary + Data 분리 (characterId 평문 FK 보유. 소유: lorebookRefs)
  - messages — 단일, 평문 FK: chatId ([chatId+sortOrder] 복합 인덱스, softDeleteByIndex 벌크 삭제)
  - personas — 단일 (독립된 데이터 + 에셋 보유)
  - promptPresetSummaries / promptPresetData — Summary + Data 분리
  - modules — 단일 (소유: lorebookRefs, scriptRefs. 폴더 지원)
  - plugins — 단일 (내장 hooks 및 샌드박스 설정)
  - lorebooks — 단일 (부모 소유, Deep Copy)
  - scripts — 단일 (부모 소유, Deep Copy)
  - settings — 단일 (최상위 엔티티 관리: characterRefs, personaRefs, presetRefs, moduleRefs, pluginRefs + folders)
  - roomKeys — 단일, FK: roomId (미래)
- 에셋 테이블 (단일 테이블, Blind Sync 대상 ✅):
  - assets — kind: private/inlay/public. ID = UUID. encryptedData 내부에 kind, mimeType, remoteUrl? 저장.
    - remoteUrl 없음 → 로컬 전용. remoteUrl 있음 → 리모트(캐시 가능).
    - private/inlay의 remoteUrl: 오브젝트 스토리지 경로 (파일명 = HMAC-SHA256(MasterKey, UUID), Blind Hash).
    - public의 remoteUrl: CDN URL (평문).
- 에셋 스토리지 및 캐시 (로컬 전용, 동기화 X):
  - IStorageAdapter — 영속 에셋 + 리모트 에셋 캐시를 구분 없이 같은 위치에 저장. 키 = UUID.
  - 캐시 레지스트리 — {uuid, lastAccessedAt, size}. 여기 등록된 것만 LRU evict 대상. 없으면 영속 에셋.

17. 인프라 구성 전략 (Zero-Cost Stack)

- 핵심 철학: 인프라 비용은 0원에 수렴하게 만들고, 유저의 신뢰는 100%로 끌어올리며, 핵심 수익 모델은 완벽하게 방어한다.
- 구성 요소 (MVP ~ 소규모 단계까지 비용 없이 운영 가능):
  - 프론트엔드 (UI & E2EE 엔진): Cloudflare Pages. Svelte 정적 웹 클라이언트 배포. 무료 티어로 사실상 무제한 대역폭, 글로벌 CDN 자동 적용.
  - 엣지 프록시 (API 라우터): Cloudflare Workers. 유저의 OpenAI/Claude API 키를 안전하게 포워딩하는 무상태 중계소. 하루 10만 건까지 무료.
  - 데이터 백엔드 (비밀 금고): Oracle Cloud A1 VPS + PocketBase. 포켓베이스(단일 Go 바이너리)를 평생 무료 인스턴스에 올려 암호화된 E2EE 데이터와 프라이빗 파일을 로컬 디스크(`pb_data`)에 저장 및 동기화.
  - 퍼블릭 에셋 스토리지 & CDN: Cloudflare R2. Hub에 공유된 평문 에셋(캐릭터 썸네일, 배경 등) 저장. AWS S3와 달리 Egress 비용 100% 무료.

18. 오픈소스 전략 (Open Source vs Closed Source)

- 핵심 원칙: 보안에 대한 신뢰는 코드로 증명하되, 서비스의 핵심 자산과 수익 모델은 철저히 방어한다.
- 공개 영역 (Open-Source): 유저가 "내 데이터와 API 키가 안전한가?"를 직접 검증할 수 있는 보안 핵심 구역.
  - 프론트엔드 E2EE 엔진 (Svelte 클라이언트): 브라우저 내에서 비밀번호로 KDF를 만들고 Dexie DB와 Svelte Store를 오가며 암복호화를 수행하는 로직, 프롬프트 조립 파이프라인.
  - 엣지 프록시 (Cloudflare Workers): API 키와 프롬프트를 엿보거나 저장하지 않고 바이패스한다는 것을 증명하는 코드. 유저가 직접 자신의 CF 계정에 1-Click Deploy 가능.
  - PocketBase 인증 훅: 이메일을 받으면 KDF용 Salt만 반환하는 `/api/salt/:email` 등 최소한의 보안 스니펫.
- 비공개 영역 (Closed-Source): 서비스의 핵심 자산이자 수익 모델과 직결된 구역.
  - 수익 및 구독 관리 로직: 결제사(Stripe/포트원 등) 웹훅 처리, 유저 등급(Free/Pro) 판별, 동기화 쿼터 계산 및 업로드 차단 로직. (우회 해킹 방지)
  - Hub 커뮤니티 백엔드: 유저 공유 콘텐츠 서빙 로직. 공개 시 UI만 바꾼 클론 서비스가 동일한 생태계를 구축 가능하므로 절대 비공개. 플랫폼의 진짜 해자(Moat).

19. 이벤트 시스템 (EventBus — Unified Hook/Trigger/Script)

- RisuAI 문제 분석:
  - Trigger(노코드 GUI 블록)와 Script(Regex/Lua/Python) 두 시스템이 분리되어 있으나 실행 시점이 겹치고 trigger 안에서 script를 호출하는 등 경계가 모호.
  - 전체 파이프라인이 `sendChat()` 1973줄 단일 함수에 하드코딩. 트리거 실행 시점이 함수 내부 특정 라인에 고정.
  - 6가지 트리거 타입과 스크립트 실행 타입이 별개 열거형으로 관리되어 혼란 가중.
- 통합 설계 원칙: Trigger와 Script를 분리하지 않고 **단일 EventBus**로 통합. 구현 방식(Regex, Lua, 노코드 블록)은 리스너의 내부 관심사일 뿐, 버스는 이벤트 이름과 리스너만 관리.
- EventBus 호출 모드 (하나의 버스, 두 가지 모드):
  - **pipe(event, data)**: 변환 체이닝. 각 리스너가 데이터를 받아 변환 후 반환하면 다음 리스너의 입력이 됨. 파이프라인 데이터 변환용.
  - **emit(event, data)**: 팬아웃 알림. 모든 리스너에 독립 전달, 리턴값 무시. 시스템 이벤트/유저 액션 알림용.
  - 등록/해제는 둘 다 on/off. 리스너 저장소도 단일 Map. 호출하는 쪽(Publisher)이 pipe로 부르면 체이닝, emit으로 부르면 팬아웃. Subscriber는 모드를 알 필요 없음.
- 이벤트 네이밍 컨벤션: `{category}:{action}` 통일.
  - 파이프라인(변환): `pipe:input`, `pipe:output`, `pipe:request`, `pipe:display`.
  - 생성 라이프사이클(알림): `gen:started`, `gen:chunk`, `gen:completed`, `gen:error`, `gen:aborted`.
  - 채팅/메시지/앱 상태(알림): `chat:selected`, `msg:created`, `sync:complete`, `char:loaded` 등.
  - 유저 액션(커스텀): `btn:{name}`, `custom:{name}`.
  - `pipe:` 접두사가 있으면 리스너가 "리턴값이 의미 있다"는 걸 이름만 보고 인지 가능.
- 파이프라인 실행 흐름: 유저 입력 → pipe:input(텍스트 변환) → PromptBuilder(프롬프트 조립) → pipe:request(페이로드 변환) → LLM 호출 → pipe:output(응답 변환, DB 저장 전) → pipe:display(화면 표시용 변환, 원본 불변).
  - pipe:output ≠ pipe:display 분리가 핵심: output은 영구 변환(DB 저장 전), display는 렌더링 전용(원본 유지).
- 시스템 이벤트 활용:
  - 앱 내부의 주요 상태 변화도 EventBus로 emit. 캐릭터 스크립트가 시스템 이벤트를 구독하여 커스텀 로직 실행 가능 (예: `chat:selected` → 변수 초기화, `gen:completed` → 턴 카운팅).
  - 비동기 유저 액션도 이벤트로 통합: UI 버튼에 이벤트 이름 할당 → 리스너가 AI 재호출, 변수 조작 등 자유 실행.
- 리스너 우선순위: priority 값(낮을수록 먼저 실행)으로 같은 이벤트의 리스너 실행 순서 제어.
- 소유자 기반 벌크 관리: 리스너 등록 시 ownerId 지정. 캐릭터/모듈 언로드 시 해당 소유자의 모든 리스너 일괄 해제.
- 기존 Script 서비스와의 연동:
  - DB 스키마 변경 없음: ScriptFields는 이미 E2E 암호화 Blob이므로 JSON 내부 구조만 확장.
  - 기존 placement 필드 → events 배열로 일반화 (하위호환: `placement: 'onOutput'` → `events: ['pipe:output']` 자동 변환).
  - ScriptFields 유니온 확장: RegexScript(기존 regex/replacement) + CodeScript(language, code) + 향후 VisualScript(노코드 블록).

20. 렌더링 파이프라인 (Streaming Chat Display)

- 핵심 문제: 스트리밍 중 청크마다 전체 메시지를 마크다운 파싱 + DOM 교체하면 성능 폭발. 디바운스만으로는 시각적 끊김.
- Two-Track State (이중 상태 관리):
  - 확정 메시지 (Confirmed): DB에 저장된 완성 메시지. messages 스토어에 평문 배열로 보유.
  - 생성 중 메시지 (Ephemeral): LLM 스트리밍 도중의 미완성 텍스트. generationTasks 스토어에 chatId 키 Map으로 보유. DB 미저장.
  - displayMessages derived 스토어: 확정 + 생성 중을 합쳐 UI에 단일 리스트로 제공. 생성 완료 → createMessage(암호화 + DB 저장) → clearTask. 순서: 생성 먼저, 삭제 나중 (시각적 갭 방지).
- 스트리밍 렌더링 전략:
  - 청크 도착 시 generationTasks Map 교체 → displayMessages 재계산.
  - 마크다운 파싱은 컴포넌트 레벨에서 pipe:display 이벤트를 통해 실행. 디바운스 적용. 스트리밍 도중에는 매 청크가 아닌 디바운스된 간격으로만 파싱.
  - DOM 업데이트: diffDOM으로 이전 렌더링 결과와 diff → 변경된 노드만 패치. 전체 innerHTML 교체 방지.
  - 스크롤 관리: 컴포넌트 로컬 상태. 스토어가 아닌 UI 레벨 관심사.
- GenerationManager 역할:
  - StreamProvider 인터페이스를 받아 스트리밍 라이프사이클만 관리: startTask → 청크 수집 → createMessage → clearTask.
  - 에러 처리: AbortError(유저 중단, 부분 저장 옵션), 일반 에러(UI 인라인 표시), 빈 응답(에러 취급).
  - LLM 종류 무관: StreamProvider 구현체만 교체.
- 파이프라인 오케스트레이션: UI 진입점 → pipe:input → PromptBuilder → pipe:request → GenerationManager → pipe:output → DB 저장. pipeline/이 generation/를 호출하는 상위 레이어.
