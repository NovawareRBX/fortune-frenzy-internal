import { CaseBattleData } from "../../service/casebattles-redis";

export default function standardModeHandler(current: CaseBattleData) {
	const sortedPlayers = [...current.players].sort((a, b) => a.position - b.position);
	const teamSizes = current.team_mode.split("v").map(Number);

	let i = 0;
	const teams = teamSizes.map((size) => sortedPlayers.slice(i, (i += size)));
	const totalValue = current.players.reduce((acc, player) => acc + current.player_pulls[player.id].total_value, 0);
	const teamValues = teams.map((team) =>
		team.reduce((acc, player) => acc + current.player_pulls[player.id].total_value, 0),
	);
	const bestValue = current.crazy ? Math.min(...teamValues) : Math.max(...teamValues);
	const candidateTeams = teams.filter((_, idx) => teamValues[idx] === bestValue);
	const winningTeam = candidateTeams[Math.floor(Math.random() * candidateTeams.length)];

	return winningTeam.map((player) => ({
		player_id: player.id,
		amount_won: Math.floor(totalValue / winningTeam.length),
	}));
}
