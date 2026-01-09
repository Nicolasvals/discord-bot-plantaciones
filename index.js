require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionsBitField,
} = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// =====================
// CONFIG
// =====================
const TZ = "America/Argentina/Buenos_Aires";

// Plantaciones
const T_REGAR = 2 * 60 * 60 * 1000 + 40 * 60 * 1000; // 2h40m
const T_COSECHAR = 3 * 60 * 60 * 1000;               // 3h
const T_DUPLICAR = 3 * 60 * 60 * 1000;               // 3h (1 sola vez)

// Chester
const T_CHESTER = 24 * 60 * 60 * 1000;               // 24h

// Tienda
const T_TIENDA_SOLO  = 5 * 60 * 60 * 1000;           // 5h
const T_TIENDA_GRUPO = 2 * 60 * 60 * 1000;           // 2h
const TIENDA_RESETS = new Set(["00:00", "08:00", "16:00"]); // AR

// Ping plantaciones
const PLANT_PING = "@everyone"; // o "@here"

// =====================
// DATA (en memoria)
// =====================
let plantaciones = [];   // activas
let registro = [];       // registro global (todo)
let chesterTasks = [];   // { userId, userTag, job, channelId, dueAt, notified }
let tiendaTasks = [];    // { userId, userTag, mode, channelId, dueAt, notified }

const CHESTER_JOBS = [
  "molotov",
  "parking",
  "ventanillas",
  "ruedas",
  "grafitis",
  "peleas",
  "transporte",
  "coche",
];

let lastTiendaResetKey = ""; // evita reset doble en el mismo minuto

// =====================
// UTILS
// =====================
function now() {
  return Date.now();
}

function fechaAR() {
  return new Date().toLocaleString("es-AR", { timeZone: TZ });
}

function hmAR() {
  const parts = new Intl.DateTimeFormat("es-AR", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const h = parts.find(p => p.type === "hour")?.value ?? "00";
  const m = parts.find(p => p.type === "minute")?.value ?? "00";
  return `${h}:${m}`;
}

function msToHM(ms) {
  const t = Math.max(0, ms);
  const h = Math.floor(t / 3600000);
  const m = Math.floor((t % 3600000) / 60000);
  return `${h}h ${m}m`;
}

function id() {
  return `${Date.now()}_${Math.floor(Math.random() * 999999)}`;
}

function niceTitle(tipo) {
  return tipo === "duplicar" ? "🌿 Plantación (Duplicar semillas)" : "🌱 Plantación (Cosecha)";
}

function addLog(line) {
  // Para que no se vaya infinito, recortamos a 400 entradas (ajustable)
  registro.push(line);
  if (registro.length > 400) registro = registro.slice(-400);
}

function buildPlantEmbed(p, extra = {}) {
  const e = new EmbedBuilder()
    .setTitle(niceTitle(p.tipo))
    .setColor(p.tipo === "duplicar" ? 0x7CFF6B : 0x00FFB2)
    .setDescription(`**📝 Descripción:** ${p.descripcion || "Sin descripción"}`)
    .addFields(
      { name: "📦 Tipo", value: p.tipo === "duplicar" ? "Duplicar" : "Cosecha", inline: true },
      { name: "🆔 ID", value: `\`${p.id}\``, inline: true },
    )
    .setFooter({ text: extra.footer || "Sistema de timers" })
    .setTimestamp();

  if (p.tipo === "cosecha") {
    e.addFields(
      { name: "🌾 Cosechas", value: `${p.cosechas}/3`, inline: true }
    );
  }

  return e;
}

function buildAlertEmbed(title, desc, color) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(desc)
    .setColor(color)
    .setFooter({ text: "Respondé con el botón para registrar la acción" })
    .setTimestamp();
}

