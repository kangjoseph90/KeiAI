# 🏛️ KeiAI Asset System v3 — 최종 설계 명세

## 1. 설계 원칙

- **데이터 서버 = 에셋 서버**: 하나의 PB 인스턴스가 데이터 동기화와 에셋 동기화를 모두 담당
- **모든 에셋은 암호화**: public/private 구분 폐기. 서버는 어떤 이미지도 볼 수 없음
- **수렴 암호화 (Convergent Encryption)**: 같은 원본 → 같은 암호문 → 자연스러운 dedup
- **서버 자동 ref 관리**: 클라이언트가 별도 ref API를 호출하지 않음. 데이터 동기화만 하면 PB Hook이 처리
- **셀프호스트 완전 지원**: 공식 서버와 동일한 PB 코드. 기능 잠금 없음

---

## 2. 수렴 암호화 모델

```
plaintext  (원본 이미지, WebP 압축 후)
  │
  ├─ plaintextHash = SHA256(plaintext) (내부 계산용, 즉시 폐기)
  ├─ encKey = HKDF-SHA256(plaintextHash, "kei-asset-enc")     결정적 키 유도
  ├─ iv     = HKDF-SHA256(encKey, "kei-asset-iv")[0:12]    encKey에서 IV 유도
  ├─ ciphertext = AES-256-GCM(plaintext, encKey, iv)       결정적 암호화
  └─ hash = SHA-256(ciphertext)                            콘텐츠 주소
```

> [!IMPORTANT]
> **IV는 encKey에서 유도한다** — plaintext에서 유도하면 복호화 시점에
> plaintext가 없어 IV를 복원할 수 없음. encKey는 `encryptedData`에 저장되므로
> 복호화 시 항상 사용 가능.
>
> IV가 결정적이므로 confirmation attack이 이론적으로 가능하나,
> 공격자가 원본 이미지를 이미 보유해야 하므로 실질적 위협은 무시할 수 있음.
> (Tahoe-LAFS, MEGA 등에서 검증된 패턴)

**핵심 특성**:
- 같은 원본 → 같은 ciphertext → 같은 hash → **서버 dedup 가능**
- `encKey`를 모르면 복호화 불가 → **CDN 공개 다운로드 안전**
- 서버는 `sha256(수신된 ciphertext) == 클레임된 hash`로 **무결성 검증 가능**

---

## 3. 에셋 종류와 상태

### Kind (종류)
| Kind | 설명 |
|---|---|
| `resource` | 캐릭터 아바타, 배경, 표정 등 핵심 자원 |
| `inlay` | 채팅 중 생성된 이미지. `{{inlay::uuid}}` 형식으로 참조 |

### Status (상태)
| Status | 의미 |
|---|---|
| `local` | 이 기기에만 존재. 서버에 ciphertext 없음 |
| `remote` | ciphertext를 알려진 외부 source에서 재획득 가능 |

> `remote`의 의미는 연결 상태에 따라 구체화된다:
> - **공식 서버 연결 시**: 공식 CDN catalog에 ciphertext 존재
> - **셀프호스트 연결 시**: 커스텀 PB catalog에 ciphertext 존재
> - **비로그인 시**: 공식 CDN에 ciphertext가 존재한다고 간주 (경량 임포트 origin)
>
> 서버 이전 시 모든 에셋의 remote 상태는 재평가되어야 한다.

---

## 4. 서버 스키마

### 4.1 assets 테이블 (데이터 동기화 대상)

| 필드 | 타입 | 암호화 | 설명 |
|---|---|---|---|
| `id` | text PK | - | UUID |
| `userId` | text FK | - | 소유자 |
| `createdAt` | number | - | |
| `updatedAt` | number | - | |
| `isDeleted` | bool | - | 소프트 삭제 |
| `hash` | text, indexed | **평문** | ciphertext의 SHA-256. ref/dedup에 사용 |
| `status` | text | **평문** | `'local'` \| `'remote'`. Hook 판단용 |
| `encryptedData` | text | E2EE | `{kind, encKey}` |
| `encryptedDataIV` | text | E2EE | E2EE 메타데이터 암호화 IV |

> `hash`와 `status`는 서버가 ref/쿼타를 자동 관리하기 위해 평문으로 노출.
> 이전 모델에서도 upload API와 ref 테이블을 통해 동일 정보가 서버에 전달되었으므로
> 프라이버시 수준 변화 없음.

### 4.2 asset_catalog 테이블 (서버 전용)

