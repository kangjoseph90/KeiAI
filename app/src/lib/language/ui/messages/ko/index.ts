import type { MessageKey } from '../en';
import type { MessageValue } from '../../types';
import { chatMessages } from './chat';
import { characterMessages } from './character';
import { commonMessages } from './common';
import { componentsMessages } from './components';
import { libraryMessages } from './library';
import { moduleMessages } from './module';
import { personaMessages } from './persona';
import { settingsMessages } from './settings';
import { shellMessages } from './shell';
import { tasksMessages } from './tasks';
import { workflowMessages } from './workflow';

export const koreanMessages = {
    ...commonMessages,
    ...shellMessages,
    ...settingsMessages,
    ...chatMessages,
    ...libraryMessages,
    ...characterMessages,
    ...personaMessages,
    ...moduleMessages,
    ...workflowMessages,
    ...tasksMessages,
    ...componentsMessages
} as const satisfies Record<MessageKey, MessageValue>;
