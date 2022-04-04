import 'source-map-support/register';

import { basename } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { boundMethod } from 'autobind-decorator';

import {
  Adapter,
  AdapterOptions,
} from '@iobroker/adapter-core';

import {
  Client,
  Collection,
  Intents,
  Message,
  MessageOptions,
  NonThreadGuildBasedChannel,
  Presence,
  PresenceData,
  PresenceStatusData,
  Snowflake,
  User,
} from 'discord.js';

import {
  SetBotPresenceOptions,
  StateId2SendTargetInfo,
  Text2commandMessagePayload,
  VALID_ACTIVITY_TYPES,
  VALID_PRESENCE_STATUS_DATA,
  ValidActivityType,
  JsonServersMembersObj,
  JsonServersChannelsObj,
  JsonUsersObj,
  UpdateUserPresenceResult,
  JsonMessageObj,
} from './lib/definitions';

/**
 * ioBroker.discord adapter
 */
class DiscordAdapter extends Adapter {

  /**
   * Local cache for `info.connection` state.
   */
  private infoConnected: boolean = false;

  /**
   * Instance of the discord client.
   */
  private client: Client | null = null;

  /**
   * Mapping of state IDs to some information where to send messages to.
   * The state ID is only used until the last channel ID, e.g.
   * `discord.0.servers.813364154118963251.channels.813364154559102996.channels.813364154559102998`
   * or `discord.0.users.490222742801481728`.
   */
  private stateId2SendTargetInfo: StateId2SendTargetInfo = new Map();

  /**
   * Set of state IDs where received discord messages will be stored to.
   * Used to identify target states for received discord messages.
   */
  private messageReceiveStates: Set<string> = new Set();

  /**
   * Set of objects from this instance with text2command enabled.
   */
  private text2commandObjects: Set<string> = new Set();

  /**
   * Cache for `extendObjectCache(...)` calls to extend objects only when changed.
   */
  private extendObjectCache: Collection<string, ioBroker.PartialObject> = new Collection();

  /**
   * Cache for `.json` states.
   */
  private jsonStateCache: Collection<string, JsonServersMembersObj | JsonServersChannelsObj | JsonUsersObj | JsonMessageObj> = new Collection();

  public constructor(options: Partial<AdapterOptions> = {}) {
    super({
      ...options,
      name: 'discord',
    });
    this.on('ready', this.onReady);
    this.on('stateChange', this.onStateChange);
    this.on('objectChange', this.onObjectChange);
    this.on('message', this.onMessage);
    this.on('unload', this.onUnload);
  }

  /**
   * Is called when databases are connected and adapter received configuration.
   */
  @boundMethod
  private async onReady(): Promise<void> {

    // Reset the connection indicator during startup
    this.setInfoConnectionState(false, true);

    this.client = new Client({
      intents: [
        Intents.FLAGS.GUILDS,
        Intents.FLAGS.GUILD_MEMBERS,
        Intents.FLAGS.GUILD_MESSAGES,
        Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
        Intents.FLAGS.GUILD_MESSAGE_TYPING,
        Intents.FLAGS.GUILD_PRESENCES,
        Intents.FLAGS.DIRECT_MESSAGES,
        Intents.FLAGS.DIRECT_MESSAGE_REACTIONS,
        Intents.FLAGS.DIRECT_MESSAGE_TYPING,
      ],
      partials: [
        'CHANNEL', // needed for DMs
      ],
    });

    this.client.on('ready', this.onClientReady);

    this.client.on('warn', (message) => this.log.warn(`Discord client warning: ${message}`));
    this.client.on('error', (err) => this.log.error(`Discord client error: ${err.toString()}`));
    this.client.on('rateLimit', (rateLimitData) => this.log.warn(`Discord client rate limit hit: ${JSON.stringify(rateLimitData)}`));
    this.client.on('invalidRequestWarning', (invalidRequestWarningData) => this.log.warn(`Discord client invalid request warning: ${JSON.stringify(invalidRequestWarningData)}`));

    this.client.on('invalidated', () => {
      this.log.warn('Discord client session invalidated');
      this.setInfoConnectionState(false);
    });

    this.client.on('shardError', (err) => {
      // discord.js internally handles websocket errors and reconnects
      // this is just for some logging
      this.log.warn(`Discord client websocket error: ${err.toString()}`);
      this.setInfoConnectionState(false);
    });
    this.client.on('shardReady', (shardId) => {
      // discord.js websocket is ready (connected)
      this.log.info(`Discord client websocket connected (shardId:${shardId})`);
      this.setInfoConnectionState(true);
      this.setBotPresence();
    });
    this.client.on('shardResume', (shardId, replayedEvents) => this.log.debug(`Discord client websocket resume (shardId:${shardId} replayedEvents:${replayedEvents})`));
    this.client.on('shardDisconnect', (event, shardId) => this.log.debug(`Discord client websocket disconnect (shardId:${shardId} ${event.reason})`));
    this.client.on('shardReconnecting', (shardId) => this.log.debug(`Discord client websocket reconnecting (shardId:${shardId})`));

    this.client.on('messageCreate', this.onClientMessageCreate);

    if (this.config.dynamicServerUpdates) {
      this.client.on('channelCreate', () => this.updateGuilds());
      this.client.on('channelDelete', () => this.updateGuilds());
      this.client.on('channelUpdate', () => this.updateGuilds());
      this.client.on('guildCreate', () => this.updateGuilds());
      this.client.on('guildDelete', () => this.updateGuilds());
      this.client.on('guildUpdate', () => this.updateGuilds());
      this.client.on('guildMemberAdd', () => this.updateGuilds());
      this.client.on('guildMemberRemove', () => this.updateGuilds());
      this.client.on('roleCreate', () => this.updateGuilds());
      this.client.on('roleDelete', () => this.updateGuilds());
      this.client.on('roleUpdate', () => this.updateGuilds());
      this.client.on('userUpdate', () => this.updateGuilds());
    }

    if (this.config.observeUserPresence) {
      this.client.on('presenceUpdate', (_oldPresence, newPresence) => { this.updateUserPresence(newPresence.userId, newPresence); });
    }

    // subscribe needed states and objects
    this.subscribeStates('*.send');
    this.subscribeStates('*.sendFile');
    this.subscribeStates('*.sendReply');
    this.subscribeStates('*.sendReaction');
    this.subscribeStates('bot.*');
    this.subscribeForeignObjects('*'); // needed to handle custom object configs

    // initially get objects with custom.enableText2command enabled
    const view = await this.getObjectViewAsync('system', 'custom', {
      startkey: `${this.namespace}.`,
      endkey: `${this.namespace}.\u9999`,
    });
    if (view?.rows) {
      for (const item of view.rows) {
        this.setupObjCustom(item.id, item.value?.[this.namespace]);
      }
    }

    try {
      await this.client.login(this.config.token);
    } catch (err) {
      if (err instanceof Error) {
        this.log.error(`Discord login error: ${err.toString()}`);
      } else {
        this.log.error(`Discord login error`);
      }
    }
  }

