## 반드시 재현해야 할 기능

1. 멀티 LLM 프로바이더 지원. 최소 OpenAI, Claude, OpenRouter, Ollama급은 초기에 들어가야 한다. RisuAI는 모델/포맷/토크나이저/스트리밍 플래그를 별도 레이어로 들고 있다. 근거는 RisuAI/src/ts/model/modellist.ts.
2. 강한 프롬프트 조립기. 메인 프롬프트, 시스템 프롬프트 대체, jailbreak, author note, persona, lorebook, 최근 대화, 메모리 요약을 순서대로 조합하는 엔진이 필요하다. 설정 표면과 설명은 RisuAI/src/lib/Setting/Pages/PromptSettings.svelte, RisuAI/src/lang/en.ts에 퍼져 있고, 처리 코어는 RisuAI/src/ts/process/index.svelte.ts, RisuAI/src/ts/process/prompt.ts다.
3. 캐릭터 카드 호환. PNG, CharX, JSON, V3 카드 import는 사실상 필수다. RisuAI 유저 유입 경로의 핵심이고, 재작성 앱이 기존 생태계를 흡수하려면 이걸 못 피한다. 근거는 RisuAI/src/ts/characterCards.ts.
4. Lorebook. 키워드 기반 활성화, depth, token cap, selective mode 정도는 초기부터 있어야 한다. 이건 캐릭터 채팅 앱에서 “기억력”보다 먼저 체감되는 품질 요소다. 근거는 RisuAI/src/ts/process/lorebook.svelte.ts, RisuAI/src/lib/Setting/Pages/GlobalLoreBookSettings.svelte.
5. Regex/스크립트 후처리. RisuAI의 실제 강점 중 하나다. input/output/display/request 변환을 분리해둔 구조는 유지 가치가 높다. 특히 KeiAI의 pipeline TODO와 정확히 맞물린다. 근거는 RisuAI/src/ts/process/scripts.ts, KeiAI/app/src/lib/generation/pipeline.ts.
6. Persona 시스템. 유저 프로필, persona prompt, 여러 persona 전환은 실제 사용 빈도가 높다. 근거는 RisuAI/src/ts/storage/database.svelte.ts, RisuAI/src/lib/Setting/Pages/PersonaSettings.svelte.
7. 긴 대화 유지 장치. 최소한 “요약 기반” 장기 기억은 필요하다. 다만 RisuAI처럼 여러 세대를 동시에 안고 갈 필요는 없다. V3 스타일 하나로 수렴하는 게 맞다. 근거는 RisuAI/src/ts/process/memory/hypamemory.ts, RisuAI/src/ts/process/memory/hypav2.ts, RisuAI/src/ts/process/memory/hypav3.ts.
8. 스트리밍 생성과 중단/부분저장. 이건 UX 기본이다. KeiAI는 이미 스트리밍 뼈대가 있으니 prompt/context만 붙이면 된다. 근거는 KeiAI/app/src/lib/generation/pipeline.ts.
9. 백업/복구. RisuAI에서는 Google Drive 백업이 여전히 살아 있는 기능이다. KeiAI는 보안 모델상 평문 드라이브 백업이 아니라 암호화된 export/recovery 중심으로 재설계하면 된다. 근거는 RisuAI/src/ts/drive/drive.ts.
10. 번역. 글로벌 유저층을 생각하면 자동 번역은 생각보다 중요하다. 다만 RisuAI처럼 옵션을 다섯 개씩 두기보다 “로컬 or LLM 보조 번역 + 캐시” 정도로 좁혀도 충분하다. 근거는 RisuAI/src/lib/Setting/Pages/LanguageSettings.svelte.
11. 감정 이미지. 니치처럼 보이지만 캐릭터 앱에서는 체감 가치가 높다. RisuAI도 이것을 메인 기능으로 계속 노출한다. 근거는 RisuAI/src/lang/en.ts, RisuAI/src/ts/process/scripts.ts.
12. 그룹 채팅. 대중 기능은 아니지만 “RisuAI를 넘는 앱”으로 인식되려면 중기 우선순위로는 높다. 근거는 RisuAI/src/ts/process/group.ts.

## 있으면 강하지만 2순위인 기능

