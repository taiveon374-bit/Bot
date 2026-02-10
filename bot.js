import { Client, GatewayIntentBits, SlashCommandBuilder, Routes } from "discord.js";
import { REST } from "@discordjs/rest";
import axios from "axios";
import sqlite3 from "sqlite3";

// ==========================
// ⚡ ENVIRONMENT VARIABLES
// ==========================
const DISCORD_TOKEN = process.env.BOTTOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const CUSTOMER_ROLE_ID = process.env.CUSTOMER_ROLE_ID;

// PAYHIP products → secrets
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
  LowPolyNYC: process.env.PAYHIP_SECRET_10
};

const PAYHIP_URL = "https://payhip.com/api/v2/license/verify";

// ==========================
// 📦 DATABASE
// ==========================
const db = new sqlite3.Database("./redeems.db");
db.run(`
  CREATE TABLE IF NOT EXISTS redeems (
    licenseKey TEXT UNIQUE,
    discordUserId TEXT UNIQUE,
    productId TEXT
  )
`);

// ==========================
// 🤖 DISCORD CLIENT
// ==========================
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// ==========================
// /redeem SLASH COMMAND
// ==========================
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

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
await rest.put(
  Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
  { body: commands }
);

// ==========================
// READY EVENT
// ==========================
client.once("ready", () => {
  console.log(`Bot online as ${client.user.tag}`);
});

// ==========================
// LICENSE REDEEM HANDLER
// ==========================
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "redeem") return;

  const licenseKey = interaction.options.getString("key");
  const discordUserId = interaction.user.id;

  // 🔒 User can only redeem once
  db.get("SELECT * FROM redeems WHERE discordUserId = ?", [discordUserId], async (_, row) => {
    if (row) {
      return interaction.reply({
        content: "❌ You have already redeemed a license.",
        ephemeral: true
      });
    }

    // 🔍 Try license against all products
    for (const [productId, secret] of Object.entries(PAYHIP_PRODUCTS)) {
      try {
        const r = await axios.get(PAYHIP_URL, {
          params: { license_key: licenseKey },
          headers: { "product-secret-key": secret }
        });

        if (r.data.data && r.data.data.enabled) {
          // 🔒 License can only be used once
          db.get("SELECT * FROM redeems WHERE licenseKey = ?", [licenseKey], (_, used) => {
            if (used) {
              return interaction.reply({
                content: "❌ This license key has already been redeemed.",
                ephemeral: true
              });
            }

            // SAVE REDEEM
            db.run(
              "INSERT INTO redeems VALUES (?, ?, ?)",
              [licenseKey, discordUserId, productId]
            );

            // GIVE ROLE
            interaction.guild.members.fetch(discordUserId).then(member => {
              member.roles.add(CUSTOMER_ROLE_ID).catch(console.error);
            });

            return interaction.reply({
              content: `✅ License verified for ${productId}! You now have customer access.`,
              ephemeral: true
            });
          });

          return;
        }
      } catch (err) {
        // ignore errors and try next product
      }
    }

    interaction.reply({
      content: "❌ Invalid or already used license key.",
      ephemeral: true
    });
  });
});

// ==========================
// LOGIN BOT
// ==========================
client.login(DISCORD_TOKEN);