  /**
   * When the discord client is ready.
   */
  @boundMethod
  private async onClientReady (): Promise<void> {
    if (!this.client?.user) {
      this.log.error('Discord client has no user!');
      return;
    }

    this.log.info(`Logged in as ${this.client.user.tag}!`);
    this.log.debug(`User ID: ${this.client.user.id}`);

    // change the bot username/nickname if needed
    if (this.config.botName) {
      if (this.client.user.username !== this.config.botName) {
        // update needed
        this.log.debug(`Update of bot name needed - current name: ${this.client.user.username} - configured name: ${this.config.botName}`);
        try {
          const proms: Promise<any>[] = [];
          proms.push(this.client.user.setUsername(this.config.botName));

          for (const [, guild] of this.client.guilds.cache) {
            const me = guild.members.cache.get(this.client.user.id);
            if (me) {
              proms.push(me.setNickname(this.config.botName));
            }
          }

          await Promise.all(proms);
          this.log.debug(`Bot name updated`);
        } catch (err) {
          this.log.warn(`Error setting the bot name to "${this.config.botName}": ${err}`);
        }
      } else {
        // up to date
        this.log.debug('Bot name is up to date');
      }
    }

    await this.updateGuilds();
  }

  /**
   * Update the guilds (servers), channels and users seen by the discord bot.
   * This will create/update all dynamic objects for all servers and users if needed.
   */
  private async updateGuilds (): Promise<void> {
    if (!this.client?.user) {
      throw new Error('Client not loaded');
    }

    /**
     * Collection of known users on all known servers.
     * Used to create/delete user objects.
     */
    const allServersUsers: Collection<Snowflake, { user: User, presence: Presence | null }> = new Collection();

    /**
     * Set of object IDs for all known servers and channels.
     * Used to detect server/channel objects which have be deleted.
     */
    const knownServersAndChannelsIds: Set<string> = new Set();

    const guilds = await this.client.guilds.fetch();
    for (const [, guildBase] of guilds) {
      const guild = await guildBase.fetch();

      knownServersAndChannelsIds.add(`${this.namespace}.servers.${guild.id}`);

      // create channel for this guild
      await this.extendObjectAsyncCached(`servers.${guild.id}`, {
        type: 'channel',
        common: {
          name: guild.name,
        },
        native: {},
      });
      await this.extendObjectAsyncCached(`servers.${guild.id}.members`, {
        type: 'channel',
        common: {
          name: `Members`, // TODO: i18n
        },
        native: {},
      });
      await this.extendObjectAsyncCached(`servers.${guild.id}.channels`, {
        type: 'channel',
        common: {
          name: `Channels`, // TODO: i18n
        },
        native: {},
      });

      // add guild member objects
      const guildMembers = await guild.members.fetch();
      for (const [, member] of guildMembers) {
        // remember user if not the bot itself
        if (member.user.id !== this.client.user.id) {
          allServersUsers.set(member.user.id, { user: member.user, presence: member.presence });
        }

        // TODO: needed???
        await this.extendObjectAsyncCached(`servers.${guild.id}.members.${member.id}`, {
          type: 'channel',
          common: {
            name: `${member.displayName} (${member.user.tag})`,
          },
          native: {},
        });

        await this.extendObjectAsyncCached(`servers.${guild.id}.members.${member.id}.roles`, {
          type: 'state',
          common: {
            name: `Roles`, // TODO: i18n
            desc: 'Roles of this member', // TODO: i18n
            role: 'text',
            type: 'string',
            read: true,
            write: false,
            def: '',
          },
          native: {},
        });
        const memberRoles = member.roles.cache.map((role) => role.name);
        await this.setStateAsync(`servers.${guild.id}.members.${member.id}.roles`, memberRoles.join(', '), true);

        await this.extendObjectAsyncCached(`servers.${guild.id}.members.${member.id}.tag`, {
          type: 'state',
          common: {
            name: `Tag`, // TODO: i18n
            desc: 'Tag of this member', // TODO: i18n
            role: 'text',
            type: 'string',
            read: true,
            write: false,
            def: '',
          },
          native: {},
        });
        await this.setStateAsync(`servers.${guild.id}.members.${member.id}.tag`, member.user.tag, true);

        await this.extendObjectAsyncCached(`servers.${guild.id}.members.${member.id}.displayName`, {
          type: 'state',
          common: {
            name: `Display name`, // TODO: i18n
            desc: 'Display name of this member', // TODO: i18n
            role: 'text',
            type: 'string',
            read: true,
            write: false,
            def: '',
          },
          native: {},
        });
        await this.setStateAsync(`servers.${guild.id}.members.${member.id}.displayName`, member.displayName, true);

        await this.extendObjectAsyncCached(`servers.${guild.id}.members.${member.id}.joinedAt`, {
          type: 'state',
          common: {
            name: `Joined at`, // TODO: i18n
            desc: 'When the member joined the server', // TODO: i18n
            role: 'date',
            type: 'number',
            read: true,
            write: false,
            def: 0,
          },
          native: {},
        });
        await this.setStateAsync(`servers.${guild.id}.members.${member.id}.joinedAt`, member.joinedTimestamp, true);

        await this.extendObjectAsyncCached(`servers.${guild.id}.members.${member.id}.json`, {
          type: 'state',
          common: {
            name: `JSON`, // TODO: i18n
            desc: 'JSON data for this member', // TODO: i18n
            role: 'json',
            type: 'string',
            read: true,
            write: false,
            def: '',
          },
          native: {},
        });

        const json: JsonServersMembersObj = {
          tag: member.user.tag,
          id: member.id,
          displayName: member.displayName,
          roles: memberRoles,
          joined: member.joinedTimestamp,
        };
        if (!isDeepStrictEqual(json, this.jsonStateCache.get(`${this.namespace}.servers.${guild.id}.members.${member.id}.json`))) {
          await this.setStateAsync(`servers.${guild.id}.members.${member.id}.json`, JSON.stringify(json), true);
          this.jsonStateCache.set(`${this.namespace}.servers.${guild.id}.members.${member.id}.json`, json);
        }

      }

      // guild channels
      const channels = await guild.channels.fetch();
      // loop over all channels twice to setup the parent channel objects first and afterwards the child channel objects
      for (const parents of [true, false]) {
        for (const [, channel] of channels) {
          if ((parents && channel.parentId) || (!parents && !channel.parentId)) {
            continue;
          }
          const channelIdPrefix = parents ? `servers.${guild.id}.channels.${channel.id}` : `servers.${guild.id}.channels.${channel.parentId}.channels.${channel.id}`;

          knownServersAndChannelsIds.add(`${this.namespace}.${channelIdPrefix}`);

          let icon: string | undefined = undefined;
          if (channel.isText()) {
            icon = 'channel-text.svg';
          }
          if (channel.isVoice()) {
            icon = 'channel-voice.svg';
          }
          await this.extendObjectAsyncCached(channelIdPrefix, {
            type: 'channel',
            common: {
              name: channel.parent ? `${channel.parent.name} / ${channel.name}` : channel.name,
              icon,
            },
            native: {
              channelId: channel.id,
            },
          });
          await this.extendObjectAsyncCached(`${channelIdPrefix}.json`, {
            type: 'state',
            common: {
              name: `JSON`, // TODO: i18n
              desc: 'JSON data for this channel', // TODO: i18n
              role: 'json',
              type: 'string',
              read: true,
              write: false,
              def: '',
            },
            native: {},
          });
          if (channel.type === 'GUILD_CATEGORY') {
            await this.extendObjectAsyncCached(`${channelIdPrefix}.channels`, {
              type: 'channel',
              common: {
                name: `Channels`, // TODO: i18n
              },
              native: {},
            });
          }
          await this.extendObjectAsyncCached(`${channelIdPrefix}.memberCount`, {
            type: 'state',
            common: {
              name: `Member count`, // TODO: i18n
              role: 'value',
              type: 'number',
              read: true,
              write: false,
              def: 0,
            },
            native: {},
          });
          await this.extendObjectAsyncCached(`${channelIdPrefix}.members`, {
            type: 'state',
            common: {
              name: `Members`, // TODO: i18n
              role: 'text',
              type: 'string',
              read: true,
              write: false,
              def: '',
            },
            native: {},
          });

          if (channel.isText()) {
            await this.extendObjectAsyncCached(`${channelIdPrefix}.message`, {
              type: 'state',
              common: {
                name: `Message`, // TODO: i18n
                desc: 'Last received message', // TODO: i18n
                role: 'text',
                type: 'string',
                read: true,
                write: false,
                def: '',
              },
              native: {},
            });
            await this.extendObjectAsyncCached(`${channelIdPrefix}.messageId`, {
              type: 'state',
              common: {
                name: `Message ID`, // TODO: i18n
                desc: 'ID of the last received message', // TODO: i18n
                role: 'text',
                type: 'string',
                read: true,
                write: false,
                def: '',
              },
              native: {},
            });
            await this.extendObjectAsyncCached(`${channelIdPrefix}.messageAuthor`, {
              type: 'state',
              common: {
                name: `Message author`, // TODO: i18n
                desc: 'Who send the last received message', // TODO: i18n
                role: 'text',
                type: 'string',
                read: true,
                write: false,
                def: '',
              },
              native: {},
            });
            await this.extendObjectAsyncCached(`${channelIdPrefix}.messageTimestamp`, {
              type: 'state',
              common: {
                name: `Message timestamp`, // TODO: i18n
                desc: 'Timestamp of the last received message', // TODO: i18n
                role: 'date',
                type: 'number',
                read: true,
                write: false,
                def: 0,
              },
              native: {},
            });
            await this.extendObjectAsyncCached(`${channelIdPrefix}.messageJson`, {
              type: 'state',
              common: {
                name: `Message JSON`, // TODO: i18n
                desc: 'JSON for the last received message', // TODO: i18n
                role: 'json',
                type: 'string',
                read: true,
                write: false,
                def: '',
              },
              native: {},
            });
            this.messageReceiveStates.add(`${this.namespace}.${channelIdPrefix}.message`);

            await this.extendObjectAsyncCached(`${channelIdPrefix}.send`, {
              type: 'state',
              common: {
                name: `Send`, // TODO: i18n
                desc: 'Send some text or json formated content', // TODO: i18n
                role: 'text',
                type: 'string',
                read: true,
                write: true,
                def: '',
              },
              native: {},
            });
            await this.extendObjectAsyncCached(`${channelIdPrefix}.sendFile`, {
              type: 'state',
              common: {
                name: `Send file`, // TODO: i18n
                desc: 'Send some file', // TODO: i18n
                role: 'text',
                type: 'string',
                read: true,
                write: true,
                def: '',
              },
              native: {},
            });
            await this.extendObjectAsyncCached(`${channelIdPrefix}.sendReply`, {
              type: 'state',
              common: {
                name: `Send reply`, // TODO: i18n
                desc: 'Send a reply to a message', // TODO: i18n
                role: 'text',
                type: 'string',
                read: true,
                write: true,
                def: '',
              },
              native: {},
            });
            await this.extendObjectAsyncCached(`${channelIdPrefix}.sendReaction`, {
              type: 'state',
              common: {
                name: `Send reaction`, // TODO: i18n
                desc: 'Send a reaction to a message', // TODO: i18n
                role: 'text',
                type: 'string',
                read: true,
                write: true,
                def: '',
              },
              native: {},
            });
            this.stateId2SendTargetInfo.set(`${this.namespace}.${channelIdPrefix}`, {
              guild: guild,
              channel: channel,
            });
          }

          const members = [...channel.members.values()];
          const json: JsonServersChannelsObj = {
            id: channel.id,
            name: channel.name,
            type: channel.type,
            memberCount: members.length,
            members: members.map((m) => ({
              id: m.user.id,
              tag: m.user.tag,
              displayName: m.displayName,
            })),
          };
          const proms: Promise<any>[] = [];
          if (!isDeepStrictEqual(json, this.jsonStateCache.get(`${this.namespace}.${channelIdPrefix}.json`))) {
            proms.push(this.setStateAsync(`${channelIdPrefix}.json`, JSON.stringify(json), true));
            this.jsonStateCache.set(`${this.namespace}.${channelIdPrefix}.json`, json);
          }
          await Promise.all([
            this.setStateAsync(`${channelIdPrefix}.memberCount`, members.length, true),
            this.setStateAsync(`${channelIdPrefix}.members`, members.map((m) => m.displayName).join(', '), true),
            ...proms,
          ]);
        }
      }
    }

    /*
     * Create objects/states for all known users.
     */
    for (const [, {user, presence}] of allServersUsers) {
      this.log.debug(`Known user: ${user.tag} id:${user.id}`);

      await this.extendObjectAsyncCached(`users.${user.id}`, {
        type: 'channel',
        common: {
          name: user.tag,
        },
        native: {
          userId: user.id,
        },
      });

      await this.extendObjectAsyncCached(`users.${user.id}.json`, {
        type: 'state',
        common: {
          name: `JSON`, // TODO: i18n
          desc: 'JSON data for this user', // TODO: i18n
          role: 'json',
          type: 'string',
          read: true,
          write: false,
          def: '',
        },
        native: {},
      });

      await this.extendObjectAsyncCached(`users.${user.id}.tag`, {
        type: 'state',
        common: {
          name: `Tag`, // TODO: i18n
          desc: 'Tag of the user', // TODO: i18n
          role: 'text',
          type: 'string',
          read: true,
          write: false,
          def: '',
        },
        native: {},
      });

      await this.extendObjectAsyncCached(`users.${user.id}.message`, {
        type: 'state',
        common: {
          name: `Message`, // TODO: i18n
          desc: 'Last received message', // TODO: i18n
          role: 'text',
          type: 'string',
          read: true,
          write: false,
          def: '',
        },
        native: {},
      });
      await this.extendObjectAsyncCached(`users.${user.id}.messageId`, {
        type: 'state',
        common: {
          name: `Message ID`, // TODO: i18n
          desc: 'ID of the last received message', // TODO: i18n
          role: 'text',
          type: 'string',
          read: true,
          write: false,
          def: '',
        },
        native: {},
      });
      await this.extendObjectAsyncCached(`users.${user.id}.messageTimestamp`, {
        type: 'state',
        common: {
          name: `Message timestamp`, // TODO: i18n
          desc: 'Timestamp of the last received message', // TODO: i18n
          role: 'date',
          type: 'number',
          read: true,
          write: false,
          def: 0,
        },
        native: {},
      });
      await this.extendObjectAsyncCached(`users.${user.id}.messageJson`, {
        type: 'state',
        common: {
          name: `Message JSON`, // TODO: i18n
          desc: 'JSON for the last received message', // TODO: i18n
          role: 'json',
          type: 'string',
          read: true,
          write: false,
          def: '',
        },
        native: {},
      });
      this.messageReceiveStates.add(`${this.namespace}.users.${user.id}.message`);

      await this.extendObjectAsyncCached(`users.${user.id}.send`, {
        type: 'state',
        common: {
          name: `Send`, // TODO: i18n
          desc: 'Send some text or json formated content', // TODO: i18n
          role: 'text',
          type: 'string',
          read: true,
          write: true,
          def: '',
        },
        native: {},
      });
      await this.extendObjectAsyncCached(`users.${user.id}.sendFile`, {
        type: 'state',
        common: {
          name: `Send file`, // TODO: i18n
          desc: 'Send some file', // TODO: i18n
          role: 'text',
          type: 'string',
          read: true,
          write: true,
          def: '',
        },
        native: {},
      });
      await this.extendObjectAsyncCached(`users.${user.id}.sendReply`, {
        type: 'state',
        common: {
          name: `Send reply`, // TODO: i18n
          desc: 'Send a reply to a message', // TODO: i18n
          role: 'text',
          type: 'string',
          read: true,
          write: true,
          def: '',
        },
        native: {},
      });
      await this.extendObjectAsyncCached(`users.${user.id}.sendReaction`, {
        type: 'state',
        common: {
          name: `Send reaction`, // TODO: i18n
          desc: 'Send a reaction to a message', // TODO: i18n
          role: 'text',
          type: 'string',
          read: true,
          write: true,
          def: '',
        },
        native: {},
      });
      this.stateId2SendTargetInfo.set(`${this.namespace}.users.${user.id}`, { user });

      await this.extendObjectAsyncCached(`users.${user.id}.avatarUrl`, {
        type: 'state',
        common: {
          name: `Avatar`, // TODO: i18n
          role: 'media.link',
          type: 'string',
          read: true,
          write: false,
          def: '',
        },
        native: {},
      });

      await this.extendObjectAsyncCached(`users.${user.id}.bot`, {
        type: 'state',
        common: {
          name: `Bot`, // TODO: i18n
          desc: 'If the user is a bot', // TODO: i18n
          role: 'indicator',
          type: 'boolean',
          read: true,
          write: false,
          def: false,
        },
        native: {},
      });

      await this.extendObjectAsyncCached(`users.${user.id}.status`, {
        type: 'state',
        common: {
          name: `Status`, // TODO: i18n
          role: 'text',
          type: 'string',
          read: true,
          write: false,
          def: '',
        },
        native: {},
      });
      await this.extendObjectAsyncCached(`users.${user.id}.activityType`, {
        type: 'state',
        common: {
          name: `Activity type`, // TODO: i18n
          role: 'text',
          type: 'string',
          read: true,
          write: false,
          def: '',
        },
        native: {},
      });
      await this.extendObjectAsyncCached(`users.${user.id}.activityName`, {
        type: 'state',
        common: {
          name: `Activity name`, // TODO: i18n
          role: 'text',
          type: 'string',
          read: true,
          write: false,
          def: '',
        },
        native: {},
      });

      const ps = await this.updateUserPresence(user.id, presence, true);

      const proms: Promise<any>[] = [];
      const json: JsonUsersObj = {
        id: user.id,
        tag: user.tag,
        activityName: ps.activityName,
        activityType: ps.activityType,
        avatarUrl: user.displayAvatarURL(),
        bot: user.bot,
        status: ps.status,
      };
      if (!isDeepStrictEqual(json, this.jsonStateCache.get(`${this.namespace}.users.${user.id}.json`))) {
        proms.push(this.setStateAsync(`users.${user.id}.json`, JSON.stringify(json), true));
        this.jsonStateCache.set(`${this.namespace}.users.${user.id}.json`, json);
      }
      await Promise.all([
        this.setStateAsync(`users.${user.id}.tag`, user.tag, true),
        this.setStateAsync(`users.${user.id}.avatarUrl`, json.avatarUrl, true),
        this.setStateAsync(`users.${user.id}.bot`, user.bot, true),
        ...proms,
        this.updateUserPresence(user.id, presence),
      ]);

    }

    /*
     * Delete objects for unknown Channels/Servers
     */
    const objListServers = await this.getObjectListAsync({
      startkey: `${this.namespace}.servers.`,
      endkey: `${this.namespace}.servers.\u9999`,
    });
    const reServersChannels = new RegExp(`^${this.name}\\.${this.instance}\\.servers\\.((\\d+)(\\.channels\\.(\\d+)){0,2})$`);
    for (const item of objListServers.rows) {
      const m = item.id.match(reServersChannels);
      if (m) {
        const idPath = m[1];
        if (!knownServersAndChannelsIds.has(item.id)) {
          this.log.debug(`Server/Channel ${idPath} "${item.value.common.name}" is no longer available - deleting objects`);
          this.messageReceiveStates.delete(`${this.namespace}.servers.${idPath}.message`);
          this.stateId2SendTargetInfo.delete(`${this.namespace}.servers.${idPath}`);
          this.jsonStateCache.delete(`${this.namespace}.servers.${idPath}.json`);
          await this.delObjectAsyncCached(`servers.${idPath}`, { recursive: true });
        }
      }
    }

    /*
     * Delete objects for unknown users
     */
    const objListUsers = await this.getObjectListAsync({
      startkey: `${this.namespace}.users.`,
      endkey: `${this.namespace}.users.\u9999`,
    });
    const reUsers = new RegExp(`^${this.name}\\.${this.instance}\\.users\\.(\\d+)$`);
    for (const item of objListUsers.rows) {
      const m = item.id.match(reUsers);
      if (m) {
        const userId = m[1];
        if (!allServersUsers.has(userId)) {
          this.log.debug(`User ${userId} "${item.value.common.name}" is no longer available - deleting objects`);
          this.messageReceiveStates.delete(`${this.namespace}.users.${userId}.message`);
          this.stateId2SendTargetInfo.delete(`${this.namespace}.users.${userId}`);
          this.jsonStateCache.delete(`${this.namespace}.users.${userId}.json`);
          await this.delObjectAsyncCached(`users.${userId}`, { recursive: true });
        }
      }
    }
  }