| 필드 | 타입 | 설명 |
|---|---|---|
| `hash` | text PK | 물리 파일 식별자 |
| `size` | number | ciphertext 바이트 크기 |
| `createdAt` | datetime | |

### 4.3 asset_usage 테이블 (서버 전용 — ref ledger)

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | text PK | `{userId}:{hash}` |
| `userId` | text, indexed | |
| `hash` | text, indexed | |
| `refCount` | number | 이 유저가 이 hash를 참조하는 live asset 수 |
| `size` | number | catalog에서 가져온 ciphertext 크기 |
| `createdAt` | datetime | |
| `updatedAt` | datetime | |

> 클라이언트에 노출되지 않는 서버 내부 장부.
> countLiveRefs() 쿼리 대신 이 테이블을 직접 조회하여 판단.
> 디버깅 시 "이 유저가 어떤 hash로 쿼타를 소비하는지" 한눈에 파악 가능.

### 4.4 users 테이블 (쿼타 필드 추가)

| 필드 | 타입 | 설명 |
|---|---|---|
| `assetUsedBytes` | number | 현재 사용량 (고유 hash 기준) |
| `assetMaxBytes` | number | 플랜별 한도 |

---

## 5. 서버 API 및 정책

### 5.1 Upload

```
PUT /api/assets/{hash}
Content-Type: application/octet-stream
Body: <ciphertext 바이너리>
Auth: PB 인증 필요

1. 검증: sha256(body) === URL의 {hash}
2. abuse 방어: hash 형식 검증, 최대 파일 크기 제한, rate limit
3. hard quota 검사: assetUsedBytes + size > assetMaxBytes 이면 거부
4. asset_catalog에 hash 존재?
   → 있음: 파일 스킵, 200 OK
   → 없음: 스토리지에 저장, catalog 등록, 201 Created
```

> JSON 안에 바이너리를 넣으면 base64 오버헤드 33%. octet-stream이 효율적.
> ref 관리는 이 API가 하지 않음. Hook이 담당.
> **Hard quota는 upload API에서만 적용한다.** assets 동기화 write는 quota 문제로 거부하지 않는다.

### 5.2 Download

```
공식 서버: GET {CDN_BASE}/{hash}.bin  (인증 불필요)
셀프호스트: GET {PB_URL}/api/assets/download/{hash}  (PB 인증 필요)
```

### 5.3 PB Hook — 자동 ref 관리 (State Transition + Ledger)

```javascript
onRecordAfterCreateOrUpdate('assets', (e) => {
    const rec = e.record
    const old = e.record.original() // create 시 null

    const oldLive = old && old.get('status') === 'remote'
                    && !old.get('isDeleted') && old.get('hash')
    const newLive = rec.get('status') === 'remote'
                    && !rec.get('isDeleted') && rec.get('hash')
    const oldHash = old?.get('hash')
    const newHash = rec.get('hash')
    const userId = rec.get('userId')

    // 상태 변화가 없으면 no-op
    if (oldLive === newLive && oldHash === newHash) return

    // 이전 hash의 ref 해제
    if (oldLive && (!newLive || oldHash !== newHash)) {
        decrementUsage(userId, oldHash)
    }

    // 새 hash의 ref 생성
    if (newLive && (!oldLive || oldHash !== newHash)) {
        incrementUsage(userId, newHash)
    }
})

function incrementUsage(userId, hash) {
    const usage = getUsage(userId, hash)
    if (!usage) {
        const size = catalogSize(hash)
        if (!size) return // catalog가 없으면 usage를 만들지 않음 (sync write는 깨지지 않음)
        createUsage(userId, hash, 1, size)
        db.exec(`UPDATE users SET assetUsedBytes = assetUsedBytes + :size
                 WHERE id = :userId`, { size, userId })
    } else {
        db.exec(`UPDATE asset_usage SET refCount = refCount + 1
                 WHERE id = :id`, { id: usage.id })
    }
}

function decrementUsage(userId, hash) {
    const usage = getUsage(userId, hash)
    if (!usage) return
    if (usage.refCount <= 1) {
        deleteUsage(usage.id)
        db.exec(`UPDATE users SET assetUsedBytes = MAX(0, assetUsedBytes - :size)
                 WHERE id = :userId`, { size: usage.size, userId })
    } else {
        db.exec(`UPDATE asset_usage SET refCount = refCount - 1
                 WHERE id = :id`, { id: usage.id })
    }
}
```

