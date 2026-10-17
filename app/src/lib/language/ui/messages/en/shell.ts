// App shell: sidebar, navigation, sync status, startup, and recovery surfaces.

export const shellMessages = {
    'shell.sidebar.library': 'Library',
    'shell.sidebar.multiRooms': 'Multi Rooms',
    'shell.sidebar.settings': 'Settings',
    'shell.sidebar.currentUser': 'Current user',
    'shell.sidebar.newUser': 'New user',
    'shell.sidebar.showSidebar': 'Show sidebar',
    'shell.sidebar.showRoomPanel': 'Show room panel',
    'shell.sidebar.hideRoomPanel': 'Hide room panel',
    'shell.sidebar.closeNavigation': 'Close navigation',
    'shell.sidebar.sync.title': 'Sync status',
    'shell.sidebar.sync.statusUpToDate': 'Up to date',
    'shell.sidebar.sync.statusSyncing': 'Syncing',
    'shell.sidebar.sync.statusNetworkError': 'Network error',
    'shell.sidebar.sync.statusQuotaError': 'Quota error',
    'shell.sidebar.sync.statusAuthError': 'Authentication error',
    'shell.sidebar.sync.statusUnsafeMerge': 'Merge blocked',
    'shell.sidebar.sync.statusInitRequired': 'Setup required',
    'shell.sidebar.sync.statusServerInitializing': 'Server setup in progress',
    'shell.sidebar.sync.resolveConflict': 'Resolve sync conflict…',
    'shell.sidebar.sync.user': 'User',
    'shell.sidebar.sync.records': 'Records',
    'shell.sidebar.sync.assets': 'Assets',
    'shell.sidebar.sync.multiRoom': 'Multi-room',
    'shell.sidebar.sync.syncNow': 'Sync now',
    'shell.sidebar.sync.syncingNow': 'Syncing…',
    'shell.sidebar.sync.indicatorIdle': 'Encrypted data is synced. Activate to sync now.',
    'shell.sidebar.sync.indicatorSyncing': 'Syncing encrypted data',
    'shell.sidebar.sync.indicatorNetwork': 'Sync paused: network unavailable. Activate to retry.',
    'shell.sidebar.sync.indicatorQuota':
        'Sync paused: remote storage quota reached. Activate to retry.',
    'shell.sidebar.sync.indicatorAuth': 'Sync paused: sign-in needs attention. Activate to retry.',
    'shell.sidebar.sync.indicatorUnsafeMerge':
        'Sync stopped: deleted data could reappear if these copies merged. Nothing was changed.',
    'shell.sidebar.sync.indicatorInitRequired':
        'Sync stopped: this device has data that was never synced with the server. Choose which copy to keep.',
    'shell.sidebar.sync.indicatorServerInitializing':
        'Sync waiting: another device is setting up this data on the server.',
    'shell.sync.conflict.titleUnsafe': 'This device and the server cannot be merged safely',
    'shell.sync.conflict.titleInit': 'This device has data the server has not seen',
    'shell.sync.conflict.bodyUnsafe':
        'The copies of {:scope} on this device and on the server have diverged in a way that could bring deleted items back if merged. Choose which copy to keep.',
    'shell.sync.conflict.bodyInit':
        'This device holds {:scope} that was never synced with the copy on this server. Choose which copy to keep.',
    'shell.sync.conflict.scopeUser': 'your personal data',
    'shell.sync.conflict.scopeRoom': 'this multi room',
    'shell.sync.conflict.keepLocal': "Keep this device's data",
    'shell.sync.conflict.keepLocalHint':
        "Replaces the server's copy. Changes that exist only on the server or on other devices are lost, and those devices will be asked to choose again.",
    'shell.sync.conflict.keepServer': "Keep the server's data",
    'shell.sync.conflict.keepServerHint':
        "Replaces this device's copy. Changes that exist only on this device are lost.",
    'shell.sync.conflict.later': 'Decide later',
    'shell.sync.conflict.working': 'Resolving…',
    'shell.sync.conflict.confirmLocalTitle': "Replace the server's copy?",
    'shell.sync.conflict.confirmLocalBody':
        "The server's copy of {:scope} will be replaced with this device's. This cannot be undone.",
    'shell.sync.conflict.confirmServerTitle': "Replace this device's copy?",
    'shell.sync.conflict.confirmServerBody':
        "This device's copy of {:scope} will be replaced with the server's. This cannot be undone.",
    'shell.sync.conflict.confirmAction': 'Replace',
    'shell.sync.conflict.resolved': 'Sync conflict resolved',
    'shell.sync.conflict.failed': 'Could not resolve the conflict: {:error}',
    'shell.sync.conflict.keepLocalUnavailable':
        "Only the room's owner can replace the server's copy.",
    'shell.sync.conflict.keepServerUnavailable':
        "Another device's unfinished setup holds the server, so its copy cannot be taken now.",
    'shell.sync.conflict.errorStale':
        'This conflict was already handled or has changed. Check the sync status.',
    'shell.sync.conflict.errorChanged':
        "The server's data changed meanwhile, so it could not proceed safely. Choose again.",
    'shell.sync.conflict.errorInitializing':
        'Another device is preparing the server. Try again later.',
    'shell.sync.conflict.errorAssets':
        "Some attachments could not be fetched, so the server's copy was not replaced. Check the connection and try again.",
    'shell.sync.conflict.errorNetwork':
        'Could not reach the server. Check the connection and try again.',
    'shell.sidebar.sync.indicatorServerTransition': 'Server change in progress',
    'shell.sidebar.sync.serverTransitionTitle': 'Server change in progress',
    'shell.sidebar.sync.serverTransitionBody': 'Sync is paused until the server change finishes.',
    'shell.sidebar.sync.viewStatus': 'View sync status',
    'shell.sidebar.toast.sync': 'Could not sync',
    'shell.sidebar.toast.switchUser': 'Could not switch user',
    'shell.sidebar.toast.createUser': 'Could not create user',
    'shell.workspace.closeLabel': 'Close',
    'shell.workspace.backToSections': 'Back to sections',
    'shell.workspace.sectionsAria': '{:name} sections',
    'shell.loading.app': 'Loading KeiAI…',
    'shell.startup.label': 'Startup blocked',
    'shell.startup.failedLabel': 'Startup failed',
    'shell.startup.title': 'KeiAI could not finish starting',
    'shell.startup.continueHeading': 'How to continue',
    'shell.startup.retry': 'Retry startup',
    'shell.startup.envTitle': 'Environment configuration required',
    'shell.startup.envMessage': 'Set {:variables} before starting KeiAI.',
    'shell.startup.envInstructionAdd': 'Add {:variables} to the root .env file.',
    'shell.startup.envInstructionRestart':
        'Restart the development server or rebuild the app after updating the environment.',
    'shell.startup.cryptoOpenHttps': 'Open KeiAI from an HTTPS address.',
    'shell.startup.cryptoModernBrowser': 'Use a modern browser with Web Crypto support.',
    'shell.startup.cryptoTauri': 'Use the native Tauri app when available.',
    'shell.startup.cryptoTitleSecure': 'KeiAI requires a secure connection',
    'shell.startup.cryptoTitleUnsupported': 'This browser cannot run KeiAI securely',
    'shell.startup.cryptoMessage':
        'KeiAI needs a browser environment that supports Web Crypto for local identity and end-to-end encryption.',
    'shell.startup.dataIntact': 'Your local data has not been removed.',
    'shell.startup.checkStorage': 'Check storage permissions and connectivity before retrying.'
} as const;

export type ShellMessageKey = keyof typeof shellMessages;
