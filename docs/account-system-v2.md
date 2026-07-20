# KeiAI 계정 시스템 설계 (v2)

## 핵심 원칙

**정체성은 로컬에서 시작한다.** 유저의 정체성은 서버 계정이 아니라 로컬에서 생성된 UUID + 마스터키(M)이다. 서버는 이 정체성을 "보관"할 뿐, "생성"하지 않는다.

**username/password는 사용자-facing 계정이다.** 단, 서버가 아는 비밀번호는 raw password가 아니라 클라이언트에서 파생한 로그인 키 X이다. 같은 password에서 클라이언트 전용 암호화 키 Y도 파생되며, 서버는 Y와 M을 절대 알 수 없다.

**이메일은 불필요하다.** KeiAI는 이메일 기반 비밀번호 리셋을 제공하지 않는다. 복구 코드가 유일한 복구 경로이므로, 이메일을 수집할 이유가 없다. 이메일은 선택적으로만 받는다 (공지 수신 목적).

---

## 1. 정체성 모델

```
앱 최초 실행
├─ UUID 생성 (nanoid)          ← 유저의 영구 식별자
├─ M 생성 (AES-256-GCM)       ← 동기화 데이터 암호화 키
└─ Identity Key Pair 생성      ← RSA-OAEP, 미래 Room Key wrapping용
    (공개키 + 비밀키)

→ 즉시 앱 사용 가능 (게스트 모드)
→ 서버 연결 없이 모든 로컬 기능 동작
```

### M의 속성

| 속성        |      값       | 이유                                                  |
| ----------- | :-----------: | ----------------------------------------------------- |
| 알고리즘    |  AES-256-GCM  | 업계 표준 AEAD                                        |
| extractable | `true` (항상) | 로컬 DB가 평문이므로 non-extractable의 보안 이점 없음 |
| 생성 시점   | 앱 최초 실행  | 서버 독립적 정체성                                    |
| 변경 여부   |   **불변**    | 서버를 옮기든, 비밀번호를 바꾸든 M은 동일             |

### Identity Key Pair 의 속성

| 속성     |                        값                         |
| -------- | :-----------------------------------------------: |
| 알고리즘 |                    RSA-OAEP SHA-256               |
| 공개키   | 서버에 평문 저장 (타 유저가 Room Key 교환에 사용) |
| 비밀키   |           서버에 M으로 암호화하여 저장            |
| 용도     |           미래 멀티 룸의 Room Key 교환            |

---

## 2. 서버 계정 생성 / 로그인

유저가 동기화를 원할 때 **username + password**를 설정한다.

PocketBase auth의 identity는 이메일이 아니라 유저가 고른 `username`을 사용한다. `userId`는 서버 record id이자 모든 데이터의 canonical owner id로 유지된다.

### 플로우

```
계정 생성:
  salt = generateSalt()
  { X, Y } = deriveKeys(password, salt)
  M(Y) = wrapMasterKey(M, Y)
  recovery = createRecoveryData(M)
  users.create({ id: userId, username, password: X, salt, M(Y), M(Z)... })
  username 중복은 create 실패로만 노출

로그인:
  POST /api/account/salt { username } → { salt }
  존재하지 않는 username은 deterministic dummy salt 반환
  { X, Y } = deriveKeys(password, salt)
  authWithPassword(username, X)
  서버 record.id(userId)를 canonical identity로 사용
  Y로 M(Y) 복호화
```

### 서버에 저장되는 데이터

| 필드                        | 내용                    | 서버가 읽을 수 있나? |
| --------------------------- | ----------------------- | :------------------: |
| id                          | UUID / canonical userId |          ✅          |
| username                    | 로그인 alias            |          ✅          |
| salt                        | KDF용 솔트              |   ✅ (공개 데이터)   |
| password                    | X (로그인 키 해시)      |     ✅ (인증용)      |
| encryptedMasterKey          | M(Y)                    |          ❌          |
| masterKeyIv                 | M(Y) IV                 |   ✅ (공개 데이터)   |
| encryptedRecoveryMasterKey  | M(Z)                    |          ❌          |
| recoveryMasterKeyIv         | M(Z) IV                 |          ✅          |
| recoveryAuthTokenHash       | 복구 코드 뒤 절반 해시  |     ✅ (인증용)      |
| identityPublicKey           | 공개키 JWK              |   ✅ (의도적 공개)   |
| encryptedIdentityPrivateKey | E(비밀키, M)            |          ❌          |
| email                       | (선택)                  |          ✅          |

---

## 3. 새 기기 연결

### 방법 A: QR 페어링 (기존 기기 있을 때)