// =====================
// SLASH COMMANDS
// =====================
const comandos = [
  new SlashCommandBuilder()
    .setName("plantacion")
    .setDescription("Crear una plantación (cosecha o duplicar)")
    .addStringOption(o =>
      o.setName("tipo")
        .setDescription("Tipo de plantación")
        .setRequired(true)
        .addChoices(
          { name: "Cosecha", value: "cosecha" },
          { name: "Duplicar semillas", value: "duplicar" }
        )
    )
    .addStringOption(o =>
      o.setName("descripcion")
        .setDescription("Descripción (opcional)")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("plantaciones")
    .setDescription("Ver plantaciones activas (#1 #2 #3...)"),

  new SlashCommandBuilder()
    .setName("borrarplantacion")
    .setDescription("Borrar una plantación por número (#1 #2 #3...)")
    .addIntegerOption(o =>
      o.setName("numero")
        .setDescription("Número de la lista (ej: 1)")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("registro")
    .setDescription("Ver registro completo (ADMIN)"),

  new SlashCommandBuilder()
    .setName("chester")
    .setDescription("Panel de trabajos de Chester (CD 24h)"),

  new SlashCommandBuilder()
    .setName("tienda")
    .setDescription("CD de robos de tienda (solo/grupo)")
    .addStringOption(o =>
      o.setName("modo")
        .setDescription("Modo del robo")
        .setRequired(true)
        .addChoices(
          { name: "Solo (5h)", value: "solo" },
          { name: "Grupo (2h)", value: "grupo" }
        )
    ),
];

// =====================
// REGISTER COMMANDS
// =====================
const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: comandos.map(c => c.toJSON()) }
  );
  console.log("✅ Comandos registrados");
})();

// =====================
// READY
// =====================
client.once("ready", () => {
  console.log(`🤖 Bot listo: ${client.user.tag}`);
});

