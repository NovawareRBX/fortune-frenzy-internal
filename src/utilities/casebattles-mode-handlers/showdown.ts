import { CaseBattleData } from "../../service/casebattles-redis";

export default function showdownModeHandler(current: CaseBattleData) {
	const sortedPlayers = [...current.players].sort((a, b) => a.position - b.position);
	const teamSizes = current.team_mode.split("v").map(Number);

	let i = 0;
	const teams = teamSizes.map((size) => sortedPlayers.slice(i, (i += size)));
	const totalValue = current.players.reduce((acc, player) => acc + current.player_pulls[player.id].total_value, 0);

	const getLastPullValue = (playerId: string): number => {
		const pulls = current.player_pulls[playerId]?.items;
		return pulls?.length ? pulls[pulls.length - 1].value : 0;
	};

	const winningTeam = teams.reduce((bestTeam, contenderTeam) => {
		const contenderBest = contenderTeam.reduce((best, player) => {
			const a = getLastPullValue(player.id);
			const b = getLastPullValue(best.id);
			return current.crazy ? (a < b ? player : best) : a > b ? player : best;
		}, contenderTeam[0]);

		const bestTeamBest = bestTeam.reduce((best, player) => {
			const a = getLastPullValue(player.id);
			const b = getLastPullValue(best.id);
			return current.crazy ? (a < b ? player : best) : a > b ? player : best;
		}, bestTeam[0]);

		const contenderValue = getLastPullValue(contenderBest.id);
		const bestTeamValue = getLastPullValue(bestTeamBest.id);

		return current.crazy
			? contenderValue < bestTeamValue
				? contenderTeam
				: bestTeam
			: contenderValue > bestTeamValue
			? contenderTeam
			: bestTeam;
	}, teams[0]);

	return winningTeam.map((player) => ({
		player_id: player.id,
		amount_won: Math.floor(totalValue / winningTeam.length),
	}));
}