  private async updateUserPresence (userId: Snowflake, presence: Presence | null, skipJsonStateUpdate: boolean = false): Promise<UpdateUserPresenceResult> {
    if (!this.config.observeUserPresence) {
      return { activityName: '', activityType: '', status: '' };
    }

    try {
      const p: UpdateUserPresenceResult = {
        status: presence?.status || '',
        activityName: (presence?.activities[0]?.type === 'CUSTOM' ? presence?.activities[0]?.state : presence?.activities[0]?.name) || '',
        activityType: presence?.activities[0]?.type || '',
      };
      const proms: Promise<any>[] = [];
      if (!skipJsonStateUpdate) {
        const json = this.jsonStateCache.get(`${this.namespace}.users.${userId}.json`) as JsonUsersObj | undefined;
        if (json) {
          json.status = p.status;
          json.activityName = p.activityName;
          json.activityType = p.activityType;
          this.jsonStateCache.set(`${this.namespace}.users.${userId}.json`, json);
          proms.push(this.setStateAsync(`users.${userId}.json`, JSON.stringify(json), true));
        }
      }
      await Promise.all([
        this.setStateAsync(`users.${userId}.status`, p.status , true),
        this.setStateAsync(`users.${userId}.activityName`, p.activityType, true),
        this.setStateAsync(`users.${userId}.activityType`, p.activityName, true),
        ...proms,
      ]);
      return p;
    } catch (err) {
      this.log.warn(`Error while updating user presence of user ${userId}: ${err}`);
      return { activityName: '', activityType: '', status: '' };
    }
  }

