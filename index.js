// index.js - Maleficis Plantaciones + Chester + CDs Armas + LOGS + RESET TOTAL
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

// =====================
// CONFIG
// =====================
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

// Plantaciones
const DUPLICAR_MS = 3 * 60 * 60 * 1000;        // 3h
const REGAR_MS    = (2 * 60 + 30) * 60 * 1000; // 2h 30m
const COSECHAR_MS = 3 * 60 * 60 * 1000;        // 3h
const MAX_COSECHAS = 3;

// Ping role exacto por nombre
const PING_ROLE_NAME = "marihuana";

// Chester
const CHESTER_JOBS = [
  "molotov",
  "parking",
  "ventanillas",
  "ruedas",
  "grafitis",
  "peleas",
  "moto",
  "coche",
];
const CHESTER_CD_MS = 24 * 60 * 60 * 1000; // 24h

// CDs Armas
const ARMA_CD = {
  revolver: 2 * 24 * 60 * 60 * 1000,
  sns: 4 * 24 * 60 * 60 * 1000,
  balas_revolver: 1 * 24 * 60 * 60 * 1000,
  balas_sns: 2 * 24 * 60 * 60 * 1000,
};
const ARMA_LABEL = {
  revolver: "Revolver",
  sns: "SNS",
  balas_revolver: "Balas de Revolver",
  balas_sns: "Balas de SNS",
};

// =====================
// SIMPLE FILE DB
// =====================
const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function loadJSON(file, fallback) {
  const p = path.join(DATA_DIR, file);
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}
function saveJSON(file, data) {
  const p = path.join(DATA_DIR, file);
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
}
function writeJSON(file, data) { saveJSON(file, data); }

const DB = {
  plantaciones: loadJSON("plantaciones.json", []),
  chester: loadJSON("chester.json", {}),
  chesterPanels: loadJSON("chester_panels.json", {}),
  armas: loadJSON("armas.json", {}),
  registro: loadJSON("registro.json", []),
};

function now() { return Date.now(); }
function toUnix(ms) { return Math.floor(ms / 1000); }
function relTs(ms) { return `<t:${toUnix(ms)}:R>`; }
function absTs(ms) { return `<t:${toUnix(ms)}:f>`; }

function logReg(type, by, meta = {}) {
  DB.registro.push({ type, by, at: now(), meta });
  writeJSON("registro.json", DB.registro);
}

function capFirst(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function niceJob(job) { return job === "moto" ? "Moto" : capFirst(job); }
function fmtTipo(tipo) { return tipo === "duplicar" ? "Duplicar" : "Cosecha"; }

function nextPlantId() {
  const max = DB.plantaciones.reduce((m, p) => Math.max(m, p.id), 0);
  return max + 1;
}
function getPlantByNumber(n) {
  const list = [...DB.plantaciones].sort((a, b) => a.id - b.id);
  return list[n - 1] || null;
}
function removePlant(id) {
  DB.plantaciones = DB.plantaciones.filter(p => p.id !== id);
  writeJSON("plantaciones.json", DB.plantaciones);
}
function updatePlant(patch) {
  const idx = DB.plantaciones.findIndex(p => p.id === patch.id);
  if (idx >= 0) {
    DB.plantaciones[idx] = { ...DB.plantaciones[idx], ...patch };
    writeJSON("plantaciones.json", DB.plantaciones);
  }
}

async function safeFetchChannel(client, channelId) {
  try { return await client.channels.fetch(channelId); } catch { return null; }
}
async function safeFetchMessage(channel, messageId) {
  try { return await channel.messages.fetch(messageId); } catch { return null; }
}
async function deleteMessageIfPossible(msg) {
  if (!msg) return;
  try { await msg.delete(); } catch {}
}
function isNotifiedKey(k) {
  return typeof k === "string" && (k.endsWith("_notified") || k.endsWith("_notifiedTs"));
}

// =====================
// DISCORD CLIENT
// =====================
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel],
});

// =====================
// ROLE PING (por ID real)
// =====================
async function getRoleMentionForGuild(guild) {
  if (!guild) return { content: `@${PING_ROLE_NAME}`, allowedMentions: { parse: [] } };

  try {
    if (!guild.roles.cache?.size) await guild.roles.fetch().catch(() => {});
    const role = guild.roles.cache.find(r => (r.name || "").toLowerCase() === PING_ROLE_NAME.toLowerCase());
    if (!role) return { content: `@${PING_ROLE_NAME}`, allowedMentions: { parse: [] } };

    return {
      content: `<@&${role.id}>`,
      allowedMentions: { roles: [role.id], users: [], repliedUser: false },
    };
  } catch {
    return { content: `@${PING_ROLE_NAME}`, allowedMentions: { parse: [] } };
  }
}

