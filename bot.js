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

import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus
} from "@discordjs/voice";

import ytdl from "ytdl-core";

// ===============================
// ENV
// ===============================
const DISCORD_TOKEN = process.env.BOTTOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const CUSTOMER_ROLE_ID = process.env.CUSTOMER_ROLE_ID;

// ===============================
// KEEP ALIVE (Render)
// ===============================
const app = express();
app.get("/", (_, res) => res.send("Bot alive"));
app.listen(process.env.PORT || 3000);

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
// MUSIC SYSTEM
// ===============================
const queue = [];
let connection = null;
let currentSong = null;

const player = createAudioPlayer();

player.on(AudioPlayerStatus.Idle, () => {
  playNext();
});

function playNext() {
  if (queue.length === 0) {
    currentSong = null;
    return;
  }

  const song = queue.shift();
  currentSong = song;

  const stream = ytdl(song.url, {
    filter: "audioonly",
    highWaterMark: 1 << 25
  });

  const resource = createAudioResource(stream);
  player.play(resource);
  connection.subscribe(player);
}

// ===============================
// SLASH COMMANDS
// ===============================
const commands = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play or queue a YouTube song")
    .addStringOption(o =>
      o.setName("url").setDescription("YouTube URL").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Skip current song"),

  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop music and clear queue"),

  new SlashCommandBuilder()
    .setName("queue")
    .setDescription("View music queue"),

  new SlashCommandBuilder()
    .setName("nowplaying")
    .setDescription("See current song")
].map(c => c.toJSON());

// ===============================
// REGISTER COMMANDS
// ===============================
const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
await rest.put(
  Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
  { body: commands }
);

console.log("Music commands registered");

// ===============================
// READY
// ===============================
client.once("ready", () => {
  console.log(`Bot online as ${client.user.tag}`);
});

// ===============================
// INTERACTIONS
// ===============================
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

  // -------------------------------
  // PLAY
  // -------------------------------
  if (commandName === "play") {
    const url = interaction.options.getString("url");
    const vc = interaction.member.voice.channel;

    if (!vc) {
      return interaction.reply({
        content: "❌ Join a voice channel first",
        ephemeral: true
      });
    }

    if (!ytdl.validateURL(url)) {
      return interaction.reply({
        content: "❌ Invalid YouTube URL",
        ephemeral: true
      });
    }

    if (!connection) {
      connection = joinVoiceChannel({
        channelId: vc.id,
        guildId: vc.guild.id,
        adapterCreator: vc.guild.voiceAdapterCreator
      });
    }

    const info = await ytdl.getInfo(url);
    const title = info.videoDetails.title;

    queue.push({ title, url });

    if (!currentSong) {
      playNext();
      return interaction.reply(`🎶 **Now playing:** ${title}`);
    } else {
      return interaction.reply(`➕ Added to queue: **${title}**`);
    }
  }

  // -------------------------------
  // SKIP
  // -------------------------------
  if (commandName === "skip") {
    if (!currentSong) {
      return interaction.reply("❌ No song is playing");
    }

    player.stop();
    return interaction.reply("⏭️ Skipped");
  }

  // -------------------------------
  // STOP
  // -------------------------------
  if (commandName === "stop") {
    queue.length = 0;
    currentSong = null;
    player.stop();
    connection?.destroy();
    connection = null;

    return interaction.reply("⏹️ Music stopped & queue cleared");
  }

  // -------------------------------
  // QUEUE
  // -------------------------------
  if (commandName === "queue") {
    if (queue.length === 0) {
      return interaction.reply("📭 Queue is empty");
    }

    const list = queue
      .map((s, i) => `${i + 1}. ${s.title}`)
      .join("\n");

    return interaction.reply(`🎵 **Queue:**\n${list}`);
  }

  // -------------------------------
  // NOW PLAYING
  // -------------------------------
  if (commandName === "nowplaying") {
    if (!currentSong) {
      return interaction.reply("❌ Nothing playing");
    }

    return interaction.reply(`🎶 **Now playing:** ${currentSong.title}`);
  }
});

// ===============================
client.login(DISCORD_TOKEN);
