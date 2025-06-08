import { CaseBattleData } from "../../service/casebattles-redis";
import { randomNumber } from "../secureRandomness";

export default function randomizerModeHandler(current: CaseBattleData) {
	const sortedPlayers = [...current.players].sort((a, b) => a.position - b.position);
	const teamSizes = current.team_mode.split("v").map(Number);
	
	let i = 0;
	const teams = teamSizes.map((size) => sortedPlayers.slice(i, (i += size)));
	const totalValue = current.players.reduce((acc, player) => acc + current.player_pulls[player.id].total_value, 0);
	const winningTeam = teams[randomNumber(0, teams.length - 1, `${current.server_seed}-${current.started_at}`)];
    
	return winningTeam.map((player) => ({
		player_id: player.id,
		amount_won: Math.floor(totalValue / winningTeam.length),
	}));
}
