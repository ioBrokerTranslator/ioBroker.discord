// This file extends the AdapterConfig type from "@types/iobroker"

import { EmojiIdentifierResolvable, Snowflake } from 'discord.js';

// Augment the globally declared type ioBroker.AdapterConfig
declare global {
  namespace ioBroker {
    interface AdapterConfig {
      token: string;
      botName: string;
      processAllMessagesInServerChannel: boolean;
      reactOnMentions: boolean;
      reactOnMentionsEmoji: EmojiIdentifierResolvable;
      text2commandInstance: string;
      text2commandRespondWith: 'message' | 'reply' | 'none';
      dynamicServerUpdates: boolean;
      observeUserPresence: boolean;
      observeUserVoiceState: boolean;
      enableAuthorization: boolean;
      authorizedUsers: AdapterConfigAuthorizedUser[];
      processMessagesFromUnauthorizedUsers: boolean;

      enableCommands: boolean;
      cmdGetStateName: string;
      cmdSetStateName: string;
    }

    interface AdapterConfigAuthorizedUser {
      userId: Snowflake;
      getStates: boolean;
      setStates: boolean;
      useText2command: boolean;
    }

    interface CustomConfig {
      enabled?: boolean;
      enableText2command?: boolean;

      enableCommands?: boolean;
      commandsName?: string;
      commandsAlias?: string;
      commandsAllowGet?: boolean;
      commandsAllowSet?: boolean;

      commandsBooleanValueTrue?: string;
      commandsBooleanValueFalse?: string;
      commandsNumberDecimals?: number;
      commandsStringSendAsFile?: boolean;

      commandsShowAckFalse?: boolean;
      commandsSetWithAck?: boolean;
    }
  }
}

// this is required so the above AdapterConfig is found by TypeScript / type checking
export {};