> [!IMPORTANT]
> **Hook은 "현재 상태"가 아닌 "상태 전이"를 본다.**
> `updatedAt`만 바뀐 경우 oldLive===newLive, oldHash===newHash → no-op.
> 쿼타 증감은 SQL atomic increment. PocketBase/SQLite 단일 writer로 안전.
> `asset_usage`는 accounting/ref ledger이며 hard quota gate가 아니다. catalog가 없는 remote ref는 usage를 만들지 않고, 읽기 시 404 placeholder로 degrade한다.

**Live Ref 정의**: `status === 'remote' && isDeleted === false && hash exists`

**쿼타 규칙**: 한 유저가 같은 hash를 여러 에셋에서 참조해도 **첫 번째만 차감, 마지막 해제 시 반환**.

### 5.4 GC (주기적 크론)

```javascript
// asset_usage에 참조가 없는 catalog 항목을 삭제
const orphans = db.query(`
    SELECT c.hash FROM asset_catalog c
    WHERE NOT EXISTS (
        SELECT 1 FROM asset_usage u WHERE u.hash = c.hash
    )
`)
for (const { hash } of orphans) {
    deleteFromStorage(hash)
    deleteCatalogEntry(hash)
}
```

> N+1 쿼리 대신 단일 NOT EXISTS 조인으로 처리.
> asset_usage ledger 덕분에 assets 테이블을 스캔할 필요 없음.

### 5.5 불변식 (Invariants)

```
1. local 에셋은 PUT /api/assets/{hash} 성공 후에만
   assets.status를 remote로 변경한다.
   → upload API가 quota exceeded / rate limit / size limit을 반환하면
     status는 local로 유지하고 다음 upload tick에서 재시도한다.
   → remote status write가 실패하면 다음 sync tick에서 재시도한다.
     (upload은 됐지만 status 갱신이 실패한 경우 = 안전한 실패)
   → 서버는 assets write를 catalog/quota 문제로 reject하지 않는다.
     blind sync를 유지하기 위해 hook은 가능한 범위에서만 usage를 갱신한다.

2. GC는 asset_usage에 참조가 없는 catalog 항목만 삭제한다.
   local 에셋은 쿼타/ref/GC 계산에 포함되지 않는다.

3. 서버 이전 절차 (공식↔셀프호스트 동일):
   a. 기존 remote 에셋의 ciphertext 확보 (로컬 캐시 / CDN / 구 서버)
   b. 새 서버에 PUT upload (→ catalog 생성)
   c. 새 서버로 assets 레코드 push (→ hook이 ref/쿼타 처리)
   ⚠️ 순서가 바뀌면 hook이 catalog를 찾지 못해 ref/쿼타 누락
```

---

## 6. 클라이언트 저장소 계층

```
[assets 테이블]     SOT. PB와 E2EE 동기화. {id, hash, status, encData}
[assetRegistry]    디바이스 종속. 동기화 안 됨. {id, size, accessedAt, isDeleted}
[appStorage]       실제 파일 (평문). /assets/{id}
```

---

## 7. 클라이언트 흐름

### 7.1 에셋 생성 (이미지 업로드)

```
1. 전처리: WebP 변환, 리사이징
2. 수렴 암호화: encKey, iv, ciphertext, hash 유도
3. 로컬 저장: appStorage + assets(status:local) + registry
4. [로그인 시] 백그라운드:
   a. PUT /api/assets/{hash} (ciphertext 업로드)
   b. 성공 후 assets.status → remote
   c. sync → Hook이 asset_usage 생성 + 쿼타 차감
```

### 7.2 경량 봇 임포트 (hash+encKey만)

```
공식 서버 연결 / 비로그인:
  1. 봇 카드에서 {hash, encKey} 목록 추출
  2. assets 테이블에 기록 (status: remote, hash, encKey)
  3. 실제 이미지는 다운로드하지 않음 (lazy)
  4. UI에서 에셋 필요 시 → AssetService.read(id)로 on-demand fetch

  비로그인 상태에서 생성되는 remote 에셋은 항상 공식 CDN origin으로 간주한다.

  공식 서버 로그인 시:
    sync → Hook이 asset_usage 생성 + 쿼타 차감 (업로드 불필요)

  비로그인에서 나중에 공식 서버 로그인 시:
    동일하게 sync → Hook 처리 (ref가 GC를 방지)

셀프호스트:
  1. 봇 카드에서 {hash, encKey} 추출
  2. 공식 CDN에서 ciphertext 다운로드
  3. 셀프호스트 PB에 PUT upload
  4. 성공 후 assets(status: remote) 기록
```