  /**
   * Set the presence status of the discord bot.
   */
  private async setBotPresence (opts?: SetBotPresenceOptions): Promise<void> {
    if (!this.client?.user) return;

    if (!opts) {
      opts = {};
    }

    if (!opts.status) {
      opts.status = ((await this.getStateAsync('bot.status'))?.val as PresenceStatusData | undefined) || 'online';
    }
    if (!VALID_PRESENCE_STATUS_DATA.includes(opts.status)) {
      opts.status = 'online';
    }

    const presenceData: PresenceData = {
      status: opts.status,
      activities: [],
    };

    if (opts.activityType === undefined) {
      opts.activityType = ((await this.getStateAsync('bot.activityType'))?.val as ValidActivityType | undefined) || '';
    }
    if (!VALID_ACTIVITY_TYPES.includes(opts.activityType)) {
      opts.activityType = '';
    }
    if (opts.activityName === undefined) {
      opts.activityName = ((await this.getStateAsync('bot.activityName'))?.val as string | undefined) || '';
    }
    if (opts.activityType && opts.activityName) {
      presenceData.activities = [{
        type: opts.activityType,
        name: opts.activityName,
      }];
    }

    this.log.debug(`Set bot presence: ${JSON.stringify(presenceData)}`);
    this.client.user.setPresence(presenceData);
  }