1. TTS. 의미는 크지만 제품의 정체성을 좌우하진 않는다. 근거는 RisuAI/src/ts/process/tts.ts.
2. 추가 에셋과 인레이 이미지. 멀티모달 모델 시대라 중장기적으로 중요하지만, 초반에는 텍스트 체인을 먼저 닫는 게 맞다. 근거는 RisuAI/src/lang/en.ts, RisuAI/src/ts/characterCards.ts.
3. 모듈 시스템. KeiAI는 이미 modules 엔티티를 가지고 있으니 확장 포인트로 발전시킬 가치가 높다. 근거는 KeiAI/app/src/lib/views/ModulesView.svelte, RisuAI/src/lib/Setting/Pages/Module/ModuleSettings.svelte.
4. 플러그인 시스템. 다만 초기에 provider/plugin sandbox를 다 하려고 들면 프로젝트가 다시 복잡해진다. “간단한 후처리 훅”부터 시작하는 게 맞다. 근거는 RisuAI/src/ts/plugins/plugins.ts, RisuAI/src/lib/Setting/Pages/PluginSettings.svelte.
5. 자동 제안 응답, reroll cache, chain features. 파워유저용이지만 분명 가치가 있다. 다만 핵심 체인 완성 후다.

## 늦춰도 되거나 버려도 되는 기능

1. 메모리 시스템 다중 세대 공존. RisuAI는 HypaMemory, HypaV2, HypaV3, SupaMemory, Hanurai까지 겹친다. 이건 유지보수 짐이다. KeiAI는 하나만 설계해야 한다. 근거는 RisuAI/src/ts/process/memory.
2. Plugin V1 호환. RisuAI도 아예 거부한다. 근거는 RisuAI/src/ts/plugins/plugins.ts.
3. 오래된 카드/세이브 포맷 호환을 끝까지 안고 가는 것. import migration은 필요하지만 내부 포맷 공존은 불필요하다. 근거는 RisuAI/src/ts/characterCards.ts, RisuAI/src/ts/storage/risuSave.ts.
4. Character JavaScript. 언어 파일에서조차 보안상 비추천이라고 박아놨다. KeiAI 보안 모델과도 정면 충돌한다. 근거는 RisuAI/src/lang/en.ts.
5. RisuRealm 같은 마켓플레이스 연동. 제품 성숙 후의 네트워크 효과 기능이지, 핵심 채팅 품질 기능이 아니다. 근거는 RisuAI/src/ts/realm.ts, RisuAI/src/App.svelte.
6. Google Drive식 원격 저장 중심 설계. KeiAI는 이미 로컬 우선 E2EE 쪽으로 더 나은 방향을 잡았으니, 이것을 그대로 답습할 필요가 없다.
7. 3D, Pyodide, ComfyUI workflow, MCP 광범위 노출, dynamic request timing 같은 실험 기능. 설정 화면을 부풀리는 기능이지 제품 정체성을 만들진 않는다. 근거는 RisuAI/src/lib/Setting/Pages/AdvancedSettings.svelte.

## 레거시 신호

1. 플러그인 V1은 코드에서 명시적으로 막혀 있다. RisuAI/src/ts/plugins/plugins.ts
2. 메모리 시스템은 최소 3세대 이상이 공존한다. RisuAI/src/ts/process/memory/hypamemory.ts, RisuAI/src/ts/process/memory/hypav2.ts, RisuAI/src/ts/process/memory/hypav3.ts
3. 저장 구조는 거대한 단일 Database 객체에 기능이 계속 누적된 형태다. RisuAI/src/ts/storage/database.svelte.ts
4. 세이브 포맷도 legacy encoder와 블록형 encoder가 같이 존재한다. RisuAI/src/ts/storage/risuSave.ts
5. 설정 문구 자체가 experimental, unrecommended, legacyTranslation, legacyMediaFindings 같은 플래그를 다수 노출한다. RisuAI/src/lib/Setting/Pages/AdvancedSettings.svelte, RisuAI/src/lib/Setting/Pages/LanguageSettings.svelte, RisuAI/src/lang/en.ts

## KeiAI에 맞춘 추천 순서

1. 생성 파이프라인 완성: context snapshot, prompt builder, script stages, lorebook injection, preset/persona merge.
2. 카드 호환 완성: PNG/CharX/V3 import부터.
3. 프로바이더 레이어 완성: OpenAI, Claude, OpenRouter, Ollama.
4. 장기 기억은 하나만 구현: “HypaV3급 단일 시스템”.
5. 번역과 감정 이미지를 붙여 체감 기능 강화.
6. 그 다음에 그룹 채팅, TTS, 에셋/인레이, 플러그인 확장.


한 줄로 요약하면, KeiAI가 재현해야 하는 건 “RisuAI의 넓은 옵션 집합”이 아니라 “실제로 캐릭터 채팅 품질과 이주 가능성을 만든 기능들”이다. 가장 중요한 건 프롬프트 엔진, 카드 호환, lorebook, 후처리 스크립트, 멀티 프로바이더, 장기 기억 단일화다. 나머지는 꽤 많이 버려도 된다.