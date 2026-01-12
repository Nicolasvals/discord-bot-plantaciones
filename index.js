// index.js - Maleficis Plantaciones + Chester + Tienda + CDs Armas (Railway ready)
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

// Ping role exacto (por nombre)
const PING_ROLE_NAME = "marihuana";

// Chester
const CHESTER_JOBS = [
  "molotov",
  "parking",
  "ventanillas",
  "ruedas",
  "grafitis",
  "peleas",
  "moto",     // antes transporte
  "coche",
];
const CHESTER_CD_MS = 24 * 60 * 60 * 1000; // 24h

// Tienda
const TIENDA_CD_SOLO_MS  = 5 * 60 * 60 * 1000;  // 5h
const TIENDA_CD_GRUPO_MS = 2 * 60 * 60 * 1000;  // 2h

// CDs Armas
const ARMA_CD = {
  revolver: 2 * 24 * 60 * 60 * 1000,        // 2 días
  sns: 4 * 24 * 60 * 60 * 1000,             // 4 días
  balas_revolver: 1 * 24 * 60 * 60 * 1000,  // 1 día
  balas_sns: 2 * 24 * 60 * 60 * 1000,       // 2 días
};

const ARMA_LABEL = {
  revolver: "Revolver",
  sns: "SNS",
  balas_revolver: "Balas de Revolver",
  balas_sns: "Balas de SNS",
};

// Use TZ Argentina en Railway: TZ=America/Argentina/Buenos_Aires

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

const DB = {
  plantaciones: loadJSON("plantaciones.json", []),
  chester: loadJSON("chester.json", {}),               // { userId: { job: nextTs, job_notifiedTs: ts } }
  chesterPanels: loadJSON("chester_panels.json", {}),  // { userId: { channelId, messageId } }
  tienda: loadJSON("tienda.json", {}),
  armas: loadJSON("armas.json", {}),                   // { userId: { key: nextTs, key_notifiedTs: ts } }
  registro: loadJSON("registro.json", []),
};

function logReg(entry) {
  DB.registro.push(entry);
  saveJSON("registro.json", DB.registro);
}

function now() { return Date.now(); }
function toUnix(ms) { return Math.floor(ms / 1000); }
function relTs(ms) { return `<t:${toUnix(ms)}:R>`; }
function absTs(ms) { return `<t:${toUnix(ms)}:f>`; }

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
  saveJSON("plantaciones.json", DB.plantaciones);
}

function updatePlant(patch) {
  const idx = DB.plantaciones.findIndex(p => p.id === patch.id);
  if (idx >= 0) {
    DB.plantaciones[idx] = { ...DB.plantaciones[idx], ...patch };
    saveJSON("plantaciones.json", DB.plantaciones);
  }
}

async function safeFetchChannel(client, channelId) {
  try { return await client.channels.fetch(channelId); } catch { return null; }
}
async function safeFetchMessage(channel, messageId) {
  try { return await channel.messages.fetch(messageId); } catch { return null; }
}

function isNotifiedKey(k) {
  return typeof k === "string" && (k.endsWith("_notified") || k.endsWith("_notifiedTs"));
}

// =====================
// DISCORD CLIENT
// =====================
// Sin intents extra para evitar "Used disallowed intents"
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
    if (!guild.roles.cache?.size) {
      await guild.roles.fetch().catch(() => {});
    }
    const role = guild.roles.cache.find(
      r => (r.name || "").toLowerCase() === PING_ROLE_NAME.toLowerCase()
    );
    if (!role) {
      return { content: `@${PING_ROLE_NAME}`, allowedMentions: { parse: [] } };
    }
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

