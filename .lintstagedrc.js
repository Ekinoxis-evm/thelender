const path = require("path");

const buildNextEslintCommand = (filenames) =>
  `yarn workspace @se-2/nextjs eslint --fix ${filenames
    .map((f) => path.relative(path.join("packages", "nextjs"), f))
    .join(" ")}`;

const checkTypesNextCommand = () => "yarn next:check-types";

// Foundry only — no packages/hardhat in this repo. Solidity is checked via
// `forge fmt` / `forge test` in CI and the `/test-ci` command.
module.exports = {
  "packages/nextjs/**/*.{ts,tsx}": [buildNextEslintCommand, checkTypesNextCommand],
};
