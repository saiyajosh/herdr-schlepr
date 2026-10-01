#!/usr/bin/env node
import fs from "node:fs";

const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const expectedTag = `v${packageJson.version}`;
const actualTag = process.env.GITHUB_REF_NAME ?? process.argv[2];

if (actualTag !== expectedTag) {
  console.error(`Release tag ${JSON.stringify(actualTag)} does not match package version ${JSON.stringify(expectedTag)}.`);
  process.exit(1);
}

console.log(`Release tag ${actualTag} matches package version ${packageJson.version}.`);
