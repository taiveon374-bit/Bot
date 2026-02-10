// bot.js
import { Client, GatewayIntentBits, SlashCommandBuilder, Routes } from "discord.js";
import { REST } from "@discordjs/rest";
import { joinVoiceChannel, createAudioPlayer, createAudioResource } from "@discordjs/voice";
import playdl from "play-dl";
import sqlite3 from "sqlite3";
import axios from "axios";

// ===== ENV VARIABLES =====
// Set these in Render
// BOTTOKEN, CLIENT_ID, GUILD_ID, CUSTOMER_ROLE_ID, PAYHIP_SECRET_1..10

const DISCORD_TOKEN = process.env.BOTTOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const CUSTOMER_ROLE_ID = process.env.CUSTOMER_ROLE_ID;
const PAYHIP_URL = "https://payhip.com/api/v2/license/verify";

// Products
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

// Database
const db = new sqlite3.Database("./redeems.db");
db.run(`
  CREATE TABLE IF NOT EXISTS redeems (
    licenseKey TEXT UNIQUE,
    discordUserId TEXT UNIQUE,
    productId TEXT
  )
`);

// Music Queue
const queue = new Map();

// Discord Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages
  ]
});

// Commands
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
    .setDescription("Skip the currently playing song")
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
    console.error(err);
  }
})();

// Cooldowns
const cooldowns = new Map();

// Ready
client.once("ready", () => {
  console.log(`Bot online as ${client.user.tag}`);
});

// Interaction handler
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const userId = interaction.user.id;

  // Cooldown check
  const now = Date.now();
  const cooldownAmount = 5000; // 5 seconds
  if (cooldowns.has(userId)) {
    const expiration = cooldowns.get(userId) + cooldownAmount;
    if (now < expiration) {
      return interaction.reply({ content: `⏳ Please wait a few seconds before using commands again.`, ephemeral: true });
    }
  }
  cooldowns.set(userId, now);

  // ====== /redeem ======
  if (interaction.commandName === "redeem") {
    await interaction.deferReply({ ephemeral: true });
    const licenseKey = interaction.options.getString("key");

    db.get("SELECT * FROM redeems WHERE discordUserId = ?", [userId], async (_, row) => {
      if (row) return interaction.editReply("❌ You have already redeemed a license.");

      for (const [productId, secret] of Object.entries(PAYHIP_PRODUCTS)) {
        try {
          const res = await axios.get(PAYHIP_URL, {
            params: { license_key: licenseKey },
            headers: { "product-secret-key": secret }
          });

          if (res.data.data && res.data.data.enabled) {
            db.get("SELECT * FROM redeems WHERE licenseKey = ?", [licenseKey], (_, used) => {
              if (used) return interaction.editReply("❌ This license key has already been redeemed.");

              db.run("INSERT INTO redeems VALUES (?, ?, ?)", [licenseKey, userId, productId]);

              interaction.guild.members.fetch(userId).then(member => {
                member.roles.add(CUSTOMER_ROLE_ID).catch(console.error);
              });

              return interaction.editReply(`✅ License verified for **${productId}**!`);
            });
            return;
          }
        } catch {}
      }
      return interaction.editReply("❌ Invalid or already used license key.");
    });
  }

  // ====== /play ======
  if (interaction.commandName === "play") {
    await interaction.deferReply();
    const query = interaction.options.getString("query");
    const voiceChannel = interaction.member.voice.channel;
    if (!voiceChannel) return interaction.editReply("❌ You must be in a voice channel to play music.");

    const permissions = voiceChannel.permissionsFor(interaction.client.user);
    if (!permissions.has("Connect") || !permissions.has("Speak")) {
      return interaction.editReply("❌ I need permissions to join and speak in your voice channel.");
    }

    let serverQueue = queue.get(interaction.guild.id);
    if (!serverQueue) {
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guild.id,
        adapterCreator: interaction.guild.voiceAdapterCreator,
      });

      const player = createAudioPlayer();
      connection.subscribe(player);

      serverQueue = { connection, player, songs: [] };
      queue.set(interaction.guild.id, serverQueue);
    }

    try {
      const ytInfo = await playdl.search(query, { limit: 1 });
      if (!ytInfo || ytInfo.length === 0) return interaction.editReply("❌ No results found.");

      const song = { title: ytInfo[0].title, url: ytInfo[0].url };
      serverQueue.songs.push(song);

      // Play immediately if nothing is playing
      if (serverQueue.player.state.status !== "playing") {
        const stream = await playdl.stream(song.url);
        const resource = createAudioResource(stream.stream, { inputType: stream.type });
        serverQueue.player.play(resource);
        interaction.editReply(`🎶 Now playing: **${song.title}**`);
      } else {
        interaction.editReply(`➕ Added to queue: **${song.title}**`);
      }
    } catch (err) {
      console.error(err);
      interaction.editReply("❌ Error playing the song.");
    }
  }

  // ====== /skip ======
  if (interaction.commandName === "skip") {
    const serverQueue = queue.get(interaction.guild.id);
    if (!serverQueue || serverQueue.songs.length === 0) return interaction.reply({ content: "❌ Nothing to skip.", ephemeral: true });

    serverQueue.player.stop();
    serverQueue.songs.shift(); // remove current song

    if (serverQueue.songs.length > 0) {
      const nextSong = serverQueue.songs[0];
      const stream = await playdl.stream(nextSong.url);
      const resource = createAudioResource(stream.stream, { inputType: stream.type });
      serverQueue.player.play(resource);
      interaction.reply(`⏭ Skipped! Now playing: **${nextSong.title}**`);
    } else {
      interaction.reply("⏭ Skipped! Queue is empty.");
    }
  }
});

client.login(DISCORD_TOKEN);
