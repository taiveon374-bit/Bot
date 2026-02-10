import {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  Routes
} from "discord.js";
import { REST } from "@discordjs/rest";
import express from "express";
import axios from "axios";
import sqlite3 from "sqlite3";
import ytdl from "ytdl-core";
import yts from "yt-search";
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus
} from "@discordjs/voice";

// ===============================
// ENV VARIABLES
// ===============================
const DISCORD_TOKEN = process.env.BOTTOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const CUSTOMER_ROLE_ID = process.env.CUSTOMER_ROLE_ID;

// PAYHIP Products
const PAYHIP_PRODUCTS = {
  CraftingSystem: process.env.PAYHIP_SECRET_1,
  CharacterCreation: process.env.PAYHIP_SECRET_2
  // add more products as needed
};
const PAYHIP_URL = "https://payhip.com/api/v2/license/verify";

// ===============================
// KEEP ALIVE (Render Web Service)
// ===============================
const app = express();
app.get("/", (_, res) => res.send("Bot alive"));
app.listen(process.env.PORT || 3000);

// ===============================
// DATABASE
// ===============================
const db = new sqlite3.Database("./redeems.db");
db.run(`
  CREATE TABLE IF NOT EXISTS redeems (
    licenseKey TEXT UNIQUE,
    discordUserId TEXT UNIQUE,
    productId TEXT
  )
`);

// ===============================
// COOLDOWN
// ===============================
const cooldowns = new Map();
const REDEEM_COOLDOWN = 60 * 1000; // 1 minute

function onCooldown(userId) {
  const last = cooldowns.get(userId);
  if (!last) return false;
  return Date.now() - last < REDEEM_COOLDOWN;
}

// ===============================
// DISCORD CLIENT
// ===============================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// ===============================
// MUSIC QUEUE
// ===============================
const queue = [];
let connection = null;
let currentSong = null;

const player = createAudioPlayer();
player.on(AudioPlayerStatus.Idle, () => playNext());

function playNext() {
  if (queue.length === 0) {
    currentSong = null;
    return;
  }

  const song = queue.shift();
  currentSong = song;

  const stream = ytdl(song.url, { filter: "audioonly", highWaterMark: 1 << 25 });
  const resource = createAudioResource(stream);
  player.play(resource);
  connection.subscribe(player);
}

// ===============================
// SLASH COMMANDS
// ===============================
const commands = [
  // Redeem
  new SlashCommandBuilder()
    .setName("redeem")
    .setDescription("Redeem a license key")
    .addStringOption(opt =>
      opt.setName("key")
        .setDescription("Your license key")
        .setRequired(true)
    ),
  // Fun
  new SlashCommandBuilder().setName("ping").setDescription("Ping test"),
  new SlashCommandBuilder().setName("dice").setDescription("Roll a dice"),
  new SlashCommandBuilder().setName("coinflip").setDescription("Flip a coin"),
  // Music
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a song by name or YouTube link")
    .addStringOption(opt =>
      opt.setName("song")
        .setDescription("Song name or YouTube URL")
        .setRequired(true)
    ),
  new SlashCommandBuilder().setName("skip").setDescription("Skip current song"),
  new SlashCommandBuilder().setName("stop").setDescription("Stop music and clear queue"),
  new SlashCommandBuilder().setName("queue").setDescription("View music queue"),
  new SlashCommandBuilder().setName("nowplaying").setDescription("See current playing song")
].map(c => c.toJSON());

// ===============================
// REGISTER COMMANDS
// ===============================
const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
console.log("Commands registered");

// ===============================
// READY
// ===============================
client.once("ready", () => {
  console.log(`Bot online as ${client.user.tag}`);
});

// ===============================
// INTERACTION HANDLER
// ===============================
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, user, member } = interaction;

  // -------------------------------
  // FUN COMMANDS
  // -------------------------------
  if (commandName === "ping") return interaction.reply(`🏓 Pong! ${client.ws.ping}ms`);
  if (commandName === "dice") return interaction.reply(`🎲 You rolled **${Math.floor(Math.random()*6)+1}**`);
  if (commandName === "coinflip") return interaction.reply(`🪙 ${Math.random() > 0.5 ? "Heads" : "Tails"}`);

  // -------------------------------
  // REDEEM COMMAND
  // -------------------------------
  if (commandName === "redeem") {
    if (onCooldown(user.id)) return interaction.reply({ content: "⏳ You must wait before redeeming again.", ephemeral: true });
    cooldowns.set(user.id, Date.now());

    const licenseKey = interaction.options.getString("key");

    for (const [productId, secret] of Object.entries(PAYHIP_PRODUCTS)) {
      try {
        const r = await axios.get(PAYHIP_URL, {
          params: { license_key: licenseKey },
          headers: { "product-secret-key": secret }
        });

        if (r.data?.data?.enabled) {
          db.get("SELECT * FROM redeems WHERE licenseKey = ?", [licenseKey], async (_, row) => {
            if (row) return interaction.reply({ content: "❌ This license key has already been redeemed.", ephemeral: true });

            db.run("INSERT INTO redeems VALUES (?, ?, ?)", [licenseKey, user.id, productId]);

            const guildMember = await interaction.guild.members.fetch(user.id);
            await guildMember.roles.add(CUSTOMER_ROLE_ID);

            return interaction.reply({ content: `✅ License redeemed for **${productId}**!`, ephemeral: true });
          });

          return;
        }
      } catch {}
    }

    return interaction.reply({ content: "❌ Invalid or already used license key.", ephemeral: true });
  }

  // -------------------------------
  // MUSIC COMMANDS
  // -------------------------------
  if (commandName === "play") {
    await interaction.deferReply(); // avoids timeout
    const query = interaction.options.getString("song");
    const vc = member.voice.channel;
    if (!vc) return interaction.followUp({ content: "❌ Join a voice channel first" });

    if (!connection) {
      connection = joinVoiceChannel({
        channelId: vc.id,
        guildId: vc.guild.id,
        adapterCreator: vc.guild.voiceAdapterCreator
      });
    }

    let songUrl = query;
    if (!ytdl.validateURL(query)) {
      const r = await yts(query);
      if (!r || !r.videos || r.videos.length === 0)
        return interaction.followUp({ content: "❌ No results found" });
      songUrl = r.videos[0].url;
    }

    const info = await ytdl.getInfo(songUrl);
    const title = info.videoDetails.title;

    queue.push({ title, url: songUrl });

    if (!currentSong) {
      playNext();
      return interaction.followUp(`🎶 **Now playing:** ${title}`);
    } else {
      return interaction.followUp(`➕ Added to queue: **${title}**`);
    }
  }

  if (commandName === "skip") {
    if (!currentSong) return interaction.reply("❌ No song is playing");
    player.stop();
    return interaction.reply("⏭️ Skipped the song");
  }

  if (commandName === "stop") {
    queue.length = 0;
    currentSong = null;
    player.stop();
    connection?.destroy();
    connection = null;
    return interaction.reply("⏹️ Music stopped & queue cleared");
  }

  if (commandName === "queue") {
    if (queue.length === 0) return interaction.reply("📭 Queue is empty");
    const list = queue.map((s, i) => `${i + 1}. ${s.title}`).join("\n");
    return interaction.reply(`🎵 **Queue:**\n${list}`);
  }

  if (commandName === "nowplaying") {
    if (!currentSong) return interaction.reply("❌ Nothing playing");
    return interaction.reply(`🎶 **Now playing:** ${currentSong.title}`);
  }
});

// ===============================
client.login(DISCORD_TOKEN);
