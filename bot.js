// bot.js
import { Client, GatewayIntentBits, SlashCommandBuilder, Routes } from "discord.js";
import { REST } from "@discordjs/rest";
import sqlite3 from "sqlite3";
import axios from "axios";

// ===============================
// ENVIRONMENT VARIABLES (Set in Render)
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

// Products map
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

// Cooldowns map
const cooldowns = new Map();

// Discord client
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// ===============================
// Slash Commands
// ===============================
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
    .setName("coinflip")
    .setDescription("Flip a coin!"),
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check bot latency"),
  new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("Get info about a user")
    .addUserOption(opt => opt.setName("target").setDescription("Select a user")),
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

// ===============================
// Ready
// ===============================
client.once("ready", () => {
  console.log(`Bot online as ${client.user.tag}`);
});

// ===============================
// Interaction Handler
// ===============================
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, user, options } = interaction;

  // --------- COOLDOWN CHECK ----------
  const now = Date.now();
  const cooldownAmount = 5000; // 5 seconds
  if (cooldowns.has(user.id)) {
    const expirationTime = cooldowns.get(user.id) + cooldownAmount;
    if (now < expirationTime) {
      return interaction.reply({ content: `⏳ Please wait a few seconds before using a command again.`, ephemeral: true });
    }
  }
  cooldowns.set(user.id, now);

  // --------- COMMANDS ----------
  if (commandName === "redeem") {
    const licenseKey = options.getString("key");
    const discordUserId = user.id;

    // Check if user already redeemed
    db.get("SELECT * FROM redeems WHERE discordUserId = ?", [discordUserId], async (_, row) => {
      if (row) {
        return interaction.reply({ content: "❌ You have already redeemed a license.", ephemeral: true });
      }

      // Check all products
      for (const [productId, secret] of Object.entries(PAYHIP_PRODUCTS)) {
        try {
          const r = await axios.get(PAYHIP_URL, {
            params: { license_key: licenseKey },
            headers: { "product-secret-key": secret }
          });

          if (r.data.data && r.data.data.enabled) {
            // Check if license already used
            db.get("SELECT * FROM redeems WHERE licenseKey = ?", [licenseKey], (_, used) => {
              if (used) {
                return interaction.reply({ content: "❌ This license key has already been redeemed.", ephemeral: true });
              }

              // Save redemption
              db.run("INSERT INTO redeems VALUES (?, ?, ?)", [licenseKey, discordUserId, productId]);

              // Give role
              interaction.guild.members.fetch(discordUserId).then(member => {
                member.roles.add(CUSTOMER_ROLE_ID).catch(console.error);
              });

              return interaction.reply({ content: `✅ License verified for **${productId}**! You now have customer access.`, ephemeral: true });
            });

            return; // Stop checking other products
          }
        } catch (err) {
          // Ignore, try next product
        }
      }

      return interaction.reply({ content: "❌ Invalid or already used license key.", ephemeral: true });
    });
  }

  else if (commandName === "coinflip") {
    const result = Math.random() < 0.5 ? "Heads 🪙" : "Tails 🪙";
    return interaction.reply(`🎲 Coinflip result: **${result}**`);
  }

  else if (commandName === "ping") {
    return interaction.reply(`🏓 Pong! Latency is ${Date.now() - interaction.createdTimestamp}ms`);
  }

  else if (commandName === "userinfo") {
    const target = options.getUser("target") || user;
    return interaction.reply({
      content: `👤 **User Info**\n• Username: ${target.tag}\n• ID: ${target.id}\n• Bot: ${target.bot ? "Yes" : "No"}`
    });
  }
});

// ===============================
// Login
// ===============================
client.login(DISCORD_TOKEN);
