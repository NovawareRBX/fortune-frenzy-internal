export default {
	method: "GET",
	url: "/time",
	callback: async () => {
		return [200, Date.now()];
	},
};