// =====================
// EMBEDS
// =====================
function plantCompletedEmbed(p) {
  const created = p.createdAt ?? now();
  const plantedBy = p.createdBy ? `<@${p.createdBy}>` : "—";

  const waterCount = p.waterCount || 0;
  const harvestCount = p.harvestCount || 0;

  const e = new EmbedBuilder()
    .setTitle(`✅ Plantación completada • #${p.id}`)
    .setColor(0x2ecc71)
    .setFooter({ text: `Maleficis • Plantaciones • PID:#${p.id}` })
    .setTimestamp(new Date(created));

  const desc = (p.descripcion && p.descripcion.trim()) ? p.descripcion.trim() : "Sin descripción.";

  const lines = [];
  lines.push(`📌 **${fmtTipo(p.tipo)}** — ${desc}`);
  lines.push(`🌱 **Plantó:** ${plantedBy}`);

  // si nadie regó/cosechó, no lo muestro
  if ((waterCount > 0) || (harvestCount > 0)) {
    lines.push(`💧 **Regó:** ${waterCount}`);
    lines.push(`🧺 **Cosechó:** ${harvestCount}`);
  }

  e.setDescription(lines.join("\n"));

  // duplicar terminado: sin foto
  if (p.tipo !== "duplicar" && p.imageUrl) e.setImage(p.imageUrl);

  return e;
}

function plantEmbed(p) {
  if (p.completed) return plantCompletedEmbed(p);

  const created = p.createdAt ?? now();

  const e = new EmbedBuilder()
    .setTitle(`🌿 Plantación #${p.id}`)
    .setColor(p.tipo === "duplicar" ? 0x2ecc71 : 0x3498db)
    .setFooter({ text: `Maleficis • Plantaciones • PID:#${p.id}` })
    .setTimestamp(new Date(created));

  const desc = (p.descripcion && p.descripcion.trim()) ? p.descripcion.trim() : "Sin descripción.";

  e.addFields(
    { name: "📝 Descripción", value: desc, inline: false },
    { name: "📌 Tipo", value: fmtTipo(p.tipo), inline: true },
    { name: "👤 Plantó", value: `<@${p.createdBy}>`, inline: true },
    { name: "📅 Creada", value: absTs(created), inline: false },
  );

  if (p.tipo === "duplicar") {
    const readyAt = p.readyAt;
    const isReady = now() >= readyAt;
    e.addFields(
      { name: "📍 Estado", value: isReady ? "✅ Lista" : "🌱 Creciendo", inline: true },
      { name: "🌿 Cultivar", value: isReady ? "Ahora" : relTs(readyAt), inline: true },
    );
  } else {
    e.addFields(
      { name: "📍 Progreso", value: `💧 Riegos: **${p.waterCount || 0}** • 🧺 Cosechas: **${p.harvestCount || 0}/${MAX_COSECHAS}**`, inline: false },
      { name: "💧 Próximo riego", value: relTs(p.nextWaterAt), inline: true },
      { name: "🧺 Próxima cosecha", value: relTs(p.nextHarvestAt), inline: true },
    );
  }

  if (p.imageUrl) e.setImage(p.imageUrl);

  return e;
}

// ALERTA MINIMA (solo nombre + desc + foto)
function plantAlertEmbed(p) {
  const e = new EmbedBuilder()
    .setTitle(`🌿 Plantación #${p.id}`)
    .setColor(0x5865f2)
    .setFooter({ text: `Maleficis • Plantaciones • PID:#${p.id}` });

  const desc = (p.descripcion && p.descripcion.trim()) ? p.descripcion.trim() : "Sin descripción.";
  e.setDescription(desc);

  if (p.imageUrl) e.setImage(p.imageUrl);

  return e;
}

function chesterEmbed(userId) {
  const e = new EmbedBuilder()
    .setTitle("🧰 Chester • Trabajos")
    .setDescription(
      `👤 **Panel de:** <@${userId}>\n` +
      `✅ Marcá lo que hiciste y te aviso cuando vuelva.\n` +
      `🔒 **Solo el dueño** puede apretar los botones.`
    )
    .setColor(0x9b59b6)
    .setFooter({ text: "Maleficis • Chester" });

  const lines = CHESTER_JOBS.map(job => {
    const nextTs = DB.chester?.[userId]?.[job] || 0;
    const available = now() >= nextTs;
    return available
      ? `✅ **${niceJob(job)}** — Disponible`
      : `⏳ **${niceJob(job)}** — ${relTs(nextTs)}`;
  });

  e.addFields({ name: "📋 Estado", value: lines.join("\n"), inline: false });
  return e;
}

function armaEmbed(userId, key, nextTs) {
  const e = new EmbedBuilder()
    .setTitle(`🔫 Cooldown • ${ARMA_LABEL[key]}`)
    .setColor(0x2b2d31)
    .setFooter({ text: "Maleficis • Armamento" });

  e.addFields(
    { name: "👤 Usuario", value: `<@${userId}>`, inline: true },
    { name: "✅ Disponible", value: relTs(nextTs), inline: true },
  );
  return e;
}

