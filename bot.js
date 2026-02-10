// bot.js
import { Client, GatewayIntentBits, SlashCommandBuilder, Routes } from "discord.js";
import { REST } from "@discordjs/rest";
import axios from "axios";
import sqlite3 from "sqlite3";

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

// Map of products → secrets
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

// Cooldown map
const cooldowns = new Map();

// Discord client
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// Slash command
const commands = [
  new SlashCommandBuilder()
    .setName("redeem")
    .setDescription("Redeem your license key")
    .addStringOption(opt =>
      opt.setName("key")
        .setDescription("Your license key")
        .setRequired(true)
    )
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

// Ready
client.once("ready", () => {
  console.log(`Bot online as ${client.user.tag}`);
});

// Redeem handler
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "redeem") return;

  const discordUserId = interaction.user.id;
  const now = Date.now();

  // Cooldown: 30 seconds
  if (cooldowns.has(discordUserId) && now - cooldowns.get(discordUserId) < 30000) {
    return interaction.reply({ content: "⏳ Please wait 30 seconds before redeeming again.", ephemeral: true });
  }

  cooldowns.set(discordUserId, now);

  const licenseKey = interaction.options.getString("key");

  // Check if user already redeemed
  db.get("SELECT * FROM redeems WHERE discordUserId = ?", [discordUserId], async (_, row) => {
    if (row) {
      return interaction.reply({
        content: "❌ You have already redeemed a license.",
        ephemeral: true
      });
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
              return interaction.reply({
                content: "❌ This license key has already been redeemed.",
                ephemeral: true
              });
            }

            // Save redemption
            db.run(
              "INSERT INTO redeems VALUES (?, ?, ?)",
              [licenseKey, discordUserId, productId]
            );

            // Give role
            interaction.guild.members.fetch(discordUserId).then(member => {
              member.roles.add(CUSTOMER_ROLE_ID).catch(err => console.error(err));
            });

            return interaction.reply({
              content: `✅ License verified for **${productId}**! You now have customer access.`,
              ephemeral: true
            });
          });

          return; // Stop checking other products
        }
      } catch (err) {
        // Ignore, try next product
      }
    }

    interaction.reply({
      content: "❌ Invalid or already used license key.",
      ephemeral: true
    });
  });
});

client.login(DISCORD_TOKEN);