// =====================
// INTERACTIONS - COMMANDS
// =====================
client.on("interactionCreate", async (i) => {
  if (!i.isChatInputCommand()) return;

  // -------- /plantacion --------
  if (i.commandName === "plantacion") {
    const tipo = i.options.getString("tipo");
    const descripcion = i.options.getString("descripcion") || "Sin descripción";

    const p = {
      id: id(),
      tipo,
      descripcion,
      canalId: i.channelId,

      creada: now(),

      // para cosecha
      ultimaRegada: now(),
      ultimaCosecha: now(),
      cosechas: 0,

      // flags de aviso (para no spamear cada minuto)
      avisoRegar: false,
      avisoCosechar: false,
      avisoDuplicar: false,
    };

    plantaciones.push(p);

    addLog(`🆕 PLANTACIÓN | ${tipo.toUpperCase()} | "${descripcion}" | por ${i.user.tag} | ${fechaAR()}`);

    // IMPORTANTE: NO botones acá
    const embed = buildPlantEmbed(p, { footer: "Creada ✅ (los botones aparecen solo cuando toque)" });

    return i.reply({
      embeds: [embed],
      ephemeral: false,
    });
  }

  // -------- /plantaciones --------
  if (i.commandName === "plantaciones") {
    if (plantaciones.length === 0) {
      return i.reply({ content: "📭 No hay plantaciones activas.", ephemeral: true });
    }

    const e = new EmbedBuilder()
      .setTitle("📋 Plantaciones activas")
      .setColor(0x6AA9FF)
      .setFooter({ text: "Usá /borrarplantacion numero:X para eliminar una" })
      .setTimestamp();

    const t = now();

    plantaciones.forEach((p, idx) => {
      if (p.tipo === "duplicar") {
        const falta = T_DUPLICAR - (t - p.creada);
        e.addFields({
          name: `#${idx + 1} — 🌿 Duplicar`,
          value: `📝 ${p.descripcion}\n⏳ Cultivar en: **${msToHM(falta)}**`,
        });
      } else {
        const faltaRegar = T_REGAR - (t - p.ultimaRegada);
        const faltaCosechar = T_COSECHAR - (t - p.ultimaCosecha);
        e.addFields({
          name: `#${idx + 1} — 🌱 Cosecha`,
          value:
            `📝 ${p.descripcion}\n` +
            `💧 Regar en: **${msToHM(faltaRegar)}**\n` +
            `🌾 Cosechar en: **${msToHM(faltaCosechar)}**\n` +
            `🌾 Cortes: **${p.cosechas}/3**`,
        });
      }
    });

    return i.reply({ embeds: [e], ephemeral: false });
  }

  // -------- /borrarplantacion --------
  if (i.commandName === "borrarplantacion") {
    const n = i.options.getInteger("numero") - 1;

    if (!plantaciones[n]) {
      return i.reply({ content: "❌ Número inválido.", ephemeral: true });
    }

    const p = plantaciones[n];
    plantaciones.splice(n, 1);

    addLog(`🗑️ PLANTACIÓN BORRADA | ${p.tipo.toUpperCase()} | "${p.descripcion}" | por ${i.user.tag} | ${fechaAR()}`);

    const e = buildAlertEmbed(
      "🗑️ Plantación eliminada",
      `Se eliminó: **${p.descripcion}** (${p.tipo})`,
      0xFF6B6B
    );

    return i.reply({ embeds: [e], ephemeral: false });
  }

  // -------- /registro (ADMIN) --------
  if (i.commandName === "registro") {
    if (!i.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return i.reply({ content: "❌ Solo administradores.", ephemeral: true });
    }

    if (registro.length === 0) {
      return i.reply({ content: "📭 No hay registros.", ephemeral: true });
    }

    const lines = registro.slice(-120); // últimas 120 entradas

    const e = new EmbedBuilder()
      .setTitle("📜 Registro completo")
      .setColor(0xFFD166)
      .setDescription(lines.join("\n"))
      .setFooter({ text: `Mostrando las últimas ${lines.length} entradas` })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("reg_clear")
        .setLabel("🗑️ Borrar registro")
        .setStyle(ButtonStyle.Danger)
    );

    return i.reply({ embeds: [e], components: [row], ephemeral: false });
  }

  // -------- /chester --------
  if (i.commandName === "chester") {
    const e = new EmbedBuilder()
      .setTitle("🧰 Chester — Trabajos (CD 24h)")
      .setDescription("Tocá un trabajo para iniciar el cooldown. Cuando esté listo, te taggeo solo a vos.")
      .setColor(0x8A6CFF)
      .setFooter({ text: "Cooldown por usuario y por trabajo" })
      .setTimestamp();

    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("ch_molotov").setLabel("molotov").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("ch_parking").setLabel("parking").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("ch_ventanillas").setLabel("ventanillas").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("ch_ruedas").setLabel("ruedas").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("ch_grafitis").setLabel("grafitis").setStyle(ButtonStyle.Secondary),
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("ch_peleas").setLabel("peleas").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("ch_transporte").setLabel("transporte").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("ch_coche").setLabel("coche").setStyle(ButtonStyle.Secondary),
    );

    return i.reply({ embeds: [e], components: [row1, row2], ephemeral: false });
  }

  // -------- /tienda --------
  if (i.commandName === "tienda") {
    const modo = i.options.getString("modo"); // solo/grupo
    const t = now();

    let task = tiendaTasks.find(x => x.userId === i.user.id);

    // Si está activo el CD
    if (task && task.dueAt > t) {
      const falta = task.dueAt - t;
      const e = buildAlertEmbed(
        "🏪 Tienda en cooldown",
        `⏳ Te falta **${msToHM(falta)}** para poder robar tienda de nuevo.`,
        0xFFB703
      );
      return i.reply({ embeds: [e], ephemeral: true });
    }

    const dur = (modo === "grupo") ? T_TIENDA_GRUPO : T_TIENDA_SOLO;
    const dueAt = t + dur;

    if (!task) {
      task = { userId: i.user.id, userTag: i.user.tag, mode: modo, channelId: i.channelId, dueAt, notified: false };
      tiendaTasks.push(task);
    } else {
      task.mode = modo;
      task.channelId = i.channelId;
      task.dueAt = dueAt;
      task.notified = false;
    }

    addLog(`🏪 TIENDA START | modo=${modo.toUpperCase()} | por ${i.user.tag} | ${fechaAR()}`);

    const e = new EmbedBuilder()
      .setTitle("🏪 Tienda iniciada")
      .setColor(0x06D6A0)
      .setDescription(
        `✅ Listo, **${modo}**.\n` +
        `Te aviso cuando puedas hacerlo de nuevo.\n` +
        `⏳ Cooldown: **${msToHM(dur)}**`
      )
      .setTimestamp();

    return i.reply({ embeds: [e], ephemeral: true });
  }
});