// Embed ORIGINAL (estado general) — este es el único que queda en el canal
function plantCompletedEmbed(p) {
  const created = p.createdAt ?? now();
  const plantedBy = p.createdBy ? `<@${p.createdBy}>` : "—";

  const waterCount = p.waterCount || 0;
  const harvestCount = p.harvestCount || 0;

  const e = new EmbedBuilder()
    .setTitle(`✅ Plantación completada • #${p.id}`)
    .setColor(0x2ecc71)
    .setFooter({ text: "Maleficis • Plantaciones" })
    .setTimestamp(new Date(created));

  const desc = (p.descripcion && p.descripcion.trim()) ? p.descripcion.trim() : "Sin descripción.";

  let lines = [];
  lines.push(`📌 **${fmtTipo(p.tipo)}** — ${desc}`);
  lines.push(`🌱 **Plantó:** ${plantedBy}`);

  // Solo mostrar regó/cosechó si hubo acción
  if ((waterCount > 0) || (harvestCount > 0)) {
    lines.push(`💧 **Regó:** ${waterCount}${p.lastWaterBy ? ` (último: <@${p.lastWaterBy}>)` : ""}`);
    lines.push(`🧺 **Cosechó:** ${harvestCount}${p.lastHarvestBy ? ` (último: <@${p.lastHarvestBy}>)` : ""}`);
  }

  e.setDescription(lines.join("\n"));

  // Si es duplicar, nunca mostrar foto al terminar
  if (p.tipo !== "duplicar" && p.imageUrl) e.setImage(p.imageUrl);

  return e;
}

function plantEmbed(p) {
  if (p.completed) return plantCompletedEmbed(p);

  const created = p.createdAt ?? now();
  const e = new EmbedBuilder()
    .setTitle(`🌿 Plantación #${p.id}`)
    .setColor(p.tipo === "duplicar" ? 0x2ecc71 : 0x3498db)
    .setFooter({ text: "Maleficis • Plantaciones" })
    .setTimestamp(new Date(created));

  const desc = (p.descripcion && p.descripcion.trim()) ? p.descripcion.trim() : "Sin descripción.";

  // Mantenerlo lindo pero no spam
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

// Embed ALERTA (mínimo) — SOLO para mensajes nuevos de regar/cosechar/cultivar
function plantAlertEmbed(p) {
  const e = new EmbedBuilder()
    .setTitle(`🌿 Plantación #${p.id}`)
    .setColor(0x5865f2)
    .setFooter({ text: "Maleficis • Plantaciones" });

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

function tiendaEmbed(userId, modo, nombre, nextTs) {
  const e = new EmbedBuilder()
    .setTitle("🏪 Robo a tienda • Cooldown")
    .setColor(0xe67e22)
    .setFooter({ text: "Maleficis • Tiendas" });

  e.addFields(
    { name: "👤 Usuario", value: `<@${userId}>`, inline: true },
    { name: "👥 Modo", value: modo === "grupo" ? "Grupo (2h)" : "Solo (5h)", inline: true },
    { name: "📍 Tienda", value: nombre, inline: false },
    { name: "✅ Disponible", value: relTs(nextTs), inline: true },
  );

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
// HELPERS: CLEANUP SPAM MSG
// =====================
async function deleteMessageIfPossible(msg) {
  if (!msg) return;
  try { await msg.delete(); } catch {}
}

// =====================
// PLANT: ORIGINAL MESSAGE (solo se edita)
// =====================
async function ensurePlantMessage(p) {
  const ch = await safeFetchChannel(client, p.channelId);
  if (!ch) return;

  const embed = plantEmbed(p);

  if (p.messageId) {
    const msg = await safeFetchMessage(ch, p.messageId);
    if (msg) {
      await msg.edit({ embeds: [embed], components: [] }).catch(() => {});
      return;
    }
    // si se perdió, lo recreamos 1 sola vez
  }

  const sent = await ch.send({ embeds: [embed] }).catch(() => null);
  if (sent) updatePlant({ id: p.id, messageId: sent.id });
}

// =====================
// PLANT: ALERT SENDER (1 SOLO MENSAJE, MINIMO)
// =====================
async function sendPlantAlert(p, kind) {
  const ch = await safeFetchChannel(client, p.channelId);
  if (!ch) return;

  // Evitar duplicados: si ya hay un alert message guardado y existe, no mandar otro
  const alertKey =
    p.tipo === "duplicar" ? "alertMessageIdReady" :
    (kind === "regar" ? "alertMessageIdWater" : "alertMessageIdHarvest");

  const existingId = p[alertKey];
  if (existingId) {
    const ex = await safeFetchMessage(ch, existingId);
    if (ex) return; // ya está el mensaje, no duplicar
  }

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

  if (sent) {
    const patch = { id: p.id };
    patch[alertKey] = sent.id;

    // marcar que ya alertó este ciclo
    if (p.tipo === "duplicar") patch.alertedReady = true;
    else if (kind === "regar") patch.alertedWater = true;
    else patch.alertedHarvest = true;

    updatePlant(patch);
  }
}

// =====================
// CHESTER: REFRESH PANEL SAVED (edita SIEMPRE el mismo)
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
// SLASH COMMANDS
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
    .setDescription("🧰 Chester: panel de trabajos (CD 24h por trabajo) (público)"),

  new SlashCommandBuilder()
    .setName("tienda")
    .setDescription("🏪 Iniciar cooldown de robo a tienda (solo/grupo)")
    .addStringOption(opt =>
      opt.setName("modo")
        .setDescription("Modo")
        .setRequired(true)
        .addChoices(
          { name: "Solo (5h)", value: "solo" },
          { name: "Grupo (2h)", value: "grupo" },
        )
    )
    .addStringOption(opt =>
      opt.setName("nombre")
        .setDescription("Nombre/tienda")
        .setRequired(true)
    ),

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
    .setName("registro")
    .setDescription("Ver registro completo (ADMIN)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(opt =>
      opt.setName("usuario")
        .setDescription("Filtrar por usuario")
        .setRequired(false)
    ),
].map(c => c.toJSON());

// Register commands
async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );
  console.log("✅ Comandos registrados:", commands.map(c => c.name).join(", "));
}

