const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Show a player profile (Hypixel or FakePixel)')
    .addStringOption(option =>
      option.setName('server')
        .setDescription('Which server API to query')
        .setRequired(true)
        .addChoices(
          { name: 'Hypixel', value: 'hypixel' },
          { name: 'FakePixel', value: 'fakepixel' }
        )
    )
    .addStringOption(option =>
      option.setName('player')
        .setDescription('Minecraft username of the player')
        .setRequired(true)
    ),

  async execute(interaction, client) {
    await interaction.deferReply();

    const serverChoice = interaction.options.getString('server');
    const playerName = interaction.options.getString('player');

    // Helper: convert cumulative XP -> level using an array of per-level XP requirements
    function xpToLevel(xp, levelReqs) {
      if (!Array.isArray(levelReqs) || levelReqs.length === 0) return 0;
      let cum = 0;
      for (let i = 0; i < levelReqs.length; i++) {
        cum += Number(levelReqs[i] || 0);
        if (xp < cum) return i + 1; // levels are 1-indexed
      }
      // Past max known levels: approximate extra levels by dividing by last requirement
      const last = Number(levelReqs[levelReqs.length - 1] || 1);
      return levelReqs.length + Math.floor((xp - cum) / Math.max(1, last)) + 1;
    }

    try {
      if (serverChoice === 'hypixel') {
        const HYPIXEL_KEY = process.env.HYPIXEL_API_KEY;
        if (!HYPIXEL_KEY) {
          return interaction.editReply({ content: '❌ Hypixel API key not set. Set process env `HYPIXEL_API_KEY`.' });
        }

        // 1) Get basic player & uuid via Hypixel /player endpoint
        const playerRes = await axios.get('https://api.hypixel.net/player', {
          params: { key: HYPIXEL_KEY, name: playerName }
        });
        if (!playerRes.data || !playerRes.data.player) {
          return interaction.editReply({ content: `❌ Could not find player **${playerName}** on Hypixel.` });
        }
        const displayName = playerRes.data.player.displayname || playerName;
        const uuid = playerRes.data.player.uuid || playerRes.data.player._id || null;

        // 2) Get SkyBlock profiles to read skill XP and dungeons (catacombs) XP
        const profilesRes = await axios.get('https://api.hypixel.net/skyblock/profiles', {
          params: { key: HYPIXEL_KEY, uuid }
        });
        const profiles = profilesRes.data?.profiles || [];
        if (!profiles.length) {
          // If no skyblock data, still show player name
          const embedNoSB = new EmbedBuilder()
            .setTitle(displayName)
            .setDescription('No SkyBlock profile found for this player.')
            .setColor('#FFCC00');
          return interaction.editReply({ embeds: [embedNoSB] });
        }

        // choose the profile with the most recent member last_save (best-effort)
        let chosenProfile = profiles[0];
        let bestSave = 0;
        for (const p of profiles) {
          const member = p.members?.[uuid];
          const last = (member?.last_save || member?.lastsave || 0);
          if (last > bestSave) { bestSave = last; chosenProfile = p; }
        }
        const member = chosenProfile.members?.[uuid] || {};

        // Grab XP fields (keys used by Hypixel SkyBlock profiles)
        const foragingXp = Number(member['experience_skill_foraging'] || 0);
        const combatXp = Number(member['experience_skill_combat'] || 0);
        // catacombs xp can be stored under the profile's dungeons object or under the member
        const catacombsXp =
          Number(member?.dungeons?.dungeon_types?.catacombs?.experience ||
                 chosenProfile?.dungeons?.dungeon_types?.catacombs?.experience ||
                 0);

        // 3) Fetch skill-level resource table (used to convert xp -> level)
        // Hypixel provides a resource endpoint with skill leveling data.
        let skillsResource = null;
        try {
          const skillsRes = await axios.get('https://api.hypixel.net/resources/skyblock/skills', {
            params: { key: HYPIXEL_KEY }
          });
          skillsResource = skillsRes.data;
        } catch (e) {
          // We'll try to continue — some servers or keys may restrict this endpoint.
          skillsResource = null;
        }

        // try to extract per-level arrays for foraging/combat from the resource payload
        function getLevelReqsFromResources(skillKey) {
          if (!skillsResource) return null;
          // Hypixel resources structure varies, try common locations:
          return skillsResource?.skills?.[skillKey]?.levels ||
                 skillsResource?.[skillKey]?.levels ||
                 skillsResource?.levels?.[skillKey] ||
                 null;
        }

        let foragingLevel = 0, combatLevel = 0, catacombsLevel = 0;

        // compute foraging & combat levels if we have resource tables
        const foragingReqs = getLevelReqsFromResources('foraging');
        const combatReqs = getLevelReqsFromResources('combat');

        if (foragingReqs) foragingLevel = xpToLevel(foragingXp, foragingReqs);
        if (combatReqs) combatLevel = xpToLevel(combatXp, combatReqs);

        // For catacombs leveling: some resource endpoints do not include dungeons/cata tables.
        // We'll try the NEU leveling JSON as a fallback (public raw file) if needed.
        if (catacombsXp) {
          // try resources first
          const cataReqs = getLevelReqsFromResources('catacombs') || getLevelReqsFromResources('dungeons') || null;
          let usedCataReqs = cataReqs;

          if (!usedCataReqs) {
            // fallback: try raw NotEnoughUpdates leveling.json (contains 'catacombs' table)
            try {
              const neuUrl = 'https://raw.githubusercontent.com/NotEnoughUpdates/NotEnoughUpdates-REPO/master/constants/leveling.json';
              const neuRes = await axios.get(neuUrl);
              usedCataReqs = neuRes.data?.catacombs || neuRes.data?.dungeons?.catacombs || null;
            } catch (e) {
              usedCataReqs = null;
            }
          }

          if (usedCataReqs) {
            catacombsLevel = xpToLevel(catacombsXp, usedCataReqs);
          } else {
            // fallback: if we can't find tables, we still show raw XP and mark level unknown
            catacombsLevel = 0;
          }
        }

        // If resource tables were missing, fallback: try a simple heuristic (show XP -> level unknown)
        const embed = new EmbedBuilder()
          .setTitle(`${displayName} — Hypixel`)
          .setColor('#00AAFF')
          .addFields(
            { name: 'Player', value: `${displayName}`, inline: true },
            { name: 'Foraging', value: foragingLevel ? `${foragingLevel}` : `${foragingXp} XP (level unknown)`, inline: true },
            { name: 'Combat', value: combatLevel ? `${combatLevel}` : `${combatXp} XP (level unknown)`, inline: true },
            { name: 'Catacombs (Dungeons)', value: catacombsLevel ? `${catacombsLevel}` : `${catacombsXp} XP (level unknown)`, inline: false }
          )
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      }

      // ===== FakePixel branch (stub) =====
      if (serverChoice === 'fakepixel') {
        const FAKEPIXEL_API = process.env.FAKEPIXEL_API_URL; // e.g. https://api.fakepixel.example
        if (!FAKEPIXEL_API) {
          return interaction.editReply({ content: '❌ FakePixel API URL not configured. Set process env `FAKEPIXEL_API_URL` to the base endpoint.' });
        }

        // Example: attempt to call a hypothetical endpoint:
        // GET `${FAKEPIXEL_API}/player?name=${playerName}`
        // Adapt this to the actual FakePixel API you have (keys, fields, etc.)
        try {
          const res = await axios.get(`${FAKEPIXEL_API}/player`, { params: { name: playerName } });
          const data = res.data;
          // adjust field names to match the actual response you get from your FakePixel API
          const displayName = data?.username || data?.name || playerName;
          const cata = data?.catacombs_level || data?.dungeons?.catacombs || 'N/A';
          const skill = data?.combat_level || data?.skill_level || 'N/A';
          const foraging = data?.foraging_level || data?.skills?.foraging || 'N/A';

          const embed = new EmbedBuilder()
            .setTitle(`${displayName} — FakePixel`)
            .addFields(
              { name: 'Player', value: `${displayName}`, inline: true },
              { name: 'Catacombs', value: `${cata}`, inline: true },
              { name: 'Skill', value: `${skill}`, inline: true },
              { name: 'Foraging', value: `${foraging}`, inline: true }
            )
            .setColor('#FF66AA');

          return interaction.editReply({ embeds: [embed] });
        } catch (err) {
          console.error('FakePixel fetch error:', err?.response?.data || err.message || err);
          return interaction.editReply({ content: '❌ Error fetching FakePixel data — check your FAKEPIXEL_API_URL and response format.' });
        }
      }

      return interaction.editReply({ content: '❌ Unknown server choice.' });
    } catch (error) {
      console.error('Profile command error:', error);
      return interaction.editReply({ content: '❌ An error occurred while fetching profile.' });
    }
  }
};