// =====================
// INTERACTIONS - BUTTONS
// =====================
client.on("interactionCreate", async (i) => {
  if (!i.isButton()) return;

  // -------- limpiar registro (ADMIN) --------
  if (i.customId === "reg_clear") {
    if (!i.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return i.reply({ content: "❌ Solo administradores.", ephemeral: true });
    }
    registro = [];
    return i.update({ content: "🗑️ Registro eliminado.", embeds: [], components: [] });
  }

  // -------- Chester buttons --------
  if (i.customId.startsWith("ch_")) {
    const job = i.customId.replace("ch_", "").trim();
    if (!CHESTER_JOBS.includes(job)) return i.reply({ content: "❌ Trabajo inválido.", ephemeral: true });

    const t = now();
    let task = chesterTasks.find(x => x.userId === i.user.id && x.job === job);

    if (task && task.dueAt > t) {
      const falta = task.dueAt - t;
      const e = buildAlertEmbed("🧰 Chester", `⏳ Te falta **${msToHM(falta)}** para **${job}**.`, 0x9B5DE5);
      return i.reply({ embeds: [e], ephemeral: true });
    }

    if (!task) {
      task = { userId: i.user.id, userTag: i.user.tag, job, channelId: i.channelId, dueAt: t + T_CHESTER, notified: false };
      chesterTasks.push(task);
    } else {
      task.channelId = i.channelId;
      task.dueAt = t + T_CHESTER;
      task.notified = false;
    }

    addLog(`🧰 CHESTER START | ${job} | por ${i.user.tag} | ${fechaAR()}`);

    const e = new EmbedBuilder()
      .setTitle("🧰 Chester — Cooldown iniciado")
      .setColor(0x8A6CFF)
      .setDescription(`✅ Trabajo: **${job}**\n⏳ Te aviso en **24 horas**.`)
      .setTimestamp();

    return i.reply({ embeds: [e], ephemeral: true });
  }

  // -------- Plantación: regar / cosechar / cultivar --------
  if (i.customId.startsWith("pl_")) {
    const parts = i.customId.split("_"); // pl_{action}_{id}
    const action = parts[1];
    const pid = parts.slice(2).join("_");

    const p = plantaciones.find(x => x.id === pid);
    if (!p) return i.reply({ content: "❌ Esa plantación ya no existe.", ephemeral: true });

    const t = now();

    // Cultivar (duplicar) -> elimina
    if (action === "cultivar") {
      if (p.tipo !== "duplicar") return i.reply({ content: "❌ Acción inválida.", ephemeral: true });

      plantaciones = plantaciones.filter(x => x.id !== p.id);
      addLog(`🌿 CULTIVADA (DUPLICAR) | "${p.descripcion}" | por ${i.user.tag} | ${fechaAR()}`);

      const e = new EmbedBuilder()
        .setTitle("🌿 Cultivo realizado")
        .setColor(0x7CFF6B)
        .setDescription(`✅ **${i.user.tag}** cultivó: **${p.descripcion}**\n🧾 La plantación fue eliminada.`)
        .setTimestamp();

      // editamos el mensaje del aviso para quitar el botón
      try { await i.update({ embeds: [e], components: [] }); } catch { /* ignore */ }
      return;
    }

    // Regar
    if (action === "regar") {
      if (p.tipo !== "cosecha") return i.reply({ content: "❌ Acción inválida.", ephemeral: true });

      p.ultimaRegada = t;
      p.avisoRegar = false;

      addLog(`💧 REGADA | "${p.descripcion}" | por ${i.user.tag} | ${fechaAR()}`);

      const e = new EmbedBuilder()
        .setTitle("💧 Riego registrado")
        .setColor(0x4CC9F0)
        .setDescription(`✅ **${i.user.tag}** regó: **${p.descripcion}**`)
        .addFields({ name: "Próximo riego", value: `En **${msToHM(T_REGAR)}**`, inline: true })
        .setTimestamp();

      try { await i.update({ embeds: [e], components: [] }); } catch { /* ignore */ }
      return;
    }

    // Cosechar
    if (action === "cosechar") {
      if (p.tipo !== "cosecha") return i.reply({ content: "❌ Acción inválida.", ephemeral: true });

      p.ultimaCosecha = t;
      p.avisoCosechar = false;
      p.cosechas++;

      addLog(`🌾 COSECHADA | "${p.descripcion}" | por ${i.user.tag} | ${fechaAR()} (${p.cosechas}/3)`);

      if (p.cosechas >= 3) {
        plantaciones = plantaciones.filter(x => x.id !== p.id);
        addLog(`❌ PLANTA DESAPARECE | "${p.descripcion}" | auto (3/3) | ${fechaAR()}`);

        const e = new EmbedBuilder()
          .setTitle("🌾 Cosecha final (3/3)")
          .setColor(0xFF6B6B)
          .setDescription(`✅ **${i.user.tag}** hizo la **3ª cosecha** de: **${p.descripcion}**\n🧾 La planta desapareció.`)
          .setTimestamp();

        try { await i.update({ embeds: [e], components: [] }); } catch { /* ignore */ }
        return;
      }

      const e = new EmbedBuilder()
        .setTitle("🌾 Cosecha registrada")
        .setColor(0xF4A261)
        .setDescription(`✅ **${i.user.tag}** cosechó: **${p.descripcion}**`)
        .addFields(
          { name: "Cortes", value: `**${p.cosechas}/3**`, inline: true },
          { name: "Próxima cosecha", value: `En **${msToHM(T_COSECHAR)}**`, inline: true }
        )
        .setTimestamp();

      try { await i.update({ embeds: [e], components: [] }); } catch { /* ignore */ }
      return;
    }
  }
});