  /**
   * Handler for received discord messages.
   * @param message The discord message.
   */
  @boundMethod
  private async onClientMessageCreate (message: Message<boolean>): Promise<void> {
    this.log.debug(`Discord message: mId:${message.id} cId:${message.channelId} uId: ${message.author.id} - ${message.content}`);

    if (!this.client?.user?.id) return;

    const { author, channel, content } = message;

    // don't process own messages
    if (author.id === this.client.user.id) {
      return;
    }

    const mentioned = message.mentions.users.has(this.client.user.id);

    if (mentioned && this.config.reactOnMentions) {
      try {
        await message.react(this.config.reactOnMentionsEmoji);
      } catch (err) {
        this.log.warn(`Error while adding reaction to message ${message.id}! ${err}`);
      }
    }

    if (!mentioned && channel.type === 'GUILD_TEXT' && !this.config.processAllMessagesInServerChannel) {
      this.log.debug('Server message without mention ignored');
      return;
    }

    let msgStateIdPrefix: string;
    if (channel.type === 'GUILD_TEXT') {
      msgStateIdPrefix = channel.parentId ? `${this.namespace}.servers.${message.guildId}.channels.${channel.parentId}.channels.${channel.id}` : `${this.namespace}.servers.${message.guildId}.channels.${channel.id}`;
    } else if (channel.type === 'DM') {
      msgStateIdPrefix = `${this.namespace}.users.${author.id}`;
    } else {
      this.log.warn('Received unexpected message!');
      return;
    }

    // check if a valid object/state for this received message is known by the adapter
    if (!this.messageReceiveStates.has(`${msgStateIdPrefix}.message`)) {
      this.log.debug(`State for received message ${msgStateIdPrefix} it not known for receiving messages`);
      return;
    }

    // prepare json state object
    const json: JsonMessageObj = {
      content,
      attachments: message.attachments.map((att) => ({ attachment: att.attachment.toString(), name: att.name, size: att.size, id: att.id })),
      id: message.id,
      mentions: message.mentions.members?.map((m) => ({ id: m.id, tag: m.user.tag, displayName: m.displayName })) || [],
      mentioned,
      timestamp: message.createdTimestamp,
    };
    const proms: Promise<any>[] = [];
    if (message.guildId) {
      json.author = {
        id: author.id,
        tag: author.tag,
        displayName: this.client.guilds.cache.get(message.guildId)?.members.cache.get(author.id)?.displayName || author.username,
      };
      proms.push(this.setStateAsync(`${msgStateIdPrefix}.messageAuthor`, author.tag, true));
    }
    if (!isDeepStrictEqual(json, this.jsonStateCache.get(`${this.namespace}.${msgStateIdPrefix}.messageJson`))) {
      proms.push(this.setStateAsync(`${msgStateIdPrefix}.messageJson`, JSON.stringify(json), true));
      this.jsonStateCache.set(`${this.namespace}.${msgStateIdPrefix}.messageJson`, json);
    }
    await Promise.all([
      this.setStateAsync(`${msgStateIdPrefix}.message`, content, true),
      this.setStateAsync(`${msgStateIdPrefix}.messageId`, message.id, true),
      this.setStateAsync(`${msgStateIdPrefix}.messageTimestamp`, message.createdTimestamp, true),
      ...proms,
    ]);

    // handle text2command if enabled for this receiving state
    if (content && this.config.text2commandInstance && this.text2commandObjects.has(`${msgStateIdPrefix}.message`)) {
      this.log.debug(`Sending "${content}" to ${this.config.text2commandInstance}`);
      // prepare message payload
      const payload: Text2commandMessagePayload = {
        text: content,
      };
      // use callback style sendTo here to not block message processing here if text2command instance is not running
      this.sendTo(this.config.text2commandInstance, 'send', payload, async (responseObj) => {
        // Response object from text2command is the message payload from the sendTo call with a `response` property set
        const response: string | undefined = (responseObj as unknown as Text2commandMessagePayload | undefined)?.response;
        try {
          if (!response) {
            this.log.debug(`Empty response from ${this.config.text2commandInstance}`);
            return;
          }
          this.log.debug(`Response from ${this.config.text2commandInstance}: ${response}`);
          switch (this.config.text2commandRespondWith) {
            case 'reply':
              await message.reply(response);
              break;
            case 'message':
              await message.channel.send(response);
              break;
            default:
              // no response needed
          }
        } catch (err) {
          this.log.warn(`Error while processing response "${response}" from ${this.config.text2commandInstance}! ${err}`);
        }
      });
    }

  }

