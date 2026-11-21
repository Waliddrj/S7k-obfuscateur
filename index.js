const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
const fs = require('fs');

const CONFIG = {
  TOKEN:          process.env.TOKEN          || "TON_TOKEN_ICI",
  GUILD_ID:       process.env.GUILD_ID       || "ID_SERVEUR",
  ROLE_PRO_ID:    process.env.ROLE_PRO_ID    || "ID_ROLE_PRO",
  ROLE_ELITE_ID:  process.env.ROLE_ELITE_ID  || "ID_ROLE_ELITE",
  LOG_CHANNEL_ID: process.env.LOG_CHANNEL_ID || "ID_SALON_LOG",
  LTC_ADDRESS:    "LKpFPc5hhDoeYjKWdWazmt5RBydWDFLnaT",
};

const PLANS = {
  pro:   { name: "Pro",   usd: 5,  ltc: 0.0943, roleId: CONFIG.ROLE_PRO_ID,   days: 30 },
  elite: { name: "Elite", usd: 10, ltc: 0.1887, roleId: CONFIG.ROLE_ELITE_ID, days: 30 },
};

const LICENSES_FILE = "licenses.json";
const pendingPayments = new Map();

function loadLicenses() {
  if (!fs.existsSync(LICENSES_FILE)) return {};
  return JSON.parse(fs.readFileSync(LICENSES_FILE, "utf8"));
}
function saveLicenses(data) {
  fs.writeFileSync(LICENSES_FILE, JSON.stringify(data, null, 2));
}
function generateKey(plan) {
  const prefix = plan === "pro" ? "S7K-PRO" : "S7K-ELITE";
  const rand = (n) => [...Array(n)].map(() => "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[Math.floor(Math.random() * 36)]).join('');
  return `${prefix}-${rand(4)}-${rand(4)}-${rand(4)}`;
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

async function updateLTCPrice() {
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=litecoin&vs_currencies=usd");
    const d = await r.json();
    const price = d.litecoin.usd;
    PLANS.pro.ltc   = parseFloat((5  / price).toFixed(6));
    PLANS.elite.ltc = parseFloat((10 / price).toFixed(6));
    console.log(`[LTC] Prix: $${price} | Pro=${PLANS.pro.ltc} LTC | Elite=${PLANS.elite.ltc} LTC`);
  } catch (e) {
    console.error("[LTC] Erreur prix:", e.message);
  }
}

async function checkLTCPayment(ltcAmount) {
  const satoshis = Math.round(ltcAmount * 1e8);
  try {
    const r = await fetch(`https://api.blockcypher.com/v1/ltc/main/addrs/${CONFIG.LTC_ADDRESS}`);
    if (!r.ok) return false;
    const d = await r.json();
    const txs = [...(d.txrefs || []), ...(d.unconfirmed_txrefs || [])];
    return txs.some(tx => !tx.spent && tx.value >= satoshis);
  } catch { return false; }
}

async function activateLicense(member, planKey) {
  const plan = PLANS[planKey];
  const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
  const key   = generateKey(planKey);
  const expire = new Date(Date.now() + plan.days * 86400000);

  const licenses = loadLicenses();
  licenses[member.id] = { key, plan: planKey, expire: expire.toISOString(), discord: member.user.tag };
  saveLicenses(licenses);

  const role = guild.roles.cache.get(plan.roleId);
  if (role) await member.roles.add(role, `S7k HUB — Licence ${plan.name}`).catch(console.error);

  const embedDM = new EmbedBuilder()
    .setTitle("✅ Licence S7k HUB activée !")
    .setColor(0xe02020)
    .addFields(
      { name: "Plan",           value: `**${plan.name}**`,                 inline: true },
      { name: "Clé de licence", value: `\`\`\`${key}\`\`\``,               inline: false },
      { name: "Expire le",      value: expire.toLocaleDateString("fr-FR"), inline: true },
      { name: "Durée",          value: `${plan.days} jours`,               inline: true },
    )
    .setFooter({ text: "S7k HUB — Merci pour ton achat !" })
    .setTimestamp();

  await member.send({ embeds: [embedDM] }).catch(() =>
    console.log(`[DM] Impossible d'envoyer à ${member.user.tag}`)
  );

  const logCh = guild.channels.cache.get(CONFIG.LOG_CHANNEL_ID);
  if (logCh) {
    const embedLog = new EmbedBuilder()
      .setTitle("💸 Nouveau paiement LTC")
      .setColor(0xe02020)
      .addFields(
        { name: "Utilisateur", value: member.toString(), inline: true },
        { name: "Plan",        value: plan.name,         inline: true },
        { name: "Clé",         value: `||${key}||`,      inline: false },
        { name: "Expire",      value: expire.toLocaleDateString("fr-FR"), inline: true },
      )
      .setFooter({ text: `ID: ${member.id}` })
      .setTimestamp();
    await logCh.send({ embeds: [embedLog] });
  }
}

const commands = [
  new SlashCommandBuilder()
    .setName("payer")
    .setDescription("Démarre le paiement LTC pour une licence S7k HUB")
    .addStringOption(o => o.setName("plan").setDescription("Choisis ton plan").setRequired(true)
      .addChoices(
        { name: "Pro — 5$",    value: "pro" },
        { name: "Elite — 10$", value: "elite" },
      )),
  new SlashCommandBuilder()
    .setName("licence")
    .setDescription("Vérifie ta licence S7k HUB"),
  new SlashCommandBuilder()
    .setName("prix")
    .setDescription("Voir les prix en LTC"),
  new SlashCommandBuilder()
    .setName("activer")
    .setDescription("[ADMIN] Active manuellement une licence")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(o => o.setName("membre").setDescription("Le membre").setRequired(true))
    .addStringOption(o => o.setName("plan").setDescription("pro ou elite").setRequired(true)
      .addChoices(
        { name: "Pro",   value: "pro" },
        { name: "Elite", value: "elite" },
      )),
  new SlashCommandBuilder()
    .setName("revoquer")
    .setDescription("[ADMIN] Révoque une licence")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(o => o.setName("membre").setDescription("Le membre").setRequired(true)),
  new SlashCommandBuilder()
    .setName("licences")
    .setDescription("[ADMIN] Voir toutes les licences actives")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
];

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(CONFIG.TOKEN);
  await rest.put(Routes.applicationGuildCommands(client.user.id, CONFIG.GUILD_ID), {
    body: commands.map(c => c.toJSON()),
  });
  console.log("[S7k HUB] Slash commands enregistrées.");
}