// =====================
// BUTTONS
// =====================
function chesterButtons(userId) {
  const rows = [];
  let currentRow = new ActionRowBuilder();
  let countInRow = 0;

  for (const job of CHESTER_JOBS) {
    const nextTs = DB.chester?.[userId]?.[job] || 0;
    const available = now() >= nextTs;

    const label = available ? `✅ ${niceJob(job)}` : `⏳ ${niceJob(job)}`;

    const btn = new ButtonBuilder()
      .setCustomId(`chester_${job}_${userId}`)
      .setLabel(label.slice(0, 80))
      .setStyle(available ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(!available);

    currentRow.addComponents(btn);
    countInRow++;

    if (countInRow === 5) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
      countInRow = 0;
    }
  }
  if (countInRow > 0) rows.push(currentRow);
  return rows;
}

function plantAlertButtons(p, kind) {
  if (p.tipo === "duplicar") {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`plant_cultivar_${p.id}`)
          .setLabel("🌿 Cultivar")
          .setStyle(ButtonStyle.Success)
      )
    ];
  }

  const row = new ActionRowBuilder();
  if (kind === "regar") {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`plant_regar_${p.id}`)
        .setLabel("💧 Regar")
        .setStyle(ButtonStyle.Primary)
    );
  } else if (kind === "cosechar") {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`plant_cosechar_${p.id}`)
        .setLabel("🧺 Cosechar")
        .setStyle(ButtonStyle.Success)
    );
  }
  return [row];
}

// =====================
// ANTI DUPES: buscar mensajes originales por PID
// =====================
async function findPlantMessagesInChannel(channel, plantId) {
  try {
    const fetched = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    if (!fetched) return [];
    const meId = client.user?.id;
    const key = `PID:#${plantId}`;

    const msgs = [];
    for (const m of fetched.values()) {
      if (meId && m.author?.id !== meId) continue;
      const emb = m.embeds?.[0];
      const footer = emb?.footer?.text || "";
      const title = emb?.title || "";
      if (footer.includes(key) || title.includes(`#${plantId}`)) msgs.push(m);
    }
    msgs.sort((a, b) => (b.createdTimestamp || 0) - (a.createdTimestamp || 0));
    return msgs;
  } catch {
    return [];
  }
}

const plantEnsureLock = new Set();
const plantAlertLock = new Set();

// =====================
// PLANT: asegurar SOLO 1 embed original por plantación
// =====================
async function ensurePlantMessage(p) {
  if (plantEnsureLock.has(p.id)) return;
  plantEnsureLock.add(p.id);

  try {
    const ch = await safeFetchChannel(client, p.channelId);
    if (!ch) return;

    if (p.messageId) {
      const msg = await safeFetchMessage(ch, p.messageId);
      if (msg) {
        await msg.edit({ embeds: [plantEmbed(p)], components: [] }).catch(() => {});
        return;
      }
      updatePlant({ id: p.id, messageId: null });
      p.messageId = null;
    }

    const matches = await findPlantMessagesInChannel(ch, p.id);

    if (matches.length > 0) {
      const keep = matches[0];
      for (const dup of matches.slice(1)) await deleteMessageIfPossible(dup);

      updatePlant({ id: p.id, messageId: keep.id });
      await keep.edit({ embeds: [plantEmbed(p)], components: [] }).catch(() => {});
      return;
    }

    const sent = await ch.send({ embeds: [plantEmbed(p)] }).catch(() => null);
    if (sent) updatePlant({ id: p.id, messageId: sent.id });
  } finally {
    plantEnsureLock.delete(p.id);
  }
}

// =====================
// ALERTS: 1 SOLO MENSAJE, NO SPAM, lock + persistencia en memoria
// =====================
async function sendPlantAlert(p, kind) {
  const lockKey = `${p.id}:${p.tipo}:${kind}`;
  if (plantAlertLock.has(lockKey)) return;
  plantAlertLock.add(lockKey);

  try {
    const ch = await safeFetchChannel(client, p.channelId);
    if (!ch) return;

    const alertKey =
      p.tipo === "duplicar" ? "alertMessageIdReady" :
      (kind === "regar" ? "alertMessageIdWater" : "alertMessageIdHarvest");

    // Si existe ID guardado y el msg existe => no mando otro
    if (p[alertKey]) {
      const ex = await safeFetchMessage(ch, p[alertKey]);
      if (ex) return;
      // si no existe, limpio
      p[alertKey] = null;
      updatePlant({ id: p.id, [alertKey]: null });
    }

    // Si ya fue alertado => no mando otro
    if (p.tipo === "duplicar" && p.alertedReady) return;
    if (p.tipo === "cosecha" && kind === "regar" && p.alertedWater) return;
    if (p.tipo === "cosecha" && kind === "cosechar" && p.alertedHarvest) return;

    const pingInfo = await getRoleMentionForGuild(ch.guild);

    let text = "Hay que regar";
    if (p.tipo === "duplicar") text = "Hay que cultivar";
    else if (kind === "cosechar") text = "Hay que cosechar";

    const sent = await ch.send({
      content: `${pingInfo.content} ${text}`,
      allowedMentions: pingInfo.allowedMentions,
      embeds: [plantAlertEmbed(p)],
      components: plantAlertButtons(p, kind),
    }).catch(() => null);

    if (!sent) return;

    // Persistencia: memoria + json
    p[alertKey] = sent.id;

    const patch = { id: p.id, [alertKey]: sent.id };
    if (p.tipo === "duplicar") {
      p.alertedReady = true; patch.alertedReady = true;
    } else if (kind === "regar") {
      p.alertedWater = true; patch.alertedWater = true;
    } else {
      p.alertedHarvest = true; patch.alertedHarvest = true;
    }
    updatePlant(patch);
  } finally {
    plantAlertLock.delete(lockKey);
  }
}