  /**
   * Setup for objects custom config related to the adapter instance.
   * E.g. text2command enabled or state availability for commands.
   * @param objId The object ID.
   * @param customCfg The custom config part of the object for this adapter instance.
   */
  private setupObjCustom (objId: string, customCfg: ioBroker.CustomConfig | undefined): void {
    // own .message objects - enableText2command
    if (objId.startsWith(`${this.namespace}.`) && objId.endsWith('.message')) {
      if (customCfg?.enabled && customCfg.enableText2command) {
        this.log.debug(`Custom option text2command enabled for ${objId}`);
        this.text2commandObjects.add(objId);
      } else if (this.text2commandObjects.has(objId)) {
        this.log.debug(`Custom option text2command disabled for ${objId}`);
        this.text2commandObjects.delete(objId);
      }
    }

    // TODO: other objects
  }

  /**
   * Is called if a subscribed object changes.
   */
  @boundMethod
  private onObjectChange (objId: string, obj: ioBroker.Object | null | undefined): void {
    if (obj) {
      // The object was changed
      this.log.silly(`object ${objId} changed: ${JSON.stringify(obj)}`);
      this.setupObjCustom(objId, obj.common?.custom?.[this.namespace]);
    } else {
      // The object was deleted
      this.log.silly(`object ${objId} deleted`);
      this.setupObjCustom(objId, undefined);
    }
  }

