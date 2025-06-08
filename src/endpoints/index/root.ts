export default {
	method: "GET",
	url: "/",
	authType: "none",
	callback: async function(): Promise<[number, any]> {
		return [200, { status: "OK" }];
	}
};
