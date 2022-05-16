var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __decorateClass = (decorators, target, key, kind) => {
  var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc(target, key) : target;
  for (var i = decorators.length - 1, decorator; i >= 0; i--)
    if (decorator = decorators[i])
      result = (kind ? decorator(target, key, result) : decorator(result)) || result;
  if (kind && result)
    __defProp(target, key, result);
  return result;
};
var main_exports = {};
module.exports = __toCommonJS(main_exports);
var import_register = require("source-map-support/register");
var import_node_util = require("node:util");
var import_autobind_decorator = require("autobind-decorator");
var import_adapter_core = require("@iobroker/adapter-core");
var import_discord = require("discord.js");
var import_commands = require("./commands");
var import_definitions = require("./lib/definitions");
var import_i18n = require("./lib/i18n");
var import_utils = require("./lib/utils");
class DiscordAdapter extends import_adapter_core.Adapter {
  constructor(options = {}) {
    super(__spreadProps(__spreadValues({}, options), {
      name: "discord"
    }));
    this.infoConnected = false;
    this.client = null;
    this.messageReceiveStates = /* @__PURE__ */ new Set();
    this.text2commandObjects = /* @__PURE__ */ new Set();
    this.extendObjectCache = new import_discord.Collection();
    this.jsonStateCache = new import_discord.Collection();
    this.initialCustomObjectSetupDone = false;
    this.unloaded = false;
    this.discordSlashCommands = new import_commands.DiscordAdapterSlashCommands(this);
    this.on("ready", this.onReady);
    this.on("stateChange", this.onStateChange);
    this.on("objectChange", this.onObjectChange);
    this.on("message", this.onMessage);
    this.on("unload", this.onUnload);
  }
  async onReady() {
    var _a;
    await this.setInfoConnectionState(false, true);
    const systemConfig = await this.getForeignObjectAsync("system.config");
    import_i18n.i18n.language = (systemConfig == null ? void 0 : systemConfig.common.language) || "en";
    import_i18n.i18n.isFloatComma = (systemConfig == null ? void 0 : systemConfig.common.isFloatComma) || false;
    if (typeof this.config.token !== "string" || !this.config.token.match(/^[0-9a-zA-Z-_]{24}\.[0-9a-zA-Z-_]{6}\.[0-9a-zA-Z-_]{27,38}$/)) {
      this.log.error(`No or invalid token!`);
      return;
    }
    if (!Array.isArray(this.config.authorizedUsers)) {
      this.config.authorizedUsers = [];
    }
    if (!Array.isArray(this.config.authorizedServerRoles)) {
      this.config.authorizedServerRoles = [];
    }
    if (!this.config.enableAuthorization) {
      this.log.info("Authorization is disabled, so any user is able to interact with the bot. You should only disable authorization if you trust all users on any server where the bot is on.");
    }
    if (this.config.enableAuthorization && this.config.authorizedUsers.length === 0) {
      this.log.info("Authorization is enabled but no authorized users are defined!");
    }
    if (this.config.enableRawStates) {
      await this.extendObjectAsync("raw", {
        type: "channel",
        common: {
          name: import_i18n.i18n.getStringOrTranslated("Raw data")
        },
        native: {}
      });
      await Promise.all([
        this.extendObjectAsync("raw.interactionJson", {
          type: "state",
          common: {
            name: import_i18n.i18n.getStringOrTranslated("Last interaction JSON data"),
            role: "json",
            type: "string",
            read: true,
            write: false,
            def: ""
          },
          native: {}
        }),
        this.extendObjectAsync("raw.messageJson", {
          type: "state",
          common: {
            name: import_i18n.i18n.getStringOrTranslated("Last message JSON data"),
            role: "json",
            type: "string",
            read: true,
            write: false,
            def: ""
          },
          native: {}
        })
      ]);
    } else {
      await this.delObjectAsync("raw", { recursive: true });
    }
    this.client = new import_discord.Client({
      intents: [
        import_discord.Intents.FLAGS.GUILDS,
        import_discord.Intents.FLAGS.GUILD_MEMBERS,
        import_discord.Intents.FLAGS.GUILD_MESSAGES,
        import_discord.Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
        import_discord.Intents.FLAGS.GUILD_MESSAGE_TYPING,
        import_discord.Intents.FLAGS.GUILD_PRESENCES,
        import_discord.Intents.FLAGS.DIRECT_MESSAGES,
        import_discord.Intents.FLAGS.DIRECT_MESSAGE_REACTIONS,
        import_discord.Intents.FLAGS.DIRECT_MESSAGE_TYPING,
        import_discord.Intents.FLAGS.GUILD_VOICE_STATES
      ],
      partials: [
        "CHANNEL"
      ]
    });
    this.client.on("ready", this.onClientReady);
    this.client.on("warn", (message) => this.log.warn(`Discord client warning: ${message}`));
    this.client.on("error", (err) => this.log.error(`Discord client error: ${err.toString()}`));
    this.client.on("rateLimit", (rateLimitData) => this.log.debug(`Discord client rate limit hit: ${JSON.stringify(rateLimitData)}`));
    this.client.on("invalidRequestWarning", (invalidRequestWarningData) => this.log.warn(`Discord client invalid request warning: ${JSON.stringify(invalidRequestWarningData)}`));
    this.client.on("invalidated", () => {
      this.log.warn("Discord client session invalidated");
      this.setInfoConnectionState(false);
    });
    this.client.on("shardError", (err) => {
      this.log.warn(`Discord client websocket error: ${err.toString()}`);
      this.setInfoConnectionState(false);
    });
    this.client.on("shardReady", (shardId) => {
      this.log.info(`Discord client websocket connected (shardId:${shardId})`);
      this.setInfoConnectionState(true);
      this.setBotPresence();
    });
    this.client.on("shardResume", (shardId, replayedEvents) => this.log.debug(`Discord client websocket resume (shardId:${shardId} replayedEvents:${replayedEvents})`));
    this.client.on("shardDisconnect", (event, shardId) => this.log.debug(`Discord client websocket disconnect (shardId:${shardId} ${event.reason})`));
    this.client.on("shardReconnecting", (shardId) => this.log.debug(`Discord client websocket reconnecting (shardId:${shardId})`));
    this.client.on("messageCreate", this.onClientMessageCreate);
    if (this.config.dynamicServerUpdates) {
      this.client.on("channelCreate", () => this.updateGuilds());
      this.client.on("channelDelete", () => this.updateGuilds());
      this.client.on("channelUpdate", () => this.updateGuilds());
      this.client.on("guildCreate", () => this.updateGuilds());
      this.client.on("guildDelete", () => this.updateGuilds());
      this.client.on("guildUpdate", () => this.updateGuilds());
      this.client.on("guildMemberAdd", () => this.updateGuilds());
      this.client.on("guildMemberRemove", () => this.updateGuilds());
      this.client.on("roleCreate", () => this.updateGuilds());
      this.client.on("roleDelete", () => this.updateGuilds());
      this.client.on("roleUpdate", () => this.updateGuilds());
      this.client.on("userUpdate", () => this.updateGuilds());
    }
    if (this.config.observeUserPresence) {
      this.client.on("presenceUpdate", (_oldPresence, newPresence) => {
        this.updateUserPresence(newPresence.userId, newPresence);
      });
    }
    if (this.config.observeUserVoiceState) {
      this.client.on("voiceStateUpdate", this.onClientVoiceStateUpdate);
    }
    this.discordSlashCommands.onReady();
    this.subscribeStates("*.send");
    this.subscribeStates("*.sendFile");
    this.subscribeStates("*.sendReply");
    this.subscribeStates("*.sendReaction");
    this.subscribeStates("servers.*.members.*.voiceDisconnect");
    this.subscribeStates("servers.*.members.*.voiceServerMute");
    this.subscribeStates("servers.*.members.*.voiceServerDeaf");
    this.subscribeStates("bot.*");
    this.subscribeForeignObjects("*");
    this.log.debug("Get all objects with custom config ...");
    const view = await this.getObjectViewAsync("system", "custom", {});
    if (view == null ? void 0 : view.rows) {
      for (const item of view.rows) {
        await this.setupObjCustom(item.id, (_a = item.value) == null ? void 0 : _a[this.namespace]);
      }
    }
    this.log.debug("Getting all objects with custom config done");
    this.initialCustomObjectSetupDone = true;
    try {
      await this.client.login(this.config.token);
    } catch (err) {
      if (err instanceof Error) {
        this.log.error(`Discord login error: ${err.toString()}`);
      } else {
        this.log.error(`Discord login error`);
      }
      return;
    }
    await this.discordSlashCommands.registerSlashCommands();
  }
  async onClientReady() {
    var _a;
    if (!((_a = this.client) == null ? void 0 : _a.user)) {
      this.log.error("Discord client has no user!");
      return;
    }
    this.log.info(`Logged in as ${this.client.user.tag}!`);
    this.log.debug(`User ID: ${this.client.user.id}`);
    if (this.config.botName) {
      if (this.client.user.username !== this.config.botName) {
        this.log.debug(`Update of bot name needed - current name: ${this.client.user.username} - configured name: ${this.config.botName}`);
        try {
          const proms = [];
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
        this.log.debug("Bot name is up to date");
      }
    }
    try {
      await this.updateGuilds();
    } catch (err) {
      this.log.error(`Error while updating server information: ${err}`);
    }
  }
  async updateGuilds() {
    var _a, _b, _c, _d;
    if (!((_a = this.client) == null ? void 0 : _a.user)) {
      throw new Error("Client not loaded");
    }
    const allServersUsers = new import_discord.Collection();
    const knownServersAndChannelsIds = /* @__PURE__ */ new Set();
    if (this.unloaded)
      return;
    const guilds = await this.client.guilds.fetch();
    if (this.unloaded)
      return;
    for (const [, guildBase] of guilds) {
      if (this.unloaded)
        return;
      let guild;
      try {
        guild = await guildBase.fetch();
      } catch (err) {
        this.log.warn(`Could not fetch guild information for guild "${guildBase.name}" id:${guildBase.id}`);
        this.log.debug(`Error: ${err}`);
        continue;
      }
      if (this.unloaded)
        return;
      knownServersAndChannelsIds.add(`${this.namespace}.servers.${guild.id}`);
      await this.extendObjectAsyncCached(`servers.${guild.id}`, {
        type: "channel",
        common: {
          name: guild.name
        },
        native: {}
      });
      await Promise.all([
        this.extendObjectAsyncCached(`servers.${guild.id}.members`, {
          type: "channel",
          common: {
            name: import_i18n.i18n.getStringOrTranslated("Members")
          },
          native: {}
        }),
        this.extendObjectAsyncCached(`servers.${guild.id}.channels`, {
          type: "channel",
          common: {
            name: import_i18n.i18n.getStringOrTranslated("Channels")
          },
          native: {}
        })
      ]);
      const guildMembers = await guild.members.fetch();
      if (this.unloaded)
        return;
      for (const [, member] of guildMembers) {
        if (member.user.id !== this.client.user.id) {
          allServersUsers.set(member.user.id, { user: member.user, presence: member.presence });
        }
        await this.extendObjectAsyncCached(`servers.${guild.id}.members.${member.id}`, {
          type: "channel",
          common: {
            name: `${member.displayName} (${member.user.tag})`
          },
          native: {}
        });
        await Promise.all([
          this.extendObjectAsyncCached(`servers.${guild.id}.members.${member.id}.tag`, {
            type: "state",
            common: {
              name: import_i18n.i18n.getStringOrTranslated("User tag"),
              role: "text",
              type: "string",
              read: true,
              write: false,
              def: ""
            },
            native: {}
          }),
          this.extendObjectAsyncCached(`servers.${guild.id}.members.${member.id}.displayName`, {
            type: "state",
            common: {
              name: import_i18n.i18n.getStringOrTranslated("Display name"),
              role: "text",
              type: "string",
              read: true,
              write: false,
              def: ""
            },
            native: {}
          }),
          this.extendObjectAsyncCached(`servers.${guild.id}.members.${member.id}.roles`, {
            type: "state",
            common: {
              name: import_i18n.i18n.getStringOrTranslated("Roles"),
              role: "text",
              type: "string",
              read: true,
              write: false,
              def: ""
            },
            native: {}
          }),
          this.extendObjectAsyncCached(`servers.${guild.id}.members.${member.id}.joinedAt`, {
            type: "state",
            common: {
              name: import_i18n.i18n.getStringOrTranslated("Joined at"),
              role: "date",
              type: "number",
              read: true,
              write: false,
              def: 0
            },
            native: {}
          }),
          this.extendObjectAsyncCached(`servers.${guild.id}.members.${member.id}.voiceChannel`, {
            type: "state",
            common: {
              name: import_i18n.i18n.getStringOrTranslated("Voice channel"),
              role: "text",
              type: "string",
              read: true,
              write: false,
              def: ""
            },
            native: {}
          }),
          this.extendObjectAsyncCached(`servers.${guild.id}.members.${member.id}.voiceDisconnect`, {
            type: "state",
            common: {
              name: import_i18n.i18n.getStringOrTranslated("Voice disconnect"),
              role: "button",
              type: "boolean",
              read: false,
              write: true,
              def: false
            },
            native: {}
          }),
          this.extendObjectAsyncCached(`servers.${guild.id}.members.${member.id}.voiceSelfDeaf`, {
            type: "state",
            common: {
              name: import_i18n.i18n.getStringOrTranslated("Voice self deafen"),
              role: "indicator",
              type: "boolean",
              read: true,
              write: false,
              def: false
            },
            native: {}
          }),
          this.extendObjectAsyncCached(`servers.${guild.id}.members.${member.id}.voiceServerDeaf`, {
            type: "state",
            common: {
              name: import_i18n.i18n.getStringOrTranslated("Voice server deafen"),
              role: "switch",
              type: "boolean",
              read: true,
              write: true,
              def: false
            },
            native: {}
          }),
          this.extendObjectAsyncCached(`servers.${guild.id}.members.${member.id}.voiceSelfMute`, {
            type: "state",
            common: {
              name: import_i18n.i18n.getStringOrTranslated("Voice self mute"),
              role: "indicator",
              type: "boolean",
              read: true,
              write: false,
              def: false
            },
            native: {}
          }),
          this.extendObjectAsyncCached(`servers.${guild.id}.members.${member.id}.voiceServerMute`, {
            type: "state",
            common: {
              name: import_i18n.i18n.getStringOrTranslated("Voice server mute"),
              role: "switch",
              type: "boolean",
              read: true,
              write: true,
              def: false
            },
            native: {}
          }),
          this.extendObjectAsyncCached(`servers.${guild.id}.members.${member.id}.json`, {
            type: "state",
            common: {
              name: import_i18n.i18n.getStringOrTranslated("JSON data"),
              role: "json",
              type: "string",
              read: true,
              write: false,
              def: ""
            },
            native: {}
          })
        ]);
        const memberRoles = member.roles.cache.map((role) => role.name);
        await Promise.all([
          this.setStateAsync(`servers.${guild.id}.members.${member.id}.tag`, member.user.tag, true),
          this.setStateAsync(`servers.${guild.id}.members.${member.id}.displayName`, member.displayName, true),
          this.setStateAsync(`servers.${guild.id}.members.${member.id}.roles`, memberRoles.join(", "), true),
          this.setStateAsync(`servers.${guild.id}.members.${member.id}.joinedAt`, member.joinedTimestamp, true),
          this.setStateAsync(`servers.${guild.id}.members.${member.id}.voiceChannel`, ((_b = member.voice.channel) == null ? void 0 : _b.name) || "", true),
          this.setStateAsync(`servers.${guild.id}.members.${member.id}.voiceSelfDeaf`, !!member.voice.selfDeaf, true),
          this.setStateAsync(`servers.${guild.id}.members.${member.id}.voiceServerDeaf`, !!member.voice.serverDeaf, true),
          this.setStateAsync(`servers.${guild.id}.members.${member.id}.voiceSelfMute`, !!member.voice.selfMute, true),
          this.setStateAsync(`servers.${guild.id}.members.${member.id}.voiceServerMute`, !!member.voice.serverMute, true)
        ]);
        const json = {
          tag: member.user.tag,
          id: member.id,
          displayName: member.displayName,
          roles: memberRoles,
          joined: member.joinedTimestamp,
          voiceChannel: ((_c = member.voice.channel) == null ? void 0 : _c.name) || "",
          voiceChannelId: ((_d = member.voice.channel) == null ? void 0 : _d.id) || "",
          voiceSelfDeaf: !!member.voice.selfDeaf,
          voiceServerDeaf: !!member.voice.serverDeaf,
          voiceSelfMute: !!member.voice.selfMute,
          voiceServerMute: !!member.voice.serverMute
        };
        if (!(0, import_node_util.isDeepStrictEqual)(json, this.jsonStateCache.get(`${this.namespace}.servers.${guild.id}.members.${member.id}.json`))) {
          await this.setStateAsync(`servers.${guild.id}.members.${member.id}.json`, JSON.stringify(json), true);
          this.jsonStateCache.set(`${this.namespace}.servers.${guild.id}.members.${member.id}.json`, json);
        }
      }
      if (this.unloaded)
        return;
      const channels = await guild.channels.fetch();
      if (this.unloaded)
        return;
      for (const parents of [true, false]) {
        for (const [, channel] of channels) {
          if (parents && channel.parentId || !parents && !channel.parentId) {
            continue;
          }
          const channelIdPrefix = parents ? `servers.${guild.id}.channels.${channel.id}` : `servers.${guild.id}.channels.${channel.parentId}.channels.${channel.id}`;
          knownServersAndChannelsIds.add(`${this.namespace}.${channelIdPrefix}`);
          let icon = void 0;
          if (channel.isText()) {
            icon = "channel-text.svg";
          }
          if (channel.isVoice()) {
            icon = "channel-voice.svg";
          }
          await this.extendObjectAsyncCached(channelIdPrefix, {
            type: "channel",
            common: {
              name: channel.parent ? `${channel.parent.name} / ${channel.name}` : channel.name,
              icon
            },
            native: {
              channelId: channel.id
            }
          });
          if (channel.type === "GUILD_CATEGORY") {
            await this.extendObjectAsyncCached(`${channelIdPrefix}.channels`, {
              type: "channel",
              common: {
                name: import_i18n.i18n.getStringOrTranslated("Channels")
              },
              native: {}
            });
          }
          await Promise.all([
            this.extendObjectAsyncCached(`${channelIdPrefix}.json`, {
              type: "state",
              common: {
                name: import_i18n.i18n.getStringOrTranslated("JSON data"),
                role: "json",
                type: "string",
                read: true,
                write: false,
                def: ""
              },
              native: {}
            }),
            this.extendObjectAsyncCached(`${channelIdPrefix}.memberCount`, {
              type: "state",
              common: {
                name: import_i18n.i18n.getStringOrTranslated("Member count"),
                role: "value",
                type: "number",
                read: true,
                write: false,
                def: 0
              },
              native: {}
            }),
            this.extendObjectAsyncCached(`${channelIdPrefix}.members`, {
              type: "state",
              common: {
                name: import_i18n.i18n.getStringOrTranslated("Members"),
                role: "text",
                type: "string",
                read: true,
                write: false,
                def: ""
              },
              native: {}
            })
          ]);
          if (channel.isText()) {
            await Promise.all([
              this.extendObjectAsyncCached(`${channelIdPrefix}.message`, {
                type: "state",
                common: {
                  name: import_i18n.i18n.getStringOrTranslated("Last message"),
                  role: "text",
                  type: "string",
                  read: true,
                  write: false,
                  def: ""
                },
                native: {}
              }),
              this.extendObjectAsyncCached(`${channelIdPrefix}.messageId`, {
                type: "state",
                common: {
                  name: import_i18n.i18n.getStringOrTranslated("Last message ID"),
                  role: "text",
                  type: "string",
                  read: true,
                  write: false,
                  def: ""
                },
                native: {}
              }),
              this.extendObjectAsyncCached(`${channelIdPrefix}.messageAuthor`, {
                type: "state",
                common: {
                  name: import_i18n.i18n.getStringOrTranslated("Last message author"),
                  role: "text",
                  type: "string",
                  read: true,
                  write: false,
                  def: ""
                },
                native: {}
              }),
              this.extendObjectAsyncCached(`${channelIdPrefix}.messageTimestamp`, {
                type: "state",
                common: {
                  name: import_i18n.i18n.getStringOrTranslated("Last message timestamp"),
                  role: "date",
                  type: "number",
                  read: true,
                  write: false,
                  def: 0
                },
                native: {}
              }),
              this.extendObjectAsyncCached(`${channelIdPrefix}.messageJson`, {
                type: "state",
                common: {
                  name: import_i18n.i18n.getStringOrTranslated("Last message JSON data"),
                  role: "json",
                  type: "string",
                  read: true,
                  write: false,
                  def: ""
                },
                native: {}
              }),
              this.extendObjectAsyncCached(`${channelIdPrefix}.send`, {
                type: "state",
                common: {
                  name: import_i18n.i18n.getStringOrTranslated("Send message"),
                  role: "text",
                  type: "string",
                  read: false,
                  write: true,
                  def: ""
                },
                native: {}
              }),
              this.extendObjectAsyncCached(`${channelIdPrefix}.sendFile`, {
                type: "state",
                common: {
                  name: import_i18n.i18n.getStringOrTranslated("Send file"),
                  role: "text",
                  type: "string",
                  read: false,
                  write: true,
                  def: ""
                },
                native: {}
              }),
              this.extendObjectAsyncCached(`${channelIdPrefix}.sendReply`, {
                type: "state",
                common: {
                  name: import_i18n.i18n.getStringOrTranslated("Send reply"),
                  role: "text",
                  type: "string",
                  read: false,
                  write: true,
                  def: ""
                },
                native: {}
              }),
              this.extendObjectAsyncCached(`${channelIdPrefix}.sendReaction`, {
                type: "state",
                common: {
                  name: import_i18n.i18n.getStringOrTranslated("Send reaction"),
                  role: "text",
                  type: "string",
                  read: false,
                  write: true,
                  def: ""
                },
                native: {}
              })
            ]);
            this.messageReceiveStates.add(`${this.namespace}.${channelIdPrefix}.message`);
          }
          const members = [...channel.members.values()];
          const json = {
            id: channel.id,
            name: channel.name,
            type: channel.type,
            memberCount: members.length,
            members: members.map((m) => ({
              id: m.user.id,
              tag: m.user.tag,
              displayName: m.displayName
            }))
          };
          const proms = [];
          if (!(0, import_node_util.isDeepStrictEqual)(json, this.jsonStateCache.get(`${this.namespace}.${channelIdPrefix}.json`))) {
            proms.push(this.setStateAsync(`${channelIdPrefix}.json`, JSON.stringify(json), true));
            this.jsonStateCache.set(`${this.namespace}.${channelIdPrefix}.json`, json);
          }
          await Promise.all([
            this.setStateAsync(`${channelIdPrefix}.memberCount`, members.length, true),
            this.setStateAsync(`${channelIdPrefix}.members`, members.map((m) => m.displayName).join(", "), true),
            ...proms
          ]);
        }
      }
    }
    for (const [, { user, presence }] of allServersUsers) {
      this.log.debug(`Known user: ${user.tag} id:${user.id}`);
      await this.extendObjectAsyncCached(`users.${user.id}`, {
        type: "channel",
        common: {
          name: user.tag
        },
        native: {
          userId: user.id
        }
      });
      await Promise.all([
        this.extendObjectAsyncCached(`users.${user.id}.json`, {
          type: "state",
          common: {
            name: import_i18n.i18n.getStringOrTranslated("JSON data"),
            role: "json",
            type: "string",
            read: true,
            write: false,
            def: ""
          },
          native: {}
        }),
        this.extendObjectAsyncCached(`users.${user.id}.tag`, {
          type: "state",
          common: {
            name: import_i18n.i18n.getStringOrTranslated("User tag"),
            role: "text",
            type: "string",
            read: true,
            write: false,
            def: ""
          },
          native: {}
        }),
        this.extendObjectAsyncCached(`users.${user.id}.message`, {
          type: "state",
          common: {
            name: import_i18n.i18n.getStringOrTranslated("Last message"),
            role: "text",
            type: "string",
            read: true,
            write: false,
            def: ""
          },
          native: {}
        }),
        this.extendObjectAsyncCached(`users.${user.id}.messageId`, {
          type: "state",
          common: {
            name: import_i18n.i18n.getStringOrTranslated("Last message ID"),
            role: "text",
            type: "string",
            read: true,
            write: false,
            def: ""
          },
          native: {}
        }),
        this.extendObjectAsyncCached(`users.${user.id}.messageTimestamp`, {
          type: "state",
          common: {
            name: import_i18n.i18n.getStringOrTranslated("Last message timestamp"),
            role: "date",
            type: "number",
            read: true,
            write: false,
            def: 0
          },
          native: {}
        }),
        this.extendObjectAsyncCached(`users.${user.id}.messageJson`, {
          type: "state",
          common: {
            name: import_i18n.i18n.getStringOrTranslated("Last message JSON data"),
            role: "json",
            type: "string",
            read: true,
            write: false,
            def: ""
          },
          native: {}
        }),
        this.extendObjectAsyncCached(`users.${user.id}.send`, {
          type: "state",
          common: {
            name: import_i18n.i18n.getStringOrTranslated("Send message"),
            role: "text",
            type: "string",
            read: false,
            write: true,
            def: ""
          },
          native: {}
        }),
        this.extendObjectAsyncCached(`users.${user.id}.sendFile`, {
          type: "state",
          common: {
            name: import_i18n.i18n.getStringOrTranslated("Send file"),
            role: "text",
            type: "string",
            read: false,
            write: true,
            def: ""
          },
          native: {}
        }),
        this.extendObjectAsyncCached(`users.${user.id}.sendReply`, {
          type: "state",
          common: {
            name: import_i18n.i18n.getStringOrTranslated("Send reply"),
            role: "text",
            type: "string",
            read: false,
            write: true,
            def: ""
          },
          native: {}
        }),
        this.extendObjectAsyncCached(`users.${user.id}.sendReaction`, {
          type: "state",
          common: {
            name: import_i18n.i18n.getStringOrTranslated("Send reaction"),
            role: "text",
            type: "string",
            read: false,
            write: true,
            def: ""
          },
          native: {}
        }),
        this.extendObjectAsyncCached(`users.${user.id}.avatarUrl`, {
          type: "state",
          common: {
            name: import_i18n.i18n.getStringOrTranslated("Avatar"),
            role: "media.link",
            type: "string",
            read: true,
            write: false,
            def: ""
          },
          native: {}
        }),
        this.extendObjectAsyncCached(`users.${user.id}.bot`, {
          type: "state",
          common: {
            name: import_i18n.i18n.getStringOrTranslated("Bot"),
            role: "indicator",
            type: "boolean",
            read: true,
            write: false,
            def: false
          },
          native: {}
        }),
        this.extendObjectAsyncCached(`users.${user.id}.status`, {
          type: "state",
          common: {
            name: import_i18n.i18n.getStringOrTranslated("Status"),
            role: "text",
            type: "string",
            read: true,
            write: false,
            def: ""
          },
          native: {}
        }),
        this.extendObjectAsyncCached(`users.${user.id}.activityType`, {
          type: "state",
          common: {
            name: import_i18n.i18n.getStringOrTranslated("Activity type"),
            role: "text",
            type: "string",
            read: true,
            write: false,
            def: ""
          },
          native: {}
        }),
        this.extendObjectAsyncCached(`users.${user.id}.activityName`, {
          type: "state",
          common: {
            name: import_i18n.i18n.getStringOrTranslated("Activity name"),
            role: "text",
            type: "string",
            read: true,
            write: false,
            def: ""
          },
          native: {}
        })
      ]);
      this.messageReceiveStates.add(`${this.namespace}.users.${user.id}.message`);
      const ps = await this.updateUserPresence(user.id, presence, true);
      const proms = [];
      const json = {
        id: user.id,
        tag: user.tag,
        activityName: ps.activityName,
        activityType: ps.activityType,
        avatarUrl: user.displayAvatarURL(),
        bot: user.bot,
        status: ps.status
      };
      if (!(0, import_node_util.isDeepStrictEqual)(json, this.jsonStateCache.get(`${this.namespace}.users.${user.id}.json`))) {
        proms.push(this.setStateAsync(`users.${user.id}.json`, JSON.stringify(json), true));
        this.jsonStateCache.set(`${this.namespace}.users.${user.id}.json`, json);
      }
      await Promise.all([
        this.setStateAsync(`users.${user.id}.tag`, user.tag, true),
        this.setStateAsync(`users.${user.id}.avatarUrl`, json.avatarUrl, true),
        this.setStateAsync(`users.${user.id}.bot`, user.bot, true),
        ...proms,
        this.updateUserPresence(user.id, presence)
      ]);
    }
    const objListServers = await this.getObjectListAsync({
      startkey: `${this.namespace}.servers.`,
      endkey: `${this.namespace}.servers.\u9999`
    });
    const reServersChannels = new RegExp(`^${this.name}\\.${this.instance}\\.servers\\.((\\d+)(\\.channels\\.(\\d+)){0,2})$`);
    for (const item of objListServers.rows) {
      const m = item.id.match(reServersChannels);
      if (m) {
        const idPath = m[1];
        if (!knownServersAndChannelsIds.has(item.id)) {
          this.log.debug(`Server/Channel ${idPath} "${item.value.common.name}" is no longer available - deleting objects`);
          this.messageReceiveStates.delete(`${this.namespace}.servers.${idPath}.message`);
          this.jsonStateCache.delete(`${this.namespace}.servers.${idPath}.json`);
          await this.delObjectAsyncCached(`servers.${idPath}`, { recursive: true });
        }
      }
    }
    const objListUsers = await this.getObjectListAsync({
      startkey: `${this.namespace}.users.`,
      endkey: `${this.namespace}.users.\u9999`
    });
    const reUsers = new RegExp(`^${this.name}\\.${this.instance}\\.users\\.(\\d+)$`);
    for (const item of objListUsers.rows) {
      const m = item.id.match(reUsers);
      if (m) {
        const userId = m[1];
        if (!allServersUsers.has(userId)) {
          this.log.debug(`User ${userId} "${item.value.common.name}" is no longer available - deleting objects`);
          this.messageReceiveStates.delete(`${this.namespace}.users.${userId}.message`);
          this.jsonStateCache.delete(`${this.namespace}.users.${userId}.json`);
          await this.delObjectAsyncCached(`users.${userId}`, { recursive: true });
        }
      }
    }
  }
  async updateUserPresence(userId, presence, skipJsonStateUpdate = false) {
    var _a, _b, _c, _d;
    if (!this.config.observeUserPresence) {
      return { activityName: "", activityType: "", status: "" };
    }
    try {
      const p = {
        status: (presence == null ? void 0 : presence.status) || "",
        activityName: (((_a = presence == null ? void 0 : presence.activities[0]) == null ? void 0 : _a.type) === "CUSTOM" ? (_b = presence == null ? void 0 : presence.activities[0]) == null ? void 0 : _b.state : (_c = presence == null ? void 0 : presence.activities[0]) == null ? void 0 : _c.name) || "",
        activityType: ((_d = presence == null ? void 0 : presence.activities[0]) == null ? void 0 : _d.type) || ""
      };
      const proms = [];
      if (!skipJsonStateUpdate) {
        const json = this.jsonStateCache.get(`${this.namespace}.users.${userId}.json`);
        if (json) {
          json.status = p.status;
          json.activityName = p.activityName;
          json.activityType = p.activityType;
          this.jsonStateCache.set(`${this.namespace}.users.${userId}.json`, json);
          proms.push(this.setStateAsync(`users.${userId}.json`, JSON.stringify(json), true));
        }
      }
      await Promise.all([
        this.setStateAsync(`users.${userId}.status`, p.status, true),
        this.setStateAsync(`users.${userId}.activityName`, p.activityName, true),
        this.setStateAsync(`users.${userId}.activityType`, p.activityType, true),
        ...proms
      ]);
      return p;
    } catch (err) {
      this.log.warn(`Error while updating user presence of user ${userId}: ${err}`);
      return { activityName: "", activityType: "", status: "" };
    }
  }
  async setBotPresence(opts) {
    var _a, _b, _c, _d;
    if (!((_a = this.client) == null ? void 0 : _a.user))
      return;
    if (!opts) {
      opts = {};
    }
    if (!opts.status) {
      opts.status = ((_b = await this.getStateAsync("bot.status")) == null ? void 0 : _b.val) || "online";
    }
    if (!import_definitions.VALID_PRESENCE_STATUS_DATA.includes(opts.status)) {
      opts.status = "online";
    }
    const presenceData = {
      status: opts.status,
      activities: []
    };
    if (opts.activityType === void 0) {
      opts.activityType = ((_c = await this.getStateAsync("bot.activityType")) == null ? void 0 : _c.val) || "";
    }
    if (!import_definitions.VALID_ACTIVITY_TYPES.includes(opts.activityType)) {
      opts.activityType = "";
    }
    if (opts.activityName === void 0) {
      opts.activityName = ((_d = await this.getStateAsync("bot.activityName")) == null ? void 0 : _d.val) || "";
    }
    if (opts.activityType && opts.activityName) {
      presenceData.activities = [{
        type: opts.activityType,
        name: opts.activityName
      }];
    }
    this.log.debug(`Set bot presence: ${JSON.stringify(presenceData)}`);
    this.client.user.setPresence(presenceData);
  }
  async onClientMessageCreate(message) {
    var _a, _b, _c, _d, _e;
    this.log.debug(`Discord message: mId:${message.id} cId:${message.channelId} uId: ${message.author.id} - ${message.content}`);
    if (this.config.enableRawStates) {
      this.setState("raw.messageJson", JSON.stringify(message.toJSON(), (_key, value) => typeof value === "bigint" ? value.toString() : value), true);
    }
    if (!((_b = (_a = this.client) == null ? void 0 : _a.user) == null ? void 0 : _b.id))
      return;
    if (message.interaction) {
      return;
    }
    const { author, channel, content } = message;
    if (author.id === this.client.user.id) {
      return;
    }
    const authCheckTarget = message.member || author;
    const isAuthorAuthorized = this.checkUserAuthorization(authCheckTarget);
    if (!this.config.processMessagesFromUnauthorizedUsers && !isAuthorAuthorized) {
      this.log.debug(`Ignore message from unauthorized user ${author.tag} (id:${author.id})`);
      return;
    }
    const mentioned = message.mentions.users.has(this.client.user.id);
    if (mentioned && this.config.reactOnMentions && isAuthorAuthorized) {
      try {
        await message.react(this.config.reactOnMentionsEmoji);
      } catch (err) {
        this.log.warn(`Error while adding reaction to message ${message.id}! ${err}`);
      }
    }
    if (!mentioned && channel.type === "GUILD_TEXT" && !this.config.processAllMessagesInServerChannel) {
      this.log.debug("Server channel message without mention ignored");
      return;
    }
    let msgStateIdPrefix;
    if (channel.type === "GUILD_TEXT") {
      msgStateIdPrefix = channel.parentId ? `${this.namespace}.servers.${message.guildId}.channels.${channel.parentId}.channels.${channel.id}` : `${this.namespace}.servers.${message.guildId}.channels.${channel.id}`;
    } else if (channel.type === "DM") {
      msgStateIdPrefix = `${this.namespace}.users.${author.id}`;
    } else {
      this.log.warn("Received unexpected message!");
      return;
    }
    if (!this.messageReceiveStates.has(`${msgStateIdPrefix}.message`)) {
      this.log.debug(`State for received message ${msgStateIdPrefix} is not known for receiving messages`);
      return;
    }
    const json = {
      content,
      attachments: message.attachments.map((att) => ({ attachment: att.attachment.toString(), name: att.name, size: att.size, id: att.id })),
      id: message.id,
      mentions: ((_c = message.mentions.members) == null ? void 0 : _c.map((m) => ({ id: m.id, tag: m.user.tag, displayName: m.displayName }))) || [],
      mentioned,
      timestamp: message.createdTimestamp,
      authorized: isAuthorAuthorized
    };
    const proms = [];
    if (message.guildId) {
      json.author = {
        id: author.id,
        tag: author.tag,
        displayName: ((_e = (_d = this.client.guilds.cache.get(message.guildId)) == null ? void 0 : _d.members.cache.get(author.id)) == null ? void 0 : _e.displayName) || author.username
      };
      proms.push(this.setStateAsync(`${msgStateIdPrefix}.messageAuthor`, author.tag, true));
    }
    if (!(0, import_node_util.isDeepStrictEqual)(json, this.jsonStateCache.get(`${this.namespace}.${msgStateIdPrefix}.messageJson`))) {
      proms.push(this.setStateAsync(`${msgStateIdPrefix}.messageJson`, JSON.stringify(json), true));
      this.jsonStateCache.set(`${this.namespace}.${msgStateIdPrefix}.messageJson`, json);
    }
    await Promise.all([
      this.setStateAsync(`${msgStateIdPrefix}.message`, content, true),
      this.setStateAsync(`${msgStateIdPrefix}.messageId`, message.id, true),
      this.setStateAsync(`${msgStateIdPrefix}.messageTimestamp`, message.createdTimestamp, true),
      ...proms
    ]);
    if (content && this.config.text2commandInstance && this.text2commandObjects.has(`${msgStateIdPrefix}.message`)) {
      if (this.checkUserAuthorization(authCheckTarget, { useText2command: true })) {
        this.log.debug(`Sending "${content}" to ${this.config.text2commandInstance}`);
        const payload = {
          text: content
        };
        this.sendTo(this.config.text2commandInstance, "send", payload, async (responseObj) => {
          const response = responseObj == null ? void 0 : responseObj.response;
          try {
            if (!response) {
              this.log.debug(`Empty response from ${this.config.text2commandInstance}`);
              return;
            }
            this.log.debug(`Response from ${this.config.text2commandInstance}: ${response}`);
            switch (this.config.text2commandRespondWith) {
              case "reply":
                await message.reply(response);
                break;
              case "message":
                await message.channel.send(response);
                break;
              default:
            }
          } catch (err) {
            this.log.warn(`Error while processing response "${response}" from ${this.config.text2commandInstance}! ${err}`);
          }
        });
      } else {
        this.log.debug(`User ${author.tag} (id:${author.id}) NOT allowed to use text2command`);
      }
    }
  }
  async onClientVoiceStateUpdate(oldState, newState) {
    var _a, _b, _c;
    if (!((_a = newState.member) == null ? void 0 : _a.id)) {
      return;
    }
    const proms = [];
    const json = __spreadValues({}, this.jsonStateCache.get(`${this.namespace}.servers.${newState.guild.id}.members.${newState.member.id}.json`));
    let update = false;
    if (oldState.channelId !== newState.channelId) {
      proms.push(this.setStateAsync(`servers.${newState.guild.id}.members.${newState.member.id}.voiceChannel`, ((_b = newState.channel) == null ? void 0 : _b.name) || "", true));
      json.voiceChannel = ((_c = newState.channel) == null ? void 0 : _c.name) || "";
      update = true;
    }
    if (oldState.serverDeaf !== newState.serverDeaf) {
      proms.push(this.setStateAsync(`servers.${newState.guild.id}.members.${newState.member.id}.voiceServerDeaf`, !!newState.serverDeaf, true));
      json.voiceSelfDeaf = !!newState.selfDeaf;
      update = true;
    }
    if (oldState.selfDeaf !== newState.selfDeaf) {
      proms.push(this.setStateAsync(`servers.${newState.guild.id}.members.${newState.member.id}.voiceSelfDeaf`, !!newState.selfDeaf, true));
      json.voiceServerDeaf = !!newState.serverDeaf;
      update = true;
    }
    if (oldState.serverMute !== newState.serverMute) {
      proms.push(this.setStateAsync(`servers.${newState.guild.id}.members.${newState.member.id}.voiceServerMute`, !!newState.serverMute, true));
      json.voiceSelfMute = !!newState.selfMute;
      update = true;
    }
    if (oldState.selfMute !== newState.selfMute) {
      proms.push(this.setStateAsync(`servers.${newState.guild.id}.members.${newState.member.id}.voiceSelfMute`, !!newState.selfMute, true));
      json.voiceServerMute = !!newState.serverMute;
      update = true;
    }
    if (update) {
      proms.push(this.setStateAsync(`servers.${newState.guild.id}.members.${newState.member.id}.json`, JSON.stringify(json), true));
      this.jsonStateCache.set(`${this.namespace}.servers.${newState.guild.id}.members.${newState.member.id}.json`, json);
    }
    await Promise.all(proms);
  }
  async setupObjCustom(objId, customCfg, objCommon) {
    if (objId.startsWith(`${this.namespace}.`) && objId.endsWith(".message")) {
      if ((customCfg == null ? void 0 : customCfg.enabled) && customCfg.enableText2command) {
        this.log.debug(`Custom option text2command enabled for ${objId}`);
        this.text2commandObjects.add(objId);
      } else if (this.text2commandObjects.has(objId)) {
        this.log.debug(`Custom option text2command disabled for ${objId}`);
        this.text2commandObjects.delete(objId);
      }
    }
    if (customCfg == null ? void 0 : customCfg.enableCommands) {
      if (!objCommon) {
        const obj = await this.getForeignObjectAsync(objId);
        if ((obj == null ? void 0 : obj.type) === "state") {
          objCommon = obj.common;
        } else {
          this.log.warn(`Object ${objId} has commands enabled but this seams to be an error because it is not a state object!`);
        }
      }
      let name = customCfg.commandsName;
      if (!name && objCommon) {
        if (typeof objCommon.name === "object") {
          name = objCommon.name[import_i18n.i18n.language] || objCommon.name.en;
        } else {
          name = objCommon.name;
        }
      }
      const cfg = {
        id: objId,
        alias: customCfg.commandsAlias || objId,
        name: name || objId,
        get: !!customCfg.commandsAllowGet,
        set: !!customCfg.commandsAllowSet
      };
      let cfgOk = true;
      if (cfg.name.length > 100) {
        this.log.warn(`Command name for ${objId} exceeds the limit of 100 chars! This object will be ignored.`);
        cfgOk = false;
      }
      if (!cfg.alias.match(/^[0-9a-zA-Z._-]{0,100}$/)) {
        this.log.warn(`Command alias for ${objId} includes invalid chars or exceeds the limit of 100 chars! This object will be ignored.`);
        cfgOk = false;
      }
      this.discordSlashCommands.setupCommandObject(objId, cfgOk ? cfg : null);
    } else {
      this.discordSlashCommands.setupCommandObject(objId, null);
    }
  }
  onObjectChange(objId, obj) {
    var _a, _b;
    if (obj) {
      if (obj.type === "state") {
        this.log.silly(`Object ${objId} changed: ${JSON.stringify(obj)}`);
        this.setupObjCustom(objId, (_b = (_a = obj.common) == null ? void 0 : _a.custom) == null ? void 0 : _b[this.namespace], obj.common);
      }
    } else {
      this.log.silly(`Object ${objId} deleted`);
      this.setupObjCustom(objId, null);
    }
  }
  async onStateChange(stateId, state) {
    this.log.silly(`State changed: ${stateId} ${state == null ? void 0 : state.val} (ack=${state == null ? void 0 : state.ack})`);
    if (!state || state.ack)
      return;
    let setAck = false;
    if (stateId.startsWith(`${this.namespace}.`)) {
      switch (stateId) {
        case `${this.namespace}.bot.status`:
          await this.setBotPresence({ status: state.val });
          setAck = true;
          break;
        case `${this.namespace}.bot.activityType`:
          await this.setBotPresence({ activityType: state.val });
          setAck = true;
          break;
        case `${this.namespace}.bot.activityName`:
          await this.setBotPresence({ activityName: state.val });
          setAck = true;
          break;
        default:
          if (stateId.endsWith(".send") || stateId.endsWith(".sendFile") || stateId.endsWith(".sendReply") || stateId.endsWith(".sendReaction")) {
            setAck = await this.onSendStateChange(stateId, state);
          } else if (stateId.endsWith(".voiceDisconnect") || stateId.endsWith(".voiceServerMute") || stateId.endsWith(".voiceServerDeaf")) {
            setAck = await this.onVoiceStateChange(stateId, state);
          }
      }
    }
    if (setAck) {
      await this.setStateAsync(stateId, __spreadProps(__spreadValues({}, state), {
        ack: true
      }));
    }
  }
  async onSendStateChange(stateId, state) {
    var _a, _b, _c;
    if (!((_a = this.client) == null ? void 0 : _a.isReady())) {
      this.log.warn(`State ${stateId} changed but client is not ready!`);
      return false;
    }
    if (typeof state.val !== "string") {
      this.log.warn(`State ${stateId} changed but value if not a string!`);
      return false;
    }
    if (state.val.length === 0) {
      this.log.debug(`State ${stateId} changed but value is empty`);
      return false;
    }
    let action;
    let target;
    let targetName = "";
    let targetStateIdBase;
    let m = stateId.match(/^(discord\.\d+\.servers\.(\d+)\.channels\.(\d+)(\.channels\.(\d+))?)\.(send|sendFile|sendReaction|sendReply)$/);
    if (m) {
      const guildId = m[2];
      const channelId = m[5] || m[3];
      targetStateIdBase = m[1];
      action = m[6];
      const channel = (_b = this.client.guilds.cache.get(guildId)) == null ? void 0 : _b.channels.cache.get(channelId);
      if (!(channel == null ? void 0 : channel.isText()) || channel.isThread()) {
        this.log.warn(`State ${stateId} changed but target is not a valid text channel!`);
        return false;
      }
      target = channel;
      targetName = channel.parent ? `${channel.guild.name}/${channel.parent.name}/${channel.name}` : `${channel.guild.name}/${channel.name}`;
    } else {
      m = stateId.match(/^(discord\.\d+\.users\.(\d+))\.(send|sendFile|sendReaction|sendReply)$/);
      if (!m) {
        this.log.warn(`State ${stateId} changed but could not determine target to send message to!`);
        return false;
      }
      const userId = m[2];
      targetStateIdBase = m[1];
      action = m[3];
      const user = this.client.users.cache.get(userId);
      if (!user) {
        this.log.warn(`State ${stateId} changed but target is not a valid user!`);
        return false;
      }
      target = user;
      targetName = user.tag;
    }
    let mo;
    if (action === "sendFile") {
      const idx = state.val.indexOf("|");
      let file;
      let content = void 0;
      if (idx > 0) {
        file = state.val.slice(0, idx);
        content = state.val.slice(idx + 1);
      } else {
        file = state.val;
      }
      const b64data = (0, import_utils.getBufferAndNameFromBase64String)(file);
      if (b64data) {
        mo = {
          content,
          files: [{
            attachment: b64data.buffer,
            name: b64data.name
          }]
        };
      } else {
        const name = (0, import_utils.getBasenameFromFilePathOrUrl)(file);
        if (file.startsWith("file://")) {
          file = file.slice(7);
        }
        mo = {
          content,
          files: [{
            attachment: file,
            name
          }]
        };
      }
    } else if (action === "sendReply" || action === "sendReaction") {
      const idx = state.val.indexOf("|");
      let messageReference;
      let content;
      if (idx > 0) {
        messageReference = state.val.slice(0, idx);
        content = state.val.slice(idx + 1);
      } else {
        this.log.debug(`Get reply message reference from last received message for ${targetStateIdBase}`);
        messageReference = (_c = await this.getForeignStateAsync(`${targetStateIdBase}.messageId`)) == null ? void 0 : _c.val;
        content = state.val;
      }
      if (action === "sendReply") {
        if (!messageReference || !content) {
          this.log.warn(`No message reference or no content for reply for ${stateId}!`);
          return false;
        }
        mo = {
          content,
          reply: {
            messageReference
          }
        };
      } else {
        if (!messageReference || !content) {
          this.log.warn(`No message reference or no/invalid content for reaction for ${stateId}!`);
          return false;
        }
        const channel = target instanceof import_discord.User ? target.dmChannel || await target.createDM() : target;
        if (!channel || !channel.isText()) {
          this.log.warn(`Could not determine target channel for reaction ${stateId}!`);
          return false;
        }
        const message = channel.messages.cache.get(messageReference) || await channel.messages.fetch(messageReference);
        if (!message) {
          this.log.warn(`Could not determine target message for reaction ${stateId}!`);
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
    } else if (state.val.startsWith("{") && state.val.endsWith("}")) {
      this.log.debug(`State ${stateId} value seams to be json`);
      try {
        mo = JSON.parse(state.val);
      } catch (err) {
        this.log.warn(`State ${stateId} value seams to be json but cannot be parsed!`);
        return false;
      }
      if (!(mo == null ? void 0 : mo.files) && !mo.content || mo.files && !Array.isArray(mo.files) || mo.embeds && !Array.isArray(mo.embeds)) {
        this.log.warn(`State ${stateId} value seams to be json but seams to be invalid!`);
        return false;
      }
    } else {
      mo = {
        content: state.val
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
  async onVoiceStateChange(stateId, state) {
    var _a;
    const m = stateId.match(/^discord\.\d+\.servers\.(\d+)\.members\.(\d+)\.voice(Disconnect|ServerMute|ServerDeaf)$/);
    if (!m) {
      this.log.debug(`Voice state ${stateId} changed but could not get serverID and memberID!`);
      return false;
    }
    const [, guildId, memberId, action] = m;
    const guild = (_a = this.client) == null ? void 0 : _a.guilds.cache.get(guildId);
    const member = guild == null ? void 0 : guild.members.cache.get(memberId);
    if (!guild || !member) {
      this.log.warn(`Voice state ${stateId} changed but could not get the server member!`);
      return false;
    }
    try {
      switch (action) {
        case "Disconnect":
          if (!state.val) {
            return false;
          }
          await member.voice.disconnect();
          this.log.debug(`Voice member ${member.user.tag} of server ${guild.name} disconnected.`);
          break;
        case "ServerDeaf":
          await member.voice.setDeaf(!!state.val);
          this.log.debug(`Voice server deafen of member ${member.user.tag} of server ${guild.name} set to ${!!state.val}.`);
          break;
        case "ServerMute":
          await member.voice.setMute(!!state.val);
          this.log.debug(`Voice server mute of member ${member.user.tag} of server ${guild.name} set to ${!!state.val}.`);
          break;
        default:
          return false;
      }
      return true;
    } catch (err) {
      this.log.warn(`Voice server action of member ${member.user.tag} of server ${guild.name} can't be done! ${err}`);
      return false;
    }
  }
  async onMessage(obj) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i;
    if (typeof obj !== "object")
      return;
    this.log.debug(`Got message: ${JSON.stringify(obj)}`);
    let msg;
    switch (obj.command) {
      case "getText2commandInstances":
        if (!obj.callback) {
          this.log.warn(`Message '${obj.command}' called without callback!`);
          return;
        }
        const view = await this.getObjectViewAsync("system", "instance", {
          startkey: "system.adapter.text2command.",
          endkey: "system.adapter.text2command.\u9999"
        });
        const text2commandInstances = view.rows.map((r) => {
          const id = r.id.slice(15);
          return {
            label: id,
            value: id
          };
        });
        this.log.debug(`Found text2command instances: ${text2commandInstances.map((i) => i.value)}`);
        this.sendTo(obj.from, obj.command, [{ value: "", label: "---" }, ...text2commandInstances], obj.callback);
        break;
      case "getUsers":
        if (!obj.callback) {
          this.log.warn(`Message '${obj.command}' called without callback!`);
          return;
        }
        const users = ((_a = this.client) == null ? void 0 : _a.users.cache.map((u) => ({ label: u.tag, value: u.id }))) || [];
        this.log.debug(`Users: ${users.map((i) => i.value)}`);
        this.sendTo(obj.from, obj.command, users, obj.callback);
        break;
      case "getServers":
        if (!obj.callback) {
          this.log.warn(`Message '${obj.command}' called without callback!`);
          return;
        }
        const servers = ((_b = this.client) == null ? void 0 : _b.guilds.cache.map((g) => ({ label: g.name, value: g.id }))) || [];
        this.log.debug(`Servers: ${servers.map((i) => i.value)}`);
        this.sendTo(obj.from, obj.command, servers, obj.callback);
        break;
      case "getServerRoles":
        if (!obj.callback) {
          this.log.warn(`Message '${obj.command}' called without callback!`);
          return;
        }
        if (!this.client) {
          this.sendTo(obj.from, obj.command, [], obj.callback);
          return;
        }
        const guildRolesWithLabel = [];
        for (const [, guild] of this.client.guilds.cache) {
          for (const [, role] of guild.roles.cache) {
            guildRolesWithLabel.push({
              label: `${guild.name} - ${role.name}`,
              value: `${guild.id}|${role.id}`
            });
          }
        }
        this.log.debug(`Server roles: ${guildRolesWithLabel.map((i) => i.value)}`);
        this.sendTo(obj.from, obj.command, guildRolesWithLabel, obj.callback);
        break;
      case "getAddToServerLink":
        if (!obj.callback) {
          this.log.warn(`Message '${obj.command}' called without callback!`);
          return;
        }
        if ((_d = (_c = this.client) == null ? void 0 : _c.user) == null ? void 0 : _d.id) {
          const perms = new import_discord.Permissions([
            import_discord.Permissions.FLAGS.CHANGE_NICKNAME,
            import_discord.Permissions.FLAGS.VIEW_CHANNEL,
            import_discord.Permissions.FLAGS.MODERATE_MEMBERS,
            import_discord.Permissions.FLAGS.SEND_MESSAGES,
            import_discord.Permissions.FLAGS.EMBED_LINKS,
            import_discord.Permissions.FLAGS.ATTACH_FILES,
            import_discord.Permissions.FLAGS.READ_MESSAGE_HISTORY,
            import_discord.Permissions.FLAGS.MENTION_EVERYONE,
            import_discord.Permissions.FLAGS.ADD_REACTIONS,
            import_discord.Permissions.FLAGS.MUTE_MEMBERS,
            import_discord.Permissions.FLAGS.DEAFEN_MEMBERS,
            import_discord.Permissions.FLAGS.MOVE_MEMBERS
          ]);
          this.sendTo(obj.from, obj.command, `https://discord.com/api/oauth2/authorize?client_id=${this.client.user.id}&permissions=${perms.bitfield}&scope=bot%20applications.commands`, obj.callback);
        } else {
          this.sendTo(obj.from, obj.command, `- ${import_i18n.i18n.getString("Error: The Bot is not connected to Discord!")} -`, obj.callback);
        }
        break;
      case "logConfiguredCommandObjects":
        this.discordSlashCommands.logConfiguredCommandObjects();
        if (obj.callback) {
          this.sendTo(obj.from, obj.command, { result: "ok" }, obj.callback);
        }
        break;
      case "send":
      case "sendMessage":
        if (!obj.callback) {
          this.log.warn(`Message '${obj.command}' called without callback!`);
          return;
        }
        if (typeof obj.message !== "object") {
          this.sendTo(obj.from, obj.command, { error: "sendTo message needs to be an object" }, obj.callback);
          return;
        }
        const sendPayload = obj.message;
        if (!sendPayload.content || typeof sendPayload.content !== "string" && typeof sendPayload.content !== "object") {
          this.sendTo(obj.from, obj.command, __spreadValues({ error: "content needs to be a string or a MessageOptions object" }, sendPayload), obj.callback);
          return;
        }
        if (sendPayload.userId || sendPayload.userTag) {
          let user;
          if (sendPayload.userId) {
            user = (_e = this.client) == null ? void 0 : _e.users.cache.get(sendPayload.userId);
            if (!user) {
              this.sendTo(obj.from, obj.command, __spreadValues({ error: `No user with userId ${sendPayload.userId} found` }, sendPayload), obj.callback);
              return;
            }
          } else {
            user = (_f = this.client) == null ? void 0 : _f.users.cache.find((u) => u.tag === sendPayload.userTag);
            if (!user) {
              this.sendTo(obj.from, obj.command, __spreadValues({ error: `No user with userTag ${sendPayload.userTag} found` }, sendPayload), obj.callback);
              return;
            }
          }
          try {
            msg = await user.send(sendPayload.content);
            this.sendTo(obj.from, obj.command, __spreadProps(__spreadValues({ result: `Message sent to user ${user.tag}` }, sendPayload), { messageId: msg.id }), obj.callback);
          } catch (err) {
            this.sendTo(obj.from, obj.command, __spreadValues({ error: `Error sending message to user ${user.tag}: ${err}` }, sendPayload), obj.callback);
          }
        } else if (sendPayload.serverId && sendPayload.channelId) {
          const channel = (_h = (_g = this.client) == null ? void 0 : _g.guilds.cache.get(sendPayload.serverId)) == null ? void 0 : _h.channels.cache.get(sendPayload.channelId);
          if (!(channel == null ? void 0 : channel.isText())) {
            this.sendTo(obj.from, obj.command, __spreadValues({ error: `No text channel with channelId ${sendPayload.channelId} on server ${sendPayload.serverId} found` }, sendPayload), obj.callback);
            return;
          }
          try {
            msg = await channel.send(sendPayload.content);
            this.sendTo(obj.from, obj.command, __spreadProps(__spreadValues({ result: `Message sent to channel ${channel.name}` }, sendPayload), { messageId: msg.id }), obj.callback);
          } catch (err) {
            this.sendTo(obj.from, obj.command, __spreadValues({ error: `Error sending message to channel ${channel.name}: ${err}` }, sendPayload), obj.callback);
          }
        } else {
          this.sendTo(obj.from, obj.command, __spreadValues({ error: "userId, userTag or serverId and channelId needs to be set" }, sendPayload), obj.callback);
        }
        break;
      case "editMessage":
        if (!obj.callback) {
          this.log.warn(`Message '${obj.command}' called without callback!`);
          return;
        }
        if (typeof obj.message !== "object") {
          this.sendTo(obj.from, obj.command, { error: "sendTo message needs to be an object" }, obj.callback);
          return;
        }
        const editMessagePayload = obj.message;
        if (!editMessagePayload.content || typeof editMessagePayload.content !== "string" && typeof editMessagePayload.content !== "object") {
          this.sendTo(obj.from, obj.command, __spreadValues({ error: "content needs to be a string or a MessageOptions object" }, editMessagePayload), obj.callback);
          return;
        }
        try {
          msg = await this.getPreviousMessage(editMessagePayload);
        } catch (err) {
          if (err instanceof Error && err.message) {
            this.sendTo(obj.from, obj.command, __spreadValues({ error: err.message }, editMessagePayload), obj.callback);
          } else {
            this.sendTo(obj.from, obj.command, __spreadValues({ error: err }, editMessagePayload), obj.callback);
          }
          return;
        }
        try {
          if (!msg.editable) {
            this.sendTo(obj.from, obj.command, __spreadValues({ error: `Message with messageId ${editMessagePayload.messageId} is not editable` }, editMessagePayload), obj.callback);
            return;
          }
          await msg.edit(editMessagePayload.content);
          this.sendTo(obj.from, obj.command, __spreadValues({ result: `Message edited` }, editMessagePayload), obj.callback);
        } catch (err) {
          this.sendTo(obj.from, obj.command, __spreadValues({ error: `Error editing message: ${err}` }, editMessagePayload), obj.callback);
        }
        break;
      case "deleteMessage":
        if (!obj.callback) {
          this.log.warn(`Message '${obj.command}' called without callback!`);
          return;
        }
        if (typeof obj.message !== "object") {
          this.sendTo(obj.from, obj.command, { error: "sendTo message needs to be an object" }, obj.callback);
          return;
        }
        const deleteMessagePayload = obj.message;
        try {
          msg = await this.getPreviousMessage(deleteMessagePayload);
        } catch (err) {
          if (err instanceof Error && err.message) {
            this.sendTo(obj.from, obj.command, __spreadValues({ error: err.message }, deleteMessagePayload), obj.callback);
          } else {
            this.sendTo(obj.from, obj.command, __spreadValues({ error: err }, deleteMessagePayload), obj.callback);
          }
          return;
        }
        try {
          if (!msg.deletable) {
            this.sendTo(obj.from, obj.command, __spreadValues({ error: `Message with messageId ${deleteMessagePayload.messageId} is not deletable` }, deleteMessagePayload), obj.callback);
            return;
          }
          await msg.delete();
          this.sendTo(obj.from, obj.command, __spreadValues({ result: `Message deleted` }, deleteMessagePayload), obj.callback);
        } catch (err) {
          this.sendTo(obj.from, obj.command, __spreadValues({ error: `Error deleting message: ${err}` }, deleteMessagePayload), obj.callback);
        }
        break;
      case "addReaction":
        if (!obj.callback) {
          this.log.warn(`Message '${obj.command}' called without callback!`);
          return;
        }
        if (typeof obj.message !== "object") {
          this.sendTo(obj.from, obj.command, { error: "sendTo message needs to be an object" }, obj.callback);
          return;
        }
        const addReactionPayload = obj.message;
        if (typeof addReactionPayload.emoji !== "string") {
          this.sendTo(obj.from, obj.command, __spreadValues({ error: "emoji needs to be a string" }, addReactionPayload), obj.callback);
          return;
        }
        try {
          msg = await this.getPreviousMessage(addReactionPayload);
        } catch (err) {
          if (err instanceof Error && err.message) {
            this.sendTo(obj.from, obj.command, __spreadValues({ error: err.message }, addReactionPayload), obj.callback);
          } else {
            this.sendTo(obj.from, obj.command, __spreadValues({ error: err }, addReactionPayload), obj.callback);
          }
          return;
        }
        try {
          await msg.react(addReactionPayload.emoji);
          this.sendTo(obj.from, obj.command, __spreadValues({ result: `Reaction added to message` }, addReactionPayload), obj.callback);
        } catch (err) {
          this.sendTo(obj.from, obj.command, __spreadValues({ error: `Error adding reaction to message: ${err}` }, addReactionPayload), obj.callback);
        }
        break;
      case "awaitMessageReaction":
        if (!obj.callback) {
          this.log.warn(`Message '${obj.command}' called without callback!`);
          return;
        }
        if (typeof obj.message !== "object") {
          this.sendTo(obj.from, obj.command, { error: "sendTo message needs to be an object" }, obj.callback);
          return;
        }
        const awaitMessageReactionPayload = obj.message;
        if (typeof awaitMessageReactionPayload.timeout !== "number" || awaitMessageReactionPayload.timeout < 100 || awaitMessageReactionPayload.timeout > 6e4) {
          this.sendTo(obj.from, obj.command, __spreadValues({ error: "timeout needs to be a number between 100 and 60000" }, awaitMessageReactionPayload), obj.callback);
          return;
        }
        if (typeof awaitMessageReactionPayload.max !== "number" || awaitMessageReactionPayload.max < 1) {
          awaitMessageReactionPayload.max = 1;
        }
        try {
          msg = await this.getPreviousMessage(awaitMessageReactionPayload);
        } catch (err) {
          if (err instanceof Error && err.message) {
            this.sendTo(obj.from, obj.command, __spreadValues({ error: err.message }, awaitMessageReactionPayload), obj.callback);
          } else {
            this.sendTo(obj.from, obj.command, __spreadValues({ error: err }, awaitMessageReactionPayload), obj.callback);
          }
          return;
        }
        const reactionCollector = msg.createReactionCollector({
          filter: (_reaction, user) => {
            var _a2, _b2;
            return user.id !== ((_b2 = (_a2 = this.client) == null ? void 0 : _a2.user) == null ? void 0 : _b2.id);
          },
          max: awaitMessageReactionPayload.max,
          time: awaitMessageReactionPayload.timeout
        });
        reactionCollector.on("end", (collected) => {
          const reactions = collected.map((r) => ({ emoji: r.emoji.name, emojiId: r.emoji.id, users: r.users.cache.map((u) => ({ id: u.id, tag: u.tag })) }));
          this.sendTo(obj.from, obj.command, __spreadValues({ reactions }, awaitMessageReactionPayload), obj.callback);
        });
        break;
      case "leaveServer":
        if (typeof obj.message !== "object") {
          this.sendTo(obj.from, obj.command, { error: "sendTo message needs to be an object" }, obj.callback);
          return;
        }
        const leaveServerPayload = obj.message;
        if (!leaveServerPayload.serverId) {
          this.sendTo(obj.from, obj.command, __spreadValues({ error: "serverId needs to be set" }, leaveServerPayload), obj.callback);
          return;
        }
        const guildToLeave = (_i = this.client) == null ? void 0 : _i.guilds.cache.get(leaveServerPayload.serverId);
        if (!guildToLeave) {
          this.sendTo(obj.from, obj.command, { error: `No server with ID ${leaveServerPayload.serverId} found` }, obj.callback);
          return;
        }
        try {
          await guildToLeave.leave();
          this.log.info(`Left server ${guildToLeave.name} (${guildToLeave.id})`);
          if (obj.callback) {
            this.sendTo(obj.from, obj.command, { result: "ok" }, obj.callback);
          }
        } catch (err) {
          if (obj.callback) {
            this.sendTo(obj.from, obj.command, __spreadValues({ error: `Error leaving server ${leaveServerPayload.serverId}: ${err}` }, leaveServerPayload), obj.callback);
          }
        }
        break;
      default:
        this.log.warn(`Got message with unknown command: ${obj.command}`);
        if (obj.callback) {
          this.sendTo(obj.from, obj.command, { error: `Unknown command: ${obj.command}` }, obj.callback);
        }
    }
  }
  async getPreviousMessage(identifier) {
    var _a, _b, _c, _d, _e, _f;
    if (!identifier.messageId) {
      throw new Error("messageId needs to be set");
    }
    if (identifier.userId || identifier.userTag) {
      let user;
      if (identifier.userId) {
        user = (_a = this.client) == null ? void 0 : _a.users.cache.get(identifier.userId);
        if (!user) {
          throw new Error(`No user with userId ${identifier.userId} found`);
        }
      } else {
        user = (_b = this.client) == null ? void 0 : _b.users.cache.find((u) => u.tag === identifier.userTag);
        if (!user) {
          throw new Error(`No user with userTag ${identifier.userTag} found`);
        }
      }
      try {
        if (!user.dmChannel) {
          await user.createDM();
        }
        const msg = ((_c = user.dmChannel) == null ? void 0 : _c.messages.cache.get(identifier.messageId)) || await ((_d = user.dmChannel) == null ? void 0 : _d.messages.fetch(identifier.messageId));
        if (!msg) {
          throw new Error(`No message with messageId ${identifier.messageId} for user ${user.tag} found`);
        }
        return msg;
      } catch (err) {
        throw new Error(`Error finding message for user ${user.tag}: ${err}`);
      }
    } else if (identifier.serverId && identifier.channelId) {
      const channel = (_f = (_e = this.client) == null ? void 0 : _e.guilds.cache.get(identifier.serverId)) == null ? void 0 : _f.channels.cache.get(identifier.channelId);
      if (!(channel == null ? void 0 : channel.isText())) {
        throw new Error(`No text channel with channelId ${identifier.channelId} on server ${identifier.serverId} found`);
      }
      try {
        const msg = channel.messages.cache.get(identifier.messageId) || await channel.messages.fetch(identifier.messageId);
        if (!msg) {
          throw new Error(`No message with messageId ${identifier.messageId} for channel ${channel.name} found`);
        }
        return msg;
      } catch (err) {
        throw new Error(`Error finding message in channel ${channel.name}: ${err}`);
      }
    } else {
      throw new Error("userId, userTag or serverId and channelId needs to be set");
    }
  }
  checkUserAuthorization(user, required) {
    if (!this.config.enableAuthorization) {
      return true;
    }
    let given = this.config.authorizedUsers.find((au) => au.userId === user.id);
    if (this.config.authorizedServerRoles.length > 0 && user instanceof import_discord.GuildMember) {
      for (const [, role] of user.roles.cache) {
        const roleGiven = this.config.authorizedServerRoles.find((ar) => ar.serverAndRoleId === `${user.guild.id}|${role.id}`);
        if (roleGiven) {
          if (!given) {
            given = roleGiven;
          } else {
            given = {
              getStates: given.getStates || roleGiven.getStates,
              setStates: given.setStates || roleGiven.setStates,
              useText2command: given.useText2command || roleGiven.useText2command
            };
          }
        }
      }
    }
    if (!given) {
      return false;
    }
    if (!required) {
      return true;
    }
    if (required.getStates && !given.getStates || required.setStates && !given.setStates || required.useText2command && !given.useText2command) {
      return false;
    }
    return true;
  }
  async setInfoConnectionState(connected, force = false) {
    if (force || connected !== this.infoConnected) {
      await this.setStateAsync("info.connection", connected, true);
      this.infoConnected = connected;
    }
  }
  async extendObjectAsyncCached(id, objPart, options) {
    const cachedObj = this.extendObjectCache.get(id);
    if ((0, import_node_util.isDeepStrictEqual)(cachedObj, objPart)) {
      return { id };
    }
    const ret = await this.extendObjectAsync(id, objPart, options);
    this.extendObjectCache.set(id, objPart);
    return ret;
  }
  async delObjectAsyncCached(id, options) {
    if (options == null ? void 0 : options.recursive) {
      this.extendObjectCache.filter((_obj, id2) => id2.startsWith(id)).each((_obj, id2) => this.extendObjectCache.delete(id2));
    } else {
      this.extendObjectCache.delete(id);
    }
    return this.delObjectAsync(id, options);
  }
  async onUnload(callback) {
    try {
      this.unloaded = true;
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
__decorateClass([
  import_autobind_decorator.boundMethod
], DiscordAdapter.prototype, "onReady", 1);
__decorateClass([
  import_autobind_decorator.boundMethod
], DiscordAdapter.prototype, "onClientReady", 1);
__decorateClass([
  import_autobind_decorator.boundMethod
], DiscordAdapter.prototype, "onClientMessageCreate", 1);
__decorateClass([
  import_autobind_decorator.boundMethod
], DiscordAdapter.prototype, "onClientVoiceStateUpdate", 1);
__decorateClass([
  import_autobind_decorator.boundMethod
], DiscordAdapter.prototype, "onObjectChange", 1);
__decorateClass([
  import_autobind_decorator.boundMethod
], DiscordAdapter.prototype, "onStateChange", 1);
__decorateClass([
  import_autobind_decorator.boundMethod
], DiscordAdapter.prototype, "onMessage", 1);
__decorateClass([
  import_autobind_decorator.boundMethod
], DiscordAdapter.prototype, "onUnload", 1);
if (require.main !== module) {
  module.exports = (options) => new DiscordAdapter(options);
} else {
  (() => new DiscordAdapter())();
}
//# sourceMappingURL=main.js.map