client.once("ready", async () => {
  console.log(`[S7k HUB] Connecté : ${client.user.tag}`);
  await registerCommands();
  await updateLTCPrice();
  setInterval(updateLTCPrice, 10 * 60 * 1000);
  setInterval(async () => {
    for (const [userId, info] of pendingPayments.entries()) {
      const paid = await checkLTCPayment(info.ltc);
      if (paid) {
        const guild  = client.guilds.cache.get(CONFIG.GUILD_ID);
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) await activateLicense(member, info.plan);
        pendingPayments.delete(userId);
      }
    }
  }, 60 * 1000);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

  if (commandName === "payer") {
    const planKey = interaction.options.getString("plan");
    const p = PLANS[planKey];
    pendingPayments.set(interaction.user.id, { plan: planKey, ltc: p.ltc });
    const embed = new EmbedBuilder()
      .setTitle(`💳 Paiement S7k HUB — Plan ${p.name}`)
      .setDescription("Envoie exactement le montant à l'adresse LTC ci-dessous.\nLa licence s'active **automatiquement** après confirmation.")
      .setColor(0xe02020)
      .addFields(
        { name: "Adresse LTC",   value: `\`\`\`${CONFIG.LTC_ADDRESS}\`\`\``, inline: false },
        { name: "Montant exact", value: `**${p.ltc} LTC** (≈ ${p.usd}$)`,   inline: true },
        { name: "Plan",          value: p.name,                               inline: true },
        { name: "Durée",         value: "30 jours",                           inline: true },
      )
      .setFooter({ text: "S7k HUB • Vérification automatique toutes les 60s" })
      .setTimestamp();
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  else if (commandName === "licence") {
    const licenses = loadLicenses();
    const lic = licenses[interaction.user.id];
    if (!lic) return interaction.reply({ content: "❌ Aucune licence trouvée. Utilise `/payer` pour en acheter une.", ephemeral: true });
    const expire = new Date(lic.expire);
    const reste  = Math.max(0, Math.ceil((expire - Date.now()) / 86400000));
    const embed  = new EmbedBuilder()
      .setTitle("🔑 Ta licence S7k HUB")
      .setColor(0xe02020)
      .addFields(
        { name: "Plan",   value: lic.plan.charAt(0).toUpperCase() + lic.plan.slice(1), inline: true },
        { name: "Clé",    value: `||${lic.key}||`,                                      inline: false },
        { name: "Expire", value: `${expire.toLocaleDateString("fr-FR")} (${reste}j restants)`, inline: true },
      );
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  else if (commandName === "prix") {
    const embed = new EmbedBuilder()
      .setTitle("💰 Prix S7k HUB")
      .setColor(0xe02020)
      .addFields(
        { name: "Plan Pro",   value: `**5$** ≈ ${PLANS.pro.ltc} LTC\n30 jours`,   inline: true },
        { name: "Plan Elite", value: `**10$** ≈ ${PLANS.elite.ltc} LTC\n30 jours`, inline: true },
      )
      .setFooter({ text: "Prix LTC mis à jour automatiquement • /payer pour acheter" });
    await interaction.reply({ embeds: [embed] });
  }

  else if (commandName === "activer") {
    const membre  = interaction.options.getMember("membre");
    const planKey = interaction.options.getString("plan");
    await interaction.deferReply({ ephemeral: true });
    await activateLicense(membre, planKey);
    await interaction.editReply(`✅ Licence **${PLANS[planKey].name}** activée pour ${membre.toString()} !`);
  }

  else if (commandName === "revoquer") {
    const membre   = interaction.options.getMember("membre");
    const licenses = loadLicenses();
    if (!licenses[membre.id]) return interaction.reply({ content: "❌ Cet utilisateur n'a pas de licence.", ephemeral: true });
    const planKey = licenses[membre.id].plan;
    delete licenses[membre.id];
    saveLicenses(licenses);
    const role = interaction.guild.roles.cache.get(PLANS[planKey].roleId);
    if (role) await membre.roles.remove(role).catch(console.error);
    await interaction.reply({ content: `✅ Licence révoquée pour ${membre.toString()}.`, ephemeral: true });
  }

  else if (commandName === "licences") {
    const licenses = loadLicenses();
    const entries  = Object.entries(licenses);
    if (!entries.length) return interaction.reply({ content: "Aucune licence active.", ephemeral: true });
    const lines = entries.slice(0, 20).map(([uid, lic]) => {
      const reste = Math.ceil((new Date(lic.expire) - Date.now()) / 86400000);
      return `<@${uid}> — **${lic.plan}** — ${reste}j restants`;
    });
    const embed = new EmbedBuilder()
      .setTitle("📋 Licences actives — S7k HUB")
      .setDescription(lines.join("\n"))
      .setColor(0xe02020)
      .setFooter({ text: `Total : ${entries.length} licence(s)` });
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
});

client.login(CONFIG.TOKEN);