// =====================
// CHESTER: refrescar panel guardado
// =====================
async function refreshChesterPanel(userId) {
  const panel = DB.chesterPanels?.[userId];
  if (!panel?.channelId || !panel?.messageId) return false;

  const ch = await safeFetchChannel(client, panel.channelId);
  if (!ch) return false;

  const msg = await safeFetchMessage(ch, panel.messageId);
  if (!msg) return false;

  await msg.edit({
    embeds: [chesterEmbed(userId)],
    components: chesterButtons(userId),
  }).catch(() => {});
  return true;
}

// =====================
// LOG helpers
// =====================
function localYMD(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}
async function getDisplayName(guild, userId) {
  try {
    const m = await guild.members.fetch(userId).catch(() => null);
    if (m) return m.displayName || m.user?.username || userId;
  } catch {}
  try {
    const u = await client.users.fetch(userId).catch(() => null);
    if (u) return u.username;
  } catch {}
  return userId;
}

// =====================
// COMMANDS
// =====================
const commands = [
  new SlashCommandBuilder()
    .setName("plantacion")
    .setDescription("Crear una plantación (cosecha o duplicar semillas)")
    .addStringOption(opt =>
      opt.setName("tipo")
        .setDescription("Tipo de plantación")
        .setRequired(true)
        .addChoices(
          { name: "Cosecha", value: "cosecha" },
          { name: "Duplicar semillas", value: "duplicar" },
        )
    )
    .addStringOption(opt =>
      opt.setName("descripcion")
        .setDescription("Descripción (opcional)")
        .setRequired(false)
    )
    .addAttachmentOption(opt =>
      opt.setName("foto")
        .setDescription("Foto (opcional)")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("plantaciones")
    .setDescription("Ver plantaciones activas y tiempos"),

  new SlashCommandBuilder()
    .setName("borrarplantacion")
    .setDescription("Borrar plantación por número (#1, #2...)")
    .addIntegerOption(opt =>
      opt.setName("numero")
        .setDescription("Número de la lista")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("chester")
    .setDescription("🧰 Chester: panel de trabajos (público, botones privados)"),

  new SlashCommandBuilder()
    .setName("cdarma")
    .setDescription("🔫 Iniciar cooldown de armamento (te avisa por DM)")
    .addStringOption(opt =>
      opt.setName("tipo")
        .setDescription("¿Qué cooldown querés iniciar?")
        .setRequired(true)
        .addChoices(
          { name: "Revolver (2 días)", value: "revolver" },
          { name: "SNS (4 días)", value: "sns" },
          { name: "Balas de Revolver (1 día)", value: "balas_revolver" },
          { name: "Balas de SNS (2 días)", value: "balas_sns" },
        )
    ),

  new SlashCommandBuilder()
    .setName("dia")
    .setDescription("📅 Resumen por día (ADMIN) - Ej: día 24")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addIntegerOption(opt =>
      opt.setName("dia")
        .setDescription("Número de día (1-31)")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(31)
    ),

  new SlashCommandBuilder()
    .setName("log")
    .setDescription("📚 Logs filtrados (ADMIN)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt =>
      opt.setName("tipo")
        .setDescription("Tipo de log")
        .setRequired(true)
        .addChoices(
          { name: "Todo", value: "todo" },
          { name: "Plantaciones", value: "plantaciones" },
          { name: "Chester", value: "chester" },
          { name: "Armas", value: "armas" },
        )
    )
    .addUserOption(opt =>
      opt.setName("usuario")
        .setDescription("Filtrar por usuario (opcional)")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("resetbot")
    .setDescription("🧨 RESET TOTAL del bot (borra TODO) (ADMIN)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
].map(c => c.toJSON());

// =====================
// READY
// =====================
client.once("ready", async () => {
  console.log(`🤖 Bot listo: ${client.user.tag}`);
  for (const p of DB.plantaciones) await ensurePlantMessage(p);
});

// =====================
// LOOP (20s)
// =====================
setInterval(async () => {
  // Plantaciones: re-leer “fresco” para evitar spam
  for (const item of DB.plantaciones) {
    try {
      const p = DB.plantaciones.find(x => x.id === item.id);
      if (!p) continue;

      await ensurePlantMessage(p);
      if (p.completed) continue;

      if (p.tipo === "duplicar") {
        if (!p.alertedReady && now() >= p.readyAt) await sendPlantAlert(p, "cultivar");
      } else {
        if (!p.alertedWater && now() >= p.nextWaterAt) await sendPlantAlert(p, "regar");
        if (!p.alertedHarvest && now() >= p.nextHarvestAt) await sendPlantAlert(p, "cosechar");
      }
    } catch {}
  }

  // Chester DM (sin duplicar) + refresh panel
  for (const userId of Object.keys(DB.chester)) {
    for (const job of Object.keys(DB.chester[userId] || {})) {
      if (isNotifiedKey(job)) continue;

      const ts = DB.chester[userId][job];
      if (!ts || typeof ts !== "number") continue;

      const notifiedKey = `${job}_notifiedTs`;
      const alreadyNotifiedTs = DB.chester[userId][notifiedKey] || 0;

      if (now() >= ts && alreadyNotifiedTs !== ts) {
        DB.chester[userId][notifiedKey] = ts;
        writeJSON("chester.json", DB.chester);

        await refreshChesterPanel(userId);

        try {
          const user = await client.users.fetch(userId);
          await user.send(`✅ Ya puedes hacer el trabajo de **${niceJob(job)}**.`);
        } catch {}
      }
    }
  }

  // Armas DM (sin duplicar)
  for (const userId of Object.keys(DB.armas)) {
    for (const key of Object.keys(DB.armas[userId] || {})) {
      if (isNotifiedKey(key)) continue;

      const ts = DB.armas[userId][key];
      if (!ts || typeof ts !== "number") continue;

      const notifiedKey = `${key}_notifiedTs`;
      const alreadyNotifiedTs = DB.armas[userId][notifiedKey] || 0;

      if (now() >= ts && alreadyNotifiedTs !== ts) {
        DB.armas[userId][notifiedKey] = ts;
        writeJSON("armas.json", DB.armas);

        try {
          const user = await client.users.fetch(userId);
          await user.send(`🔫 Ya puedes volver a hacer **${ARMA_LABEL[key]}**.`);
        } catch {}
      }
    }
  }
}, 20 * 1000);

// =====================
// INTERACTIONS
// =====================
client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const name = interaction.commandName;

      if (name === "plantacion") {
        const tipo = interaction.options.getString("tipo", true);
        const descripcion = interaction.options.getString("descripcion") || "";
        const foto = interaction.options.getAttachment("foto");

        const p = {
          id: nextPlantId(),
          tipo,
          descripcion,
          imageUrl: foto?.url || null,
          createdAt: now(),
          createdBy: interaction.user.id,
          channelId: interaction.channelId,
          messageId: null,

          harvestCount: 0,
          waterCount: 0,

          readyAt: null,
          nextWaterAt: null,
          nextHarvestAt: null,

          alertedReady: false,
          alertedWater: false,
          alertedHarvest: false,

          alertMessageIdReady: null,
          alertMessageIdWater: null,
          alertMessageIdHarvest: null,

          completed: false,
          completedAt: null,
        };

        if (tipo === "duplicar") p.readyAt = p.createdAt + DUPLICAR_MS;
        else {
          p.nextWaterAt = p.createdAt + REGAR_MS;
          p.nextHarvestAt = p.createdAt + COSECHAR_MS;
        }

        DB.plantaciones.push(p);
        writeJSON("plantaciones.json", DB.plantaciones);

        logReg("plantacion_creada", interaction.user.id, { plantId: p.id, tipo, descripcion });

        await interaction.reply({ ephemeral: true, content: `✅ Plantación creada (#${p.id}).` });
        await ensurePlantMessage(p);
        return;
      }

      if (name === "plantaciones") {
        const list = [...DB.plantaciones].sort((a, b) => a.id - b.id);
        if (list.length === 0) return interaction.reply({ ephemeral: true, content: "No hay plantaciones activas." });

        const lines = list.map((p, i) => {
          const num = i + 1;
          if (p.completed) return `**#${num}** → ✅ **#${p.id}** • ${fmtTipo(p.tipo)} • Completada`;
          if (p.tipo === "duplicar") return `**#${num}** → 🌿 **#${p.id}** • Duplicar • Cultivar: ${now() >= p.readyAt ? "✅ ahora" : relTs(p.readyAt)}`;
          return `**#${num}** → 🌱 **#${p.id}** • Cosecha • 💧 ${relTs(p.nextWaterAt)} • 🧺 ${relTs(p.nextHarvestAt)} • (${p.harvestCount}/${MAX_COSECHAS})`;
        });

        const e = new EmbedBuilder()
          .setTitle("🌿 Plantaciones")
          .setColor(0x95a5a6)
          .setDescription(lines.join("\n"));

        return interaction.reply({ ephemeral: true, embeds: [e] });
      }

      if (name === "borrarplantacion") {
        const numero = interaction.options.getInteger("numero", true);
        const p = getPlantByNumber(numero);
        if (!p) return interaction.reply({ ephemeral: true, content: "No existe esa plantación en la lista." });

        const ch = await safeFetchChannel(client, p.channelId);
        if (ch) {
          const matches = await findPlantMessagesInChannel(ch, p.id);
          for (const m of matches) await deleteMessageIfPossible(m);
        }

        removePlant(p.id);
        logReg("plantacion_borrada", interaction.user.id, { plantId: p.id });

        return interaction.reply({ ephemeral: true, content: `🗑️ Plantación #${p.id} eliminada.` });
      }

      if (name === "chester") {
        const userId = interaction.user.id;
        if (!DB.chester[userId]) DB.chester[userId] = {};
        writeJSON("chester.json", DB.chester);

        const existed = await refreshChesterPanel(userId);
        if (existed) return interaction.reply({ ephemeral: true, content: "✅ Panel de Chester actualizado (guardado)." });

        const sent = await interaction.reply({
          ephemeral: false,
          embeds: [chesterEmbed(userId)],
          components: chesterButtons(userId),
          fetchReply: true,
        });

        if (sent?.id) {
          DB.chesterPanels[userId] = { channelId: interaction.channelId, messageId: sent.id };
          writeJSON("chester_panels.json", DB.chesterPanels);
        }
        return;
      }

      if (name === "cdarma") {
        const key = interaction.options.getString("tipo", true);
        if (!ARMA_CD[key]) return interaction.reply({ ephemeral: true, content: "Tipo inválido." });

        if (!DB.armas[interaction.user.id]) DB.armas[interaction.user.id] = {};

        const nextTs = now() + ARMA_CD[key];
        DB.armas[interaction.user.id][key] = nextTs;
        DB.armas[interaction.user.id][`${key}_notifiedTs`] = 0;
        writeJSON("armas.json", DB.armas);

        logReg("arma_cd", interaction.user.id, { arma: key, label: ARMA_LABEL[key] });

        return interaction.reply({
          ephemeral: true,
          embeds: [armaEmbed(interaction.user.id, key, nextTs)],
          content: "✅ CD iniciado. Te aviso por DM cuando puedas volver a hacerlo.",
        });
      }

      if (name === "dia") {
        const dayNum = interaction.options.getInteger("dia", true);

        const nowDate = new Date();
        const y = nowDate.getFullYear();
        const m = nowDate.getMonth() + 1;
        const target = `${y}-${String(m).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;

        const entries = DB.registro.filter(e => localYMD(e.at) === target);

        if (entries.length === 0) {
          return interaction.reply({ ephemeral: true, content: `No hay logs para **Día ${dayNum}**.` });
        }

        const byUser = {};
        for (const e of entries) {
          const u = e.by || "system";
          if (!byUser[u]) byUser[u] = [];
          byUser[u].push(e);
        }

        const blocks = [];
        for (const [uid, arr] of Object.entries(byUser)) {
          const plant = { planto: 0, rego: 0, cosecho: 0, completo: 0 };
          const chester = new Set();
          const armas = new Set();

          for (const ev of arr) {
            if (ev.type === "plantacion_creada") plant.planto++;
            if (ev.type === "plantacion_regada") plant.rego++;
            if (ev.type === "plantacion_cosechada") plant.cosecho++;
            if (ev.type === "plantacion_completada") plant.completo++;
            if (ev.type === "chester_job" && ev.meta?.job) chester.add(niceJob(ev.meta.job));
            if (ev.type === "arma_cd" && ev.meta?.label) armas.add(ev.meta.label);
          }

          const name = uid === "system" ? "Sistema" : await getDisplayName(interaction.guild, uid);

          const parts = [];
          if (plant.planto) parts.push(`🌱 Plantó: **${plant.planto}**`);
          if (plant.rego) parts.push(`💧 Regó: **${plant.rego}**`);
          if (plant.cosecho) parts.push(`🧺 Cosechó: **${plant.cosecho}**`);
          if (plant.completo) parts.push(`✅ Completó: **${plant.completo}**`);
          if (chester.size) parts.push(`🧰 Chester: **${[...chester].join(", ")}**`);
          if (armas.size) parts.push(`🔫 Armas: **${[...armas].join(", ")}**`);

          if (parts.length === 0) continue;
          blocks.push({ name, text: parts.join(" • ") });
        }

        const e = new EmbedBuilder()
          .setTitle(`📅 Día ${dayNum} — Resumen`)
          .setColor(0x57f287)
          .setDescription(`**${target}**`)
          .setFooter({ text: "Maleficis • Logs" });

        for (const b of blocks.slice(0, 20)) {
          e.addFields({ name: `${b.name} hizo:`, value: b.text.slice(0, 1024), inline: false });
        }

        return interaction.reply({ ephemeral: true, embeds: [e] });
      }

      if (name === "log") {
        const tipo = interaction.options.getString("tipo", true);
        const usuario = interaction.options.getUser("usuario");

        let entries = DB.registro.slice();
        if (usuario) entries = entries.filter(e => e.by === usuario.id);

        if (tipo === "plantaciones") entries = entries.filter(e => e.type.startsWith("plantacion_"));
        else if (tipo === "chester") entries = entries.filter(e => e.type.startsWith("chester_"));
        else if (tipo === "armas") entries = entries.filter(e => e.type.startsWith("arma_"));

        if (entries.length === 0) return interaction.reply({ ephemeral: true, content: "No hay logs con ese filtro." });

        const byUser = {};
        for (const ev of entries) {
          const u = ev.by || "system";
          if (!byUser[u]) byUser[u] = [];
          byUser[u].push(ev);
        }

        const e = new EmbedBuilder()
          .setTitle(`📚 Logs • ${capFirst(tipo)}`)
          .setColor(0x3498db)
          .setFooter({ text: "Maleficis • Logs" });

        const users = Object.keys(byUser).slice(0, 15);
        for (const uid of users) {
          const name = uid === "system" ? "Sistema" : await getDisplayName(interaction.guild, uid);

          const lines = byUser[uid]
            .sort((a, b) => b.at - a.at)
            .slice(0, 20)
            .map(ev => {
              if (ev.type === "chester_job") return `• ${absTs(ev.at)} — 🧰 Chester: **${niceJob(ev.meta?.job || "—")}**`;
              if (ev.type === "arma_cd") return `• ${absTs(ev.at)} — 🔫 Armas: **${ev.meta?.label || "—"}**`;
              if (ev.type === "plantacion_creada") return `• ${absTs(ev.at)} — 🌱 Plantó #${ev.meta?.plantId ?? "?"}`;
              if (ev.type === "plantacion_regada") return `• ${absTs(ev.at)} — 💧 Regó #${ev.meta?.plantId ?? "?"}`;
              if (ev.type === "plantacion_cosechada") return `• ${absTs(ev.at)} — 🧺 Cosechó #${ev.meta?.plantId ?? "?"}`;
              if (ev.type === "plantacion_completada") return `• ${absTs(ev.at)} — ✅ Completó #${ev.meta?.plantId ?? "?"}`;
              return `• ${absTs(ev.at)} — **${ev.type}**`;
            });

          e.addFields({ name: name, value: lines.join("\n").slice(0, 1024) || "—", inline: false });
        }

        return interaction.reply({ ephemeral: true, embeds: [e] });
      }

      if (name === "resetbot") {
        // Reset TOTAL en RAM
        DB.plantaciones = [];
        DB.chester = {};
        DB.chesterPanels = {};
        DB.armas = {};
        DB.registro = [];

        // Reset TOTAL en DISCO
        writeJSON("plantaciones.json", DB.plantaciones);
        writeJSON("chester.json", DB.chester);
        writeJSON("chester_panels.json", DB.chesterPanels);
        writeJSON("armas.json", DB.armas);
        writeJSON("registro.json", DB.registro);

        return interaction.reply({ ephemeral: true, content: "🧨 RESET TOTAL hecho. Bot limpio (sin memoria vieja)." });
      }
    }

    // =====================
    // BUTTONS
    // =====================
    if (interaction.isButton()) {
      const id = interaction.customId;

      // ===== Plantaciones =====
      if (id.startsWith("plant_")) {
        const parts = id.split("_");
        const action = parts[1];
        const plantId = parseInt(parts[2], 10);

        const p = DB.plantaciones.find(x => x.id === plantId);
        if (!p) {
          await deleteMessageIfPossible(interaction.message);
          return interaction.reply({ ephemeral: true, content: "Esa plantación ya no existe." });
        }

        // duplicar -> cultivar
        if (p.tipo === "duplicar" && action === "cultivar") {
          if (p.completed) {
            await deleteMessageIfPossible(interaction.message);
            return interaction.reply({ ephemeral: true, content: "✅ Ya estaba completada." });
          }
          if (now() < p.readyAt) return interaction.reply({ ephemeral: true, content: `Aún no está lista. ${relTs(p.readyAt)}` });

          updatePlant({
            id: p.id,
            completed: true,
            completedAt: now(),
            alertMessageIdReady: null,
          });

          logReg("plantacion_completada", interaction.user.id, { plantId: p.id, tipo: p.tipo });

          const updated = DB.plantaciones.find(x => x.id === p.id);
          await ensurePlantMessage(updated);

          await deleteMessageIfPossible(interaction.message);
          return interaction.reply({ ephemeral: true, content: `✅ Plantación #${p.id} completada.` });
        }

        // cosecha -> regar / cosechar
        if (p.tipo === "cosecha") {
          if (p.completed) {
            await deleteMessageIfPossible(interaction.message);
            return interaction.reply({ ephemeral: true, content: "✅ Ya estaba completada." });
          }

          if (action === "regar") {
            if (now() < p.nextWaterAt) return interaction.reply({ ephemeral: true, content: `Aún no toca. ${relTs(p.nextWaterAt)}` });

            const newWaterAt = now() + REGAR_MS;
            const newWaterCount = (p.waterCount || 0) + 1;

            updatePlant({
              id: p.id,
              waterCount: newWaterCount,
              nextWaterAt: newWaterAt,
              alertedWater: false,
              alertMessageIdWater: null,
            });

            logReg("plantacion_regada", interaction.user.id, { plantId: p.id });

            const updated = DB.plantaciones.find(x => x.id === p.id);
            await ensurePlantMessage(updated);

            await deleteMessageIfPossible(interaction.message);
            return interaction.reply({ ephemeral: true, content: `💧 Regada. Próximo riego: ${relTs(newWaterAt)}` });
          }

          if (action === "cosechar") {
            if (now() < p.nextHarvestAt) return interaction.reply({ ephemeral: true, content: `Aún no toca. ${relTs(p.nextHarvestAt)}` });

            const newCount = (p.harvestCount || 0) + 1;

            if (newCount >= MAX_COSECHAS) {
              updatePlant({
                id: p.id,
                harvestCount: newCount,
                completed: true,
                completedAt: now(),
                alertMessageIdHarvest: null,
              });

              logReg("plantacion_cosechada", interaction.user.id, { plantId: p.id, count: newCount });
              logReg("plantacion_completada", interaction.user.id, { plantId: p.id, tipo: p.tipo });

              const updated = DB.plantaciones.find(x => x.id === p.id);
              await ensurePlantMessage(updated);

              await deleteMessageIfPossible(interaction.message);
              return interaction.reply({ ephemeral: true, content: `✅ Cosecha finalizada (3/3).` });
            }

            const newHarvestAt = now() + COSECHAR_MS;
            updatePlant({
              id: p.id,
              harvestCount: newCount,
              nextHarvestAt: newHarvestAt,
              alertedHarvest: false,
              alertMessageIdHarvest: null,
            });

            logReg("plantacion_cosechada", interaction.user.id, { plantId: p.id, count: newCount });

            const updated = DB.plantaciones.find(x => x.id === p.id);
            await ensurePlantMessage(updated);

            await deleteMessageIfPossible(interaction.message);
            return interaction.reply({ ephemeral: true, content: `🧺 Cosechada (${newCount}/${MAX_COSECHAS}). Próxima: ${relTs(newHarvestAt)}` });
          }
        }

        return;
      }

      // ===== Chester =====
      if (id.startsWith("chester_")) {
        const [, job, userId] = id.split("_");

        if (interaction.user.id !== userId) {
          return interaction.reply({ ephemeral: true, content: "🔒 Este panel es personal. Usá /chester para el tuyo." });
        }
        if (!CHESTER_JOBS.includes(job)) return interaction.reply({ ephemeral: true, content: "Trabajo inválido." });

        if (!DB.chester[userId]) DB.chester[userId] = {};
        const nextTs = DB.chester[userId][job] || 0;

        if (now() < nextTs) return interaction.reply({ ephemeral: true, content: `⏳ Aún en cooldown. ${relTs(nextTs)}` });

        const newTs = now() + CHESTER_CD_MS;
        DB.chester[userId][job] = newTs;
        DB.chester[userId][`${job}_notifiedTs`] = 0;
        writeJSON("chester.json", DB.chester);

        DB.chesterPanels[userId] = { channelId: interaction.channelId, messageId: interaction.message.id };
        writeJSON("chester_panels.json", DB.chesterPanels);

        logReg("chester_job", interaction.user.id, { job });

        return interaction.update({
          embeds: [chesterEmbed(userId)],
          components: chesterButtons(userId),
        });
      }
    }
  } catch (err) {
    console.error("interaction error", err);
    if (interaction.isRepliable()) {
      try { await interaction.reply({ ephemeral: true, content: "Ocurrió un error." }); } catch {}
    }
  }
});

// =====================
// START
// =====================
(async () => {
  if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
    console.error("❌ Falta TOKEN / CLIENT_ID / GUILD_ID en variables de entorno.");
    process.exit(1);
  }

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log("✅ Comandos registrados.");

  await client.login(TOKEN);
})();