**보안 원칙**: 서버는 raw pairingCode를 절대 수신하지 않는다. HKDF로 lookup용 키와 암호화용 키를 분리한다.

```
기존 기기:
  pairingCode = random(8자리 영숫자)
  lookupId = SHA-256(HKDF(pairingCode, info="lookup"))
  encKey   = HKDF(pairingCode, info="encrypt")
  payload  = { userId, rawM, identityKeyPair }
  blob     = AES-GCM(encKey, payload)
  서버에 저장: POST /api/pairing { id: lookupId, blob, ttl: 300 }
  화면에 QR 표시 (pairingCode 인코딩)

새 기기:
  QR 스캔 → pairingCode 획득
  lookupId = SHA-256(HKDF(pairingCode, info="lookup"))
  encKey   = HKDF(pairingCode, info="encrypt")
  GET /api/pairing/{lookupId} → encrypted blob 수신
  payload  = AES-GCM-decrypt(encKey, blob)
  로컬 세션 세팅 (userId, username, M, identityKeyPair)
  → 즉시 동기화 시작
```

- 비밀번호 입력 없음
- 복구 코드 소모 없음 (재발급 없음)
- 서버는 lookupId(해시)와 암호화된 blob만 보유 — raw pairingCode, encKey 미수신
- QR은 별도 보안 경로가 아니라 pairingCode를 자동 입력하는 인코딩 수단이다. QR 스캔과 수동 입력은 같은 코드, 같은 HKDF 분리, 같은 보안 속성을 가진다.
- 페어링 엔드포인트는 TTL, 조회 성공 시 즉시 삭제, 실패 횟수 제한, IP rate limit을 적용한다.

> **위험 프로파일**: 8자리 영숫자 = ~41비트. 서버 운영자가 brute-force를 시도하면 ~2.8조 HKDF 연산으로 이론적 해독 가능. TTL 5분 + 단발성(조회 즉시 삭제)으로 완화. QR 페어링은 서버를 어느 정도 신뢰하는 시나리오에서 사용하며, 서버를 신뢰하지 않는 경우 복구 코드(59비트)를 사용한다.

### 방법 B: 복구 코드 (기존 기기 없을 때)

```
새 기기:
  복구 코드 24자리 입력
  뒤 12자리 → hash → 서버에서 유저 찾기 (식별 + 인증)
  서버: M(Z), identity keys 반환
  앞 12자리 → Z 파생 → M(Z) 복호화 → raw M 획득
  identity keys 복호화 (M으로)
  로컬 세션 세팅
  → 새 복구 코드 즉시 발급 (기존 코드 무효화)
  → UI: 새 복구 코드 강제 표시
```

- 비밀번호 입력 없음
- 복구 코드 소모됨 → 새 코드 발급

---

## 4. 복구 코드

### 형식

```
XXXX-XXXX-XXXX-XXXX-XXXX-XXXX   (24자, 대시 구분)
      앞 12자리          뒤 12자리
      ↓                  ↓
      Z 파생 (암호화)     인증 토큰 (서버 lookup)
```

| 속성               |           값           |
| ------------------ | :--------------------: |
| 총 길이            |     24자 (영숫자)      |
| 앞 12자리 엔트로피 |        ~59비트         |
| 뒤 12자리 엔트로피 |        ~59비트         |
| 서버 저장          | hash(뒤 12자리)만 저장 |

### 발급/재발급 시점

| 시점                       | 발급 | 이유               |
| -------------------------- | :--: | ------------------ |
| 서버 최초 연결 (신규 등록) |  ✅  | M(Z) 최초 생성     |
| 복구 코드로 기기 연결      |  ✅  | 사용된 코드 무효화 |
| 비밀번호 변경              |  ✅  | M(Z) 재생성        |
| 비밀번호로 서버 재연결     |  ❌  | 기존 코드 유효     |
| QR 페어링                  |  ❌  | 복구 코드 미사용   |

---

## 5. 비밀번호의 역할

비밀번호는 **서버와의 관계에서만 존재**한다.

| 용도              | 설명                                 |
| ----------------- | ------------------------------------ |
| **서버 연결**     | 신규 등록 또는 재연결 시 인증        |
| **M(Y) 보호**     | 서버 DB가 유출되어도 M을 보호        |
| **비밀번호 변경** | 복구 코드로 인증 후 새 비밀번호 설정 |
| **계정 삭제**     | 복구 코드로 인증 후 서버 계정 제거   |

> 비밀번호는 로컬에 저장되지 않는다. 입력 시 KDF를 돌려 X, Y를 파생한 후 즉시 소멸한다.

---

## 6. 세션 구조 (단순화)

