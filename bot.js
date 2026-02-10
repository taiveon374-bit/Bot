// bot.js
import { Client, GatewayIntentBits, SlashCommandBuilder, Routes } from "discord.js";
import { REST } from "@discordjs/rest";
import axios from "axios";
import sqlite3 from "sqlite3";
import http from "http";

// ===============================
// KEEP-ALIVE HTTP SERVER (RENDER)
// ===============================
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Bot is running");
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
});

// ===============================
// ENV VARIABLES
// ===============================
const DISCORD_TOKEN = process.env.BOTTOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const CUSTOMER_ROLE_ID = process.env.CUSTOMER_ROLE_ID;
const PAYHIP_URL = "https://payhip.com/api/v2/license/verify";

// ===============================
// PAYHIP PRODUCTS
// ===============================
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
// DISCORD CLIENT
// ===============================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ],
});

// ===============================
// SLASH COMMAND
// ===============================
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

// ===============================
// REGISTER COMMANDS
// ===============================
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
// READY
// ===============================
client.once("ready", () => {
  console.log(`Bot online as ${client.user.tag}`);
});

// ===============================
// REDEEM HANDLER
// ===============================
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "redeem") return;

  const licenseKey = interaction.options.getString("key");
  const discordUserId = interaction.user.id;

  db.get(
    "SELECT * FROM redeems WHERE discordUserId = ?",
    [discordUserId],
    async (_, row) => {
      if (row) {
        return interaction.reply({
          content: "❌ You have already redeemed a license.",
          ephemeral: true
        });
      }

      for (const [productId, secret] of Object.entries(PAYHIP_PRODUCTS)) {
        try {
          const r = await axios.get(PAYHIP_URL, {
            params: { license_key: licenseKey },
            headers: { "product-secret-key": secret }
          });

          if (r.data?.data?.enabled) {
            db.get(
              "SELECT * FROM redeems WHERE licenseKey = ?",
              [licenseKey],
              async (_, used) => {
                if (used) {
                  return interaction.reply({
                    content: "❌ This license key has already been redeemed.",
                    ephemeral: true
                  });
                }

                db.run(
                  "INSERT INTO redeems VALUES (?, ?, ?)",
                  [licenseKey, discordUserId, productId]
                );

                try {
                  const member = await interaction.guild.members.fetch(discordUserId);
                  await member.roles.add(CUSTOMER_ROLE_ID);
                } catch (e) {
                  console.error(e);
                }

                return interaction.reply({
                  content: `✅ License verified for **${productId}**! You now have customer access.`,
                  ephemeral: true
                });
              }
            );
            return;
          }
        } catch {}
      }

      interaction.reply({
        content: "❌ Invalid or already used license key.",
        ephemeral: true
      });
    }
  );
});

// ===============================
// LOGIN
// ===============================
client.login(DISCORD_TOKEN);