### 7.3 바이너리 봇 임포트

```
1. plaintext에서 encKey, hash 유도 + 검증
2. 로컬 저장 (status: local)
3. [로그인 시] 백그라운드: upload → 성공 후 status:remote → sync → Hook
```

### 7.4 봇 내보내기

| 조건 | 방식 |
|---|---|
| 공식 서버 + 모든 에셋 remote | **경량**: hash+encKey만 (수 KB) |
| 셀프호스트 또는 비로그인 | **바이너리 포함** (수 MB~) |
| 일부 에셋만 remote | **하이브리드**: remote는 경량, local은 바이너리 |

### 7.5 에셋 삭제

```
1. assets.isDeleted = true
2. appStorage 파일 삭제
3. registry → 삭제 큐
4. [로그인 시] sync → Hook이 asset_usage 감소 → 마지막이면 쿼타 반환
```

### 7.6 LRU 캐시 방출 (웹)

```
방출 대상: status=remote인 에셋만 (local은 절대 방출 불가!)
기준: accessedAt이 가장 오래된 순
방출: appStorage 파일 삭제 + registry 제거 (assets 테이블 유지)
재접근: CDN/PB에서 재다운로드 → 복호화 → 재캐시
```

### 7.7 AssetService.read(id) — 통합 읽기

```
1. appStorage에 있음? → 반환, registry.accessedAt 갱신
2. 없음 → assets 테이블에서 hash, encKey 조회
3. status == local? → 에러 (파일 유실)
4. status == remote:
   a. 공식 서버: GET {CDN}/{hash}.bin (무인증)
   b. 셀프호스트: GET {PB}/api/assets/download/{hash} (인증)
   c. 404 시: placeholder 표시 (graceful degradation)
5. sha256(ciphertext) == hash 검증
6. decrypt(ciphertext, encKey, iv) → plaintext
7. appStorage에 캐시 + registry 등록
8. 반환
```

---

## 8. 셀프호스팅

### 공식 서버와의 차이

| 항목 | 공식 서버 | 셀프호스트 |
|---|---|---|
| PB 코드 (hook, migration) | **동일** | **동일** |
| Upload API | **동일** | **동일** |
| 파일 저장소 | R2/CDN | PB 로컬 FS |
| 다운로드 인증 | 공개 | PB 인증 |
| 쿼타 | 플랜별 | 자유 설정 |
| 경량 봇 공유 | ✅ | ❌ (서버 비공개) |
| GC | **동일** | **동일** |

### 서버 이전 (공식↔셀프호스트 동일 절차)

```
1. 모든 remote 에셋의 ciphertext 확보
   - 로컬 캐시에 있으면 바로 사용
   - 없으면 기존 소스에서 다운로드 (CDN / 구 PB)
2. 새 서버에 PUT /api/assets/{hash} (순차, 이어하기 지원)
3. assets 레코드를 새 서버에 push
4. Hook이 asset_usage + 쿼타 자동 반영
```

### 클라이언트 분기점 (유일한 차이)

```typescript
function getCiphertextUrl(hash: string): string {
    if (isOfficialAssetServer()) {
        return `${CDN_BASE}/${hash}.bin`
    } else {
        return `${serverConfig.pbUrl}/api/assets/download/${hash}`
    }
}
```

---

## 9. 서버 테이블 요약

```
[assets]           동기화 대상. 클라이언트 SOT. {id, hash, status, encData}
[asset_catalog]    서버 전용. 물리 파일 목록. {hash, size}
[asset_usage]      서버 전용. 유저별 ref ledger. {userId, hash, refCount, size}
[assetRegistry]    클라이언트 전용. 기기별 캐시. {id, size, accessedAt}
```

---

## 10. 요약 매트릭스

| 동작 | 공식 서버 | 셀프호스트 | 비로그인 |
|---|---|---|---|
| 에셋 생성 | local → upload → remote | local → upload → remote | local 유지 |
| 경량 임포트 | lazy, 업로드 0 | CDN 다운 + PB 업로드 | lazy (remote) |
| 경량 내보내기 | ✅ hash+encKey | ❌ | ❌ |
| 바이너리 내보내기 | ✅ | ✅ | ✅ (로컬만) |
| 멀티 디바이스 | CDN on-demand | PB on-demand | ❌ |
| LRU 복구 | CDN 재다운로드 | PB 재다운로드 | CDN 재다운로드 |
| 서버 이전 | 전체 재업로드 | 전체 재업로드 | N/A |