  /**
   * Is called if a subscribed state changes
   */
  @boundMethod
  private async onStateChange(stateId: string, state: ioBroker.State | null | undefined): Promise<void> {
    this.log.silly(`State changed: ${stateId} ${state?.val} (ack=${state?.ack})`);

    if (!state || state.ack) return;

    let setAck = false;

    /*
     * Own states
     */
    if (stateId.startsWith(`${this.namespace}.`)) {

      switch (stateId) {
        case `${this.namespace}.bot.status`:
          await this.setBotPresence({ status: state.val as PresenceStatusData });
          setAck = true;
          break;
        case `${this.namespace}.bot.activityType`:
          await this.setBotPresence({ activityType: state.val as ValidActivityType });
          setAck = true;
          break;
        case `${this.namespace}.bot.activityName`:
          await this.setBotPresence({ activityName: state.val as string });
          setAck = true;
          break;

        default: // other own states
          // .send / .sendFile / .sendReply
          if (stateId.endsWith('.send') || stateId.endsWith('.sendFile') || stateId.endsWith('.sendReply') || stateId.endsWith('.sendReaction')) {
            setAck = await this.onSendStateChange(stateId, state);
          }
      }

    }

    if (setAck) {
      await this.setStateAsync(stateId, {
        ...state,
        ack: true,
      });
    }

  }