// =====================
// READY
// =====================
client.once("ready", async () => {
  console.log(`🤖 Bot listo: ${client.user.tag}`);

  // asegurar embeds originales
  for (const p of DB.plantaciones) {
    await ensurePlantMessage(p);
  }
});

// =====================
// MAIN LOOP (cada 20s)
// =====================
setInterval(async () => {
  // Plantaciones: enviar alertas 1 sola vez por ciclo
  for (const p of DB.plantaciones) {
    try {
      if (p.completed) continue;

      if (p.tipo === "duplicar") {
        if (!p.alertedReady && now() >= p.readyAt) {
          await sendPlantAlert(p, "cultivar");
        }
      } else {
        if (!p.alertedWater && now() >= p.nextWaterAt) {
          await sendPlantAlert(p, "regar");
        }
        if (!p.alertedHarvest && now() >= p.nextHarvestAt) {
          await sendPlantAlert(p, "cosechar");
        }
      }
    } catch {}
  }

  // Chester: cuando vuelve a estar disponible -> DM 1 vez + refrescar panel (habilita botones)
  for (const userId of Object.keys(DB.chester)) {
    for (const job of Object.keys(DB.chester[userId] || {})) {
      if (isNotifiedKey(job)) continue;

      const ts = DB.chester[userId][job];
      if (!ts || typeof ts !== "number") continue;

      const notifiedKey = `${job}_notifiedTs`;
      const alreadyNotifiedTs = DB.chester[userId][notifiedKey] || 0;

      if (now() >= ts && alreadyNotifiedTs !== ts) {
        DB.chester[userId][notifiedKey] = ts;
        saveJSON("chester.json", DB.chester);

        await refreshChesterPanel(userId);

        try {
          const user = await client.users.fetch(userId);
          await user.send(`✅ Ya puedes hacer el trabajo de **${niceJob(job)}**.`);
        } catch {}
      }
    }
  }

  // Armas: avisos por DM (1 vez por ts)
  for (const userId of Object.keys(DB.armas)) {
    for (const key of Object.keys(DB.armas[userId] || {})) {
      if (isNotifiedKey(key)) continue;

      const ts = DB.armas[userId][key];
      if (!ts || typeof ts !== "number") continue;

      const notifiedKey = `${key}_notifiedTs`;
      const alreadyNotifiedTs = DB.armas[userId][notifiedKey] || 0;

      if (now() >= ts && alreadyNotifiedTs !== ts) {
        DB.armas[userId][notifiedKey] = ts;
        saveJSON("armas.json", DB.armas);

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
    // Slash commands
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
          lastWaterBy: null,
          lastHarvestBy: null,

          readyAt: null,
          nextWaterAt: null,
          nextHarvestAt: null,

          alertedReady: false,
          alertedWater: false,
          alertedHarvest: false,

          // evitar spam duplicado de alertas
          alertMessageIdReady: null,
          alertMessageIdWater: null,
          alertMessageIdHarvest: null,

          completed: false,
          completedAt: null,
        };

        if (tipo === "duplicar") {
          p.readyAt = p.createdAt + DUPLICAR_MS;
        } else {
          p.nextWaterAt = p.createdAt + REGAR_MS;
          p.nextHarvestAt = p.createdAt + COSECHAR_MS;
        }

        DB.plantaciones.push(p);
        saveJSON("plantaciones.json", DB.plantaciones);

        await interaction.reply({ ephemeral: true, content: `✅ Plantación creada (#${p.id}).` });
        await ensurePlantMessage(p);

        logReg({
          type: "plantacion_creada",
          at: now(),
          by: interaction.user.id,
          meta: { plantId: p.id, tipo, descripcion: descripcion || null },
        });
        return;
      }

      if (name === "plantaciones") {
        const list = [...DB.plantaciones].sort((a, b) => a.id - b.id);
        if (list.length === 0) return interaction.reply({ ephemeral: true, content: "No hay plantaciones activas." });

        const lines = list.map((p, i) => {
          const num = i + 1;
          if (p.completed) {
            return `**#${num}** → ✅ **#${p.id}** • ${fmtTipo(p.tipo)} • Completada`;
          }

          if (p.tipo === "duplicar") {
            return `**#${num}** → 🌿 **#${p.id}** • Duplicar • Cultivar: ${now() >= p.readyAt ? "✅ ahora" : relTs(p.readyAt)}`;
          }
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

        // borrar embed original si existe
        const ch = await safeFetchChannel(client, p.channelId);
        if (ch && p.messageId) {
          const msg = await safeFetchMessage(ch, p.messageId);
          await deleteMessageIfPossible(msg);
        }

        removePlant(p.id);
        logReg({ type: "plantacion_borrada", at: now(), by: interaction.user.id, meta: { plantId: p.id } });

        return interaction.reply({ ephemeral: true, content: `🗑️ Plantación #${p.id} eliminada.` });
      }

      if (name === "chester") {
        const userId = interaction.user.id;
        if (!DB.chester[userId]) DB.chester[userId] = {};
        saveJSON("chester.json", DB.chester);

        // Si ya hay panel guardado, editar ese MISMO (no crear otro)
        const existed = await refreshChesterPanel(userId);
        if (existed) {
          return interaction.reply({ ephemeral: true, content: "✅ Panel de Chester actualizado (mismo mensaje guardado)." });
        }

        // si no hay panel, crear y guardar
        const e = chesterEmbed(userId);
        const rows = chesterButtons(userId);

        const sent = await interaction.reply({ ephemeral: false, embeds: [e], components: rows, fetchReply: true });

        if (sent?.id) {
          DB.chesterPanels[userId] = { channelId: interaction.channelId, messageId: sent.id };
          saveJSON("chester_panels.json", DB.chesterPanels);
        }
        return;
      }

      if (name === "tienda") {
        const modo = interaction.options.getString("modo", true);
        const nombre = interaction.options.getString("nombre", true).trim();

        const cd = modo === "grupo" ? TIENDA_CD_GRUPO_MS : TIENDA_CD_SOLO_MS;
        const key = `${modo}|${nombre.toLowerCase()}`;

        if (!DB.tienda[interaction.user.id]) DB.tienda[interaction.user.id] = {};
        DB.tienda[interaction.user.id][key] = now() + cd;
        DB.tienda[interaction.user.id][`${key}_notified`] = false;
        saveJSON("tienda.json", DB.tienda);

        logReg({ type: "tienda_inicio", at: now(), by: interaction.user.id, meta: { modo, nombre } });

        const e = tiendaEmbed(interaction.user.id, modo, nombre, now() + cd);
        return interaction.reply({ ephemeral: true, embeds: [e], content: "✅ CD iniciado. Te aviso por DM cuando esté listo." });
      }

      if (name === "cdarma") {
        const key = interaction.options.getString("tipo", true);

        if (!ARMA_CD[key]) {
          return interaction.reply({ ephemeral: true, content: "Tipo inválido." });
        }

        if (!DB.armas[interaction.user.id]) DB.armas[interaction.user.id] = {};

        const nextTs = now() + ARMA_CD[key];
        DB.armas[interaction.user.id][key] = nextTs;
        DB.armas[interaction.user.id][`${key}_notifiedTs`] = 0; // reset antispam para este nuevo ts
        saveJSON("armas.json", DB.armas);

        logReg({ type: "arma_cd_inicio", at: now(), by: interaction.user.id, meta: { tipo: key } });

        return interaction.reply({
          ephemeral: true,
          embeds: [armaEmbed(interaction.user.id, key, nextTs)],
          content: "✅ CD iniciado. Te aviso por DM cuando puedas volver a hacerlo.",
        });
      }

      if (name === "registro") {
        const usuario = interaction.options.getUser("usuario");
        const entries = DB.registro.slice();
        const filtered = usuario ? entries.filter(e => e.by === usuario.id) : entries;
        if (filtered.length === 0) return interaction.reply({ ephemeral: true, content: "No hay registros para mostrar." });

        const lines = filtered
          .slice(-50)
          .map(e => `• ${absTs(e.at)} — **${e.type}** — <@${e.by}>`)
          .join("\n");

        const em = new EmbedBuilder()
          .setTitle("📚 Registro")
          .setColor(0x34495e)
          .setDescription(lines.slice(0, 4000));

        return interaction.reply({ ephemeral: true, embeds: [em] });
      }
    }

    // Buttons
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
          if (now() < p.readyAt) {
            return interaction.reply({ ephemeral: true, content: `Aún no está lista. ${relTs(p.readyAt)}` });
          }

          // marcar completada, limpiar alert msg id
          updatePlant({
            id: p.id,
            completed: true,
            completedAt: now(),
            alertMessageIdReady: null,
          });

          const updated = DB.plantaciones.find(x => x.id === p.id);
          await ensurePlantMessage(updated);

          // borrar el mensaje de alerta (spam)
          await deleteMessageIfPossible(interaction.message);

          logReg({ type: "plantacion_completada", at: now(), by: interaction.user.id, meta: { plantId: p.id, tipo: p.tipo } });

          return interaction.reply({ ephemeral: true, content: `✅ Plantación #${p.id} completada.` });
        }

        // cosecha -> regar / cosechar
        if (p.tipo === "cosecha") {
          if (p.completed) {
            await deleteMessageIfPossible(interaction.message);
            return interaction.reply({ ephemeral: true, content: "✅ Ya estaba completada." });
          }

          if (action === "regar") {
            if (now() < p.nextWaterAt) {
              return interaction.reply({ ephemeral: true, content: `Aún no toca. ${relTs(p.nextWaterAt)}` });
            }

            const newWaterAt = now() + REGAR_MS;
            const newWaterCount = (p.waterCount || 0) + 1;

            updatePlant({
              id: p.id,
              waterCount: newWaterCount,
              lastWaterBy: interaction.user.id,
              nextWaterAt: newWaterAt,
              alertedWater: false,
              alertMessageIdWater: null, // ✅ permitir nuevo mensaje en el próximo ciclo, pero no duplicar este
            });

            const updated = DB.plantaciones.find(x => x.id === p.id);
            await ensurePlantMessage(updated);

            await deleteMessageIfPossible(interaction.message);

            logReg({ type: "plantacion_regada", at: now(), by: interaction.user.id, meta: { plantId: p.id } });

            return interaction.reply({ ephemeral: true, content: `💧 Regada. Próximo riego: ${relTs(newWaterAt)}` });
          }

          if (action === "cosechar") {
            if (now() < p.nextHarvestAt) {
              return interaction.reply({ ephemeral: true, content: `Aún no toca. ${relTs(p.nextHarvestAt)}` });
            }

            const newCount = (p.harvestCount || 0) + 1;

            if (newCount >= MAX_COSECHAS) {
              updatePlant({
                id: p.id,
                harvestCount: newCount,
                lastHarvestBy: interaction.user.id,
                completed: true,
                completedAt: now(),
                alertedHarvest: true,
                alertedWater: true,
                alertMessageIdHarvest: null,
              });

              const updated = DB.plantaciones.find(x => x.id === p.id);
              await ensurePlantMessage(updated);

              await deleteMessageIfPossible(interaction.message);

              logReg({ type: "plantacion_completada", at: now(), by: interaction.user.id, meta: { plantId: p.id, tipo: p.tipo } });

              return interaction.reply({ ephemeral: true, content: `✅ Cosecha finalizada (3/3).` });
            }

            const newHarvestAt = now() + COSECHAR_MS;
            updatePlant({
              id: p.id,
              harvestCount: newCount,
              lastHarvestBy: interaction.user.id,
              nextHarvestAt: newHarvestAt,
              alertedHarvest: false,
              alertMessageIdHarvest: null,
            });

            const updated = DB.plantaciones.find(x => x.id === p.id);
            await ensurePlantMessage(updated);

            await deleteMessageIfPossible(interaction.message);

            logReg({ type: "plantacion_cosechada", at: now(), by: interaction.user.id, meta: { plantId: p.id, count: newCount } });

            return interaction.reply({ ephemeral: true, content: `🧺 Cosechada (${newCount}/${MAX_COSECHAS}). Próxima: ${relTs(newHarvestAt)}` });
          }
        }

        return;
      }

      // ===== Chester =====
      if (id.startsWith("chester_")) {
        const [, job, userId] = id.split("_");

        // solo dueño
        if (interaction.user.id !== userId) {
          return interaction.reply({ ephemeral: true, content: "🔒 Este panel es personal. Usá /chester para el tuyo." });
        }
        if (!CHESTER_JOBS.includes(job)) {
          return interaction.reply({ ephemeral: true, content: "Trabajo inválido." });
        }

        if (!DB.chester[userId]) DB.chester[userId] = {};
        const nextTs = DB.chester[userId][job] || 0;

        if (now() < nextTs) {
          return interaction.reply({ ephemeral: true, content: `⏳ Aún en cooldown. ${relTs(nextTs)}` });
        }

        const newTs = now() + CHESTER_CD_MS;
        DB.chester[userId][job] = newTs;
        DB.chester[userId][`${job}_notifiedTs`] = 0;
        saveJSON("chester.json", DB.chester);

        // guardar panel SIEMPRE (así aunque se toque de nuevo, conserva la info y edita el mismo)
        DB.chesterPanels[userId] = { channelId: interaction.channelId, messageId: interaction.message.id };
        saveJSON("chester_panels.json", DB.chesterPanels);

        logReg({ type: "chester_job", at: now(), by: interaction.user.id, meta: { job } });

        // update del mismo embed (no spam)
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

  // registrar comandos
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log("✅ Comandos registrados:", commands.map(c => c.name).join(", "));

  await client.login(TOKEN);
})();