```typescript
// session.ts
let activeUserId: string | null = null;
let activeMasterKey: CryptoKey | null = null;
let activeIdentityKeyPair: CryptoKeyPair | null = null;
```

PocketBase SDK의 auth store는 메모리 전용으로 사용한다. 토큰 영속화는 `AuthService`가
`userId × serverUrl` 키로 관리하며, 앱 시작·유저 전환·서버 전환 시 해당 세션만 복원한다.
PocketBase 기본 `LocalAuthStore`는 전역 슬롯 하나만 제공하므로 사용하지 않는다.

### 제거된 것

| 제거 항목                | 이전 역할           | 대체                                          |
| ------------------------ | ------------------- | --------------------------------------------- |
| `isGuest` 플래그         | 게스트/등록 구분    | `username` 존재 여부 + `pb.authStore.isValid` |
| extractable 라이프사이클 | XSS 방어            | 로컬이 평문이므로 의미 없음. 항상 `true`      |
| `lockMasterKey()`        | 등록 후 M 잠금      | 제거                                          |
| `unlockMasterKey()`      | 해제 시 M 잠금 해제 | 제거                                          |

---

## 7. 서버 이전

유저가 공식 서버에서 자기 서버로 옮기거나, 다시 돌아오는 시나리오.

### 이전 흐름

```
공식 서버 사용 중
→ [동기화 해제] (auth token 삭제, 서버 계정은 유지)
→ UserRecord.syncServerUrl 변경 (새 서버 주소)
→ [서버 연결] (비밀번호 입력)
→ 새 서버에 신규 등록 (같은 UUID, 새 salt/X/Y/M(Y))
→ Full push (로컬 데이터 전부 → encrypt(M) → 새 서버)
→ 새 복구 코드 발급
```

### 원래 서버로 복귀

```
→ [동기화 해제]
→ syncServerUrl을 공식 서버로 변경
→ [서버 연결] (공식 서버 비밀번호 입력)
→ 재연결 (계정이 살아있으므로)
→ 동기화 재개
```

### 왜 깨지지 않나

- **M은 불변** — 어떤 서버에 연결하든 같은 M으로 암호화/복호화
- **UUID는 클라이언트 소유** — 서버가 바뀌어도 모든 레코드의 userId FK 유효
- **syncServerUrl은 UserRecord에 저장** — 로컬 전용, 동기화 대상 아님
- **공식 서버도 URL로 저장** — 공식/커스텀 여부는 별도 상태가 아니라 `syncServerUrl === DEFAULT_SYNC_SERVER_URL` 비교로만 판단

---

## 8. 유저 레코드

```typescript
interface UserRecord {
  id: string; // UUID (정체성의 핵심)
  username?: string; // 현재 syncServerUrl에서의 login alias
  name: string; // 표시 이름 (편집 가능)
  email?: string; // 선택 (공지 수신용)
  avatar: string; // identicon URL
  createdAt: number;
  updatedAt: number;
  isDeleted: boolean;
  masterKey: CryptoKey; // M (항상 extractable)
  identityKeyPair: CryptoKeyPair; // RSA-OAEP
  syncServerUrl?: string; // 계정 작업 대상 서버. 연결 상태 자체가 아님
}
```

### 동기화 상태 판별

```typescript
username === undefined;
// local-only

syncServerUrl !== undefined && username === undefined;
// sync server selected, account not linked

username !== undefined && !pb.authStore.isValid;
// linked, disconnected

username !== undefined && pb.authStore.isValid;
// connected

syncServerUrl === DEFAULT_SYNC_SERVER_URL;
// official sync server
```

### 제거된 필드

| 필드      | 이유                                            |
| --------- | ----------------------------------------------- |
| `isGuest` | `username` 존재 여부와 PB auth 상태로 파생 가능 |

---

## 9. 전체 UX 요약

```
┌─ 앱 첫 실행 ──────────────────────────────────────┐
│  → UUID + M + Identity KeyPair 자동 생성           │
│  → 즉시 사용 가능 (게스트)                          │
└───────────────────────────────────────────────────┘

┌─ 동기화 하고 싶을 때 ─────────────────────────────┐
│  → username + password 입력 → [계정 생성]          │
│  → 복구 코드 발급 (반드시 저장)                     │
└───────────────────────────────────────────────────┘

┌─ 새 기기 (기존 기기 있음) ────────────────────────┐
│  → 기존 기기에서 [다른 기기 연결] → QR 표시         │
│  → 새 기기에서 QR 스캔 → 즉시 연결                 │
└───────────────────────────────────────────────────┘

┌─ 새 기기 (기존 기기 없음) ────────────────────────┐
│  → 복구 코드 24자리 입력 → 즉시 연결               │
│  → 새 복구 코드 발급 (기존 것 소멸)                 │
└───────────────────────────────────────────────────┘

┌─ 서버 옮기고 싶을 때 ────────────────────────────┐
│  → [동기화 해제] → 서버 URL 변경 → 비밀번호 입력   │
│  → 새 서버에 등록 → 데이터 full push               │
└───────────────────────────────────────────────────┘
```

