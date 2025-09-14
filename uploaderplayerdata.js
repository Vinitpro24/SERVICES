const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const PlayerData = require('../../models/PlayerData');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('uploadplayerdata')
    .setDescription('Register or update your player data')
    .addStringOption(option =>
      option.setName('username')
        .setDescription('Your in-game username')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('password')
        .setDescription('Set a password (for updates)')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('combat')
        .setDescription('Combat level')
    )
    .addIntegerOption(option =>
      option.setName('foraging')
        .setDescription('Foraging level')
    )
    .addIntegerOption(option =>
      option.setName('mining')
        .setDescription('Mining level')
    )
    .addIntegerOption(option =>
      option.setName('farming')
        .setDescription('Farming level')
    )
    .addIntegerOption(option =>
      option.setName('catacombs')
        .setDescription('Catacombs level')
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const username = interaction.options.getString('username');
    const password = interaction.options.getString('password');
    const combat = interaction.options.getInteger('combat') ?? 0;
    const foraging = interaction.options.getInteger('foraging') ?? 0;
    const mining = interaction.options.getInteger('mining') ?? 0;
    const farming = interaction.options.getInteger('farming') ?? 0;
    const catacombs = interaction.options.getInteger('catacombs') ?? 0;

    try {
      const existing = await PlayerData.findOne({ username });

      if (!existing) {
        // New registration
        const newData = new PlayerData({
          username,
          password, // in production, hash this with bcrypt
          skills: { combat, foraging, mining, farming },
          catacombs
        });

        await newData.save();

        const embed = new EmbedBuilder()
          .setTitle('✅ Player Registered')
          .setDescription(`Player **${username}** registered successfully.`)
          .addFields(
            { name: 'Combat', value: `${combat}`, inline: true },
            { name: 'Foraging', value: `${foraging}`, inline: true },
            { name: 'Mining', value: `${mining}`, inline: true },
            { name: 'Farming', value: `${farming}`, inline: true },
            { name: 'Catacombs', value: `${catacombs}`, inline: true }
          )
          .setColor('#00FF00');

        return interaction.editReply({ embeds: [embed] });

      } else {
        // Updating existing data -> check password
        if (existing.password !== password) {
          return interaction.editReply({ content: '❌ Incorrect password! You cannot update this profile.' });
        }

        existing.skills = { combat, foraging, mining, farming };
        existing.catacombs = catacombs;
        existing.updatedAt = Date.now();

        await existing.save();

        const embed = new EmbedBuilder()
          .setTitle('🔄 Player Data Updated')
          .setDescription(`Player **${username}** updated successfully.`)
          .addFields(
            { name: 'Combat', value: `${combat}`, inline: true },
            { name: 'Foraging', value: `${foraging}`, inline: true },
            { name: 'Mining', value: `${mining}`, inline: true },
            { name: 'Farming', value: `${farming}`, inline: true },
            { name: 'Catacombs', value: `${catacombs}`, inline: true }
          )
          .setColor('#00AAFF');

        return interaction.editReply({ embeds: [embed] });
      }

    } catch (error) {
      console.error('UploadPlayerData error:', error);
      return interaction.editReply({ content: '❌ An error occurred while saving player data.' });
    }
  }
};
