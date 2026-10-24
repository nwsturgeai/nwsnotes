// pm2 settings for the app on the VM. Copied next to server.cjs by the build.
module.exports = {
  apps: [
    {
      name: "nwsnotes",
      script: "server.cjs",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production",
        NWSNOTES_CONFIG: "/etc/nwsnotes/config.json",
      },
    },
  ],
};
