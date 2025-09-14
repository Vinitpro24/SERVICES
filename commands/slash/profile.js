const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const PlayerData = require('../../models/PlayerData');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('viewplayerdata')
    .setDescription('View a player’s registered data')
    .addStringOption(option =>
      option.setName('username')
        .setDescription('The player username to view')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const username = interaction.options.getString('username');

    try {
      const player = await PlayerData.findOne({ username });

      if (!player) {
        return interaction.editReply({
          content: `❌ No data found for **${username}**. They need to register first with /uploadplayerdata.`
        });
      }

      const embed = new EmbedBuilder()
        .setTitle(`📜 Profile: ${player.username}`)
        .setColor('#FFD700')
        .addFields(
          { name: 'Combat', value: `${player.skills.combat}`, inline: true },
          { name: 'Foraging', value: `${player.skills.foraging}`, inline: true },
          { name: 'Mining', value: `${player.skills.mining}`, inline: true },
          { name: 'Farming', value: `${player.skills.farming}`, inline: true },
          { name: 'Catacombs', value: `${player.catacombs}`, inline: true }
        )
        .setFooter({ text: `Last updated: ${player.updatedAt.toLocaleString()}` });

      return interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('ViewPlayerData error:', error);
      return interaction.editReply({
        content: '❌ An error occurred while fetching player data.'
      });
    }
  }
};
