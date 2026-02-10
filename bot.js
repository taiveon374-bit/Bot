import { Client, GatewayIntentBits, SlashCommandBuilder, Routes } from "discord.js";
import { REST } from "@discordjs/rest";
import axios from "axios";
import sqlite3 from "sqlite3";

const DISCORD_TOKEN = "MTQ3MDgxMTQ1NjE5Nzg4NjIwNg.GYszNQ.U_k3oCBC7HowC23vqc1w3u3ZKRpcbpFyXMlGY8";
const CLIENT_ID = "1470811456197886206";
const GUILD_ID = "1388879154987929684";

const CUSTOMER_ROLE_ID = "1427993536761958434";
const PAYHIP_URL = "https://payhip.com/api/v2/license/verify";

// 🔑 PRODUCT → SECRET KEY MAP
const PAYHIP_PRODUCTS = {
  CraftingSystem: "prod_sk_KBup9_a530f9cdfd350fff471a5f8626b9db0b7a09a397",
  CharacterCreation: "prod_sk_qn4km_e4160de7181a828134467f7bd3b97a8f9a03de3f",
  HoodSystemsPack: "prod_sk_iRFXE_43ff058d73afeadd3f7cb657e49fe0dfd49cfe74",
  CharacterCreation2: "prod_sk_L8G7Y_c62c12b137a4a7f5a0148c70618fc85246d65270",
  HoodAssetsPack: "prod_sk_8hQlU_740e126467bb294674ed9f4f9e7499a54d62a7f1",
  PoliceSystem: "prod_sk_oUWSl_3d4586cf658964bafc979388e7861611b3e89469",
  AdvancedDuelsGame: "prod_sk_WQ0Dm_94d8513bb913097a30b06677cf36a4ff2f6800e5",
  AdvancedPhoneSystem: "prod_sk_6M75T_d3fe800125d95b36785d177b24c01822d482c6fe",
  AdvancedGunSystem: "prod_sk_bkEQf_5281eb0348614755d5f7a1ce608724fb8d003c79",
  LowPolyNYC: "prod_sk_IvK1q_462601c0e2bac6cfdbdb7a4db3d59739f769fc22"
};

// DATABASE
const db = new sqlite3.Database("./redeems.db");
db.run(`
  CREATE TABLE IF NOT EXISTS redeems (
    licenseKey TEXT UNIQUE,
    discordUserId TEXT UNIQUE,
    productId TEXT
  )
`);

// CLIENT
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// SLASH COMMAND
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

// REGISTER COMMAND
const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
await rest.put(
  Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
  { body: commands }
);

// READY
client.once("ready", () => {
  console.log(`Bot online as ${client.user.tag}`);
});

// REDEEM HANDLER
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "redeem") return;

  const licenseKey = interaction.options.getString("key");
  const discordUserId = interaction.user.id;

  // 🔒 User can only redeem once
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

      // 🔍 Try license against all products
      for (const [productId, secret] of Object.entries(PAYHIP_PRODUCTS)) {
        try {
          const r = await axios.get(PAYHIP_URL, {
            params: { license_key: licenseKey },
            headers: { "product-secret-key": secret }
          });

          if (r.data.data && r.data.data.enabled) {
            // 🔒 License can only be used once
            db.get(
              "SELECT * FROM redeems WHERE licenseKey = ?",
              [licenseKey],
              (_, used) => {
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
                  member.roles.add(CUSTOMER_ROLE_ID);
                });

                return interaction.reply({
                  content: `✅ License verified! You now have customer access.`,
                  ephemeral: true
                });
              }
            );

            return;
          }
        } catch {
          // try next product
        }
      }

      interaction.reply({
        content: "❌ Invalid or already used license key.",
        ephemeral: true
      });
    }
  );
});

client.login(DISCORD_TOKEN);
