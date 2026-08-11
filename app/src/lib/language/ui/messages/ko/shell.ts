// 앱 셸: 사이드바, 내비게이션, 동기화 상태, 시작, 복구 화면.

export const shellMessages = {
    'shell.sidebar.library': '라이브러리',
    'shell.sidebar.multiRooms': '멀티 룸',
    'shell.sidebar.settings': '설정',
    'shell.sidebar.currentUser': '현재 사용자',
    'shell.sidebar.newUser': '새 사용자',
    'shell.sidebar.showSidebar': '사이드바 표시',
    'shell.sidebar.showRoomPanel': '룸 패널 표시',
    'shell.sidebar.hideRoomPanel': '룸 패널 숨기기',
    'shell.sidebar.closeNavigation': '내비게이션 닫기',
    'shell.sidebar.sync.title': '동기화 상태',
    'shell.sidebar.sync.statusUpToDate': '최신 상태',
    'shell.sidebar.sync.statusSyncing': '동기화 중',
    'shell.sidebar.sync.statusNetworkError': '네트워크 오류',
    'shell.sidebar.sync.statusQuotaError': '할당량 오류',
    'shell.sidebar.sync.statusAuthError': '인증 오류',
    'shell.sidebar.sync.user': '사용자',
    'shell.sidebar.sync.records': '레코드',
    'shell.sidebar.sync.assets': '에셋',
    'shell.sidebar.sync.multiRoom': '멀티 룸',
    'shell.sidebar.sync.syncNow': '지금 동기화',
    'shell.sidebar.sync.syncingNow': '동기화 중…',
    'shell.sidebar.sync.indicatorIdle':
        '암호화 데이터가 동기화되었습니다. 활성화하여 지금 동기화하세요.',
    'shell.sidebar.sync.indicatorSyncing': '암호화 데이터 동기화 중',
    'shell.sidebar.sync.indicatorNetwork':
        '동기화 일시 중지: 네트워크를 사용할 수 없습니다. 활성화하여 다시 시도하세요.',
    'shell.sidebar.sync.indicatorQuota':
        '동기화 일시 중지: 원격 저장소 할당량이 가득 찼습니다. 활성화하여 다시 시도하세요.',
    'shell.sidebar.sync.indicatorAuth':
        '동기화 일시 중지: 로그인 확인이 필요합니다. 활성화하여 다시 시도하세요.',
    'shell.sidebar.sync.indicatorServerTransition': '서버 변경 진행 중',
    'shell.sidebar.sync.serverTransitionTitle': '서버 변경 진행 중',
    'shell.sidebar.sync.serverTransitionBody':
        '서버 변경이 완료될 때까지 동기화가 일시 중지됩니다.',
    'shell.sidebar.sync.viewStatus': '동기화 상태 보기',
    'shell.sidebar.toast.sync': '동기화할 수 없습니다',
    'shell.sidebar.toast.switchUser': '사용자를 전환할 수 없습니다',
    'shell.sidebar.toast.createUser': '사용자를 만들 수 없습니다',
    'shell.workspace.closeLabel': '닫기',
    'shell.workspace.backToSections': '섹션으로 돌아가기',
    'shell.workspace.sectionsAria': '{:name} 섹션',
    'shell.loading.app': 'KeiAI 로드 중…',
    'shell.startup.label': '시작 차단됨',
    'shell.startup.failedLabel': '시작 실패',
    'shell.startup.title': 'KeiAI를 시작하지 못했습니다',
    'shell.startup.continueHeading': '계속하는 방법',
    'shell.startup.retry': '시작 다시 시도',
    'shell.startup.envTitle': '환경 설정이 필요합니다',
    'shell.startup.envMessage': 'KeiAI를 시작하기 전에 {:variables}를(을) 설정하세요.',
    'shell.startup.envInstructionAdd': '루트 .env 파일에 {:variables}를(을) 추가하세요.',
    'shell.startup.envInstructionRestart':
        '환경 업데이트 후 개발 서버를 다시 시작하거나 앱을 다시 빌드하세요.',
    'shell.startup.cryptoOpenHttps': 'HTTPS 주소에서 KeiAI를 여세요.',
    'shell.startup.cryptoModernBrowser': 'Web Crypto를 지원하는 최신 브라우저를 사용하세요.',
    'shell.startup.cryptoTauri': '가능하면 네이티브 Tauri 앱을 사용하세요.',
    'shell.startup.cryptoTitleSecure': 'KeiAI에는 보안 연결이 필요합니다',
    'shell.startup.cryptoTitleUnsupported': '이 브라우저에서는 KeiAI를 안전하게 실행할 수 없습니다',
    'shell.startup.cryptoMessage':
        'KeiAI는 로컬 신원과 종단 간 암호화를 위해 Web Crypto를 지원하는 브라우저 환경이 필요합니다.',
    'shell.startup.dataIntact': '로컬 데이터는 제거되지 않았습니다.',
    'shell.startup.checkStorage': '다시 시도하기 전에 저장소 권한과 연결을 확인하세요.'
} as const;

export type ShellMessageKey = keyof typeof shellMessages;
