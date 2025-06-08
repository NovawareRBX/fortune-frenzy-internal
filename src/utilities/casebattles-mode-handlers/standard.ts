import { CaseBattleData } from "../../service/casebattles-redis";

export default function standardModeHandler(current: CaseBattleData) {
	const sortedPlayers = [...current.players].sort((a, b) => a.position - b.position);
	const teamSizes = current.team_mode.split("v").map(Number);

	let i = 0;
	const teams = teamSizes.map((size) => sortedPlayers.slice(i, (i += size)));
	const totalValue = current.players.reduce((acc, player) => acc + current.player_pulls[player.id].total_value, 0);

	const winningTeam = teams.reduce((maxTeam, currentTeam) => {
		const currentTeamValue = currentTeam.reduce(
			(acc, player) => acc + current.player_pulls[player.id].total_value,
			0,
		);
		const maxTeamValue = maxTeam.reduce((acc, player) => acc + current.player_pulls[player.id].total_value, 0);
		return current.crazy
			? currentTeamValue < maxTeamValue
				? currentTeam
				: maxTeam
			: currentTeamValue > maxTeamValue
			? currentTeam
			: maxTeam;
	}, teams[0]);

	return winningTeam.map((player) => ({
		player_id: player.id,
		amount_won: Math.floor(totalValue / winningTeam.length),
	}));
}
