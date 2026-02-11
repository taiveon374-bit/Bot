import express from "express";
import axios from "axios";
import sqlite3 from "sqlite3";
import http from "http";
import { Client, GatewayIntentBits, SlashCommandBuilder, Routes } from "discord.js";
import { REST } from "@discordjs/rest";

// ===============================
// ENV VARIABLES
// ===============================
const DISCORD_TOKEN = process.env.BOTTOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const CUSTOMER_ROLE_ID = process.env.CUSTOMER_ROLE_ID;
const PORT = process.env.PORT || 3000;

const PAYHIP_URL = "https://payhip.com/api/v2/license/verify";

// SAME secrets used for BOTH Roblox + Discord
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
// DATABASE (SHARED)
// ===============================
const db = new sqlite3.Database("./licenses.db");

db.run(`
  CREATE TABLE IF NOT EXISTS licenses (
    licenseKey TEXT PRIMARY KEY,
    productId TEXT,
    discordUserId TEXT,
    robloxUserId TEXT
  )
`);

// ===============================
// EXPRESS SERVER (ROBLOX API)
// ===============================
const app = express();
app.use(express.json());

// Keep alive endpoint
app.get("/", (_, res) => {
  res.send("Server running 24/7");
});

// Roblox verification
app.post("/verify", async (req, res) => {
  const { licenseKey, robloxUserId, productId } = req.body;

  if (!licenseKey || !robloxUserId || !productId)
    return res.json({ success: false, error: "Missing data" });

  const secret = PAYHIP_PRODUCTS[productId];
  if (!secret)
    return res.json({ success: false, error: "Unknown product" });

  try {
    const r = await axios.get(PAYHIP_URL, {
      params: { license_key: licenseKey },
      headers: { "product-secret-key": secret }
    });

    if (!r.data?.data?.enabled)
      return res.json({ success: false, error: "Invalid license" });

    db.get("SELECT * FROM licenses WHERE licenseKey = ?", [licenseKey], (err, row) => {

      if (row && row.robloxUserId && row.robloxUserId !== robloxUserId)
        return res.json({ success: false, error: "License already used on another Roblox account" });

      if (!row) {
        db.run(
          "INSERT INTO licenses VALUES (?, ?, NULL, ?)",
          [licenseKey, productId, robloxUserId]
        );
      } else {
        db.run(
          "UPDATE licenses SET robloxUserId = ? WHERE licenseKey = ?",
          [robloxUserId, licenseKey]
        );
      }

      return res.json({ success: true });
    });

  } catch {
    res.json({ success: false, error: "Server error" });
  }
});

// ===============================
// DISCORD BOT
// ===============================
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

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

(async () => {
  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );
})();

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "redeem") return;

  const licenseKey = interaction.options.getString("key");
  const discordUserId = interaction.user.id;

  for (const [productId, secret] of Object.entries(PAYHIP_PRODUCTS)) {
    try {
      const r = await axios.get(PAYHIP_URL, {
        params: { license_key: licenseKey },
        headers: { "product-secret-key": secret }
      });

      if (r.data?.data?.enabled) {

        db.get("SELECT * FROM licenses WHERE licenseKey = ?", [licenseKey], async (_, row) => {

          if (row && row.discordUserId && row.discordUserId !== discordUserId)
            return interaction.reply({ content: "❌ License already used.", ephemeral: true });

          if (!row) {
            db.run(
              "INSERT INTO licenses VALUES (?, ?, ?, NULL)",
              [licenseKey, productId, discordUserId]
            );
          } else {
            db.run(
              "UPDATE licenses SET discordUserId = ? WHERE licenseKey = ?",
              [discordUserId, licenseKey]
            );
          }

          const member = await interaction.guild.members.fetch(discordUserId);
          await member.roles.add(CUSTOMER_ROLE_ID);

          return interaction.reply({
            content: `✅ Verified for **${productId}**`,
            ephemeral: true
          });
        });

        return;
      }
    } catch {}
  }

  interaction.reply({ content: "❌ Invalid license.", ephemeral: true });
});

client.login(DISCORD_TOKEN);

// ===============================
// START SERVER (24/7 ON RENDER)
// ===============================
app.listen(PORT, () => {
  console.log("Server + Bot running on port", PORT);
});
