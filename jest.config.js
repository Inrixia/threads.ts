// eslint-disable-next-line @typescript-eslint/no-var-requires
const { defaults: tsjPreset } = require("ts-jest/presets");
module.exports = {
	roots: ["<rootDir>/src"],
	transform: {
		...tsjPreset.transform,
	},
};