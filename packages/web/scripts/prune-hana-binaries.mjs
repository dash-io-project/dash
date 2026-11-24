import { createRequire } from "node:module";
import { readdir, rm } from "node:fs/promises";

// Keep the binary for this machine. The server output must not ship the other platforms.
const keepByPlatform = {
  "linux:x64": "linuxx86_64",
  "linux:arm64": "linuxaarch64",
  "darwin:arm64": "darwinarm64",
  "darwin:x64": "darwinintel64",
  "win32:x64": "ntamd64",
};

const prebuilt = new URL(
  "../.output/server/node_modules/@sap/hana-client/prebuilt/",
  import.meta.url,
);

let names;
try {
  names = await readdir(prebuilt);
} catch {
  console.error("SAP HANA driver is missing from the server output.");
  process.exit(1);
}

const keep = keepByPlatform[`${process.platform}:${process.arch}`];
if (!keep) {
  console.error(`SAP HANA driver has no binary for ${process.platform} ${process.arch}.`);
  process.exit(1);
}
if (!names.includes(keep)) {
  console.error(`SAP HANA server output has no ${keep} binary.`);
  process.exit(1);
}

for (const name of names) {
  if (name === keep) {
    continue;
  }
  await rm(new URL(name, prebuilt), { recursive: true, force: true });
}

const require = createRequire(new URL("../.output/server/index.mjs", import.meta.url));
const driver = require("@sap/hana-client");
if (typeof driver.createPool !== "function") {
  console.error("SAP HANA driver did not load from the server output.");
  process.exit(1);
}
