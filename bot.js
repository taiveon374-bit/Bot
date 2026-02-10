import { Client, GatewayIntentBits, SlashCommandBuilder, Routes } from "discord.js";
import { REST } from "@discordjs/rest";
import axios from "axios";
import sqlite3 from "sqlite3";
import { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, NoSubscriberBehavior } from "@discordjs/voice";
import playdl from "play-dl";

// ===============================
// ENVIRONMENT VARIABLES (Set these in Render)
// ===============================
// BOTTOKEN = your bot token
// CLIENT_ID = your bot application ID
// GUILD_ID = your Discord server ID
// CUSTOMER_ROLE_ID = role to give users
// PAYHIP_SECRET_1 to PAYHIP_SECRET_10 = your 10 product secrets
// ===============================

const DISCORD_TOKEN = process.env.BOTTOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const CUSTOMER_ROLE_ID = process.env.CUSTOMER_ROLE_ID;
const PAYHIP_URL = "https://payhip.com/api/v2/license/verify";

const PAYHIP_PRODUCTS = {
  CraftingSystem: process.env.PAYHIP_SECRET_1,
  CharacterCreation: process.env.PAYHIP_SECRET_2,
  HoodSystemsPack: process.env.PAYHIP_SECRET_3,
  CharacterCreation2: process.env.PAYHIP_SECRET_4,
  HoodAssetsPack: process.env.PAYHIP_SECRET_5,
  PoliceSystem: process.env.PAYHIP_SECRET_6,
  AdvancedDuelsGame: process.env.PAYHIP_SECRET_7,
  AdvancedPhoneSystem: process.env.PAYHIP_SECRET_8,
  AdvancedGunSystem: process.env.PAYHIP_SECRET_9,
  LowPolyNYC: process.env.PAYHIP_SECRET_10,
};

// ---------------- Database ----------------
const db = new sqlite3.Database("./redeems.db");
db.run(`
  CREATE TABLE IF NOT EXISTS redeems (
    licenseKey TEXT UNIQUE,
    discordUserId TEXT UNIQUE,
    productId TEXT
  )
`);

// ---------------- Discord Client ----------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// ---------------- Slash Commands ----------------
const commands = [
  new SlashCommandBuilder()
    .setName("redeem")
    .setDescription("Redeem your license key")
    .addStringOption(opt =>
      opt.setName("key")
        .setDescription("Your license key")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a song from YouTube")
    .addStringOption(opt =>
      opt.setName("query")
        .setDescription("Song name or URL")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Skip the current song")
].map(c => c.toJSON());

// Register commands
const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
(async () => {
  try {
    console.log("Registering slash commands...");
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    console.log("Commands registered!");
  } catch (err) {
    console.error("Error registering commands:", err);
  }
})();

// ---------------- Music System ----------------
const queue = new Map();

function getQueue(guildId) {
  if (!queue.has(guildId)) {
    queue.set(guildId, {
      songs: [],
      player: createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } }),
      connection: null
    });
  }
  return queue.get(guildId);
}

// ---------------- Ready ----------------
client.once("ready", () => {
  console.log(`Bot online as ${client.user.tag}`);
});

// ---------------- Interaction ----------------
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  // ---------------- Redeem Command ----------------
  if (commandName === "redeem") {
    const licenseKey = interaction.options.getString("key");
    const discordUserId = interaction.user.id;

    db.get("SELECT * FROM redeems WHERE discordUserId = ?", [discordUserId], async (_, row) => {
      if (row) return interaction.reply({ content: "❌ You have already redeemed a license.", ephemeral: true });

      for (const [productId, secret] of Object.entries(PAYHIP_PRODUCTS)) {
        try {
          const r = await axios.get(PAYHIP_URL, {
            params: { license_key: licenseKey },
            headers: { "product-secret-key": secret }
          });

          if (r.data.data && r.data.data.enabled) {
            db.get("SELECT * FROM redeems WHERE licenseKey = ?", [licenseKey], (_, used) => {
              if (used) return interaction.reply({ content: "❌ This license key has already been redeemed.", ephemeral: true });

              db.run("INSERT INTO redeems VALUES (?, ?, ?)", [licenseKey, discordUserId, productId]);

              interaction.guild.members.fetch(discordUserId).then(member => {
                member.roles.add(CUSTOMER_ROLE_ID).catch(console.error);
              });

              return interaction.reply({ content: `✅ License verified for **${productId}**! You now have customer access.`, ephemeral: true });
            });

            return;
          }
        } catch (_) {}
      }

      return interaction.reply({ content: "❌ Invalid or already used license key.", ephemeral: true });
    });
  }

  // ---------------- Play Command ----------------
  if (commandName === "play") {
    const query = interaction.options.getString("query");
    const voiceChannel = interaction.member.voice.channel;
    if (!voiceChannel) return interaction.reply({ content: "You must be in a voice channel!", ephemeral: true });

    const q = getQueue(interaction.guildId);

    try {
      const ytInfo = await playdl.search(query, { limit: 1 });
      if (!ytInfo.length) return interaction.reply({ content: "No results found.", ephemeral: true });

      const stream = await playdl.stream(ytInfo[0].url);
      const resource = createAudioResource(stream.stream, { inputType: stream.type });

      q.songs.push({ resource, title: ytInfo[0].title });

      if (!q.connection) {
        q.connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: interaction.guildId,
          adapterCreator: interaction.guild.voiceAdapterCreator
        });
        q.connection.subscribe(q.player);

        q.player.on(AudioPlayerStatus.Idle, () => {
          q.songs.shift();
          if (q.songs.length > 0) q.player.play(q.songs[0].resource);
          else {
            q.connection.destroy();
            queue.delete(interaction.guildId);
          }
        });

        q.player.play(q.songs[0].resource);
        return interaction.reply(`🎶 Now playing: **${q.songs[0].title}**`);
      } else {
        return interaction.reply(`✅ Queued: **${ytInfo[0].title}**`);
      }
    } catch (err) {
      console.error(err);
      return interaction.reply({ content: "Error playing that song.", ephemeral: true });
    }
  }

  // ---------------- Skip Command ----------------
  if (commandName === "skip") {
    const q = queue.get(interaction.guildId);
    if (!q || !q.songs.length) return interaction.reply({ content: "No song is playing.", ephemeral: true });

    q.player.stop();
    return interaction.reply("⏭ Skipped the current song.");
  }
});

client.login(DISCORD_TOKEN);