  /**
   * Handler for changes on own .send or .sendFile states.
   * Sends the given text, json or file to the corresponding discord channel.
   * @returns `true` if the message is send.
   */
  private async onSendStateChange (stateId: string, state: ioBroker.State): Promise<boolean> {

    if (!this.client?.isReady()) {
      this.log.warn(`State ${stateId} changed but client is not ready!`);
      return false;
    }

    if (typeof state.val !== 'string') {
      this.log.warn(`State ${stateId} changed but value if not a string!`);
      return false;
    }

    if (state.val.length === 0) {
      this.log.debug(`State ${stateId} changed but value is empty`);
      return false;
    }

    const stateIdChannel = stateId.replace(/^(.+)\.\w+$/, '$1');
    const sendTargetInfo = this.stateId2SendTargetInfo.get(stateIdChannel); // last part if the stateId is not needed here

    let target: NonThreadGuildBasedChannel | User;
    let targetName: string = '';
    if (sendTargetInfo?.guild && sendTargetInfo?.channel) {
      if (!sendTargetInfo.channel.isText()) {
        this.log.warn(`State ${stateId} changed but target is not a text channel!`);
        return false;
      }
      target = sendTargetInfo.channel;
      targetName = sendTargetInfo.channel.parent ? `${sendTargetInfo.guild.name}/${sendTargetInfo.channel.parent.name}/${sendTargetInfo.channel.name}` : `${sendTargetInfo.guild.name}/${sendTargetInfo.channel.name}`;
    } else if (sendTargetInfo?.user) {
      target = sendTargetInfo.user;
      targetName = sendTargetInfo.user.tag;
    } else {
      this.log.warn(`State ${stateId} changed but I don't know where to send this to!`);
      return false;
    }

    let mo: MessageOptions;

    /*
     * Special case .sendFile state
     */
    if (stateId.endsWith('.sendFile')) {
      const idx = state.val.indexOf('|');
      let file: string;
      let content: string | undefined = undefined;
      if (idx > 0) {
        file = state.val.slice(0, idx);
        content = state.val.slice(idx + 1);
      } else {
        file = state.val;
      }
      mo = {
        content,
        files: [{
          attachment: file,
          name: basename(file),
        }],
      };

    /*
      * Special case .sendReply state
      */
    } else if (stateId.endsWith('.sendReply') || stateId.endsWith('.sendReaction')) {
      const idx = state.val.indexOf('|');
      let messageReference: string;
      let content: string;
      if (idx > 0) {
        messageReference = state.val.slice(0, idx);
        content = state.val.slice(idx + 1);
      } else {
        // use id from last received message
        this.log.debug(`Get reply message reference from last received message for ${stateIdChannel}`);
        messageReference = (await this.getForeignStateAsync(`${stateIdChannel}.messageId`))?.val as string;
        content = state.val;
      }

      if (stateId.endsWith('.sendReply')) {
        // reply
        if (!messageReference || !content) {
          this.log.warn(`No message reference or no content for reply for ${stateId}!`);
          return false;
        }

        mo = {
          content,
          reply: {
            messageReference,
          },
        };

      } else {
        // reaction
        if (!messageReference || !content) {
          this.log.warn(`No message reference or no/invalid content for reaction for ${stateId}!`);
          return false;
        }

        const channel = sendTargetInfo.channel || sendTargetInfo.user?.dmChannel || await sendTargetInfo.user?.createDM();
        if (!channel || !channel.isText()) {
          this.log.warn(`Could not determine target channel for reaction ${stateId}`);
          return false;
        }

        // get the message from cache or try to fetch the message
        const message: Message<boolean> | undefined = channel.messages.cache.get(messageReference) || await channel.messages.fetch(messageReference);
        if (!message) {
          this.log.warn(`Could not determine target message for reaction ${stateId}`);
          return false;
        }

        try {
          await message.react(content);
          return true;
        } catch (err) {
          this.log.warn(`Message reaction ${stateId} failed: ${err}`);
          return false;
        }
      }


    /*
     * `state.val` may be JSON for .send states
     * Try to parse the JSON as MessageOptions object to allow sending of files, embeds, ...
     */
    } else if (state.val.startsWith('{') && state.val.endsWith('}')) {
      // seams to be json
      this.log.debug(`State ${stateId} value seams to be json`);

      try {
        mo = JSON.parse(state.val) as MessageOptions;
      } catch (err) {
        this.log.warn(`State ${stateId} value seams to be json but cannot be parsed!`);
        return false;
      }

      // do some basic checks against the parsed object
      if ((!mo?.files && !mo.content) || (mo.files && !Array.isArray(mo.files)) || (mo.embeds && !Array.isArray(mo.embeds))) {
        this.log.warn(`State ${stateId} value seams to be json but seams to be invalid!`);
        return false;
      }

    } else {
      // just a string
      mo = {
        content: state.val,
      };
    }

    this.log.debug(`Send to ${targetName}: ${JSON.stringify(mo)}`);
    try {
      const msg = await target.send(mo);
      this.log.debug(`Sent with message ID ${msg.id}`);
      return true;
    } catch (err) {
      this.log.warn(`Error sending value of ${stateId} to ${targetName}: ${err}`);
      return false;
    }
  }

  /**
   * Handle messages send to the adapter.
   */
  @boundMethod
  private async onMessage (obj: ioBroker.Message): Promise<void> {
    if (typeof obj !== 'object') return;
    this.log.debug(`Got message: ${JSON.stringify(obj)}`);

    if (obj.command === 'getText2commandInstances' && obj.callback) {
      const view = await this.getObjectViewAsync('system', 'instance', {
        startkey: 'system.adapter.text2command.',
        endkey: 'system.adapter.text2command.\u9999',
      });
      const text2commandInstances = view.rows.map((r) => r.id.slice(15));
      this.log.debug(`Found text2command instances: ${text2commandInstances}`);
      this.sendTo(obj.from, obj.command, [{value: '', label: '---'}, ...text2commandInstances], obj.callback);
    }
  }

  /**
   * Set the `info.connection` state if changed.
   * @param connected If connected.
   * @param force `true` to skip local cache check and always set the state.
   */
  private async setInfoConnectionState (connected: boolean, force: boolean = false): Promise<void> {
    if (force || connected !== this.infoConnected) {
      await this.setStateAsync('info.connection', connected, true);
      this.infoConnected = connected;
    }
  }

  /**
   * Internal replacemend for `extendObjectAsync(...)` which compares the given
   * object for each `id` against a cached version and only calls na original
   * `extendObjectAsync(...)` if the object changed.
   * Using this, the object gets only updated if
   *  a) it's the first call for this `id` or
   *  b) the object needs to be changed.
   */
  private async extendObjectAsyncCached (id: string, objPart: ioBroker.PartialObject, options?: ioBroker.ExtendObjectOptions): ioBroker.SetObjectPromise {
    const cachedObj: ioBroker.PartialObject | undefined = this.extendObjectCache.get(id);

    if (isDeepStrictEqual(cachedObj, objPart)) {
      return { id };
    }

    const ret = await this.extendObjectAsync(id, objPart, options);
    this.extendObjectCache.set(id, objPart);
    return ret;
  }

  /**
   * Internal replacement for `delObjectAsync(...)` which also removes the local
   * cache entry for the given `id`.
   */
  private async delObjectAsyncCached (id: string, options?: ioBroker.DelObjectOptions): Promise<void> {
    if (options?.recursive) {
      this.extendObjectCache.filter((_obj, id2) => id2.startsWith(id)).each((_obj, id2) => this.extendObjectCache.delete(id2));
    } else {
      this.extendObjectCache.delete(id);
    }

    return this.delObjectAsync(id, options);
  }

  /**
   * Is called when adapter shuts down - callback has to be called under any circumstances!
   */
  @boundMethod
  private async onUnload (callback: () => void): Promise<void> {
    try {
      await this.setInfoConnectionState(false, true);

      if (this.client) {
        this.client.destroy();
      }

      callback();
    } catch (e) {
      callback();
    }
  }

}

if (require.main !== module) {
  // Export the constructor in compact mode
  module.exports = (options: Partial<AdapterOptions> | undefined) => new DiscordAdapter(options);
} else {
  // otherwise start the instance directly
  (() => new DiscordAdapter())();
}