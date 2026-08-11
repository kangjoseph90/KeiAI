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

export const englishMessages = {
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
} as const;

export type MessageKey = keyof typeof englishMessages;
export type MessageTemplate<Key extends MessageKey> = (typeof englishMessages)[Key];
