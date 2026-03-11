# 🏛️ KeiAI Asset System Architecture 2.0 (Local-First & E2EE)

이 문서는 KeiAI 플랫폼의 핵심인 '에셋 파이프라인'에 대한 최종 명세서입니다. 단대단 암호화(E2EE), 클라이언트 주도(Local-First), 그리고 서버 스토리지 및 트래픽 비용을 방어하는 1인 소유권(Single Owner) 및 원격 저장소 무임승차(Freeriding) 아키텍처를 정의합니다.

새로운 버전 2에서는 **모든 에셋 연산이 로컬 저장소를 SOT(Source of Truth) 삼아** 이루어지며, 백그라운드의 동기화 엔진(Sync Engine)이 "로컬 상태를 클라우드에 반영"하는 역할만 수행합니다.

---

## 1. 에셋의 종류 (Kinds)

에셋은 데이터 환경(컨텍스트)에 따라 3가지로 나뉩니다.

1. **인레이 (Inlay)**
   - 세션(채팅) 도중 간헐적으로 생성되는 이미지들 (유저 업로드 또는 AI 생성).
   - 채팅 내부에 `{{inlay::<uuid>}}` 형식으로 사용됩니다.
   - 프라이빗 에셋과 기술적으로 동일하지만, **유저가 명시적으로 켜지 않는 한 기본 동기화 OFF (로컬 전용)** 상태를 가집니다.

2. **프라이빗 (Private)**
   - 유저가 올린 캐릭터 아바타, 배경 이미지, 표정 등 핵심 자원.
   - 무조건 개인 소유이므로 서버 업로드 시 프라이빗 쿼타를 소비하며, E2EE 암호화 처리됩니다.

3. **퍼블릭 (Public)**
   - Hub(오픈 커뮤니티)에 공개된 봇/모듈 등에 묶인 에셋.
   - 단대단 암호화 없이 CDN을 통해 평문으로 제공되며, 쿼타를 소모하지 않습니다.

---

## 2. 에셋의 2가지 상태 (States)

- **로컬 (Local)**: 아직 서버에 업로드되지 않은 상태. (동기화 큐 대기 중이거나, 인레이 동기화가 꺼져있는 경우)
- **리모트 (Remote)**: 서버(클라우드)에 무사히 동기화가 완료된 상태. 기기 용량 관리를 위해 지워져도 나중에 다시 다운받을 수 있는 안전지대입니다.

---

## 3. 에셋 생성 및 전처리 (Client-Side Compression)

모든 에셋(이미지)은 파일 시스템이나 네트워크를 타기 전 **가장 앞단에서 압축**됩니다. 브라우저(Web Worker) 단에서 기본 WebP 변환 및 리사이징(예: 최대 5MB 이하)을 강제하여 서버 트래픽과 OOM을 방어합니다.

---

## 4. 데이터베이스 및 스토리지 구조

시스템은 3개의 계층 구조(`assets` 테이블, `assetRegistry` 캐시, `storage` 물리 파일망)로 구성됩니다.

### 4.1. 유저 에셋 테이블 (`assets` / EncryptedRecord)

이 유저가 보유한 모든 에셋 데이터의 **진실의 원천(Source of Truth)**입니다. PB(PocketBase)와 동기화됩니다.

- **id**: UUID. 동일한 에셋 원본이더라도 임포트 시마다 각각 고유의 생명주기를 가짐.
- **userId**: 에셋 소유자.
- **createdAt**, **updatedAt**, **isDeleted**
- **encryptedData**: 아래 `AssetFields` 데이터를 E2EE로 감싼 암호문.
- **encryptedDataIV**: 암호화 초기화 벡터.

> **AssetFields (복호화 시 나오는 알맹이)**
>
> - `kind`: inlay | private | public
> - `status`: local | remote
> - `encKey`: `SHA256(plaintext + FIXED_SALT)`. 파일 암호화 키.
> - `hash`: `SHA256(plaintext)`. 클라우드의 실제 물리적 파일명이자 식별자(PK).

### 4.2. 에셋 메타 레지스터리 (`assetRegistry` / Local Plaintext Cache)

현재 디바이스의 스토리지 저장 상태를 관리하는 **평문 캐시 테이블**이자 **디바이스 종속적인 큐(Queue)** 테이블입니다. 서버와 동기화되지 않습니다.

- **id, userId, kind, status, encKey, hash**: `assets`와 동일하지만 캐싱 쿼리를 위해 평문으로 저장.
- **size**: 로컬 파일의 바이트 단위 크기. (LRU 캐시 방출 계산용)
- **accessedAt**: LRU 방출 시 우선순위를 정하는 타임스탬프.
- **isDeleted**: `true`일 경우 영속적인 삭제 큐 대기 항목을 의미.

**설계 원칙:**

- 활성화된 레지스터리는 항상 스토리지 파일들의 부분집합이어야 합니다.
- 삭제(`isDeleted=true`), 상태 업데이트(터치) 등의 모든 제어는 `assets` 테이블과 SOT 동기화를 거칩니다.

### 4.3. 로컬 스토리지 (appStorage - OPFS / Tauri FS)

실제 압축된 WebP 에셋이 담기는 공간입니다. `/assets/<id>` (UUID) 이름으로 저장됩니다.