// =====================
// LOOP: ALERTAS + RESETS
// =====================
setInterval(async () => {
  const t = now();

  // ---- Reset CD tienda por horarios AR (simula reinicios) ----
  const hm = hmAR(); // "HH:MM"
  if (TIENDA_RESETS.has(hm)) {
    const key = `${hm}_${new Date().toLocaleDateString("es-AR", { timeZone: TZ })}`;
    if (lastTiendaResetKey !== key) {
      lastTiendaResetKey = key;
      if (tiendaTasks.length > 0) {
        tiendaTasks = [];
        addLog(`♻️ RESET TIENDA | Limpieza automática por horario (${hm} AR) | ${fechaAR()}`);
      }
    }
  }

  // ---- Plantaciones ----
  for (const p of plantaciones) {
    let canal;
    try {
      canal = await client.channels.fetch(p.canalId);
    } catch {
      continue;
    }

    // Duplicar -> aviso a las 3h con botón cultivar
    if (p.tipo === "duplicar") {
      if (!p.avisoDuplicar && (t - p.creada) >= T_DUPLICAR) {
        p.avisoDuplicar = true;

        const embed = buildAlertEmbed(
          "🌿 ¡Listo para cultivar!",
          `**${p.descripcion}**\n\n👉 Tocá el botón para registrar quién lo hizo y eliminar la plantación.`,
          0x7CFF6B
        );

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`pl_cultivar_${p.id}`)
            .setLabel("🌿 Cultivar")
            .setStyle(ButtonStyle.Success)
        );

        canal.send({
          content: `${PLANT_PING} 🌿 **Duplicar listo:** ${p.descripcion}`,
          embeds: [embed],
          components: [row],
        });

        addLog(`🌿 DUPLICAR LISTO | "${p.descripcion}" | aviso enviado | ${fechaAR()}`);
      }
      continue;
    }

    // Cosecha -> aviso regar
    if (p.tipo === "cosecha") {
      if (!p.avisoRegar && (t - p.ultimaRegada) >= T_REGAR) {
        p.avisoRegar = true;

        const embed = buildAlertEmbed(
          "💧 ¡Hay que regar!",
          `**${p.descripcion}**\n\n⏳ Último riego: ${msToHM(t - p.ultimaRegada)} atrás`,
          0x4CC9F0
        );

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`pl_regar_${p.id}`)
            .setLabel("💧 Regar")
            .setStyle(ButtonStyle.Primary)
        );

        canal.send({
          content: `${PLANT_PING} 💧 **Regar:** ${p.descripcion}`,
          embeds: [embed],
          components: [row],
        });

        addLog(`💧 AVISO REGAR | "${p.descripcion}" | enviado | ${fechaAR()}`);
      }

      // Cosecha -> aviso cosechar
      if (!p.avisoCosechar && (t - p.ultimaCosecha) >= T_COSECHAR) {
        p.avisoCosechar = true;

        const embed = buildAlertEmbed(
          "🌾 ¡Hay que cosechar!",
          `**${p.descripcion}**\n\n🌾 Cortes actuales: **${p.cosechas}/3**`,
          0xF4A261
        );

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`pl_cosechar_${p.id}`)
            .setLabel("🌾 Cosechar")
            .setStyle(ButtonStyle.Success)
        );

        canal.send({
          content: `${PLANT_PING} 🌾 **Cosechar:** ${p.descripcion}`,
          embeds: [embed],
          components: [row],
        });

        addLog(`🌾 AVISO COSECHAR | "${p.descripcion}" | enviado | ${fechaAR()}`);
      }
    }
  }

  // ---- Chester: avisos al usuario cuando se cumple ----
  for (const task of chesterTasks) {
    if (!task.notified && t >= task.dueAt) {
      task.notified = true;
      let canal;
      try {
        canal = await client.channels.fetch(task.channelId);
      } catch {
        continue;
      }

      const e = new EmbedBuilder()
        .setTitle("🧰 Chester — Listo")
        .setColor(0x8A6CFF)
        .setDescription(`✅ <@${task.userId}> ya podés hacer de nuevo: **${task.job}**`)
        .setTimestamp();

      canal.send({ content: `<@${task.userId}>`, embeds: [e] });
      addLog(`🧰 CHESTER READY | ${task.job} | para ${task.userTag} | ${fechaAR()}`);
    }
  }

  // ---- Tienda: avisos al usuario cuando se cumple ----
  for (const task of tiendaTasks) {
    if (!task.notified && t >= task.dueAt) {
      task.notified = true;
      let canal;
      try {
        canal = await client.channels.fetch(task.channelId);
      } catch {
        continue;
      }

      const e = new EmbedBuilder()
        .setTitle("🏪 Tienda — Cooldown terminado")
        .setColor(0x06D6A0)
        .setDescription(`✅ <@${task.userId}> ya podés robar tienda de nuevo.`)
        .addFields({ name: "Modo anterior", value: task.mode.toUpperCase(), inline: true })
        .setTimestamp();

      canal.send({ content: `<@${task.userId}>`, embeds: [e] });
      addLog(`🏪 TIENDA READY | modo=${task.mode.toUpperCase()} | para ${task.userTag} | ${fechaAR()}`);
    }
  }
}, 60 * 1000);

// =====================
// LOGIN
// =====================
client.login(process.env.TOKEN);