---

## 10. 보안 속성 요약

| 위협                       | 방어                                                                      |
| -------------------------- | ------------------------------------------------------------------------- |
| 서버 DB 유출               | M(Y)는 비밀번호 파생 Y 없이 복호화 불가                                   |
| 서버 운영자 도청           | 서버는 암호문과 메타데이터만 보유 (Zero-Knowledge)                        |
| XSS (브라우저 스크립팅)    | 로컬 DB가 평문이므로, XSS = 로컬 데이터 노출. M의 extractable 여부와 무관 |
| 기기 도난 (잠금 해제 상태) | 로컬 DB 평문 접근 가능. OS 레벨 보안(화면 잠금) 의존                      |
| 복구 코드 유출             | 사용 시 즉시 재발급으로 일회용 보장. 59비트 엔트로피 + rate limit         |
| 중간자 공격 (MITM)         | TLS + AES-GCM 이중 보호. TLS가 뚫려도 암호문만 노출                       |

---

## 11. 서버 엔드포인트

### 커스텀 훅 (PocketBase JS Hooks)

| 엔드포인트                     | 메서드 | 인증 | 용도                                                                              |
| ------------------------------ | :----: | :--: | --------------------------------------------------------------------------------- |
| `/api/account/salt`            |  POST  |  ❌  | username salt 조회. 항상 `{ salt }` 반환. 미가입 username은 dummy salt 반환       |
| `/api/recovery/lookup`         |  POST  |  ❌  | 복구 코드로 계정 조회. `{ authTokenHash }` → `{ userId, M(Z), identity keys... }` |
| `/api/recovery/reset-password` |  POST  |  ❌  | 복구 코드 인증 후 password/salt/M(Y)/M(Z) 갱신                                    |
| `/api/recovery/delete`         |  POST  |  ❌  | 복구 코드 인증 후 원격 계정 삭제                                                  |
| `/api/pairing`                 |  POST  |  ✅  | QR/수동 페어링 blob 임시 저장. `{ lookupId, blob, ttl }`. IP rate limit 필수      |
| `/api/pairing/{lookupId}`      |  GET   |  ❌  | 페어링 blob 조회 + 즉시 삭제 (one-time). 실패 횟수 제한 필수                      |

### PocketBase 내장 (재활용)

| 동작                          | PB API                                                                      | 비고                                             |
| ----------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------ |
| 신규 등록                     | `pb.collection('users').create({ id: userId, username, password: X, ... })` | 클라이언트 지정 ID. PB username auth 활성화 필요 |
| 비밀번호 인증                 | `pb.collection('users').authWithPassword(username, X)`                      | X = loginKey                                     |
| 계정 업데이트 (비밀번호 변경) | `pb.collection('users').update(id, { ... })`                                | 인증 필요                                        |
| 계정 삭제                     | `pb.collection('users').delete(id)`                                         | 인증 필요                                        |
| 데이터 동기화                 | `pb.collection('{table}').getList/create/update`                            | Blind Sync                                       |
| 실시간 구독                   | `pb.realtime.subscribe('{table}')`                                          | SSE push                                         |

## 12. 오픈 퀘스천

### 커뮤니티 (멀티 룸)

- 커뮤니티 서버는 동기화 서버와 별개인가, 동일 서버인가?
- 셀프호스팅 유저의 커뮤니티 참여는 어떻게 처리하나?
- Room Key 교환에 Identity Key Pair가 사용될 때, 서버별로 다른 키를 써야 하나?
- 커뮤니티 "계정"과 동기화 "계정"의 관계는?
- 커뮤니티 데이터의 저장 위치 (로컬 메모리 only vs 로컬 DB)

### 프로필 데이터 암호화

- name, avatar, email 등 프로필 데이터를 서버에 올릴 때 암호화해야 하는가?
- 동기화 전용 서버: 암호화가 zero-knowledge 원칙에 일관
- 커뮤니티 참여 시: 서버가 name/avatar를 읽을 수 있어야 타 유저에게 표시 가능
- 유저가 명시적으로 "프로필 공개"를 선택하게 하는 방식?

이 질문들은 계정 시스템의 기본 구조가 확정된 후, 커뮤니티 기능을 설계할 때 답해야 한다.
