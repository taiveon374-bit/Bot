import {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  Routes
} from "discord.js";

import { REST } from "@discordjs/rest";
import express from "express";
import ytdl from "ytdl-core";
import yts from "yt-search";

// ===============================
// ENV
// ===============================
const DISCORD_TOKEN = process.env.BOTTOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

// ===============================
// KEEP ALIVE (Render Web Service)
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
    GatewayIntentBits.GuildVoiceStates
  ]
});

// ===============================
// MUSIC QUEUE SYSTEM
// ===============================
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus
} from "@discordjs/voice";

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
    .setDescription("Play a song by name or YouTube link")
    .addStringOption(o =>
      o.setName("song").setDescription("Song name or YouTube URL").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Skip the current song"),

  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop music and clear queue"),

  new SlashCommandBuilder()
    .setName("queue")
    .setDescription("See current music queue"),

  new SlashCommandBuilder()
    .setName("nowplaying")
    .setDescription("Show the current playing song")
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
// COMMAND HANDLER
// ===============================
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, member } = interaction;

  // -------------------------------
  // PLAY
  // -------------------------------
  if (commandName === "play") {
    const query = interaction.options.getString("song");
    const vc = member.voice.channel;

    if (!vc) {
      return interaction.reply({
        content: "❌ Join a voice channel first",
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

    let songUrl = query;

    // Search YouTube if it's not a URL
    if (!ytdl.validateURL(query)) {
      const r = await yts(query);
      if (!r || !r.videos || r.videos.length === 0) {
        return interaction.reply({ content: "❌ No results found", ephemeral: true });
      }
      songUrl = r.videos[0].url;
    }

    const info = await ytdl.getInfo(songUrl);
    const title = info.videoDetails.title;

    queue.push({ title, url: songUrl });

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
    if (!currentSong) return interaction.reply("❌ No song is playing");
    player.stop();
    return interaction.reply("⏭️ Skipped the song");
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
    if (queue.length === 0) return interaction.reply("📭 Queue is empty");

    const list = queue.map((s, i) => `${i + 1}. ${s.title}`).join("\n");
    return interaction.reply(`🎵 **Queue:**\n${list}`);
  }

  // -------------------------------
  // NOW PLAYING
  // -------------------------------
  if (commandName === "nowplaying") {
    if (!currentSong) return interaction.reply("❌ Nothing is playing");
    return interaction.reply(`🎶 **Now playing:** ${currentSong.title}`);
  }
});

// ===============================
client.login(DISCORD_TOKEN);
