delete process.env.ELECTRON_RUN_AS_NODE;

const { spawn } = require("node:child_process");

const child = spawn("electron-vite", ["dev"], {
  stdio: "inherit",
  shell: true,
  env: process.env
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
