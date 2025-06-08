import { CaseBattleData } from "../../service/casebattles-redis";

export default function groupModeHandler(current: CaseBattleData) {
	const total = current.players.reduce((acc, player) => acc + current.player_pulls[player.id].total_value, 0);
	return current.players.map((player) => ({
		player_id: player.id,
		amount_won: Math.floor(total / current.players.length),
	}));
}