- 아직 동기화되지 않은 에셋의 **영속 보관소 (로컬 상태)**
- 이미 동기화된 에셋의 **LRU 캐시 (리모트 상태)**

---

## 5. 클라이언트 에셋 오케스트레이션 (AssetService)

유저의 모든 액션은 UI 단에서 `AssetService`를 호출하는 것으로 시작하며, 다음과 같이 동작합니다.

- **read(id)**
  1. 기기 저장소(`storage`)에 파일이 있다면 바로 반환하고 `registry`의 `accessedAt` 갱신.
  2. 없다면 서버 메타데이터(`assets`) 확인. `status="local"`이면 파일을 찾을 수 없어 에러 반환.
  3. `remote`라면 CDN URL을 통해 데이터를 다운로드.
  4. 받은 데이터가 유효한 이미지인지 검증하여, 깨졌다면(암호화 상태) `encKey`로 복호화.
  5. 복원된 이미지를 `storage`에 덮어쓰고 `registry` 캐시 등록 후 반환.

- **write(file?, kind)**
  - 에셋 테이블(`assets`) 기록(`isDeleted=false`, `status=local`)
  - 스토리지(`storage`)에 바이트 저장
  - 레지스터리(`registry`) 등록
  - (서버 업로드는 Sync 엔진에 위임)

- **delete(id)**
  - 봇을 지우거나 에셋을 지울 때, `assets(id).isDeleted=true` 처리.
  - 디바이스의 데이터(`storage`) 삭제.
  - 레지스터리 항목을 삭제 큐 상태(`isDeleted=true`)로 업데이트하여 Sync 엔진에 위임. 삭제는 본인 디바이스에서만 이루어져야 합니다.

- **promote(id)**
  - 프라이빗 에셋을 공개 Hub로 보낼 때 사용.
  - 로컬에서 복호화된 원본 데이터를 평문으로 서버에 PUT 요청하여 암호화본을 덮어씌웁니다.

---

## 6. 백그라운드 Sync 엔진 (AssetSyncEngine)

UI 작업을 블락하지 않고, 캐시의 불건전한 상태(큐)를 백그라운드에서 주기적으로 해소합니다.

작업 실행 순서: **테이블 동기화 (Down) → 삭제 큐 처리 (Up) → 업로드 큐 처리 (Up)**

- _삭제가 업로드보다 선행_: 동일 내용(해시)의 삭제, 생성 멱등성을 보장하기 위함.

### 6.1. 테이블 동기화 (Pull)

메타데이터(`assets`)만 서버와 동기화합니다.

- 서버 변경사항이 로컬보다 새로우면 덮어씁니다.
- 서버 변경사항 중 `isDeleted=true`인 항목이 있다면, 다른 기기에서 지워진 것이므로 내 기기도 캐시 및 스토리지를 지우고 큐에서 뺍니다.

### 6.2. 삭제 큐 (Delete Queue)

기기 종속적인 `registry` 테이블의 `isDeleted=true`인 레코드를 처리.

- 서버에 삭제 API(`DELETE /api/assets/:hash`)를 날려 RefCount를 감소시킵니다.
- 성공하면 레지스터리에서 완전히(Hard Delete) 제거합니다.

### 6.3. 업로드 큐 (Upload Queue)

기기 종속적인 `registry` 테이블의 `status=local` 이며 `isDeleted=false`인 레코드를 처리.

- 디바이스 로컬 `storage`에 있는 바이너리 데이터를 꺼내 `POST /api/assets/upload`에 던집니다.
- 서버 응답이 에러가 아닐 경우, `assets` 및 `registry`의 상태를 `remote`로 갱신합니다.

---

## 7. 리모트 저장소 및 서버 관문 (PocketBase / CDN)

원격지는 클라우드 벤더(Cloudflare R2 등)를 이용하며, 퍼블릭과 프라이빗을 불문하고 모두 평문 이름인 `해시값.bin`으로 저장됩니다. 클라이언트는 모든 에셋을 PB를 거치지 않고 CDN 도메인에서 다운받습니다.

서버 API는 철저하게 **E2EE 소유권 검증 및 무임승차(Deduplication) 쿼타 관리**에 집중합니다.

- **POST /api/assets/upload (업로드 및 공유)**
  - **최초의 업로더**: 해시가 R2에 없을 경우, 프라이빗 쿼타 차감 및 에셋 생성.
  - **소유자의 재업로드**: 해시가 존재할 때 주인이 또 올리면, 파일 업로드는 생략하고 RefCount만 +1.
  - **프리라이더(무임승차)**: 주인이 아닌 사람이 업로드 시도 시, 즉시 200 OK 스킵 (용량 차감, 쓰기 제로의 빠른 응답).

- **DELETE /api/assets/:hash (삭제 및 환급)**
  - 에셋 소유자만 자신의 RefCount를 줄일 수 있습니다. (타인의 삭제 요청은 무시)
  - 본인의 RefCount가 0이 되면 비로소 R2에서 파일을 파기하고 자신의 계정에 프라이빗 쿼타를 환급받습니다.

- **PUT /api/assets/promote/:hash (퍼블릭 배포)**
  - 주인이 암호화본을 깨진 평문화로 갈아끼울 때 씁니다. 파일이 공개되었으므로 쿼타에서 즉시 용량을 면제해 줍니다.
